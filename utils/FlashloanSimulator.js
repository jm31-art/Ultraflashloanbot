const { ethers } = require("hardhat");
const PriceService = require("../services/PriceService");
const FlashProvider = require("./FlashProvider");
const DexLiquidityChecker = require("./DexLiquidityChecker");

const DODO_ABI = [
    "function flashLoan(uint256 baseAmount,uint256 quoteAmount,address assetTo,bytes calldata data) external",
    "function _DODO_POOL_(address token) external view returns (address)",
    "function getDODOPool(address token) external view returns (address)",
    "function getDODOPoolByRouter(address token) external view returns (address)",
    "function balanceOf(address token) external view returns (uint256)",
    "function getVaultForToken(address token) external view returns (address)",
    "function getLiquidityPool(address token) external view returns (address)",
    "function getFlashLoanPool(address token) external view returns (address)",
    "function getReserveBalance(address token) external view returns (uint256)"
];

const IERC20_ABI = [
    "function balanceOf(address account) view returns (uint256)",
    "function decimals() view returns (uint8)"
];

class FlashloanSimulator {
    constructor(provider) {
        this.provider = provider;
        this.GAS_ESTIMATE = 850000; // Higher for BSC complex routing
        this.TEST_MODE = process.env.NODE_ENV === 'test';
        this.priceService = new PriceService();
        
        // CoinAPI service removed
        
        this.BNB_PRICE = 220; // Default BNB price, will be updated
        this.ETH_PRICE = 1650; // Default ETH price, will be updated
        this.flashProvider = new FlashProvider(provider);
        this.dexLiquidity = new DexLiquidityChecker(provider);
        this.initializePrices();
    }

    async initializePrices() {
        try {
            const bnbPrice = await this.getTokenPrice('WBNB');
            const ethPrice = await this.getTokenPrice('WETH');
            this.BNB_PRICE = bnbPrice;
            this.ETH_PRICE = ethPrice;
        } catch (error) {
            console.warn('Failed to initialize prices, using defaults:', error.message);
        }
    }

    async findVault(providerAddress, tokenAddress) {
        if (this.TEST_MODE) {
            return "0x" + "1".repeat(40); // Mock vault address
        }

        try {
            const normalizedTokenAddress = ethers.utils.getAddress(tokenAddress);
            const dodoRouter = new ethers.Contract(providerAddress, DODO_ABI, this.provider);
            
            // Try different methods to find the DODO pool
            const methods = [
                'getVaultForToken',
                'getLiquidityPool',
                'getFlashLoanPool',
                '_DODO_POOL_',
                'getDODOPool',
                'getDODOPoolByRouter'
            ];
            
            for (const method of methods) {
                try {
                    const pool = await dodoRouter[method](normalizedTokenAddress);
                    if (pool && pool !== ethers.constants.AddressZero) {
                        const poolContract = new ethers.Contract(pool, IERC20_ABI, this.provider);
                        // Verify pool has balance
                        const balance = await poolContract.balanceOf(pool);
                        if (balance.gt(0)) {
                            console.log(`Found active DODO pool for ${tokenAddress} using ${method}: ${pool}`);
                            return pool;
                        }
                    }
                } catch (e) {
                    console.log(`Method ${method} failed:`, e.message);
                }
            }
            
            console.log(`No active DODO pool found for token ${tokenAddress}`);
            return null;
            
        } catch (e) {
            console.error('Pool check failed:', e.message);
            return null;
        }
    }

