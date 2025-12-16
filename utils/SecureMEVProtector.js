import { aiMEVProtector } from '../ai/mev_protector.js';
import crypto from 'crypto';
import { MEVError, ValidationError } from './CustomError.js';

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
            'score_opportunity'
        ]);

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

    getHealthStatus() {
        return {
            initialized: this.isInitialized,
            aiReady: this.aiProtector.isReady,
            sessionId: this.sessionId,
            aiStats: this.aiProtector.getStats()
        };
    }

    cleanup() {
        if (this.aiProtector) {
            this.aiProtector.cleanup();
        }

        this.isInitialized = false;
    }
}

export { SecureMEVProtector };
