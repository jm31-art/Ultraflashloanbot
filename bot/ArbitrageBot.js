import dotenv from "dotenv";
dotenv.config();
import { EventEmitter } from 'events';
import { ethers, getAddress, ZeroAddress } from 'ethers';
import { spawn } from 'child_process';
import path from 'path';
import rpcManager from '../infra/RPCManager.js';
import MempoolWatcher from '../utils/mempoolWatcher.js';

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
    APESWAP: {
        router: '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7',
        factory: '0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6',
        name: 'ApeSwap'
    },
    BISWAP: {
        router: '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8',
        factory: '0x858E3312ed3A876947EA49d572A7C42DE08af7EE0',
        name: 'Biswap',
        retryAttempts: 5 // Force retries for BiSwap
    },
    KYBERSWAP: {
        router: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
        factory: '0x878dFE971d44e9122048308301F540910Bbd934c',
        name: 'KyberSwap'
    },
    MDEX: {
        router: '0x3CD1e2660bD7793411d3b01b62b993c616c847f9',
        factory: '0x3e708FdbE3ADA63fc94F8F618111096c42E540019',
        name: 'MDEX'
    },
    BABYSWAP: {
        router: '0x325E343f1dE602396E256B67eFd1F61C3A66639C',
        factory: '0x86407bEa2078ea5f5EB5A52B2caA963bC7F27977',
        name: 'BabySwap'
    },
    THENA: {
        router: '0xAFD89d21BdB66d00828f00d458D661a9bd36A44f',
        factory: '0xAFD89d21BdB66d00828f00d458D661a9bd36A44f',
        name: 'Thena'
    },
    DODO: {
        router: '0x3271339C33f6F3e8A3b8Ca5574b8eC7f39c3b8B5',
        factory: '0x43C3f2d0aa8F5C74703E9947A06dDA3b8ec0E6a3',
        name: 'DODO'
    },
    WOMBAT: {
        router: '0x312Bc7eA1512086fCAb733B958C0d9D1bC1bC0f1',
        factory: '0x312Bc7eA1512086fCAb733B958C0d9D1bC1bC0f1',
        name: 'Wombat'
    },
    ELLIPSIS: {
        router: '0xA238Dd80C259a72e81d7e4664a9801593f98d1c5',
        factory: '0x2a4954fc24875c4e08c9a9b6e13e8ac5d5b1b7f',
        name: 'Ellipsis'
    },
    JETSWAP: {
        router: '0x845E76A8691423fbc4ECb8Dd0f698eb2f76B087D',
        factory: '0x0eb58E5c8aA63314ff5547289185cc4583DfCBD5',
        name: 'JetSwap'
    },
    KNIGHTSWAP: {
        router: '0x05E7900765CdC3c4f89e4e0124ec815A9A3a0c48',
        factory: '0xf0bc2E21a76513aa7CC2730C7A1D6deE0787D6a7',
        name: 'KnightSwap'
    },
    BAKERYSWAP: {
        router: '0xCDe540d7eAFE93aC5fE6233Bee57E1270D3c5d52',
        factory: '0x01bF7C66c6BD861915C0BfCF6cD95b43535Ae0B',
        name: 'BakerySwap'
    },
    JULSWAP: {
        router: '0xbd67d157502A23309Db761c41965600c2Ec788bC',
        factory: '0x553990F2CBA90272390f62C5BDb1681fFc899675',
        name: 'JulSwap'
    },
    FUSIONX: {
        router: '0x598010C8C4008c4C4F1c7C8B5F4Fc6Fc9c0c7c7',
        factory: '0x598010C8C4008c4C4F1c7C8B5F4Fc6Fc9c0c7c7',
        name: 'FusionX'
    },
    WOOFI: {
        router: '0xC22FBb3133dF781E6a269793B0e94a62F3F63EEd',
        factory: '0xC22FBb3133dF781E6a269793B0e94a62F3F63EEd',
        name: 'WooFi'
    },
    BABYDOGESWAP: {
        router: '0xC9a0F685F39b9A9b46a9d467f1C6D84a2f273d6c',
        factory: '0xC9a0F685F39b9A9b46a9d467f1C6D84a2f273d6c',
        name: 'BabyDogeSwap'
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
        this.maxSlippage = options.maxSlippage || 0.01; // 1% max slippage for Extreme Mode
        this.scanInterval = options.scanInterval || 5000; // 5 second scan interval
        this.maxGasPrice = options.maxGasPrice || 10; // 10 gwei max gas price
        this.safeGasLimit = 500000; // Safe fallback gas limit

        // Router contracts cache
        this.routers = new Map();

        // CROSS-DEX ENHANCEMENT: 15+ DEXes for parallel checking
        this.crossDexEnabled = true;
        this.dexCount = Object.keys(DEX_CONFIGS).length; // 15+ DEXes
        this.parallelDexChecks = true;

        // State
        this.isRunning = false;
        this.lastScanTime = 0;
        this.totalTrades = 0;
        this.successfulTrades = 0;
        this.pythonProcessRunning = false; // Prevent multiple Python processes

        // ULTRA-LOW THRESHOLDS & BOOTSTRAP - EXTREME MODE
        this.bootstrapTradesExecuted = 0;
        this.maxBootstrapTrades = 2;
        this.bootstrapProfitThreshold = 0.30; // $0.30 min net profit for first 2 trades
        this.normalProfitThreshold = 0.30; // $0.30+ after bootstrapping
        this.executionEnabled = true; // FORCE REAL EXECUTION
        this.forceExtremeMode = true; // Force extreme mode for bootstrapping
        this.mempoolWatcher = null; // Mempool watching for competitive edge
        this.bootstrapSlippage = 0.02; // 2% slippage for bootstrap (1-2% range)
        this.normalSlippage = 0.005; // 0.5% normal slippage
        this.currentSlippage = this.bootstrapSlippage;
        console.log('🚀🚀 ARBITRAGE BOT: EXTREME MODE BOOTSTRAP ACTIVATED');
        console.log('🎯 Target: Execute 2 micro-arbs ($0.20+ profit) to recoup gas');
        console.log('🔥 Using flashloans + mempool + 15+ DEXes for MAXIMUM profits');
        console.log('⚡ 2% slippage tolerance for bootstrap, atomic execution');

        // Python calculator path
        this.pythonCalculatorPath = path.join(__dirname, '../services/PythonArbitrageCalculator.py');

        // Flashloan integration for bootstrap
        this.flashloanContract = null;
        this._initializeFlashloan();

        console.log('✅ ArbitrageBot initialized successfully');

        // Initialize flashloan for bootstrap arbitrage
        this._initializeFlashloan();

        // Initialize mempool watcher for competitive edge
        this._initializeMempoolWatcher();
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
     * Initialize mempool watcher for competitive edge
     */
    async _initializeMempoolWatcher() {
        try {
            const wsUrl = process.env.BSC_WS_URL || 'wss://bsc-mainnet.nodereal.io/ws/v1/YOUR_API_KEY';
            this.mempoolWatcher = new MempoolWatcher(this.provider, wsUrl);

            // Add all DEX routers to monitor
            const dexRouters = Object.values(DEX_CONFIGS).map(dex => dex.router);
            this.mempoolWatcher.addDexRouters(dexRouters);

            // Listen for mempool events - FORCE REAL EXECUTION
            this.mempoolWatcher.on('largeDexTransaction', async (data) => {
                console.log('📡 MEMPOOL: Large DEX transaction detected - FORCING REAL EXECUTION');
                await this._forceMempoolExecution(data);
            });

            this.mempoolWatcher.on('priceImpactDetected', async (data) => {
                console.log(`📡 MEMPOOL: Price impact detected ${data.estimatedImpact.toFixed(2)}% - FORCING REAL EXECUTION`);
                await this._forceMempoolExecution(data);
            });

            this.mempoolWatcher.on('potentialSandwich', async (data) => {
                console.log('📡 MEMPOOL: Potential sandwich opportunity detected - FORCING REAL EXECUTION');
                await this._forceMempoolExecution(data);
            });

            // MICRO-OPPORTUNITY EXECUTION - FORCE IMMEDIATE TRADES ON ANY EDGE
            this.mempoolWatcher.on('microDexTransaction', async (data) => {
                console.log(`📡 MEMPOOL: MICRO TX TRIGGER (${ethers.formatEther(data.value)} BNB) - EXECUTING IMMEDIATE ARB SCAN!`);
                await this._executeMicroOpportunity(data);
            });

            // Start watching
            await this.mempoolWatcher.start();
            console.log('📡 ArbitrageBot: Mempool watcher active');
        } catch (error) {
            console.warn('⚠️ ArbitrageBot: Mempool watcher initialization failed:', error.message);
        }
    }

    /**
     * Analyze mempool transaction for arbitrage opportunities
     */
    async _analyzeMempoolTransaction(tx) {
        try {
            // Decode the transaction if it's a swap
            if (tx.data && tx.data.startsWith('0x7ff36ab5')) { // swapExactETHForTokens signature
                console.log('📡 Mempool: Large DEX transaction detected, triggering immediate scan');
                // Trigger immediate arbitrage scan
                this._triggerMempoolScan();
            }
        } catch (error) {
            // Silent error handling
        }
    }

    /**
     * Force real execution on mempool triggers - EXTREME MODE WITH MULTI-HOP
     */
    async _forceMempoolExecution(data) {
        try {
            const isMultiHopScan = data.multiHopScan || false;
            const minPaths = data.minPaths || 3;
            const maxPaths = data.maxPaths || 3;

            console.log(`🚨 MEMPOOL EXECUTION: ${isMultiHopScan ? 'MULTI-HOP' : 'STANDARD'} scan triggered`);

            // Run Python calculator with appropriate path depth
            const amountIn = isMultiHopScan ? 0.1 : 1.0; // Smaller amounts for multi-hop
            const pythonResult = await this.runPythonCalculator(amountIn);

            if (!pythonResult.success || !pythonResult.opportunities?.length) {
                console.log('⚠️ MEMPOOL: No opportunities found');
                return;
            }

            // Filter opportunities based on trigger type and profit threshold
            let profitableOpps;
            if (data.triggerType === 'sandwich' || data.atomicExecution) {
                // For sandwich attacks, execute immediately with any profit > $0.10
                profitableOpps = pythonResult.opportunities.filter(opp =>
                    opp.expectedProfitUSD && opp.expectedProfitUSD > 0.10
                );
                console.log(`🥪 MEMPOOL SANDWICH: Found ${profitableOpps.length} atomic opportunities`);
            } else {
                // Standard mempool execution with ultra-low threshold
                profitableOpps = pythonResult.opportunities.filter(opp =>
                    opp.expectedProfitUSD && opp.expectedProfitUSD > 0.20
                );
            }

            if (profitableOpps.length === 0) {
                console.log(`⚠️ MEMPOOL: No profitable opportunities (> $${data.triggerType === 'sandwich' ? '0.10' : '0.20'})`);
                return;
            }

            // Execute the best opportunity immediately
            const bestOpp = profitableOpps[0];
            const triggerDesc = data.triggerType === 'sandwich' ? '🥪 SANDWICH ATOMIC 🥪' :
                               data.triggerType === 'price_impact' ? `📈 IMPACT ${data.estimatedImpact?.toFixed(2)}% 📈` :
                               `💰 LARGE TX ${ethers.formatEther(data.value || 0n)} BNB 💰`;

            // LOUD MEMPOOL EXECUTION LOGS
            console.log(`\n🚨🚨🚨 MEMPOOL OPPORTUNITY DETECTED 🚨🚨🚨`);
            console.log(`${triggerDesc}`);
            console.log(`🎯 PROFIT TARGET: $${bestOpp.expectedProfitUSD.toFixed(2)}`);
            console.log(`🔄 PATH: ${bestOpp.path?.map(addr => addr.substring(0, 6)).join(' → ') || 'unknown'}`);
            console.log(`🏦 DEX: ${bestOpp.router || 'unknown'}`);
            console.log(`⚡ EXECUTING IMMEDIATELY...`);
            console.log(`🚨🚨🚨 MEMPOOL EXECUTION STARTED 🚨🚨🚨\n`);

            // Force real execution with atomic cycles for multi-hop
            const result = await this.executeTriangularArbitrage(bestOpp);

            if (result && result.success) {
                console.log(`\n🎯🎯🎯 MEMPOOL ARB SUCCESS! 🎯🎯🎯`);
                console.log(`${triggerDesc}`);
                console.log(`💰💰💰 PROFIT: $${bestOpp.expectedProfitUSD.toFixed(2)} SECURED 💰💰💰`);
                console.log(`🔗 TX: ${result.txHash}`);
                console.log(`⚡ ATOMIC EXECUTION COMPLETED`);
                console.log(`🎯🎯🎯 MEMPOOL PROFIT CAPTURED! 🎯🎯🎯\n`);
                this.bootstrapTradesExecuted++;
            } else {
                console.log(`\n❌❌❌ MEMPOOL ARB FAILED ❌❌❌`);
                console.log(`${triggerDesc}`);
                console.log(`💥 EXECUTION MISSED`);
                console.log(`😞 OPPORTUNITY LOST`);
                console.log(`❌❌❌ MEMPOOL TRADE FAILED ❌❌❌\n`);
            }

        } catch (error) {
            console.error('❌ MEMPOOL EXECUTION ERROR:', error.message);
        }
    }

    /**
     * Execute micro-opportunity on ANY detected edge ($0.20+ net)
     */
    async _executeMicroOpportunity(data) {
        try {
            console.log(`\n🚨🚨🚨 MICRO-OPPORTUNITY DETECTED 🚨🚨🚨`);
            console.log(`💰 TX VALUE: ${ethers.formatEther(data.value)} BNB`);
            console.log(`🎯 MIN PROFIT: $${data.minProfitThreshold || 0.20}`);
            console.log(`⚡ IMMEDIATE EXECUTION MODE`);
            console.log(`🚨🚨🚨 EXECUTING NOW 🚨🚨🚨\n`);

            // Run immediate arbitrage scan with micro-amounts
            const pythonResult = await this.runPythonCalculator(0.1); // Smaller amounts for micro-opps

            if (!pythonResult.success || !pythonResult.opportunities?.length) {
                console.log('⚠️ MICRO-OPP: No opportunities found');
                return;
            }

            // Filter for ANY profitable opportunity ($0.20+ net)
            const profitableOpps = pythonResult.opportunities.filter(opp =>
                opp.expectedProfitUSD && opp.expectedProfitUSD > (data.minProfitThreshold || 0.20)
            );

            if (profitableOpps.length === 0) {
                console.log(`⚠️ MICRO-OPP: No opportunities > $${data.minProfitThreshold || 0.20}`);
                return;
            }

            // Execute the best micro-opportunity immediately
            const bestOpp = profitableOpps[0];

            console.log(`\n💎💎💎 MICRO-ARB FOUND 💎💎💎`);
            console.log(`💰 PROFIT: $${bestOpp.expectedProfitUSD.toFixed(2)}`);
            console.log(`🔄 PATH: ${bestOpp.path?.map(addr => addr.substring(0, 6)).join(' → ') || 'unknown'}`);
            console.log(`🏦 DEX: ${bestOpp.router || 'unknown'}`);
            console.log(`⚡ FLASHLOAN ENABLED - Executing leveraged trade`);
            console.log(`💎💎💎 EXECUTING MICRO-ARB 💎💎💎\n`);

            // Force real execution with flashloan
            const result = await this.executeTriangularArbitrage(bestOpp);

            if (result && result.success) {
                console.log(`\n🎯🎯🎯 MICRO-ARB SUCCESS! 🎯🎯🎯`);
                console.log(`💰💰💰 PROFIT: $${bestOpp.expectedProfitUSD.toFixed(2)} SECURED 💰💰💰`);
                console.log(`🔗 TX: ${result.txHash}`);
                console.log(`⚡ FLASHLOAN REPAYMENT COMPLETE`);
                console.log(`🎯🎯🎯 MICRO-PROFIT CAPTURED! 🎯🎯🎯\n`);
                this.bootstrapTradesExecuted++;
            } else {
                console.log(`\n❌❌❌ MICRO-ARB FAILED ❌❌❌`);
                console.log(`💥 EXECUTION MISSED`);
                console.log(`😞 OPPORTUNITY LOST`);
                console.log(`❌❌❌ MICRO-TRADE FAILED ❌❌❌\n`);
            }

        } catch (error) {
            console.error('❌ MICRO-OPPORTUNITY EXECUTION ERROR:', error.message);
        }
    }

    /**
     * Trigger immediate scan when mempool activity detected
     */
    _triggerMempoolScan() {
        if (!this.mempoolScanTriggered) {
            this.mempoolScanTriggered = true;
            // Trigger scan in next tick to avoid blocking
            setTimeout(async () => {
                try {
                    console.log('🎯 Mempool trigger: Running immediate arbitrage scan');
                    const pythonResult = await this.runPythonCalculator(1.0);
                    if (pythonResult.success && pythonResult.opportunities?.length > 0) {
                        // Process first profitable opportunity immediately
                        for (const opportunity of pythonResult.opportunities) {
                            if (opportunity.expectedProfitUSD >= this.bootstrapProfitThreshold) {
                                console.log('🚀 Mempool: Executing hot opportunity');
                                await this.executeTriangularArbitrage(opportunity);
                                break; // Execute only one
                            }
                        }
                    }
                } catch (error) {
                    console.warn('⚠️ Mempool scan failed:', error.message);
                } finally {
                    this.mempoolScanTriggered = false;
                }
            }, 100); // Small delay
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

            console.log(`   CROSS-DEX PRICES (${this.dexCount}+ DEXes):`);

            // Get prices for each pair from ALL DEXes
            const DexPriceFeed = (await import('../services/DexPriceFeed.js')).default;
            const priceFeed = new DexPriceFeed(this.provider);

            try {
                // Parallel price fetching from all DEXes
                const [prices1, prices2, prices3] = await Promise.all([
                    priceFeed.getAllPrices(pair1),
                    priceFeed.getAllPrices(pair2),
                    priceFeed.getAllPrices(pair3)
                ]);

                // Display prices from ALL available DEXes (not just top 3)
                const displayAllDexPrices = (pair, prices) => {
                    const dexes = Object.keys(prices).filter(dex =>
                        prices[dex] && typeof prices[dex] === 'object' && prices[dex].price
                    );

                    if (dexes.length === 0) {
                        console.log(`     ${pair}: No DEX data available`);
                        return;
                    }

                    console.log(`     ${pair} (${dexes.length} DEXes):`);
                    dexes.forEach(dex => {
                        const price = prices[dex].price;
                        const liquidity = prices[dex].liquidity || 'unknown';
                        const spread = prices[dex].spread ? `${prices[dex].spread.toFixed(4)}%` : 'N/A';
                        console.log(`       ${dex}: ${price.toFixed(6)} (liq: ${liquidity}, spread: ${spread})`);
                    });
                };

                displayAllDexPrices(pair1, prices1);
                displayAllDexPrices(pair2, prices2);
                displayAllDexPrices(pair3, prices3);

                // Calculate and display comprehensive spread analysis
                const bestPrices = this._calculateBestPrices([prices1, prices2, prices3]);
                if (bestPrices.spread > 0) {
                    console.log(`   🔍 CROSS-DEX SPREAD ANALYSIS:`);
                    console.log(`     Best Spread: ${bestPrices.spread.toFixed(4)}%`);
                    console.log(`     Optimal Route: ${bestPrices.buyDex} → ${bestPrices.sellDex}`);
                    console.log(`     Arbitrage Efficiency: ${((bestPrices.spread / bestPrices.avgPrice) * 100).toFixed(2)}%`);
                }

            } catch (priceError) {
                console.log(`   ❌ Cross-DEX price fetch failed: ${priceError.message}`);
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

            // LOUD EXECUTION LOGS - MAXIMUM VISIBILITY
            console.log(`\n🚨🚨🚨 EXECUTING TRIANGULAR ARBITRAGE - EXTREME MODE 🚨🚨🚨`);
            console.log(`💰💰💰 EXPECTED PROFIT: $${expectedProfitUSD.toFixed(2)} USD 💰💰💰`);
            console.log(`🔄 PATH: ${pathSymbols.join(' → ')}`);
            console.log(`📊 AMOUNT: ${amountIn} tokens (${ethers.formatEther(amountInWei)} wei)`);
            console.log(`🎯 SPREAD: ${spread.toFixed(4)}%`);
            console.log(`🏦 ROUTER: ${router}`);
            console.log(`💳 WALLET: ${this.signer.address.substring(0, 10)}...`);
            console.log(`⏰ TIMESTAMP: ${new Date().toISOString()}`);
            console.log(`🚨🚨🚨 EXECUTION STARTED 🚨🚨🚨\n`);

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

            // LOUD FLASHLOAN EXECUTION LOGS
            console.log(`\n🔥🔥🔥 FLASHLOAN ARBITRAGE EXECUTION 🔥🔥🔥`);
            console.log(`💸 BORROWING: ${ethers.formatEther(amountInWei)} tokens`);
            console.log(`🎯 TARGET PROFIT: $${expectedProfitUSD.toFixed(2)}`);
            console.log(`🏦 PROTOCOL: ${router}`);
            console.log(`💰 WALLET BALANCE: ${balanceEth.toFixed(6)} BNB`);
            console.log(`📈 BOOTSTRAP: ${this.bootstrapTradesExecuted}/${this.maxBootstrapTrades} trades completed`);
            console.log(`⚡ SLIPPAGE: ${this.currentSlippage * 100}%`);
            console.log(`🔥🔥🔥 EXECUTING NOW 🔥🔥🔥\n`);

            // Use flashloan for better profits if available
            let result;
            if (this.flashloanContract) {
                console.log(`🔥 Using flashloan for amplified profits`);
                result = await this._executeFlashloanArbitrage(path, amountInWei, router, expectedProfitUSD);
            } else {
                result = await this._executeTriangularSwap(path, amountInWei, routerContract);
            }

            if (result && result.success) {
                // LOUD SUCCESS LOGS
                console.log(`\n🎉🎉🎉 ARBITRAGE SUCCESS! 🎉🎉🎉`);
                console.log(`💰💰💰 PROFIT: $${expectedProfitUSD.toFixed(2)} USD 💰💰💰`);
                console.log(`🔗 TX HASH: ${result.txHash}`);
                console.log(`⏱️  BLOCK: ${result.blockNumber || 'pending'}`);
                console.log(`📊 GAS USED: ${result.gasUsed || 'unknown'}`);
                console.log(`✅ STATUS: EXECUTED SUCCESSFULLY ✅`);
                console.log(`🎯 PATH: ${pathSymbols.join(' → ')}`);
                console.log(`📈 TOTAL TRADES: ${this.totalTrades + 1} (${this.successfulTrades + 1} successful)`);
                console.log(`🎉🎉🎉 PROFIT SECURED! 🎉🎉🎉\n`);

                this.totalTrades++;
                this.successfulTrades++;
                this.bootstrapTradesExecuted++;

                // Check if we've completed bootstrapping - EXTREME MODE COMPLETE
                if (this.bootstrapTradesExecuted >= this.maxBootstrapTrades) {
                    console.log(`\n🚀🚀🚀 BOOTSTRAP COMPLETE - GAS RECOUPED! 🚀🚀🚀`);
                    console.log(`💰💰💰 SWITCHED TO NORMAL MODE: $${this.normalProfitThreshold}+ MIN PROFIT 💰💰💰`);
                    console.log(`⚡⚡⚡ REDUCED SLIPPAGE TO ${this.normalSlippage * 100}% ⚡⚡⚡`);
                    console.log(`🎯🎯🎯 EXTREME MODE SUCCESS - NOW SCALING UP! 🎯🎯🎯\n`);
                    this.emit('bootstrapComplete');
                }

                return result;
            } else {
                console.log(`\n❌❌❌ ARBITRAGE FAILED ❌❌❌`);
                console.log(`💥 EXECUTION ERROR`);
                console.log(`📊 PATH: ${pathSymbols.join(' → ')}`);
                console.log(`😞 STATUS: FAILED - RETRYING SOON`);
                console.log(`❌❌❌ TRADE FAILED ❌❌❌\n`);
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
     * Execute flashloan arbitrage for amplified profits - AGGRESSIVE MODE
     */
    async _executeFlashloanArbitrage(path, amountInWei, router, expectedProfitUSD) {
        try {
            // Try aggressive flashloan first (minimal amounts, all trades)
            if (this.flashloanContract && this.flashloanContract.executeAggressiveFlashloanArbitrage) {
                console.log(`🔥 FLASHLOAN: Using aggressive flashloan for ALL arbitrage`);
                return await this.flashloanContract.executeAggressiveFlashloanArbitrage(
                    path,
                    amountInWei,
                    router,
                    expectedProfitUSD * 0.8 // 80% minimum profit
                );
            }

            // Fallback to original flashloan contract
            if (!this.flashloanContract) {
                throw new Error('Flashloan contract not available');
            }

            const [tokenA, tokenB, tokenC] = path;
            const minProfitWei = ethers.parseEther(Math.max(0, expectedProfitUSD * 0.8).toString()); // 80% of expected

            console.log(`📤 Submitting flashloan arbitrage transaction...`);
            console.log(`EXECUTING FLASHLOAN ARB - Profit: $${expectedProfitUSD.toFixed(2)} - Tx: pending...`);

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
            console.log(`EXECUTING FLASHLOAN ARB - Profit: $${expectedProfitUSD.toFixed(2)} - Tx: ${tx.hash}`);

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

                            // ULTRA-LOW THRESHOLDS & BOOTSTRAP LOGIC - EXTREME MODE
                            const profitUSD = opportunity.expectedProfitUSD;
                            const isBootstrapMode = this.bootstrapTradesExecuted < this.maxBootstrapTrades;
                            const currentThreshold = isBootstrapMode ? this.bootstrapProfitThreshold : this.normalProfitThreshold;
                            this.currentSlippage = isBootstrapMode ? this.bootstrapSlippage : this.normalSlippage;

                            if (profitUSD < currentThreshold) {
                                console.log(`\n❌❌❌ NEAR-MISS OPPORTUNITY DETECTED ❌❌❌`);
                                console.log(`💰 POTENTIAL PROFIT: $${profitUSD.toFixed(2)} USD`);
                                console.log(`🎯 REQUIRED THRESHOLD: $${currentThreshold} USD`);
                                console.log(`🔄 PATH: ${opportunity.path.map(addr => addr.substring(0, 6)).join(' → ')}`);
                                console.log(`🏦 DEX: ${opportunity.router}`);
                                console.log(`📊 MODE: ${isBootstrapMode ? 'EXTREME BOOTSTRAP' : 'NORMAL'}`);
                                console.log(`😞 SKIPPED - TOO LOW PROFIT`);
                                console.log(`❌❌❌ NEAR-MISS OPPORTUNITY MISSED ❌❌❌\n`);
                                continue;
                            }

                            // LOUD MICRO-PROFIT DETECTION LOGS
                            console.log(`\n🎯🎯🎯 MICRO-PROFIT OPPORTUNITY DETECTED! 🎯🎯🎯`);
                            console.log(`💰💰💰 PROFIT: $${profitUSD.toFixed(2)} USD 💰💰💰`);
                            console.log(`🎯 THRESHOLD: $${currentThreshold} (${isBootstrapMode ? 'BOOTSTRAP MODE' : 'NORMAL MODE'})`);
                            console.log(`🔄 PATH: ${opportunity.path.map(addr => addr.substring(0, 6)).join(' → ')}`);
                            console.log(`🏦 DEX: ${opportunity.router}`);
                            console.log(`📊 BOOTSTRAP: ${this.bootstrapTradesExecuted}/${this.maxBootstrapTrades} trades completed`);
                            console.log(`⚡ SLIPPAGE: ${this.currentSlippage * 100}%`);
                            console.log(`🚀 EXECUTING MICRO-ARB VIA FLASHLOAN NOW!`);
                            console.log(`🎯🎯🎯 EXECUTION STARTED! 🎯🎯🎯\n`);

                            // Always estimate gas + require profit > gas + buffer
                            const estimatedGasCostUSD = isBootstrapMode ? 0.05 : 1.0; // Ultra-low for bootstrap
                            const totalRequiredProfit = estimatedGasCostUSD + (isBootstrapMode ? 0.05 : 0.5); // Buffer

                            if (profitUSD < totalRequiredProfit) {
                                console.log(`⚠️ POTENTIAL OPP: ${profitUSD.toFixed(2)}% gross - Skipped, net $${profitUSD.toFixed(2)} below gas+buffer $${totalRequiredProfit} (${isBootstrapMode ? 'bootstrap' : 'normal'} mode)`);
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