    async checkLiquidity(vaultAddress, tokenAddress) {
        if (this.TEST_MODE) {
            return {
                available: ethers.utils.parseEther("1000"),
                formatted: "1000.0"
            };
        }
        
        try {
            const normalizedTokenAddress = ethers.utils.getAddress(tokenAddress);
            const vault = new ethers.Contract(vaultAddress, DODO_ABI, this.provider);
            const token = new ethers.Contract(normalizedTokenAddress, IERC20_ABI, this.provider);
            
            // Get vault balance
            const balance = await token.balanceOf(vaultAddress);
            const decimals = await token.decimals();
            const formatted = ethers.utils.formatUnits(balance, decimals);
            
            // Calculate max flash loan (DODO allows up to 90% of pool liquidity)
            const maxLoan = balance.mul(90).div(100);
            const formattedMaxLoan = ethers.utils.formatUnits(maxLoan, decimals);
            
            console.log(`DODO vault ${vaultAddress} liquidity for ${tokenAddress}:`);
            console.log(`Total Balance: ${formatted}`);
            console.log(`Max Flash Loan: ${formattedMaxLoan}`);
            
            // Calculate fee for sample amount
            const sampleAmount = ethers.utils.parseUnits("10000", decimals);
            const fee = sampleAmount.mul(3).div(1000); // 0.3% fee
            const formattedFee = ethers.utils.formatUnits(fee, decimals);
            
            return {
                available: maxLoan,
                formatted: formattedMaxLoan,
                actualBalance: balance,
                formattedBalance: formatted,
                fee: formattedFee
            };
            
        } catch (error) {
            console.error('Liquidity check failed:', error.message);
            return { available: 0, formatted: '0' };
        }
    }

    async calculateArbitrageProfitability(opportunity) {
        const { amount, buyPrice, sellPrice, token } = opportunity;
        
        // Calculate raw profit from price difference
        const rawProfit = amount * (sellPrice - buyPrice);
        
        // Find best flash provider - DODO with 0.02% fee from simulation
        const bestProvider = await this.flashProvider.findBestFlashProvider(token, amount);
        const flashLoanFee = bestProvider.fee;

        const gasPrice = await this.getOptimalGasPrice();
        // Use fixed gas cost from simulation ($3.22) instead of variable calculation
        const gasCost = 3.22; // Fixed gas cost from Hardhat simulation results
        
        // Estimate price impact based on amount
        let priceImpact;
        try {
            const impactEstimate = amount / 1000000; // Simplified estimate: 0.1% per $1M
            priceImpact = Math.min(impactEstimate, 0.02); // Cap at 2%
        } catch (error) {
            console.error('Error calculating price impact:', error);
            priceImpact = 0.001; // Default to 0.1%
        }
        
        // Calculate adjusted profit
        const impactCost = amount * priceImpact;
        const adjustedProfit = rawProfit - flashLoanFee - gasCost - impactCost;
        const profitMargin = (adjustedProfit / amount) * 100;
        
        return {
            rawProfit,
            costs: {
                flashLoanFee,
                gasCost: gasCost,
                impactCost
            },
            priceImpact,
            adjustedProfit,
            profitMargin,
            isProfitable: adjustedProfit > 0,
            details: {
                priceSpread: ((sellPrice - buyPrice) / buyPrice) * 100,
                token,
                gasPrice,
                provider: bestProvider.protocol,
                type: bestProvider.type
            }
        };
    }

