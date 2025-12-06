const { EventEmitter } = require('events');
const { ethers } = require('ethers');
const { TOKENS } = require('../config/dex');
const ArbitrageBot = require('./ArbitrageBot');
const LiquidationBot = require('./LiquidationBot');
const NFTFlashLoanTrader = require('./NFTFlashLoanTrader');
const CrossProtocolArbitrageScanner = require('./CrossProtocolArbitrageScanner');
const StrategyRiskAssessor = require('../utils/StrategyRiskAssessor');
const PerformanceDashboard = require('../utils/PerformanceDashboard');
const PythonArbitrageCalculator = require('../services/PythonArbitrageCalculator');

// Multicoin Arbitrage Strategy - Randomly selects 2-4 coins for arbitrage
class MulticoinArbitrageStrategy extends EventEmitter {
    constructor(provider, signer, options = {}) {
        super();

        this.provider = provider;
        this.signer = signer;
        this.flashProvider = options.flashProvider;

        // Predefined coin list for multicoin arbitrage
        this.availableCoins = ['ETH', 'BNB', 'USDT', 'ADA', 'DOT', 'LINK', 'MATIC', 'CAKE', 'BTCB', 'XRP'];
        this.minCoins = 2;
        this.maxCoins = 4;

        // DEX priority for arbitrage
        this.dexPriority = ['pancakeswapv3', 'pancakeswap', 'biswap', 'uniswap', 'apeswap'];

        // Configuration
        this.minProfitUSD = options.minProfitUSD || 1.0;
        this.maxGasPrice = options.maxGasPrice || ethers.parseUnits('5', 'gwei');
        this.scanInterval = options.scanInterval || 15000; // 15 seconds
        this.isRunning = false;

        // Performance tracking
        this.totalTrades = 0;
        this.successfulTrades = 0;
        this.lastExecutionTime = 0;
        this.minTimeBetweenTrades = 10000; // 10 seconds minimum
    }

    async initialize() {
        console.log('🔄 Initializing Multicoin Arbitrage Strategy...');
        console.log(`📊 Available coins: ${this.availableCoins.join(', ')}`);
        console.log(`🎯 Coin selection: ${this.minCoins}-${this.maxCoins} coins per cycle`);
        console.log(`🏦 DEX priority: ${this.dexPriority.join(' → ')}`);
        return true;
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log('🚀 Starting Multicoin Arbitrage Strategy...');

        while (this.isRunning) {
            try {
                await this._executeMulticoinCycle();
                await new Promise(resolve => setTimeout(resolve, this.scanInterval));
            } catch (error) {
                console.error('❌ Multicoin arbitrage cycle error:', error.message);
                await new Promise(resolve => setTimeout(resolve, this.scanInterval * 2)); // Wait longer on error
            }
        }
    }

    async _executeMulticoinCycle() {
        // Randomly select 2-4 coins for this cycle
        const selectedCoins = this._selectRandomCoins();
        console.log(`🎲 Selected coins for arbitrage: ${selectedCoins.join(', ')}`);

        // Generate all possible pair combinations from selected coins
        const pairs = this._generatePairs(selectedCoins);

        // Scan for arbitrage opportunities across all pairs and DEXes
        const opportunities = await this._scanMulticoinOpportunities(pairs);

        // Execute profitable opportunities
        for (const opportunity of opportunities) {
            if (await this._shouldExecuteOpportunity(opportunity)) {
                await this._executeArbitrageOpportunity(opportunity);
            }
        }
    }

