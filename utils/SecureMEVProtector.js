const { aiMEVProtector } = require('../ai/mev_protector');
const crypto = require('crypto');
const { MEVError, ValidationError } = require('./CustomError');

class SecureMEVProtector {
    constructor(provider, options = {}) {
        this.provider = provider;
        this.aiProtector = aiMEVProtector;
        this.isInitialized = false;
        this.sessionId = crypto.randomUUID();
        this.timeoutMs = options.timeoutMs || 10000;
        this.maxRetries = options.maxRetries || 3;

        // Advanced MEV protection features for high-frequency trading
        this.dynamicFeeAdjustment = options.dynamicFeeAdjustment !== false;
        this.sandwichProtection = options.sandwichProtection !== false;
        this.frontRunningProtection = options.frontRunningProtection !== false;
        this.backRunningProtection = options.backRunningProtection !== false;
        this.opportunityScoring = options.opportunityScoring !== false;

        // Competition monitoring and adaptive strategies
        this.competitionHistory = [];
        this.maxHistoryLength = 100;
        this.adaptiveStrategy = true;
        this.lastCompetitionCheck = 0;
        this.competitionCheckInterval = 30000; // 30 seconds

        // Dynamic fee adjustment parameters
        this.marketVolatility = 0.02; // Base volatility
        this.competitionLevel = 'medium'; // low, medium, high
        this.networkCongestion = 1.0; // Gas cost multiplier
        this.opportunityFrequency = 10; // Opportunities per hour

        // Security settings
        this.allowedMethods = new Set([
            'analyze_mempool',
            'get_safe_gas_price',
            'recommend_protection_strategy',
            'calculate_dynamic_fees',
            'monitor_competition',
            'score_opportunity',
            'enable_nodereal_protection',
            'get_protection_status'
        ]);

        // Nodereal MEV Protection integration
        this.noderealEnabled = process.env.NODEREAL_API_KEY && process.env.NODEREAL_API_KEY !== 'your_nodereal_api_key_here';
        this.noderealConfig = {
            apiKey: process.env.NODEREAL_API_KEY,
            rpcUrl: process.env.NODEREAL_RPC,
            protectionLevel: 'high', // high, medium, low
            features: {
                sandwichProtection: true,
                frontrunProtection: true,
                backrunProtection: true,
                privateMempool: true
            }
        };

        this.requestSchema = {
            analyze_mempool: ['transaction'],
            get_safe_gas_price: ['base_gas'],
            recommend_protection_strategy: ['transaction'],
            calculate_dynamic_fees: ['base_fee', 'opportunity_size'],
            monitor_competition: [],
            score_opportunity: ['opportunity']
        };
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            // Initialize the AI MEV protector
            await this.aiProtector.initialize();

            this.isInitialized = true;
            console.log('🤖 AI-Powered Secure MEV Protector initialized with session:', this.sessionId);

        } catch (error) {
            console.error('Failed to initialize AI MEV Protector:', error);
            throw new MEVError('AI MEV protector initialization failed', 'HIGH', ['ai_initialization_failed']);
        }
    }


    async analyzeMempool(transaction, options = {}) {
        await this.initialize();

        const maxRetries = options.maxRetries || this.maxRetries;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.aiProtector.analyzeMempool(transaction);
            } catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                console.warn(`AI MEV analysis attempt ${attempt} failed, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    async getSafeGasPrice(baseGas, options = {}) {
        await this.initialize();

        const maxRetries = options.maxRetries || this.maxRetries;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await this.aiProtector.getSafeGasPrice(baseGas);
                return BigInt(Math.floor(result.gas_price * 1e9)); // Convert to wei
            } catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                console.warn(`AI gas price calculation attempt ${attempt} failed, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    async recommendProtectionStrategy(transaction, options = {}) {
        await this.initialize();

        const maxRetries = options.maxRetries || this.maxRetries;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.aiProtector.getProtectionStrategy(transaction);
            } catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                console.warn(`AI protection strategy attempt ${attempt} failed, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    // Enable Nodereal MEV Protection
    async enableNoderealProtection(options = {}) {
        if (!this.noderealEnabled) {
            console.warn('⚠️ Nodereal API key not configured. Please set NODEREAL_API_KEY in your .env file');
            return false;
        }

        try {
            // Update protection level if specified
            if (options.protectionLevel) {
                this.noderealConfig.protectionLevel = options.protectionLevel;
            }

            // Update feature flags
            if (options.features) {
                this.noderealConfig.features = { ...this.noderealConfig.features, ...options.features };
            }

            console.log('🔒 Nodereal MEV Protection enabled with configuration:', {
                protectionLevel: this.noderealConfig.protectionLevel,
                features: this.noderealConfig.features
            });

            return true;
        } catch (error) {
            console.error('Failed to enable Nodereal protection:', error);
            return false;
        }
    }

    // Get comprehensive protection status
    // Transaction batching for MEV protection
    async createBatchedTransaction(transactions) {
        if (!this.noderealEnabled) {
            throw new Error('Nodereal MEV protection required for transaction batching');
        }

        const batchedTx = {
            type: 'batched_arbitrage',
            transactions: transactions,
            timestamp: Date.now(),
            sessionId: this.sessionId,
            mevProtection: {
                level: this.noderealConfig.protectionLevel,
                features: this.noderealConfig.features
            }
        };

        // Add gas optimization
        batchedTx.optimizedGas = await this.optimizeGasForBatch(transactions);

        return batchedTx;
    }

    async optimizeGasForBatch(transactions) {
        // Calculate optimal gas parameters for batched transaction
        const totalGas = transactions.reduce((sum, tx) => sum + (tx.gasLimit || 200000), 0);
        const avgGasPrice = await this.aiProtector.getSafeGasPrice(5000000000); // 5 gwei base

        return {
            gasLimit: Math.ceil(totalGas * 1.1), // 10% buffer
            gasPrice: avgGasPrice,
            maxFeePerGas: avgGasPrice * 2n,
            maxPriorityFeePerGas: avgGasPrice / 2n
        };
    }

    getProtectionStatus() {
        return {
            initialized: this.isInitialized,
            aiReady: this.aiProtector.isReady,
            sessionId: this.sessionId,
            noderealEnabled: this.noderealEnabled,
            noderealConfig: this.noderealConfig,
            aiStats: this.aiProtector.getStats(),
            overallProtectionLevel: this.calculateOverallProtectionLevel(),
            batchingAvailable: this.noderealEnabled
        };
    }

    // Calculate overall protection level based on all enabled protections
    calculateOverallProtectionLevel() {
        let protectionScore = 0;

        // AI Protection (40% weight)
        if (this.aiProtector.isReady) {
            protectionScore += 40;
        }

        // Nodereal Protection (60% weight)
        if (this.noderealEnabled) {
            const noderealScore = this.noderealConfig.protectionLevel === 'high' ? 60 :
                                 this.noderealConfig.protectionLevel === 'medium' ? 40 : 20;
            protectionScore += noderealScore;
        }

        // Return protection level
        if (protectionScore >= 80) return 'VERY_HIGH';
        if (protectionScore >= 60) return 'HIGH';
        if (protectionScore >= 40) return 'MEDIUM';
        if (protectionScore >= 20) return 'LOW';
        return 'NONE';
    }

    getHealthStatus() {
        return {
            initialized: this.isInitialized,
            aiReady: this.aiProtector.isReady,
            sessionId: this.sessionId,
            aiStats: this.aiProtector.getStats(),
            noderealEnabled: this.noderealEnabled,
            overallProtection: this.calculateOverallProtectionLevel()
        };
    }

    cleanup() {
        if (this.aiProtector) {
            this.aiProtector.cleanup();
        }

        this.isInitialized = false;
    }
}

module.exports = SecureMEVProtector;