    async simulateRange(start, end, step) {
        if (this.TEST_MODE) {
            // Return mock simulation for testing
            const mockSimulation = {
                requiredEth: "10.0000",
                flashLoanFeeUsd: 30.00,
                gasCostUsd: 5.00,
                totalCostUsd: 35.00,
                minProfitUsd: 42.00,
                requiredPriceDiff: 0.42,
                gasPrice: 5
            };

            console.log(`\nSimulation for $${start.toLocaleString()} - $${end.toLocaleString()}:`);
            console.log('=====================================');
            console.log(`Required BNB: ${mockSimulation.requiredEth} BNB`);
            console.log(`Equalizer Fee: $${mockSimulation.flashLoanFeeUsd.toFixed(2)}`);
            console.log(`Gas Cost (@ ${mockSimulation.gasPrice} Gwei): $${mockSimulation.gasCostUsd.toFixed(2)}`);
            console.log(`Total Cost: $${mockSimulation.totalCostUsd.toFixed(2)}`);
            console.log(`Min Required Profit: $${mockSimulation.minProfitUsd.toFixed(2)}`);
            console.log(`Required Price Difference: ${mockSimulation.requiredPriceDiff.toFixed(2)}%`);
            
            return [mockSimulation];
        }

        const results = [];
        for (let amount = start; amount <= end; amount += step) {
            const simulation = await this.simulateAmount(amount);
            results.push(simulation);
            
            // Print simulation results
            console.log(`\nSimulation for $${amount.toLocaleString()}:`);
            console.log('=====================================');
            console.log(`Required ETH: ${simulation.requiredEth} ETH`);
            console.log(`Flash ${simulation.type} Fee: $${simulation.flashLoanFeeUsd.toFixed(2)}`);
            console.log(`Gas Cost (@ ${simulation.gasPrice} Gwei): $${simulation.gasCostUsd.toFixed(2)}`);
            console.log(`Total Cost: $${simulation.totalCostUsd.toFixed(2)}`);
            console.log(`Min Required Profit: $${simulation.minProfitUsd.toFixed(2)}`);
            console.log(`Required Price Difference: ${simulation.requiredPriceDiff.toFixed(2)}%`);
        }
        return results;
    }

    async simulateAmount(usdAmount) {
        // Convert USD amount to ETH (we multiply by 1e18 to get wei format)
        const ethAmountInWei = ethers.utils.parseEther(
            (usdAmount / this.ETH_PRICE).toFixed(18)
        );
        
        const gasPrice = await this.getOptimalGasPrice();
        
        // Find best flash provider using wei amount
        const bestProvider = await this.flashProvider.findBestFlashProvider('WETH', ethAmountInWei);
        
        // Convert fee back to ETH for display
        const flashLoanFeeEth = parseFloat(ethers.utils.formatEther(bestProvider.fee));
        
        // Gas cost calculation
        const gasCostEth = (this.GAS_ESTIMATE * gasPrice * 1e-9);
        
        // Convert to USD
        const flashLoanFeeUsd = flashLoanFeeEth * this.ETH_PRICE;
        const gasCostUsd = gasCostEth * this.ETH_PRICE;
        const totalCostUsd = flashLoanFeeUsd + gasCostUsd;
        
        // Add 20% safety margin for minimum profit
        const minProfitUsd = totalCostUsd * 1.2;
        
        // Calculate required price difference
        const requiredPriceDiff = (minProfitUsd / usdAmount) * 100;

        return {
            amount: usdAmount,
            requiredEth: (usdAmount / this.ETH_PRICE).toFixed(4),
            flashLoanFeeUsd,
            gasCostUsd,
            totalCostUsd,
            minProfitUsd,
            requiredPriceDiff,
            gasPrice,
            provider: bestProvider.protocol,
            type: bestProvider.type
        };
    }

    async getOptimalGasPrice() {
        const gasPrice = await ethers.provider.getGasPrice();
        return Math.ceil(ethers.utils.formatUnits(gasPrice, 'gwei'));
    }

    async getTokenPrice(token, inUSD = true) {
        if (this.TEST_MODE) {
            // Return mock prices for testing
            const mockPrices = {
                'WBNB': 220,
                'USDT': 1,
                'USDC': 1,
                'WETH': 1650,
                // CAKE price removed
                'LINK': 13.2
            };
            return mockPrices[token] || 1;
        }

        try {
            // Use PriceService for price fetching
            const price = await this.priceService.getLivePrice(
                token,
                inUSD ? 'USDT' : 'BNB'
            );

            if (price) {
                console.log(`${token} price from PriceService: $${price}`);
                return price;
            }

            console.warn(`Failed to get price for ${token}, using fallback`);
            return 1; // Fallback to 1 if all price fetches fail

        } catch (e) {
            console.error(`Error fetching price for ${token}:`, e);
            return 1;
        }
    }