    _selectRandomCoins() {
        const numCoins = Math.floor(Math.random() * (this.maxCoins - this.minCoins + 1)) + this.minCoins;
        const shuffled = [...this.availableCoins].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, numCoins);
    }

    _generatePairs(coins) {
        const pairs = [];
        for (let i = 0; i < coins.length; i++) {
            for (let j = i + 1; j < coins.length; j++) {
                // Create both directions for each pair
                pairs.push(`${coins[i]}/${coins[j]}`);
                pairs.push(`${coins[j]}/${coins[i]}`);
            }
        }
        return pairs;
    }

    async _scanMulticoinOpportunities(pairs) {
        const opportunities = [];

        for (const pair of pairs) {
            try {
                // Get prices from all DEXes for this pair
                const prices = await this._getPairPrices(pair);

                // Find arbitrage opportunities across DEXes
                const pairOpportunities = this._findArbitrageInPair(pair, prices);
                opportunities.push(...pairOpportunities);

            } catch (error) {
                console.warn(`⚠️ Failed to scan pair ${pair}:`, error.message);
            }
        }

        // Sort by profit potential
        opportunities.sort((a, b) => b.profitPotential - a.profitPotential);

        return opportunities.slice(0, 5); // Return top 5 opportunities
    }

    async _getPairPrices(pair) {
        // Use DexPriceFeed to get prices (now with Moralis integration)
        const DexPriceFeed = require('../services/DexPriceFeed');
        const priceFeed = new DexPriceFeed(this.provider);
        return await priceFeed.getAllPrices(pair);
    }

    _findArbitrageInPair(pair, prices) {
        const opportunities = [];
        const dexes = Object.keys(prices).filter(dex =>
            prices[dex] && typeof prices[dex] === 'object' && prices[dex].price > 0
        );

        // Compare prices across all DEX pairs
        for (let i = 0; i < dexes.length; i++) {
            for (let j = i + 1; j < dexes.length; j++) {
                const dexA = dexes[i];
                const dexB = dexes[j];

                const priceA = prices[dexA].price;
                const priceB = prices[dexB].price;

                const spread = Math.abs(priceA - priceB) / Math.min(priceA, priceB) * 100;

                if (spread > 0.05) { // 0.05% minimum spread for multicoin arbitrage
                    const buyDex = priceA < priceB ? dexA : dexB;
                    const sellDex = priceA < priceB ? dexB : dexA;
                    const buyPrice = Math.min(priceA, priceB);
                    const sellPrice = Math.max(priceA, priceB);

                    opportunities.push({
                        pair,
                        buyDex,
                        sellDex,
                        buyPrice,
                        sellPrice,
                        spread,
                        profitPotential: spread * 1000, // Estimate profit for $1000 trade
                        type: 'multicoin_arbitrage'
                    });
                }
            }
        }

        return opportunities;
    }

    async _shouldExecuteOpportunity(opportunity) {
        // Check timing constraints
        const now = Date.now();
        if (now - this.lastExecutionTime < this.minTimeBetweenTrades) {
            return false;
        }

        // Check profit threshold
        if (opportunity.profitPotential < this.minProfitUSD) {
            return false;
        }

        // Check gas price
        const gasPrice = (await this.provider.getFeeData()).gasPrice;
        if (gasPrice.gt(this.maxGasPrice)) {
            return false;
        }

        return true;
    }

    async _executeArbitrageOpportunity(opportunity) {
        try {
            console.log(`🚀 Executing multicoin arbitrage:`);
            console.log(`   Pair: ${opportunity.pair}`);
            console.log(`   Buy: ${opportunity.buyDex} @ $${opportunity.buyPrice.toFixed(4)}`);
            console.log(`   Sell: ${opportunity.sellDex} @ $${opportunity.sellPrice.toFixed(4)}`);
            console.log(`   Spread: ${opportunity.spread.toFixed(3)}%`);
            console.log(`   Expected Profit: $${opportunity.profitPotential.toFixed(2)}`);

            // Use flashloan to execute the arbitrage
            const result = await this._executeFlashloanArbitrage(opportunity);

            if (result.success) {
                this.totalTrades++;
                this.successfulTrades++;
                this.lastExecutionTime = Date.now();

                console.log(`✅ Multicoin arbitrage executed successfully!`);
                console.log(`   Transaction: ${result.txHash}`);
                console.log(`   Actual Profit: $${result.actualProfit?.toFixed(2) || 'N/A'}`);

                this.emit('tradeExecuted', {
                    type: 'multicoin_arbitrage',
                    opportunity,
                    result
                });
            }

        } catch (error) {
            console.error('❌ Multicoin arbitrage execution failed:', error.message);
            this.emit('tradeFailed', { opportunity, error: error.message });
        }
    }

    async _executeFlashloanArbitrage(opportunity) {
        // Use FlashProvider to execute flashloan arbitrage
        if (!this.flashProvider) {
            throw new Error('FlashProvider not available');
        }

        const [token0, token1] = opportunity.pair.split('/');
        const flashAmount = ethers.parseEther('10'); // 10 tokens for testing

        // Prepare arbitrage parameters
        const arbitrageParams = {
            exchanges: [opportunity.buyDex, opportunity.sellDex],
            path: [TOKENS[token0].address, TOKENS[token1].address],
            buyDex: opportunity.buyDex,
            sellDex: opportunity.sellDex,
            expectedProfit: opportunity.profitPotential,
            caller: this.signer.address,
            gasReimbursement: ethers.parseEther('0.001'),
            contractAddress: process.env.FLASHLOAN_ARB_CONTRACT
        };

        // Execute flashloan
        const result = await this.flashProvider.executeFlashLoan(
            opportunity.buyDex.toUpperCase(), // Use buy DEX as primary
            TOKENS[token0].address,
            flashAmount,
            arbitrageParams
        );

        return result;
    }

    stop() {
        this.isRunning = false;
        console.log('🛑 Multicoin Arbitrage Strategy stopped');
    }

    getStats() {
        return {
            totalTrades: this.totalTrades,
            successfulTrades: this.successfulTrades,
            winRate: this.totalTrades > 0 ? (this.successfulTrades / this.totalTrades) * 100 : 0,
            lastExecutionTime: this.lastExecutionTime,
            availableCoins: this.availableCoins.length,
            dexPriority: this.dexPriority
        };
    }
}

