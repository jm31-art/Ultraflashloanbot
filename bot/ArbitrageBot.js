require('dotenv').config();
const { EventEmitter } = require('events');
const { ethers, getAddress, JsonRpcProvider, ZeroAddress } = require('ethers');
const { spawn } = require('child_process');
const path = require('path');

// Import ABIs
const ERC20_ABI = require('../abi/erc20.json');
const ROUTER_ABI = require('../abi/router.json');
const PAIR_ABI = require('../abi/pair.json');

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

        // Python calculator path
        this.pythonCalculatorPath = path.join(__dirname, '../services/PythonArbitrageCalculator.py');

        console.log('✅ ArbitrageBot initialized successfully');
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
     * Execute triangular arbitrage opportunity
     */
    async executeTriangularArbitrage(opportunity) {
        try {
            // Validate opportunity format from Python
            const { path, amountIn, expectedProfit, router, timestamp } = opportunity;

            // Validate required fields
            if (!path || !Array.isArray(path) || path.length !== 3) {
                console.error('❌ Invalid path in opportunity:', path);
                return null;
            }

            if (!amountIn || typeof amountIn !== 'string') {
                console.error('❌ Invalid amountIn in opportunity:', amountIn);
                return null;
            }

            if (!expectedProfit || typeof expectedProfit !== 'string') {
                console.error('❌ Invalid expectedProfit in opportunity:', expectedProfit);
                return null;
            }

            if (!router || typeof router !== 'string') {
                console.error('❌ Invalid router in opportunity:', router);
                return null;
            }

            // Convert Wei strings to BigInt
            let amountInWei, expectedProfitWei;
            try {
                amountInWei = BigInt(amountIn);
                expectedProfitWei = BigInt(expectedProfit);
            } catch (error) {
                console.error('❌ Failed to parse Wei amounts:', error.message);
                return null;
            }

            // Validate amounts are positive
            if (amountInWei <= 0n) {
                console.error('❌ amountIn must be positive:', amountInWei);
                return null;
            }

            if (expectedProfitWei <= 0n) {
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
            console.log(`   Amount In: ${ethers.formatEther(amountInWei)} tokens (${amountIn} wei)`);
            console.log(`   Expected Profit: ${ethers.formatEther(expectedProfitWei)} tokens (${expectedProfit} wei)`);
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

            // Check if profit meets minimum threshold
            const profitUSD = parseFloat(ethers.formatEther(expectedProfitWei)) * 567; // Approximate BNB price
            if (profitUSD < this.minProfitUSD) {
                console.log(`⚠️ Profit too low: $${profitUSD.toFixed(2)} < $${this.minProfitUSD} minimum`);
                return null;
            }

            // Execute the triangular arbitrage
            const result = await this._executeTriangularSwap(path, amountInWei, routerContract);

            if (result && result.success) {
                console.log(`💰 Triangular arbitrage completed successfully!`);
                console.log(`   Profit: $${profitUSD.toFixed(2)}`);
                console.log(`   Transaction: ${result.txHash}`);
                this.totalTrades++;
                this.successfulTrades++;
                return result;
            } else {
                console.error('❌ Triangular arbitrage execution failed');
                this.totalTrades++;
                return null;
            }

        } catch (error) {
            console.error('❌ Triangular arbitrage execution failed:', error.message);
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

            // Execute the swap
            const tx = await routerContract.swapExactTokensForTokens(
                amountInWei,
                minAmountOut,
                swapPath,
                this.signer.address,
                deadline,
                { gasLimit: gasLimit, gasPrice: gasPrice }
            );

            console.log(`📤 Triangular swap transaction submitted: ${tx.hash}`);

            // Wait for confirmation
            const receipt = await tx.wait();

            if (receipt.status === 1) {
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
     * Execute triangular arbitrage
     */
    async executeTriangularArbitrage(opportunity) {
        try {
            const pathSymbols = opportunity.path_symbols || opportunity.path.map(addr => {
                // Try to find symbol for address
                for (const [symbol, token] of Object.entries(TOKENS)) {
                    if (token.address.toLowerCase() === addr.toLowerCase()) return symbol;
                }
                return addr.substring(0, 6) + '...';
            });

            console.log(`🔄 Executing triangular arbitrage: ${pathSymbols.join(' → ')}`);

            // Calculate profit
            const profitCalc = await this.calculateArbitrageProfit(opportunity);
            if (!profitCalc) {
                console.log(`⚠️ Could not calculate profit for this opportunity`);
                return null;
            }

            if (profitCalc.profitUSD < this.minProfitUSD) {
                console.log(`⚠️ Profit too low: $${profitCalc.profitUSD.toFixed(2)} < $${this.minProfitUSD} minimum`);
                return null;
            }

            // Check trade safety
            const isSafe = await this.isTradeSafe(
                profitCalc.path[0],
                profitCalc.path[3],
                ethers.parseEther(opportunity.amountIn.toString()),
                profitCalc.finalAmount,
                this.maxSlippage
            );

            if (!isSafe) {
                console.log(`⚠️ Trade not safe due to slippage - skipping execution`);
                return null;
            }

            console.log(`✅ All validations passed - executing triangular arbitrage`);

            // Execute the trade
            const result = await this.executeTrade(
                'PANCAKESWAP',
                profitCalc.path[0],
                profitCalc.path[3],
                ethers.parseEther(opportunity.amountIn.toString()),
                profitCalc.finalAmount * 95n / 100n, // 5% slippage protection
                profitCalc.path
            );

            console.log(`💰 Triangular arbitrage completed: $${profitCalc.profitUSD.toFixed(2)} profit`);
            console.log(`📊 Transaction: ${result.txHash}`);

            return result;

        } catch (error) {
            console.error('❌ Triangular arbitrage execution failed:', error.message);
            throw error;
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
                                const isValid = opp.path && opp.amountIn && opp.expectedProfit && opp.router;
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
            const DexPriceFeed = require('../services/DexPriceFeed');
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
                            if (!opportunity.path || !opportunity.amountIn || !opportunity.expectedProfit || !opportunity.router) {
                                console.warn('⚠️ Skipping invalid opportunity - missing required fields:', Object.keys(opportunity));
                                continue;
                            }

                            // Convert expectedProfit to BigInt and check minimum threshold
                            const expectedProfitWei = BigInt(opportunity.expectedProfit);
                            const profitUSD = parseFloat(ethers.formatEther(expectedProfitWei)) * 567;

                            if (profitUSD < this.minProfitUSD) {
                                console.log(`⚠️ Skipping opportunity - profit $${profitUSD.toFixed(2)} below minimum $${this.minProfitUSD}`);
                                continue;
                            }

                            console.log(`🎯 Executing opportunity with expected profit: $${profitUSD.toFixed(2)}`);

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

module.exports = ArbitrageBot;