    async simulateArbitrage(opportunity) {
        if (!opportunity) {
            throw new Error('Invalid opportunity structure');
        }

        try {
            if (opportunity.type === 'triangular') {
                return await this.simulateTriangularArbitrage(opportunity);
            } else {
                return await this.simulateTwoTokenArbitrage(opportunity);
            }
        } catch (error) {
            console.error('Arbitrage simulation failed:', error);
            return {
                isProfitable: false,
                error: error.message
            };
        }
    }

    async simulateTwoTokenArbitrage(opportunity) {
        if (!opportunity.token || !opportunity.buyPrice || !opportunity.sellPrice) {
            throw new Error('Invalid two-token opportunity structure');
        }

        // Get token details
        const token = opportunity.token;
        const buyPrice = opportunity.buyPrice;
        const sellPrice = opportunity.sellPrice;

        // Calculate optimal trade amount based on price difference
        const spread = (sellPrice - buyPrice) / buyPrice;
        const optimalAmount = await this.calculateOptimalTradeAmount(spread, token);

        // Create opportunity with optimal amount
        const optimizedOpportunity = {
            ...opportunity,
            amount: optimalAmount
        };

        // Calculate profitability with all costs included
        const profitability = await this.calculateArbitrageProfitability(optimizedOpportunity);

        // Check liquidity constraints
        const buyDexLiquidity = await this.dexLiquidity.checkDexLiquidity(
            opportunity.buyDex,
            token,
            optimalAmount
        );

        const sellDexLiquidity = await this.dexLiquidity.checkDexLiquidity(
            opportunity.sellDex,
            token,
            optimalAmount
        );

        // Verify sufficient liquidity
        const hasEnoughLiquidity = buyDexLiquidity && sellDexLiquidity &&
            buyDexLiquidity.available >= optimalAmount &&
            sellDexLiquidity.available >= optimalAmount;

        return {
            ...profitability,
            token,
            amount: optimalAmount,
            buyDex: opportunity.buyDex,
            sellDex: opportunity.sellDex,
            buyPrice,
            sellPrice,
            spread,
            hasEnoughLiquidity,
            liquidity: {
                buy: buyDexLiquidity,
                sell: sellDexLiquidity
            }
        };
    }

    async simulateTriangularArbitrage(opportunity) {
        if (!opportunity.tokens || !opportunity.rates || !opportunity.path) {
            throw new Error('Invalid triangular opportunity structure');
        }

        const { tokens, rates, path, profitPercent } = opportunity;

        // Calculate optimal trade amount for triangular arbitrage
        const optimalAmount = await this.calculateOptimalTriangularAmount(tokens[0], profitPercent);

        // Calculate profitability for triangular arbitrage
        const profitability = await this.calculateTriangularProfitability(opportunity, optimalAmount);

        // Check liquidity for all three pairs
        const liquidityChecks = [];
        for (const [pair, rate] of Object.entries(rates)) {
            const [token0, token1] = pair.split('/');
            try {
                const liquidity = await this.dexLiquidity.checkDexLiquidity(
                    opportunity.dex,
                    token0,
                    optimalAmount
                );
                liquidityChecks.push({ pair, liquidity });
            } catch (error) {
                console.log(`Liquidity check failed for ${pair}: ${error.message}`);
                liquidityChecks.push({ pair, liquidity: null });
            }
        }

        // Verify sufficient liquidity for all pairs
        const hasEnoughLiquidity = liquidityChecks.every(check =>
            check.liquidity && check.liquidity.available >= optimalAmount
        );

        return {
            ...profitability,
            tokens,
            path,
            amount: optimalAmount,
            dex: opportunity.dex,
            profitPercent,
            rates,
            hasEnoughLiquidity,
            liquidity: liquidityChecks
        };
    }