class UnifiedStrategyManager extends EventEmitter {
    constructor(provider, signer, options = {}) {
        super();

        this.provider = provider;
        this.signer = signer;

        // Initialize Python arbitrage calculator for enhanced profit calculations
        this.pythonCalculator = new PythonArbitrageCalculator();

        // Strategy instances
        this.strategies = {};
        this.activeStrategies = new Set();

        // Configuration
        this.strategyWeights = {
            arbitrage: options.arbitrageWeight || 0.25,
            liquidation: options.liquidationWeight || 0.2,
            nft: options.nftWeight || 0.1,
            crossProtocol: options.crossProtocolWeight || 0.1,
            multicoin: options.multicoinWeight || 0.35 // Higher allocation for multicoin
        };

        this.maxConcurrentStrategies = options.maxConcurrentStrategies || 3;
        this.strategyRotationInterval = options.strategyRotationInterval || 3600000; // 1 hour
        this.performanceRebalancingInterval = options.performanceRebalancingInterval || 1800000; // 30 minutes

        // Resource management
        this.resourceLimits = {
            maxGasPerStrategy: options.maxGasPerStrategy || ethers.parseUnits('10', 'gwei'),
            maxCapitalPerStrategy: options.maxCapitalPerStrategy || ethers.parseEther('50000'), // $50k
            maxTradesPerMinute: options.maxTradesPerMinute || 10
        };

        // Performance tracking
        this.performanceDashboard = new PerformanceDashboard();
        this.strategyRiskAssessor = new StrategyRiskAssessor(provider);

        // State management
        this.isRunning = false;
        this.emergencyStop = false;
        this.strategyPerformance = new Map();
        this.resourceUsage = new Map();

        // Rotation and rebalancing timers
        this.rotationTimer = null;
        this.rebalancingTimer = null;

        this.emit('initialized');
    }

    async initialize() {
        try {
            console.log('🔄 Initializing Unified Strategy Manager...');

            // Risk assessor is already initialized in constructor

            // Initialize performance dashboard
            this.performanceDashboard.start();

            // Initialize individual strategies
            await this._initializeStrategies();

            // Load strategy configurations
            await this._loadStrategyConfigurations();

            console.log('✅ Unified Strategy Manager initialized successfully');
            return true;

        } catch (error) {
            console.error('❌ Failed to initialize Unified Strategy Manager:', error);
            return false;
        }
    }

