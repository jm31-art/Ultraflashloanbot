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

        // Python calculator path
        this.pythonCalculatorPath = path.join(__dirname, '../services/PythonArbitrageCalculator.py');

        console.log('✅ ArbitrageBot initialized successfully');
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
     * Calculate arbitrage profit for triangular opportunity
     */
    async calculateArbitrageProfit(opportunity) {
        try {
            const { path, expectedProfit, amountIn } = opportunity;
            const [tokenA, tokenB, tokenC] = path;

            // Get token addresses
            const tokenAAddress = TOKENS[tokenA].address;
            const tokenBAddress = TOKENS[tokenB].address;
            const tokenCAddress = TOKENS[tokenC].address;

            // Get router
            const router = await this.getRouterContract('PANCAKESWAP');

            // Calculate amounts for triangular arbitrage
            const amountInWei = ethers.parseEther(amountIn.toString());

            // Get amounts out for each leg
            const amountsOut1 = await router.getAmountsOut(amountInWei, [tokenAAddress, tokenBAddress]);
            const amountsOut2 = await router.getAmountsOut(amountsOut1[1], [tokenBAddress, tokenCAddress]);
            const amountsOut3 = await router.getAmountsOut(amountsOut2[1], [tokenCAddress, tokenAAddress]);

            const finalAmount = amountsOut3[1];
            const profit = finalAmount - amountInWei;
            const profitUSD = parseFloat(ethers.formatEther(profit)) * 567; // Approximate BNB price

            return {
                profitWei: profit,
                profitUSD: profitUSD,
                finalAmount: finalAmount,
                path: [tokenAAddress, tokenBAddress, tokenCAddress, tokenAAddress]
            };

        } catch (error) {
            console.error('❌ Profit calculation failed:', error.message);
            return null;
        }
    }

    /**
     * Execute triangular arbitrage
     */
    async executeTriangularArbitrage(opportunity) {
        try {
            console.log(`🔄 Executing triangular arbitrage: ${opportunity.path.join(' -> ')}`);

            // Calculate profit
            const profitCalc = await this.calculateArbitrageProfit(opportunity);
            if (!profitCalc || profitCalc.profitUSD < this.minProfitUSD) {
                console.log(`⚠️ Profit too low: $${profitCalc?.profitUSD?.toFixed(2) || 0} < $${this.minProfitUSD}`);
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
                console.log(`⚠️ Trade not safe due to slippage`);
                return null;
            }

            // Execute the trade
            const result = await this.executeTrade(
                'PANCAKESWAP',
                profitCalc.path[0],
                profitCalc.path[3],
                ethers.parseEther(opportunity.amountIn.toString()),
                profitCalc.finalAmount * 95n / 100n, // 5% slippage protection
                profitCalc.path
            );

            console.log(`💰 Triangular arbitrage profit: $${profitCalc.profitUSD.toFixed(2)}`);

            return result;

        } catch (error) {
            console.error('❌ Triangular arbitrage failed:', error.message);
            throw error;
        }
    }

    /**
     * Run Python arbitrage calculator
     */
    async runPythonCalculator(amountIn = 1.0) {
        return new Promise((resolve, reject) => {
            try {
                const pythonProcess = spawn('python3', [this.pythonCalculatorPath, amountIn.toString()], {
                    stdio: ['pipe', 'pipe', 'pipe']
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
                    try {
                        if (code !== 0) {
                            console.warn(`⚠️ Python process exited with code ${code}: ${stderr}`);
                            resolve({ success: false, opportunities: [], errors: [{ type: 'python_exit_error', error: `Exit code ${code}: ${stderr}` }] });
                            return;
                        }

                        // Parse JSON output
                        const result = JSON.parse(stdout.trim());

                        if (result.success) {
                            console.log(`🐍 Python calculator found ${result.opportunities.length} opportunities`);
                            resolve(result);
                        } else {
                            console.warn(`⚠️ Python calculator failed: ${result.error}`);
                            resolve(result);
                        }

                    } catch (parseError) {
                        console.error(`❌ Failed to parse Python output: ${parseError.message}`);
                        console.error(`Raw output: ${stdout}`);
                        resolve({
                            success: false,
                            opportunities: [],
                            errors: [{ type: 'json_parse_error', error: parseError.message }]
                        });
                    }
                });

                pythonProcess.on('error', (error) => {
                    console.error('❌ Failed to spawn Python process:', error.message);
                    resolve({
                        success: false,
                        opportunities: [],
                        errors: [{ type: 'spawn_error', error: error.message }]
                    });
                });

            } catch (error) {
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

                if (pythonResult.success && pythonResult.opportunities.length > 0) {
                    // Process each opportunity
                    for (const opportunity of pythonResult.opportunities) {
                        try {
                            if (opportunity.type === 'triangular') {
                                await this.executeTriangularArbitrage(opportunity);
                            }
                            // Add other opportunity types here

                        } catch (error) {
                            console.error(`❌ Failed to execute opportunity:`, error.message);
                        }
                    }
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