    async calculateTriangularProfitability(opportunity, amount) {
        const { profitPercent, fees } = opportunity;

        // Get current price for the starting token
        const startToken = opportunity.tokens[0];
        const tokenPrice = await this.getTokenPrice(startToken);

        // Calculate USD value of the trade
        const usdValue = amount * tokenPrice;

        // Calculate gross profit
        const grossProfit = usdValue * (profitPercent / 100);

        // Use dynamic fees from opportunity or fallback to defaults
        const flashLoanFee = usdValue * (fees?.flashLoanFee || 0.003); // 0.3% flash loan fee
        const dexFees = usdValue * (fees?.dexFee || 0.009); // 0.3% per swap * 3 swaps
        const gasCost = 6.00; // Higher gas cost for triangular arbitrage

        const totalFees = flashLoanFee + dexFees + gasCost;
        const netProfit = grossProfit - totalFees;

        return {
            rawProfit: grossProfit,
            costs: {
                flashLoanFee,
                dexFees,
                gasCost,
                totalFees
            },
            adjustedProfit: netProfit,
            profitMargin: (netProfit / usdValue) * 100,
            isProfitable: netProfit > 0,
            details: {
                type: 'triangular',
                path: opportunity.path,
                tokens: opportunity.tokens,
                feeImpact: fees?.totalFees || 0.012 // Total fee impact (1.2%)
            }
        };
    }

    async calculateOptimalTriangularAmount(startToken, profitPercent) {
        // Base amount for triangular arbitrage (more conservative)
        const baseAmount = 25000; // $25k base

        // Adjust based on profit percentage
        const multiplier = Math.min(profitPercent / 2, 3); // Cap at 3x
        let optimalAmount = baseAmount * multiplier;

        // Get gas costs
        const gasPrice = await this.getOptimalGasPrice();
        const gasCost = (this.GAS_ESTIMATE * 1.5 * gasPrice * 1e-9 * this.BNB_PRICE); // 1.5x gas for triangular

        // Ensure amount covers gas costs
        const minAmount = gasCost * 20; // Amount should be at least 20x gas costs for triangular
        optimalAmount = Math.max(optimalAmount, minAmount);

        // Cap based on token
        const maxAmount = await this.getMaxTradeAmount(startToken);
        optimalAmount = Math.min(optimalAmount, maxAmount * 0.5); // More conservative for triangular

        return optimalAmount;
    }

    async calculateOptimalTradeAmount(spread, token) {
        // Base amount on spread percentage
        // Larger spreads allow for larger trades
        const baseAmount = 10000; // $10k base
        const multiplier = Math.min(spread * 100, 5); // Cap at 5x
        let optimalAmount = baseAmount * multiplier;
        
        // Check gas costs relative to amount
        const gasPrice = await this.getOptimalGasPrice();
        const gasCost = this.GAS_ESTIMATE * gasPrice * 1e-9 * this.BNB_PRICE;
        
        // Ensure amount is large enough for gas costs
        const minAmount = gasCost * 10; // Amount should be at least 10x gas costs
        optimalAmount = Math.max(optimalAmount, minAmount);
        
        // Cap amount based on token and market conditions
        const maxAmount = await this.getMaxTradeAmount(token);
        optimalAmount = Math.min(optimalAmount, maxAmount);
        
        return optimalAmount;
    }

    async getMaxTradeAmount(token) {
        try {
            // Get current price
            const price = await this.getTokenPrice(token);
            
            // Base max amount on token's price and market cap
            let maxAmount;
            if (token === 'WETH' || token === 'WBTC') {
                maxAmount = 1000000; // $1M for major assets
            } else if (token === 'WBNB') {
                maxAmount = 500000; // $500k for BNB
            } else {
                maxAmount = 100000; // $100k for other tokens
            }
            
            // Adjust based on price volatility
            // This is a simplified example - in production you'd want to calculate actual volatility
            const volatilityFactor = 1.0; // 1.0 means no adjustment
            return maxAmount * volatilityFactor;
            
        } catch (error) {
            console.error('Error calculating max trade amount:', error);
            return 50000; // Conservative fallback of $50k
        }
    }
}

module.exports = FlashloanSimulator;