    async _initializeStrategies() {
        // Initialize Arbitrage Bot with Python calculator for ultra-precise profit calculations
        this.strategies.arbitrage = new ArbitrageBot(this.provider, this.signer, {
            minProfitUSD: 0.1, // Execute any profitable opportunity (bundled saves 50% fees)
            maxGasPrice: 5,
            scanInterval: 5000,
            maxGasPerTransaction: ethers.parseEther('0.0005'),
            minBalanceRequired: ethers.parseEther('0.001'),
            gasPriceRefund: 2.0,
            bnbReserveRatio: 0.8,
            btcReserveRatio: 0.2,
            maxConsecutiveFailures: 5,
            minTimeBetweenTransactions: 3000,
            // Enable all advanced features
            profitProtectionEnabled: true,
            transactionBundling: true, // Enable bundled transactions for 50% fee reduction
            poolValidation: true, // Validate pools before execution
            multiPairScanning: true, // Scan all WBNB pairs
            gasCostCalculation: true, // Pre-calculate gas costs
            profitFlowConfirmation: true, // Confirm profits flow to wallet
            pythonCalculator: this.pythonCalculator // Enhanced Python calculator for precise triangular arbitrage
        });

        // Initialize Liquidation Bot with enhanced configuration
        this.strategies.liquidation = new LiquidationBot(this.provider, this.signer, {
            minProfitUSD: 10, // Lower threshold for more opportunities
            maxGasPrice: 5,
            maxGasPerTransaction: ethers.parseEther('0.0005'),
            minBalanceRequired: ethers.parseEther('0.001'),
            gasPriceRefund: 2.0,
            maxConsecutiveFailures: 5,
            minTimeBetweenTransactions: 3000,
            profitProtectionEnabled: true,
            gasCostCalculation: true,
            profitFlowConfirmation: true
        });

        // Initialize NFT Flash Loan Trader with enhanced configuration
        this.strategies.nft = new NFTFlashLoanTrader(this.provider, this.signer, {
            minProfitUSD: 50, // NFT trades need higher minimums
            maxGasPrice: 5,
            maxGasPerTransaction: ethers.parseEther('0.001'), // Higher gas for NFT operations
            minBalanceRequired: ethers.parseEther('0.002'),
            gasPriceRefund: 2.0,
            maxConsecutiveFailures: 3, // Stricter for NFT trades
            minTimeBetweenTransactions: 5000,
            profitProtectionEnabled: true,
            gasCostCalculation: true,
            profitFlowConfirmation: true
        });

        // Initialize Cross-Protocol Arbitrage Scanner with enhanced configuration
        this.strategies.crossProtocol = new CrossProtocolArbitrageScanner(this.provider, this.signer, {
            minProfitUSD: 5, // Lower for cross-protocol opportunities
            maxGasPrice: 5,
            maxGasPerTransaction: ethers.parseEther('0.0005'),
            minBalanceRequired: ethers.parseEther('0.001'),
            gasPriceRefund: 2.0,
            maxConsecutiveFailures: 5,
            minTimeBetweenTransactions: 3000,
            profitProtectionEnabled: true,
            transactionBundling: true, // Enable bundling for cross-protocol
            poolValidation: true,
            gasCostCalculation: true,
            profitFlowConfirmation: true
        });

        // Initialize Multicoin Arbitrage Strategy
        this.strategies.multicoin = new MulticoinArbitrageStrategy(this.provider, this.signer, {
            flashProvider: this.strategies.arbitrage?.flashProvider, // Share flash provider
            minProfitUSD: 1.0, // $1 minimum for multicoin arbitrage
            maxGasPrice: 5,
            scanInterval: 15000, // 15 seconds for multicoin cycles
            maxGasPerTransaction: ethers.parseEther('0.0005'),
            minBalanceRequired: ethers.parseEther('0.001'),
            gasPriceRefund: 2.0,
            maxConsecutiveFailures: 5,
            minTimeBetweenTransactions: 10000,
            profitProtectionEnabled: true,
            gasCostCalculation: true,
            profitFlowConfirmation: true
        });

        // Set up event handlers for all strategies
        for (const [strategyName, strategy] of Object.entries(this.strategies)) {
            this._setupStrategyEventHandlers(strategyName, strategy);
        }
    }

