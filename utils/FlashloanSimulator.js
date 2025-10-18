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
        
        // Find best flash provider
        const bestProvider = await this.flashProvider.findBestFlashProvider(token, amount);
        const flashLoanFee = bestProvider.fee;
        
        const gasPrice = await this.getOptimalGasPrice();
        const gasCost = this.GAS_ESTIMATE * gasPrice * 1e-9 * this.BNB_PRICE;
        
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
        const ethAmount = usdAmount / this.ETH_PRICE;
        const gasPrice = await this.getOptimalGasPrice();
        
        // Find best flash provider
        const bestProvider = await this.flashProvider.findBestFlashProvider('WETH', ethAmount);
        const flashLoanFeeEth = bestProvider.fee;
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
            requiredEth: ethAmount.toFixed(4),
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
                'CAKE': 1.45,
                'LINK': 13.2
            };
            return mockPrices[token] || 1;
        }

        try {
            const price = await this.priceService.getLivePrice(
                token,
                inUSD ? 'USDT' : 'BNB'
            );
            return price || 1; // Fallback to 1 if price fetch fails
        } catch (e) {
            console.error(`Error fetching price for ${token}:`, e);
            return 1;
        }
    }
}

module.exports = FlashloanSimulator;
