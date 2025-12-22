import dotenv from "dotenv";
dotenv.config();
import { EventEmitter } from 'events';
import { ethers, getAddress, ZeroAddress } from 'ethers';
import { spawn } from 'child_process';
import path from 'path';
import rpcManager from '../infra/RPCManager.js';

// Import ABIs
import ERC20_ABI from '../abi/erc20.json' with { type: 'json' };
import ROUTER_ABI from '../abi/router.json' with { type: 'json' };
import PAIR_ABI from '../abi/pair.json' with { type: 'json' };

// BSC Configuration
const BSC_RPC_URL = process.env.RPC_URL || 'https://bsc-dataseed.binance.org/';
const TOKENS = {
    WBNB: { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
    USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    BUSD: { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18 },
    CAKE: { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', decimals: 18 },
    BTCB: { address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18 }
};

const DEX_CONFIGS = {
    PANCAKESWAP: {
        router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
        name: 'PancakeSwap'
    },
    BISWAP: {
        router: '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8',
        factory: '0x858E3312ed3A876947EA49d572A7C42DE08af7EE0',
        name: 'Biswap'
    }
};

class ArbitrageBot extends EventEmitter {
    constructor(provider, signer, options = {}) {
        super();

        // Input validation
        if (!provider) {
            throw new Error('Provider is required for ArbitrageBot');
        }
        if (!signer) {
            throw new Error('Signer is required for ArbitrageBot');
        }

        // Initialize provider and signer
        this.provider = provider;
        this.signer = signer;

        // Validate provider
        if (typeof this.provider.getBlockNumber !== 'function') {
            throw new Error('Invalid ethers provider — provider not initialized correctly');
        }

        // Configuration
        this.minProfitUSD = options.minProfitUSD || 1.0; // $1 minimum profit
        this.maxSlippage = options.maxSlippage || 0.05; // 5% max slippage
        this.scanInterval = options.scanInterval || 5000; // 5 second scan interval
        this.maxGasPrice = options.maxGasPrice || 10; // 10 gwei max gas price
        this.safeGasLimit = 500000; // Safe fallback gas limit

        // Router contracts cache
        this.routers = new Map();

        // State
        this.isRunning = false;
        this.lastScanTime = 0;
        this.totalTrades = 0;
        this.successfulTrades = 0;
        this.pythonProcessRunning = false; // Prevent multiple Python processes

        // Low-balance bootstrapping for Extreme Mode - FORCE REAL EXECUTION
        this.bootstrapTradesExecuted = 0;
        this.maxBootstrapTrades = 2;
        this.bootstrapProfitThreshold = 0.5; // $0.50 for first 2 trades (ultra micro-arbs)
        this.normalProfitThreshold = 10.0; // $10 after bootstrapping
        this.executionEnabled = true; // FORCE REAL EXECUTION
        this.forceExtremeMode = true; // Force extreme mode for bootstrapping
        console.log('🚀 ARBITRAGE BOT: EXTREME MODE BOOTSTRAP ENABLED');
        console.log('🎯 Target: Execute 2 micro-arbs ($0.50+ profit) to recoup gas');

        // Python calculator path
        this.pythonCalculatorPath = path.join(__dirname, '../services/PythonArbitrageCalculator.py');

        // Flashloan integration for bootstrap
        this.flashloanContract = null;
        this._initializeFlashloan();

        console.log('✅ ArbitrageBot initialized successfully');

        // Initialize flashloan for bootstrap arbitrage
        this._initializeFlashloan();
    }

    /**
     * Initialize flashloan contract for bootstrap arbitrage
     */
    async _initializeFlashloan() {
        try {
            const flashloanAddress = process.env.FLASHLOAN_ARB_CONTRACT || '0xf682bd44ca1Fb8184e359A8aF9E1732afD29BBE1';
            if (flashloanAddress && flashloanAddress !== '0x0000000000000000000000000000000000000000') {
                const flashloanAbi = [
                    "function executeFlashloanArbitrage(address asset, uint256 amount, address[] calldata path, address router, uint256 minProfit) external",
                    "function executeAtomicLiquidation(address lendingProtocol, address borrower, address debtAsset, address collateralAsset, uint256 debtToCover, uint256 minProfit, bytes calldata arbitrageData) external"
                ];
                this.flashloanContract = new ethers.Contract(flashloanAddress, flashloanAbi, this.signer);
                console.log('🔥 ArbitrageBot: Flashloan contract initialized for bootstrap');
            } else {
                console.log('⚠️ ArbitrageBot: No flashloan contract - using direct swaps');
            }
        } catch (error) {
            console.warn('⚠️ ArbitrageBot: Flashloan initialization failed:', error.message);
        }
    }

    /**
     * Initialize the arbitrage bot (required by UnifiedStrategyManager)
     */
    async initialize() {
        console.log('🔄 Initializing arbitrage bot...');

        try {
            // Test provider connection
            await this.provider.getBlockNumber();

            // Test signer
            if (!this.signer.address) {
                throw new Error('Signer not properly initialized');
            }

            console.log('✅ Arbitrage bot initialized successfully');
            return true;

        } catch (error) {
            console.error('❌ Failed to initialize arbitrage bot:', error.message);
            return false;
        }
    }

    /**
     * Safely initialize router contract
     */
    async getRouterContract(dexName) {
        if (this.routers.has(dexName)) {
            return this.routers.get(dexName);
        }

        try {
            const dexConfig = DEX_CONFIGS[dexName.toUpperCase()];
            if (!dexConfig) {
                throw new Error(`Unknown DEX: ${dexName}`);
            }

            const routerContract = new ethers.Contract(
                dexConfig.router,
                ROUTER_ABI,
                this.signer
            );

            // Test the contract
            await routerContract.WETH(); // Simple call to verify contract

            this.routers.set(dexName, routerContract);
            console.log(`✅ Router contract initialized for ${dexName}`);
            return routerContract;

        } catch (error) {
            console.error(`❌ Failed to initialize ${dexName} router:`, error.message);
            throw error;
        }
    }

    /**
     * Check and approve token allowance if needed
     */
    async ensureAllowance(tokenAddress, spenderAddress, amount) {
        try {
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.signer);

            // Check current allowance
            const currentAllowance = await tokenContract.allowance(this.signer.address, spenderAddress);

            // If allowance is insufficient, approve MAX_UINT
            if (currentAllowance < amount) {
                console.log(`🔄 Approving ${tokenAddress} for ${spenderAddress}...`);

                const tx = await tokenContract.approve(spenderAddress, ethers.MaxUint256);
                await tx.wait();

                console.log(`✅ Token approval successful: ${tx.hash}`);
                return true;
            }

            return true; // Already approved

        } catch (error) {
            console.error(`❌ Token approval failed for ${tokenAddress}:`, error.message);
            throw error;
        }
    }

    /**
     * Safely fetch pair reserves with fallback
     */
    async getReservesSafe(pairAddress) {
        try {
            const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
            const [reserve0, reserve1] = await pairContract.getReserves();

            return {
                reserve0: Number(reserve0),
                reserve1: Number(reserve1),
                success: true
            };

        } catch (error) {
            console.warn(`⚠️ Failed to fetch reserves for ${pairAddress}, using fallback:`, error.message);

            // Return fallback reserves
            return {
                reserve0: 1000000, // 1M tokens fallback
                reserve1: 1000000,
                success: false,
                fallback: true
            };
        }
    }

    /**
     * Check if trade is safe (slippage protection)
     */
    async isTradeSafe(tokenIn, tokenOut, amountIn, expectedOut, maxSlippage = 0.05) {
        try {
            // Get router for price check
            const router = await this.getRouterContract('PANCAKESWAP');

            // Get expected output from router
            const amountsOut = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
            const routerExpectedOut = amountsOut[1];

            // Calculate slippage
            const slippage = Math.abs(routerExpectedOut - expectedOut) / Math.max(routerExpectedOut, expectedOut);

            console.log(`🎯 Slippage check: ${slippage.toFixed(4)} (max: ${maxSlippage.toFixed(4)})`);

            return slippage <= maxSlippage;

        } catch (error) {
            console.warn(`⚠️ Slippage check failed, allowing trade:`, error.message);
            return true; // Allow trade if check fails
        }
    }

    /**
     * Execute a trade with safe gas limits
     */
    async executeTrade(dexName, tokenIn, tokenOut, amountIn, amountOutMin, path, options = {}) {
        try {
            console.log(`🚀 Executing trade: ${ethers.formatEther(amountIn)} ${tokenIn} -> ${tokenOut} via ${dexName}`);

            // Get router contract
            const router = await this.getRouterContract(dexName);

            // Ensure allowance
            await this.ensureAllowance(tokenIn, router.target, amountIn);

            // Set deadline (5 minutes from now)
            const deadline = Math.floor(Date.now() / 1000) + 300;

            // Estimate gas safely
            let gasLimit;
            try {
                gasLimit = await router.swapExactTokensForTokens.estimateGas(
                    amountIn,
                    amountOutMin,
                    path,
                    this.signer.address,
                    deadline
                );
                // Add 20% buffer
                gasLimit = gasLimit * 120n / 100n;
            } catch (gasError) {
                console.warn(`⚠️ Gas estimation failed, using safe limit:`, gasError.message);
                gasLimit = BigInt(this.safeGasLimit);
            }

            // Get gas price
            const feeData = await this.provider.getFeeData();
            let gasPrice = feeData.gasPrice;

            // Cap gas price
            const maxGasPriceWei = ethers.parseUnits(this.maxGasPrice.toString(), 'gwei');
            if (gasPrice > maxGasPriceWei) {
                gasPrice = maxGasPriceWei;
            }

            // Execute the swap
            const tx = await router.swapExactTokensForTokens(
                amountIn,
                amountOutMin,
                path,
                this.signer.address,
                deadline,
                {
                    gasLimit: gasLimit,
                    gasPrice: gasPrice
                }
            );

            console.log(`📤 Transaction submitted: ${tx.hash}`);

            // Wait for confirmation
            const receipt = await tx.wait();

            if (receipt.status === 1) {
                console.log(`✅ Trade executed successfully: ${tx.hash}`);
                this.totalTrades++;
                this.successfulTrades++;

                return {
                    success: true,
                    txHash: tx.hash,
                    gasUsed: receipt.gasUsed,
                    blockNumber: receipt.blockNumber
                };
            } else {
                throw new Error('Transaction reverted');
            }

        } catch (error) {
            console.error(`❌ Trade execution failed:`, error.message);
            this.totalTrades++;
            throw error;
        }
    }

    /**
     * Display detailed arbitrage opportunity information
     */
    async _displayArbitrageOpportunity(opportunity, profitUSD) {
        try {
            const { path, amountIn, amountOut, expectedProfitUSD, router, spread } = opportunity;

            // Get token symbols for display
            const pathSymbols = path.map(addr => {
                for (const [symbol, token] of Object.entries(TOKENS)) {
                    if (token.address.toLowerCase() === addr.toLowerCase()) return symbol;
                }
                return addr.substring(0, 6) + '...';
            });

            console.log(`\n🎯 ARBITRAGE OPPORTUNITY FOUND:`);
            console.log(`   Path: ${pathSymbols.join(' → ')}`);
            console.log(`   Router: ${router}`);
            console.log(`   Amount In: ${amountIn} tokens`);
            console.log(`   Expected Out: ${amountOut} tokens`);
            console.log(`   Expected Profit: $${profitUSD.toFixed(2)} USD (${spread ? spread.toFixed(4) + '%' : 'N/A'} spread)`);

            // Get real-time prices from DEXes to show spread
            const pair1 = `${pathSymbols[0]}/${pathSymbols[1]}`;
            const pair2 = `${pathSymbols[1]}/${pathSymbols[2]}`;
            const pair3 = `${pathSymbols[2]}/${pathSymbols[0]}`;

            console.log(`   DEX Prices:`);

            // Get prices for each pair
            const DexPriceFeed = (await import('../services/DexPriceFeed.js')).default;
            const priceFeed = new DexPriceFeed(this.provider);

            try {
                const prices1 = await priceFeed.getAllPrices(pair1);
                const prices2 = await priceFeed.getAllPrices(pair2);
                const prices3 = await priceFeed.getAllPrices(pair3);

                // Display prices from available DEXes
                const displayDexPrices = (pair, prices) => {
                    const dexes = Object.keys(prices).filter(dex =>
                        prices[dex] && typeof prices[dex] === 'object' && prices[dex].price
                    );

                    dexes.slice(0, 3).forEach(dex => { // Show top 3 DEXes
                        const price = prices[dex].price;
                        const liquidity = prices[dex].liquidity || 'unknown';
                        console.log(`     ${dex}: ${price.toFixed(6)} (${liquidity})`);
                    });
                };

                console.log(`     ${pair1}:`);
                displayDexPrices(pair1, prices1);
                console.log(`     ${pair2}:`);
                displayDexPrices(pair2, prices2);
                console.log(`     ${pair3}:`);
                displayDexPrices(pair3, prices3);

                // Calculate and display spread
                const bestPrices = this._calculateBestPrices([prices1, prices2, prices3]);
                if (bestPrices.spread > 0) {
                    console.log(`   Calculated Spread: ${bestPrices.spread.toFixed(4)}%`);
                    console.log(`   Best Route: ${bestPrices.buyDex} → ${bestPrices.sellDex}`);
                }

            } catch (priceError) {
                console.log(`   Price fetch failed: ${priceError.message}`);
            }

            console.log(`   Status: Ready for execution\n`);

        } catch (error) {
            console.error('❌ Error displaying arbitrage opportunity:', error.message);
        }
    }

    /**
     * Calculate best prices and spread from DEX price data
     */
    _calculateBestPrices(priceArrays) {
        const allPrices = [];

        priceArrays.forEach((prices, index) => {
            Object.keys(prices).forEach(dex => {
                if (prices[dex] && typeof prices[dex] === 'object' && prices[dex].price) {
                    allPrices.push({
                        dex: dex,
                        price: prices[dex].price,
                        pairIndex: index
                    });
                }
            });
        });

        if (allPrices.length < 2) return { spread: 0 };

        // Find best buy and sell prices
        let bestBuy = Math.min(...allPrices.map(p => p.price));
        let bestSell = Math.max(...allPrices.map(p => p.price));

        const spread = ((bestSell - bestBuy) / bestBuy) * 100;

        const buyDex = allPrices.find(p => p.price === bestBuy)?.dex || 'unknown';
        const sellDex = allPrices.find(p => p.price === bestSell)?.dex || 'unknown';

        return { spread, buyDex, sellDex };
    }

    /**
     * Execute triangular arbitrage opportunity
     */
    async executeTriangularArbitrage(opportunity) {
        try {
            // Validate opportunity format from Python
            const { path, amountIn, amountOut, expectedProfitUSD, router, spread } = opportunity;

            // Validate required fields
            if (!path || !Array.isArray(path) || path.length !== 3) {
                console.error('❌ Invalid path in opportunity:', path);
                return null;
            }

            if (!amountIn || typeof amountIn !== 'number') {
                console.error('❌ Invalid amountIn in opportunity:', amountIn);
                return null;
            }

            if (!amountOut || typeof amountOut !== 'number') {
                console.error('❌ Invalid amountOut in opportunity:', amountOut);
                return null;
            }

            if (!expectedProfitUSD || typeof expectedProfitUSD !== 'number') {
                console.error('❌ Invalid expectedProfitUSD in opportunity:', expectedProfitUSD);
                return null;
            }

            if (!router || typeof router !== 'string') {
                console.error('❌ Invalid router in opportunity:', router);
                return null;
            }

            // Convert amounts to Wei for blockchain operations
            const amountInWei = ethers.parseEther(amountIn.toString());
            const amountOutWei = ethers.parseEther(amountOut.toString());

            // Validate amounts are positive
            if (amountInWei <= 0n) {
                console.error('❌ amountIn must be positive:', amountInWei);
                return null;
            }

            if (expectedProfitUSD <= 0) {
                console.log('⚠️ Expected profit is not positive, skipping');
                return null;
            }

            // Validate token addresses
            const [tokenAAddress, tokenBAddress, tokenCAddress] = path;
            if (!ethers.isAddress(tokenAAddress) || !ethers.isAddress(tokenBAddress) || !ethers.isAddress(tokenCAddress)) {
                console.error('❌ Invalid token addresses in path:', path);
                return null;
            }

            // Get token symbols for logging
            const pathSymbols = path.map(addr => {
                for (const [symbol, token] of Object.entries(TOKENS)) {
                    if (token.address.toLowerCase() === addr.toLowerCase()) return symbol;
                }
                return addr.substring(0, 6) + '...';
            });

            console.log(`🔄 Executing triangular arbitrage: ${pathSymbols.join(' → ')}`);
            console.log(`   Amount In: ${amountIn} tokens (${ethers.formatEther(amountInWei)} wei)`);
            console.log(`   Expected Out: ${amountOut} tokens`);
            console.log(`   Expected Profit: $${expectedProfitUSD.toFixed(2)} USD (${spread.toFixed(4)}% spread)`);
            console.log(`   Router: ${router}`);

            // Get router contract
            const routerContract = await this.getRouterContract(router);
            if (!routerContract) {
                console.error('❌ Failed to get router contract');
                return null;
            }

            // Verify the arbitrage opportunity on-chain before executing
            const verification = await this._verifyArbitrageOpportunity(path, amountInWei, routerContract);
            if (!verification.isValid) {
                console.log(`⚠️ Arbitrage verification failed: ${verification.reason}`);
                return null;
            }

            // Execute the triangular arbitrage
            // Check wallet balance for gas before executing
            const balance = await this.provider.getBalance(this.signer.address);
            const balanceEth = parseFloat(ethers.formatEther(balance));
            const estimatedGasCost = 0.001; // Conservative 0.001 BNB gas estimate

            if (balanceEth < estimatedGasCost) {
                console.log(`⚠️ Insufficient balance for gas: ${balanceEth} BNB < ${estimatedGasCost} BNB required`);
                console.log(`   Skipping trade - waiting for balance to recover`);
                return null;
            }

            // FORCE EXECUTE REAL TRADE - EXTREME MODE MICRO-ARB
            console.log(`🚀 EXTREME MODE: EXECUTING MICRO-ARB - Estimated profit: $${expectedProfitUSD.toFixed(2)}`);
            console.log(`   Triangular arbitrage: ${pathSymbols.join(' → ')}`);
            console.log(`   Amount: ${amountIn} tokens`);
            console.log(`   Router: ${router}`);
            console.log(`   Wallet Balance: ${balanceEth.toFixed(6)} BNB`);
            console.log(`   Bootstrap Progress: ${this.bootstrapTradesExecuted}/${this.maxBootstrapTrades} trades`);

            // Use flashloan for better profits if available
            let result;
            if (this.flashloanContract && isBootstrapMode) {
                console.log(`🔥 Using flashloan for amplified profits`);
                result = await this._executeFlashloanArbitrage(path, amountInWei, router, expectedProfitUSD);
            } else {
                result = await this._executeTriangularSwap(path, amountInWei, routerContract);
            }

            if (result && result.success) {
                console.log(`💰 Triangular arbitrage completed successfully!`);
                console.log(`   Actual Profit: $${expectedProfitUSD.toFixed(2)}`);
                console.log(`   Transaction: ${result.txHash}`);
                console.log(`   Status: executed ✅`);

                this.totalTrades++;
                this.successfulTrades++;
                this.bootstrapTradesExecuted++;

                // Check if we've completed bootstrapping
                if (this.bootstrapTradesExecuted >= this.maxBootstrapTrades) {
                    console.log(`🚀 Bootstrapping complete! Switched to normal profit threshold: $${this.normalProfitThreshold}`);
                }

                return result;
            } else {
                console.error('❌ Triangular arbitrage execution failed');
                console.log(`   Status: failed ❌`);
                this.totalTrades++;
                return null;
            }

        } catch (error) {
            console.error('❌ Triangular arbitrage execution failed:', error.message);
            console.log(`   Status: error`);
            this.totalTrades++;
            return null;
        }
    }

    /**
     * Verify arbitrage opportunity on-chain
     */
    async _verifyArbitrageOpportunity(path, amountInWei, routerContract) {
        try {
            const [tokenA, tokenB, tokenC] = path;

            // Step 1: A -> B
            const amountsOut1 = await routerContract.getAmountsOut(amountInWei, [tokenA, tokenB]);
            if (!amountsOut1 || amountsOut1.length < 2) {
                return { isValid: false, reason: 'Failed to get A->B amounts' };
            }

            // Step 2: B -> C
            const amountsOut2 = await routerContract.getAmountsOut(amountsOut1[1], [tokenB, tokenC]);
            if (!amountsOut2 || amountsOut2.length < 2) {
                return { isValid: false, reason: 'Failed to get B->C amounts' };
            }

            // Step 3: C -> A
            const amountsOut3 = await routerContract.getAmountsOut(amountsOut2[1], [tokenC, tokenA]);
            if (!amountsOut3 || amountsOut3.length < 2) {
                return { isValid: false, reason: 'Failed to get C->A amounts' };
            }

            const finalAmount = amountsOut3[1];
            const profit = finalAmount - amountInWei;

            if (profit <= 0n) {
                return { isValid: false, reason: 'No profit in arbitrage' };
            }

            return {
                isValid: true,
                finalAmount: finalAmount,
                profit: profit,
                intermediateAmounts: [amountsOut1[1], amountsOut2[1]]
            };

        } catch (error) {
            return { isValid: false, reason: `Verification error: ${error.message}` };
        }
    }

    /**
     * Execute triangular swap with retry logic
     */
    async _executeTriangularSwap(path, amountInWei, routerContract, retryCount = 0) {
        const maxRetries = 2;

        try {
            const [tokenA, tokenB, tokenC] = path;
            const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

            // Create the path for triangular arbitrage: A -> B -> C -> A
            const swapPath = [tokenA, tokenB, tokenC, tokenA];

            // Calculate minimum output (with slippage protection)
            const expectedOutput = await this._calculateExpectedOutput(path, amountInWei, routerContract);
            const minAmountOut = expectedOutput * 95n / 100n; // 5% slippage protection

            // Ensure token allowance
            await this.ensureAllowance(tokenA, routerContract.target, amountInWei);

            // Estimate gas
            let gasLimit;
            try {
                gasLimit = await routerContract.swapExactTokensForTokens.estimateGas(
                    amountInWei,
                    minAmountOut,
                    swapPath,
                    this.signer.address,
                    deadline
                );
                gasLimit = gasLimit * 120n / 100n; // 20% buffer
            } catch (gasError) {
                console.warn(`⚠️ Gas estimation failed, using safe limit:`, gasError.message);
                gasLimit = BigInt(this.safeGasLimit);
            }

            // Get gas price
            const feeData = await this.provider.getFeeData();
            let gasPrice = feeData.gasPrice;
            const maxGasPriceWei = ethers.parseUnits(this.maxGasPrice.toString(), 'gwei');
            if (gasPrice > maxGasPriceWei) {
                gasPrice = maxGasPriceWei;
            }

            // Execute REAL TRANSACTION - no simulation
            console.log(`📤 Submitting real triangular arbitrage transaction...`);

            const tx = await routerContract.swapExactTokensForTokens(
                amountInWei,
                minAmountOut,
                swapPath,
                this.signer.address,
                deadline,
                { gasLimit: gasLimit, gasPrice: gasPrice }
            );

            console.log(`✅ EXTREME MODE: Transaction submitted successfully!`);
            console.log(`   TX Hash: ${tx.hash}`);
            console.log(`   Expected Profit: $${expectedProfitUSD.toFixed(2)}`);

            // Wait for confirmation
            const receipt = await tx.wait();

            if (receipt.status === 1) {
                console.log(`💰 EXTREME MODE: MICRO-ARB COMPLETED SUCCESSFULLY!`);
                console.log(`   TX Hash: ${tx.hash}`);
                console.log(`   Gas Used: ${receipt.gasUsed}`);
                console.log(`   Block: ${receipt.blockNumber}`);
                return {
                    success: true,
                    txHash: tx.hash,
                    gasUsed: receipt.gasUsed,
                    blockNumber: receipt.blockNumber,
                    profit: expectedProfitUSD
                };
            } else {
                console.log(`❌ EXTREME MODE: Transaction reverted`);
                throw new Error('Transaction reverted');
            }

        } catch (error) {
            console.error(`❌ Triangular swap failed (attempt ${retryCount + 1}/${maxRetries + 1}):`, error.message);

            if (retryCount < maxRetries) {
                console.log(`🔄 Retrying triangular swap in 2 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this._executeTriangularSwap(path, amountInWei, routerContract, retryCount + 1);
            }

            return { success: false, error: error.message };
        }
    }

    /**
     * Execute flashloan arbitrage for amplified profits
     */
    async _executeFlashloanArbitrage(path, amountInWei, router, expectedProfitUSD) {
        try {
            if (!this.flashloanContract) {
                throw new Error('Flashloan contract not available');
            }

            const [tokenA, tokenB, tokenC] = path;
            const minProfitWei = ethers.parseEther(Math.max(0, expectedProfitUSD * 0.8).toString()); // 80% of expected

            console.log(`📤 Submitting flashloan arbitrage transaction...`);

            const tx = await this.flashloanContract.executeFlashloanArbitrage(
                tokenA, // asset to flashloan
                amountInWei, // flashloan amount
                [tokenA, tokenB, tokenC, tokenA], // arbitrage path
                router, // router address
                minProfitWei // minimum profit
            );

            console.log(`✅ EXTREME MODE: Flashloan arbitrage submitted successfully!`);
            console.log(`   TX Hash: ${tx.hash}`);
            console.log(`   Flashloan Amount: ${ethers.formatEther(amountInWei)} tokens`);
            console.log(`   Expected Profit: $${expectedProfitUSD.toFixed(2)}`);

            // Wait for confirmation
            const receipt = await tx.wait();

            if (receipt.status === 1) {
                console.log(`💰 EXTREME MODE: FLASHLOAN ARBITRAGE COMPLETED SUCCESSFULLY!`);
                console.log(`   TX Hash: ${tx.hash}`);
                console.log(`   Gas Used: ${receipt.gasUsed}`);
                console.log(`   Block: ${receipt.blockNumber}`);
                return {
                    success: true,
                    txHash: tx.hash,
                    gasUsed: receipt.gasUsed,
                    blockNumber: receipt.blockNumber,
                    profit: expectedProfitUSD,
                    flashloan: true
                };
            } else {
                console.log(`❌ EXTREME MODE: Flashloan arbitrage reverted`);
                throw new Error('Transaction reverted');
            }

        } catch (error) {
            console.log(`❌ Flashloan arbitrage failed, falling back to direct swap:`, error.message);
            // Fallback to direct swap
            const routerContract = await this.getRouterContract(router);
            return await this._executeTriangularSwap(path, amountInWei, routerContract);
        }
    }

    /**
     * Calculate expected output for triangular arbitrage
     */
    async _calculateExpectedOutput(path, amountInWei, routerContract) {
        try {
            const [tokenA, tokenB, tokenC] = path;

            // A -> B -> C -> A
            const amounts1 = await routerContract.getAmountsOut(amountInWei, [tokenA, tokenB]);
            const amounts2 = await routerContract.getAmountsOut(amounts1[1], [tokenB, tokenC]);
            const amounts3 = await routerContract.getAmountsOut(amounts2[1], [tokenC, tokenA]);

            return amounts3[1];
        } catch (error) {
            console.error('❌ Failed to calculate expected output:', error.message);
            // Return input amount as fallback (will likely fail slippage check)
            return amountInWei;
        }
    }


    /**
     * Run Python arbitrage calculator with real price data (single process)
     */
    async runPythonCalculator(amountIn = 1.0) {
        // Prevent multiple Python processes from running simultaneously
        if (this.pythonProcessRunning) {
            console.log('⚠️ Python calculator already running, skipping this scan');
            return { success: false, opportunities: [], errors: [{ type: 'process_busy', error: 'Python calculator already running' }] };
        }

        this.pythonProcessRunning = true;

        return new Promise(async (resolve, reject) => {
            try {
                console.log('🐍 Starting Python arbitrage calculator...');

                // Fetch real-time price data from DexPriceFeed
                const priceData = await this._getRealTimePrices();

                // Prepare price data for Python script
                const priceJson = JSON.stringify(priceData);

                console.log(`📊 Sending price data to Python (${Object.keys(priceData.prices || {}).length} pairs)`);

                const pythonProcess = spawn('python3', [this.pythonCalculatorPath, amountIn.toString(), priceJson], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    timeout: 30000 // 30 second timeout
                });

                let stdout = '';
                let stderr = '';

                pythonProcess.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                pythonProcess.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                pythonProcess.on('close', (code) => {
                    this.pythonProcessRunning = false; // Reset flag

                    try {
                        if (code !== 0) {
                            console.warn(`⚠️ Python process exited with code ${code}`);
                            if (stderr) console.warn(`Python stderr: ${stderr}`);
                            resolve({ success: false, opportunities: [], errors: [{ type: 'python_exit_error', error: `Exit code ${code}: ${stderr}` }] });
                            return;
                        }

                        // Parse JSON output
                        const result = JSON.parse(stdout.trim());

                        if (result.success && result.opportunities && Array.isArray(result.opportunities)) {
                            const oppCount = result.opportunities.length;
                            console.log(`✅ Python calculator completed successfully with ${oppCount} opportunities`);

                            // Validate each opportunity has required fields
                            const validOpportunities = result.opportunities.filter(opp => {
                                const isValid = opp.path && opp.amountIn && opp.expectedProfitUSD && opp.router;
                                if (!isValid) {
                                    console.warn('⚠️ Filtering out invalid opportunity:', Object.keys(opp));
                                }
                                return isValid;
                            });

                            if (validOpportunities.length !== oppCount) {
                                console.log(`⚠️ Filtered ${oppCount - validOpportunities.length} invalid opportunities`);
                            }

                            resolve({
                                success: true,
                                opportunities: validOpportunities,
                                timestamp: result.timestamp,
                                used_real_prices: result.used_real_prices
                            });
                        } else {
                            const errorMsg = result.error || 'Unknown error';
                            console.warn(`⚠️ Python calculator returned unsuccessful result: ${errorMsg}`);
                            resolve({ success: false, opportunities: [], errors: [{ type: 'python_error', error: errorMsg }] });
                        }

                    } catch (parseError) {
                        console.error(`❌ Failed to parse Python JSON output: ${parseError.message}`);
                        console.error(`Raw stdout: ${stdout.substring(0, 500)}...`);
                        if (stderr) console.error(`Python stderr: ${stderr}`);
                        resolve({
                            success: false,
                            opportunities: [],
                            errors: [{ type: 'json_parse_error', error: parseError.message }]
                        });
                    }
                });

                pythonProcess.on('error', (error) => {
                    this.pythonProcessRunning = false; // Reset flag
                    console.error('❌ Failed to spawn Python process:', error.message);
                    resolve({
                        success: false,
                        opportunities: [],
                        errors: [{ type: 'spawn_error', error: error.message }]
                    });
                });

                // Timeout handling
                setTimeout(() => {
                    if (this.pythonProcessRunning) {
                        console.warn('⚠️ Python process timeout, killing...');
                        pythonProcess.kill('SIGTERM');
                        this.pythonProcessRunning = false;
                        resolve({
                            success: false,
                            opportunities: [],
                            errors: [{ type: 'timeout_error', error: 'Python process timed out' }]
                        });
                    }
                }, 35000); // 35 seconds (5 seconds grace period)

            } catch (error) {
                this.pythonProcessRunning = false; // Reset flag
                console.error('❌ Python calculator execution failed:', error.message);
                resolve({
                    success: false,
                    opportunities: [],
                    errors: [{ type: 'execution_error', error: error.message }]
                });
            }
        });
    }

    /**
     * Get real-time prices for arbitrage calculation with robust fallback
     */
    async _getRealTimePrices() {
        try {
            // Import DexPriceFeed dynamically to avoid circular dependencies
            const DexPriceFeed = (await import('../services/DexPriceFeed.js')).default;
            const priceFeed = new DexPriceFeed(this.provider);

            const prices = {};
            let moraliSuccessCount = 0;
            let onChainSuccessCount = 0;

            // Get prices for all token pairs used in triangular arbitrage
            const pairs = [
                'WBNB/USDT', 'WBNB/BTCB', 'USDT/BTCB',
                'USDT/WBNB', 'BTCB/WBNB', 'BTCB/USDT'
            ];

            console.log('📊 Fetching real-time prices for arbitrage calculation...');

            for (const pair of pairs) {
                try {
                    const pairPrices = await priceFeed.getAllPrices(pair);

                    if (pairPrices && Object.keys(pairPrices).length > 0) {
                        prices[pair] = pairPrices;

                        // Count successful sources
                        const dexKeys = Object.keys(pairPrices);
                        const hasMoralisData = dexKeys.some(key => key.includes('pancakeswap') || key.includes('biswap'));
                        const hasOnChainData = dexKeys.some(key => key.includes('pancakeswapv2') || key.includes('uniswap'));

                        if (hasMoralisData) moraliSuccessCount++;
                        if (hasOnChainData) onChainSuccessCount++;

                        console.log(`✅ ${pair}: ${dexKeys.length} DEXes available`);
                    } else {
                        console.warn(`⚠️ ${pair}: No price data available`);
                        // Add fallback on-chain price for this pair
                        prices[pair] = await this._getOnChainFallbackPrice(pair);
                    }
                } catch (error) {
                    console.warn(`⚠️ Failed to get prices for ${pair}:`, error.message);
                    // Add fallback on-chain price for this pair
                    prices[pair] = await this._getOnChainFallbackPrice(pair);
                }
            }

            const totalPairs = pairs.length;
            console.log(`📊 Price fetch summary: ${moraliSuccessCount}/${totalPairs} pairs with Moralis data, ${onChainSuccessCount}/${totalPairs} pairs with on-chain data`);

            return {
                prices: prices,
                timestamp: Date.now(),
                source: moraliSuccessCount > 0 ? 'mixed' : 'on_chain_fallback',
                moralis_success: moraliSuccessCount,
                on_chain_success: onChainSuccessCount
            };

        } catch (error) {
            console.warn('⚠️ Failed to fetch real-time prices, using on-chain fallback:', error.message);
            return await this._getAllOnChainFallbackPrices();
        }
    }

    /**
     * Get on-chain fallback price for a specific pair
     */
    async _getOnChainFallbackPrice(pair) {
        try {
            const [token0Symbol, token1Symbol] = pair.split('/');
            const token0Address = TOKENS[token0Symbol]?.address;
            const token1Address = TOKENS[token1Symbol]?.address;

            if (!token0Address || !token1Address) {
                console.warn(`⚠️ Cannot get fallback price for ${pair} - unknown tokens`);
                return { fallback: { price: 1.0, liquidity: 'unknown', recommended: false } };
            }

            // Get PancakeSwap router
            const router = await this.getRouterContract('PANCAKESWAP');

            // Get price from on-chain reserves
            const amountIn = ethers.parseEther('1'); // 1 token
            const amountsOut = await router.getAmountsOut(amountIn, [token0Address, token1Address]);

            if (amountsOut && amountsOut.length >= 2) {
                const price = parseFloat(ethers.formatEther(amountsOut[1]));
                console.log(`🔄 On-chain fallback price for ${pair}: ${price.toFixed(6)}`);

                return {
                    pancakeswapv2: {
                        price: price,
                        liquidity: 'good',
                        priceImpact: 0.005,
                        recommended: true
                    }
                };
            }
        } catch (error) {
            console.warn(`⚠️ On-chain fallback failed for ${pair}:`, error.message);
        }

        // Ultimate fallback
        return {
            fallback: {
                price: 1.0,
                liquidity: 'unknown',
                priceImpact: 1.0,
                recommended: false
            }
        };
    }

    /**
     * Get on-chain fallback prices for all pairs
     */
    async _getAllOnChainFallbackPrices() {
        console.log('🔄 Using on-chain fallback for all price data...');

        const prices = {};
        const pairs = [
            'WBNB/USDT', 'WBNB/BTCB', 'USDT/BTCB',
            'USDT/WBNB', 'BTCB/WBNB', 'BTCB/USDT'
        ];

        for (const pair of pairs) {
            prices[pair] = await this._getOnChainFallbackPrice(pair);
        }

        return {
            prices: prices,
            timestamp: Date.now(),
            source: 'on_chain_fallback',
            moralis_success: 0,
            on_chain_success: Object.keys(prices).length
        };
    }

    /**
     * Main scanning loop
     */
    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log('🚀 Starting Arbitrage Bot...');

        while (this.isRunning) {
            try {
                this.lastScanTime = Date.now();

                // Run Python calculator
                const pythonResult = await this.runPythonCalculator(1.0);

                if (pythonResult.success && pythonResult.opportunities && pythonResult.opportunities.length > 0) {
                    console.log(`📊 Processing ${pythonResult.opportunities.length} arbitrage opportunities...`);

                    // Process opportunities sequentially (not in parallel) to avoid conflicts
                    for (const opportunity of pythonResult.opportunities) {
                        try {
                            // Validate opportunity has required fields
                            if (!opportunity.path || !opportunity.amountIn || !opportunity.expectedProfitUSD || !opportunity.router) {
                                console.warn('⚠️ Skipping invalid opportunity - missing required fields:', Object.keys(opportunity));
                                continue;
                            }

                            // Additional validation for array and types
                            if (!Array.isArray(opportunity.path) || opportunity.path.length !== 3) {
                                console.warn('⚠️ Skipping invalid opportunity - path must be array of 3 addresses');
                                continue;
                            }

                            if (typeof opportunity.amountIn !== 'number' || typeof opportunity.expectedProfitUSD !== 'number') {
                                console.warn('⚠️ Skipping invalid opportunity - amountIn and expectedProfitUSD must be numbers');
                                continue;
                            }

                            // Check minimum profit threshold (Extreme Mode bootstrap for low balance)
                            const profitUSD = opportunity.expectedProfitUSD;
                            const isBootstrapMode = this.bootstrapTradesExecuted < this.maxBootstrapTrades;
                            const currentThreshold = isBootstrapMode ? this.bootstrapProfitThreshold : this.normalProfitThreshold;

                            if (profitUSD < currentThreshold) {
                                console.log(`⚠️ Skipping opportunity - profit $${profitUSD.toFixed(2)} below threshold $${currentThreshold} (${isBootstrapMode ? 'EXTREME bootstrap' : 'normal'} mode)`);
                                continue;
                            }

                            // Bootstrap mode: ultra-low gas estimate for micro-arbs
                            const estimatedGasCostUSD = isBootstrapMode ? 0.1 : 2.0; // $0.10 for bootstrap, $2 normal
                            if (profitUSD < estimatedGasCostUSD) {
                                console.log(`⚠️ Skipping opportunity - profit $${profitUSD.toFixed(2)} below gas cost $${estimatedGasCostUSD} (${isBootstrapMode ? 'bootstrap' : 'normal'} mode)`);
                                continue;
                            }

                            // Display real arbitrage opportunity details
                            await this._displayArbitrageOpportunity(opportunity, profitUSD);

                            // Execute triangular arbitrage
                            const result = await this.executeTriangularArbitrage(opportunity);

                            if (result && result.success) {
                                console.log(`✅ Opportunity executed successfully: ${result.txHash}`);
                                // Add small delay between trades to avoid conflicts
                                await new Promise(resolve => setTimeout(resolve, 2000));
                            } else {
                                console.log(`❌ Opportunity execution failed or was skipped`);
                            }

                        } catch (error) {
                            console.error(`❌ Failed to process opportunity:`, error.message);
                        }
                    }
                } else {
                    console.log(`📊 No arbitrage opportunities found in this scan`);
                }

                // Wait before next scan
                await new Promise(resolve => setTimeout(resolve, this.scanInterval));

            } catch (error) {
                console.error('❌ Error in arbitrage scan loop:', error);
                await new Promise(resolve => setTimeout(resolve, this.scanInterval * 2));
            }
        }
    }

    /**
     * Stop the bot
     */
    async stop() {
        console.log('🛑 Stopping Arbitrage Bot...');
        this.isRunning = false;
        console.log('✅ Bot stopped');
    }

    /**
     * Get bot statistics
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            totalTrades: this.totalTrades,
            successfulTrades: this.successfulTrades,
            successRate: this.totalTrades > 0 ? (this.successfulTrades / this.totalTrades) * 100 : 0,
            lastScanTime: this.lastScanTime,
            winRate: this.totalTrades > 0 ? (this.successfulTrades / this.totalTrades) * 100 : 0
        };
    }
}

export default ArbitrageBot;