    _setupStrategyEventHandlers(strategyName, strategy) {
        // Handle strategy events
        strategy.on('tradeExecuted', (trade) => {
            this._handleStrategyTrade(strategyName, trade);
        });

        strategy.on('error', (error) => {
            this._handleStrategyError(strategyName, error);
        });

        strategy.on('opportunityFound', (opportunity) => {
            this._handleStrategyOpportunity(strategyName, opportunity);
        });
    }

    async _loadStrategyConfigurations() {
        // Load strategy-specific configurations with advanced features
        this.strategyConfigs = {
            arbitrage: {
                enabled: true,
                priority: 1,
                resourceAllocation: 0.4,
                features: {
                    transactionBundling: true, // 50% fee reduction
                    poolValidation: true, // Live data validation
                    multiPairScanning: true, // All WBNB pairs
                    gasCostCalculation: true, // Pre-trade gas calc
                    profitFlowConfirmation: true, // Wallet confirmation
                    profitProtection: true // Triple protection system
                },
                thresholds: {
                    minProfitUSD: 0.1, // Execute any profitable opportunity
                    maxGasPrice: 5,
                    maxTradesPerMinute: 10
                }
            },
            liquidation: {
                enabled: true,
                priority: 2,
                resourceAllocation: 0.3,
                features: {
                    gasCostCalculation: true,
                    profitFlowConfirmation: true,
                    profitProtection: true,
                    emergencyStop: true
                },
                thresholds: {
                    minProfitUSD: 10,
                    maxGasPrice: 5,
                    maxTradesPerMinute: 5
                }
            },
            nft: {
                enabled: true, // Fully implemented with marketplace integration
                priority: 3,
                resourceAllocation: 0.15,
                features: {
                    gasCostCalculation: true,
                    profitFlowConfirmation: true,
                    profitProtection: true,
                    marketplaceIntegration: true
                },
                thresholds: {
                    minProfitUSD: 50, // Higher for NFT complexity
                    maxGasPrice: 5,
                    maxTradesPerMinute: 2 // Lower frequency for NFTs
                }
            },
            crossProtocol: {
                enabled: true,
                priority: 4,
                resourceAllocation: 0.15,
                features: {
                    transactionBundling: true,
                    poolValidation: true,
                    gasCostCalculation: true,
                    profitFlowConfirmation: true,
                    profitProtection: true,
                    multiDexSupport: true
                },
                thresholds: {
                    minProfitUSD: 5,
                    maxGasPrice: 5,
                    maxTradesPerMinute: 8
                }
            },
            multicoin: {
                enabled: true,
                priority: 2, // High priority for multicoin arbitrage
                resourceAllocation: 0.3, // 30% resource allocation
                features: {
                    randomCoinSelection: true, // 2-4 coins per cycle
                    multiDexArbitrage: true, // Cross-DEX arbitrage
                    flashloanExecution: true, // Flashloan-based trades
                    gasCostCalculation: true,
                    profitFlowConfirmation: true,
                    profitProtection: true,
                    highVolumePools: true // Prioritize high-volume pools
                },
                thresholds: {
                    minProfitUSD: 1.0, // $1 minimum for multicoin
                    maxGasPrice: 5,
                    maxTradesPerMinute: 12, // Higher frequency for multicoin
                    minCoinsPerCycle: 2,
                    maxCoinsPerCycle: 4
                }
            }
        };
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log('🚀 Starting Unified Strategy Manager...');

        try {
            // Start enabled strategies
            await this._startEnabledStrategies();

            // Start rotation and rebalancing timers
            this._startRotationTimer();
            this._startRebalancingTimer();

            console.log('✅ Unified Strategy Manager started successfully');

        } catch (error) {
            console.error('❌ Failed to start Unified Strategy Manager:', error);
            this.isRunning = false;
            throw error;
        }
    }

    async _startEnabledStrategies() {
        for (const [strategyName, config] of Object.entries(this.strategyConfigs)) {
            if (config.enabled) {
                try {
                    await this.strategies[strategyName].initialize();
                    await this.strategies[strategyName].start();
                    this.activeStrategies.add(strategyName);
                    console.log(`✅ Started strategy: ${strategyName}`);
                } catch (error) {
                    console.error(`❌ Failed to start strategy ${strategyName}:`, error);
                }
            }
        }
    }

    _startRotationTimer() {
        this.rotationTimer = setInterval(() => {
            this._performStrategyRotation();
        }, this.strategyRotationInterval);
    }

    _startRebalancingTimer() {
        this.rebalancingTimer = setInterval(() => {
            this._performPerformanceRebalancing();
        }, this.performanceRebalancingInterval);
    }

    async _performStrategyRotation() {
        if (this.emergencyStop) return;

        console.log('🔄 Performing strategy rotation...');

        try {
            // Evaluate strategy performance
            const performanceMetrics = this._evaluateStrategyPerformance();

            // Determine which strategies to rotate
            const strategiesToRotate = this._identifyStrategiesToRotate(performanceMetrics);

            // Perform rotation
            for (const strategyName of strategiesToRotate) {
                await this._rotateStrategy(strategyName);
            }

        } catch (error) {
            console.error('❌ Error during strategy rotation:', error);
        }
    }

    async _performPerformanceRebalancing() {
        if (this.emergencyStop) return;

        console.log('⚖️ Performing performance rebalancing...');

        try {
            // Get current performance metrics
            const performanceMetrics = this._evaluateStrategyPerformance();

            // Calculate new resource allocations
            const newAllocations = this._calculateResourceAllocations(performanceMetrics);

            // Apply new allocations
            await this._applyResourceAllocations(newAllocations);

        } catch (error) {
            console.error('❌ Error during performance rebalancing:', error);
        }
    }

    _evaluateStrategyPerformance() {
        const performanceMetrics = {};

        for (const strategyName of this.activeStrategies) {
            const strategy = this.strategies[strategyName];
            const stats = strategy.getStats();

            performanceMetrics[strategyName] = {
                winRate: stats.successfulTrades / (stats.totalTrades || 1),
                totalTrades: stats.totalTrades || 0,
                profitGenerated: stats.totalProfit || 0,
                resourceUsage: this.resourceUsage.get(strategyName) || 0,
                uptime: stats.uptime || 0,
                errorRate: stats.errorCount / (stats.scanCount || 1)
            };
        }

        return performanceMetrics;
    }

    _identifyStrategiesToRotate(performanceMetrics) {
        const strategiesToRotate = [];

        // Rotate strategies with poor performance
        for (const [strategyName, metrics] of Object.entries(performanceMetrics)) {
            if (metrics.winRate < 0.3 || metrics.errorRate > 0.1) {
                strategiesToRotate.push(strategyName);
            }
        }

        // Rotate to maintain diversity
        if (this.activeStrategies.size > this.maxConcurrentStrategies) {
            // Remove lowest performing strategy
            let lowestPerforming = null;
            let lowestScore = Infinity;

            for (const strategyName of this.activeStrategies) {
                const score = this._calculateStrategyScore(performanceMetrics[strategyName]);
                if (score < lowestScore) {
                    lowestScore = score;
                    lowestPerforming = strategyName;
                }
            }

            if (lowestPerforming && !strategiesToRotate.includes(lowestPerforming)) {
                strategiesToRotate.push(lowestPerforming);
            }
        }

        return strategiesToRotate;
    }

    _calculateStrategyScore(metrics) {
        // Calculate composite score based on multiple factors
        const winRateScore = metrics.winRate * 0.4;
        const volumeScore = Math.min(metrics.totalTrades / 100, 1) * 0.3; // Normalize to 100 trades
        const uptimeScore = metrics.uptime * 0.2;
        const errorPenalty = metrics.errorRate * 0.1;

        return winRateScore + volumeScore + uptimeScore - errorPenalty;
    }

    async _rotateStrategy(strategyName) {
        try {
            console.log(`🔄 Rotating strategy: ${strategyName}`);

            // Stop current strategy
            await this.strategies[strategyName].stop();
            this.activeStrategies.delete(strategyName);

            // Find replacement strategy
            const replacementStrategy = this._findReplacementStrategy(strategyName);

            if (replacementStrategy) {
                // Start replacement strategy
                await this.strategies[replacementStrategy].initialize();
                await this.strategies[replacementStrategy].start();
                this.activeStrategies.add(replacementStrategy);

                console.log(`✅ Rotated ${strategyName} → ${replacementStrategy}`);
            }

        } catch (error) {
            console.error(`❌ Error rotating strategy ${strategyName}:`, error);
        }
    }

    _findReplacementStrategy(excludedStrategy) {
        // Find best performing inactive strategy
        let bestStrategy = null;
        let bestScore = -1;

        for (const [strategyName, config] of Object.entries(this.strategyConfigs)) {
            if (strategyName !== excludedStrategy && config.enabled && !this.activeStrategies.has(strategyName)) {
                const score = config.priority; // Use priority as initial score
                if (score > bestScore) {
                    bestScore = score;
                    bestStrategy = strategyName;
                }
            }
        }

        return bestStrategy;
    }

    _calculateResourceAllocations(performanceMetrics) {
        const allocations = {};
        let totalScore = 0;

        // Calculate performance-based scores
        for (const [strategyName, metrics] of Object.entries(performanceMetrics)) {
            const score = this._calculateStrategyScore(metrics);
            allocations[strategyName] = score;
            totalScore += score;
        }

        // Normalize allocations
        for (const strategyName in allocations) {
            allocations[strategyName] = totalScore > 0 ? allocations[strategyName] / totalScore : 0;
        }

        return allocations;
    }

    async _applyResourceAllocations(allocations) {
        for (const [strategyName, allocation] of Object.entries(allocations)) {
            if (this.strategies[strategyName]) {
                // Update strategy resource limits based on allocation
                const maxCapital = this.resourceLimits.maxCapitalPerStrategy.mul(
                    Math.floor(allocation * 100)
                ).div(100);

                // Apply resource limits (this would require strategy-specific methods)
                console.log(`📊 Updated ${strategyName} allocation: ${(allocation * 100).toFixed(1)}%`);
            }
        }
    }

    async _handleStrategyTrade(strategyName, trade) {
        // Record trade in performance dashboard
        this.performanceDashboard.recordTrade({
            ...trade,
            strategy: strategyName
        });

        // Record trade in risk assessor
        this.strategyRiskAssessor.recordTrade({
            ...trade,
            strategy: strategyName
        });

        // Update resource usage
        const currentUsage = this.resourceUsage.get(strategyName) || 0;
        this.resourceUsage.set(strategyName, currentUsage + (trade.gasCost || 0));

        // Emit unified trade event
        this.emit('strategyTrade', {
            strategy: strategyName,
            trade: trade
        });

        // Check for emergency stop conditions
        if (this.strategyRiskAssessor.shouldEmergencyStop()) {
            console.log('🚨 Risk threshold exceeded, initiating emergency stop');
            await this.emergencyStop();
        }
    }

    _handleStrategyError(strategyName, error) {
        console.error(`❌ Strategy ${strategyName} error:`, error);

        // Emit unified error event
        this.emit('strategyError', {
            strategy: strategyName,
            error: error
        });

        // Check if strategy should be rotated due to errors
        const errorCount = this._getStrategyErrorCount(strategyName);
        if (errorCount > 10) { // Arbitrary threshold
            console.log(`🔄 Rotating ${strategyName} due to excessive errors`);
            this._rotateStrategy(strategyName);
        }
    }

    _handleStrategyOpportunity(strategyName, opportunity) {
        // Perform risk assessment
        const riskAssessment = this.strategyRiskAssessor.assessStrategyRisk(strategyName, opportunity);

        if (!riskAssessment.recommended) {
            console.log(`⚠️ Opportunity rejected by risk assessor: ${strategyName}`);
            return;
        }

        // Emit unified opportunity event
        this.emit('strategyOpportunity', {
            strategy: strategyName,
            opportunity: opportunity,
            riskAssessment: riskAssessment
        });
    }

    _getStrategyErrorCount(strategyName) {
        // This would track errors per strategy
        // For now, return a placeholder
        return 0;
    }

    // Strategy management methods
    async enableStrategy(strategyName) {
        if (!this.strategyConfigs[strategyName]) {
            throw new Error(`Unknown strategy: ${strategyName}`);
        }

        this.strategyConfigs[strategyName].enabled = true;

        if (this.isRunning && !this.activeStrategies.has(strategyName)) {
            await this.strategies[strategyName].initialize();
            await this.strategies[strategyName].start();
            this.activeStrategies.add(strategyName);
        }

        console.log(`✅ Enabled strategy: ${strategyName}`);
    }

    async disableStrategy(strategyName) {
        if (!this.strategyConfigs[strategyName]) {
            throw new Error(`Unknown strategy: ${strategyName}`);
        }

        this.strategyConfigs[strategyName].enabled = false;

        if (this.activeStrategies.has(strategyName)) {
            await this.strategies[strategyName].stop();
            this.activeStrategies.delete(strategyName);
        }

        console.log(`⏸️ Disabled strategy: ${strategyName}`);
    }

    updateStrategyWeights(newWeights) {
        this.strategyWeights = {
            ...this.strategyWeights,
            ...newWeights
        };
        console.log('✅ Strategy weights updated');
    }

    // Emergency controls
    async emergencyStop() {
        console.log('🚨 Unified Strategy Manager emergency stop activated');
        this.emergencyStop = true;

        // Stop all strategies
        for (const strategyName of this.activeStrategies) {
            try {
                await this.strategies[strategyName].stop();
                console.log(`🛑 Stopped strategy: ${strategyName}`);
            } catch (error) {
                console.error(`❌ Error stopping ${strategyName}:`, error);
            }
        }

        this.activeStrategies.clear();

        // Stop timers
        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
            this.rotationTimer = null;
        }

        if (this.rebalancingTimer) {
            clearInterval(this.rebalancingTimer);
            this.rebalancingTimer = null;
        }

        console.log('🚨 All strategies stopped - Emergency stop complete');
        this.emit('emergencyStop');
    }

    async resume() {
        console.log('✅ Resuming Unified Strategy Manager');
        this.emergencyStop = false;

        // Restart strategies
        await this._startEnabledStrategies();

        // Restart timers
        this._startRotationTimer();
        this._startRebalancingTimer();

        this.emit('resumed');
    }

    // Monitoring and statistics
    getStatus() {
        return {
            isRunning: this.isRunning,
            emergencyStop: this.emergencyStop,
            activeStrategies: Array.from(this.activeStrategies),
            strategyPerformance: Object.fromEntries(this.strategyPerformance),
            resourceUsage: Object.fromEntries(this.resourceUsage),
            strategyWeights: this.strategyWeights
        };
    }

    getStrategyStats(strategyName) {
        if (!this.strategies[strategyName]) {
            throw new Error(`Unknown strategy: ${strategyName}`);
        }

        return this.strategies[strategyName].getStats();
    }

    getPerformanceMetrics() {
        return this.performanceDashboard.getDetailedMetrics();
    }

    getRiskMetrics() {
        return this.strategyRiskAssessor.getRiskMetrics();
    }

    async stop() {
        console.log('🛑 Stopping Unified Strategy Manager...');

        this.isRunning = false;

        // Stop all strategies
        for (const strategyName of this.activeStrategies) {
            try {
                await this.strategies[strategyName].stop();
            } catch (error) {
                console.error(`❌ Error stopping ${strategyName}:`, error);
            }
        }

        // Stop timers
        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
        }

        if (this.rebalancingTimer) {
            clearInterval(this.rebalancingTimer);
        }

        // Stop performance dashboard
        this.performanceDashboard.stop();

        console.log('✅ Unified Strategy Manager stopped');
    }
}

module.exports = UnifiedStrategyManager;
