// KILOCODE: JAVASCRIPT BOT COORDINATION
// src/bot-coordination.js

import axios from 'axios';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { BotCoordinationConfig } from '../config/bot-coordination.js';

class JavaScriptBotCoordinator extends EventEmitter {

    constructor(config) {
        super();
        this.config = config;
        this.coordinatorUrl = config.COORDINATOR_URL || 'http://localhost:8080';
        this.botType = 'JAVASCRIPT_BOT';
        this.opportunityReservations = new Map();
        this.consecutiveFailures = 0;
        this.lastProfit = 0;
        this.lastOperation = null;
    }

    async initialize() {

        console.log('🔗 Initializing JavaScript Bot Coordinator...');

        // Register with coordination system
        await this.registerWithCoordinator();

        // Start health reporting
        this.startHealthReporting();

        console.log('✅ JavaScript Bot Coordinator ready');
    }

    async registerWithCoordinator() {
        // Optional: register bot with coordination system
        try {
            await axios.post(`${this.coordinatorUrl}/register-bot`, {
                bot_type: this.botType,
                config: {
                    wallet: this.config.WALLET,
                    strategy: this.config.STRATEGY,
                    priority_tokens: this.config.PRIORITY_TOKENS
                }
            });
        } catch (error) {
            console.warn('Bot registration failed, continuing without registration:', error.message);
        }
    }

    async checkOpportunity(opportunityData) {

        const { tokenA, tokenB, amount, expectedProfit, exchanges } = opportunityData;
        const opportunityHash = this.generateOpportunityHash(opportunityData);

        try {
            const response = await axios.post(`${this.coordinatorUrl}/check-opportunity`, {
                bot_type: this.botType,
                opportunity_hash: opportunityHash,
                token_a: tokenA,
                token_b: tokenB,
                amount: amount.toString(),
                expected_profit: expectedProfit.toString(),
                exchanges: exchanges
            });

            const result = response.data;

            if (result.allowed) {
                // Reserve the opportunity
                await this.reserveOpportunity(opportunityHash);
                return { approved: true, reason: 'COORDINATOR_APPROVED' };
            } else {
                return { approved: false, reason: result.reason };
            }

        } catch (error) {
            console.error('Coordination check failed:', error.message);
            // Fallback to local decision
            return this.localCoordinationCheck(opportunityData);
        }
    }

    generateOpportunityHash(opportunityData) {

        const dataString = [
            opportunityData.tokenA,
            opportunityData.tokenB,
            opportunityData.amount.toString(),
            opportunityData.expectedProfit.toString(),
            opportunityData.exchanges.join('-')
        ].join('_');

        return crypto.createHash('sha256').update(dataString).digest('hex');
    }

    async reserveOpportunity(opportunityHash) {

        try {
            const response = await axios.post(`${this.coordinatorUrl}/reserve-opportunity`, {
                bot_type: this.botType,
                opportunity_hash: opportunityHash,
                ttl: 300000 // 5 minutes
            });

            this.opportunityReservations.set(opportunityHash, Date.now());
            return response.data;

        } catch (error) {
            console.error('Opportunity reservation failed:', error.message);
            return { success: false };
        }
    }

    localCoordinationCheck(opportunityData) {

        // Fallback when coordinator unavailable
        const { tokenA, tokenB } = opportunityData;

        const tokenASymbol = this.getTokenSymbol(tokenA);
        const tokenBSymbol = this.getTokenSymbol(tokenB);
        const allowedTokens = this.config.PRIORITY_TOKENS;

        const tokenAAllowed = allowedTokens.includes(tokenASymbol);
        const tokenBAllowed = allowedTokens.includes(tokenBSymbol);

        if (tokenAAllowed && tokenBAllowed) {
            return { approved: true, reason: 'LOCAL_APPROVAL' };
        } else {
            return { approved: false, reason: 'TOKEN_OUTSIDE_DOMAIN' };
        }
    }

    getTokenSymbol(tokenAddress) {
        // Arbitrum token symbol mapping
        const tokenMap = {
            "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1": "WETH",
            "0xFF970A61A04b1cA14834A43f5de4533eBDDB5CC8": "USDC",
            "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9": "USDT",
            "0x912CE59144191C1204E64559FE8253a0e49E6548": "ARB",
            "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f": "WBTC",
            "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1": "DAI",
            "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F": "FRAX"
        };

        return tokenMap[tokenAddress] || "UNKNOWN";
    }

    async reportOperationResult(operationData) {

        try {
            // Report to coordination server
            await axios.post(`${this.coordinatorUrl}/operation-result`, {
                bot_type: this.botType,
                operation_id: operationData.id,
                success: operationData.success,
                profit: operationData.profit.toString(),
                gas_used: operationData.gasUsed.toString(),
                error_type: operationData.errorType || '',
                timestamp: new Date().toISOString()
            });

            // Report to unified dashboard
            const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
            await axios.post(`${dashboardUrl}/report/${this.botType.toLowerCase()}`, {
                profit: operationData.profit,
                success: operationData.success,
                gasUsed: operationData.gasUsed,
                timestamp: new Date().toISOString()
            });

            // Update local metrics
            if (operationData.success) {
                this.consecutiveFailures = 0;
                this.lastProfit = parseFloat(operationData.profit);
            } else {
                this.consecutiveFailures++;
            }
            this.lastOperation = new Date().toISOString();

        } catch (error) {
            console.error('Operation report failed:', error.message);
        }
    }

    startHealthReporting() {

        // Report health every 30 seconds
        setInterval(async () => {
            await this.reportHealthStatus();
        }, 30000);
    }

    async reportHealthStatus() {

        const healthData = {
            bot_type: this.botType,
            success_rate: await this.calculateSuccessRate(),
            consecutive_failures: this.consecutiveFailures,
            last_profit: this.lastProfit,
            last_operation: this.lastOperation,
            timestamp: new Date().toISOString()
        };

        try {
            await axios.post(`${this.coordinatorUrl}/health-report`, healthData);
        } catch (error) {
            console.error('Health report failed:', error.message);
        }
    }

    async calculateSuccessRate() {
        // Simplified success rate calculation
        // In production, track historical data
        return 0.85; // 85% success rate
    }
}

// Enhanced arbitrage bot with coordination
class CoordinatedArbitrageBot {

    constructor(config) {
        this.config = config;
        this.coordinator = new JavaScriptBotCoordinator(config);
        this.strategyManager = null; // Will be initialized if available
        this.opportunityId = 0;
    }

    async initialize() {

        await this.coordinator.initialize();

        // Try to load strategy manager if available
        try {
            const { UnifiedStrategyManager } = require('./arbitrage/strategyManager');
            this.strategyManager = new UnifiedStrategyManager(this.config);
            await this.strategyManager.initialize();
        } catch (error) {
            console.warn('Strategy manager not available, using basic scanning');
        }

        console.log('🤖 Coordinated Arbitrage Bot initialized');
    }

    async scanAndExecuteArbitrage() {

        console.log('🔍 Scanning for arbitrage opportunities with coordination...');

        let opportunities = [];

        if (this.strategyManager) {
            opportunities = await this.strategyManager.findArbitrageOpportunities();
        } else {
            // Basic opportunity scanning (placeholder)
            opportunities = await this.basicOpportunityScan();
        }

        for (const opportunity of opportunities) {

            // Add unique ID
            opportunity.id = `js_${this.opportunityId++}_${Date.now()}`;

            // Check coordination approval
            const approval = await this.coordinator.checkOpportunity(opportunity);

            if (!approval.approved) {
                console.log(`❌ Opportunity rejected: ${approval.reason}`);

                // Report failed opportunity
                await this.coordinator.reportOperationResult({
                    id: opportunity.id,
                    success: false,
                    errorType: approval.reason
                });

                continue;
            }

            try {
                // Execute the opportunity
                const result = await this.executeArbitrage(opportunity);

                // Report success
                await this.coordinator.reportOperationResult({
                    id: opportunity.id,
                    success: true,
                    profit: result.profit,
                    gasUsed: result.gasUsed
                });

                console.log(`✅ Arbitrage executed: Profit ${result.profit} USD`);

            } catch (error) {
                console.error('Arbitrage execution failed:', error);

                // Report failure
                await this.coordinator.reportOperationResult({
                    id: opportunity.id,
                    success: false,
                    errorType: error.message
                });
            }
        }
    }

    async basicOpportunityScan() {
        // Placeholder for basic opportunity scanning
        // In production, integrate with actual scanning logic
        return [];
    }

    async executeArbitrage(opportunity) {
        // Placeholder for arbitrage execution
        // In production, integrate with actual execution logic
        console.log(`Executing arbitrage for opportunity: ${opportunity.id}`);

        // Simulate execution
        await new Promise(resolve => setTimeout(resolve, 1000));

        return {
            profit: opportunity.expectedProfit || 10,
            gasUsed: 210000
        };
    }
}

// Configuration loader
function loadConfig() {
    // Load configuration from environment and config files
    return {
        ...BotCoordinationConfig.JAVASCRIPT_BOT,
        COORDINATOR_URL: process.env.COORDINATOR_URL || 'http://localhost:8080',
        SCAN_INTERVAL: parseInt(process.env.SCAN_INTERVAL) || 10000
    };
}

// Modified main entry point
async function main() {

    const config = loadConfig();

    const bot = new CoordinatedArbitrageBot(config);

    await bot.initialize();

    console.log("🟢 JavaScript Arbitrage Bot Starting with Coordination...");
    console.log(`   Wallet: ${config.WALLET}`);
    console.log(`   Contract: ${config.FLASH_LOAN_CONTRACT}`);
    console.log(`   Strategy: ${config.STRATEGY}`);
    console.log(`   Priority Tokens: ${config.PRIORITY_TOKENS.join(', ')}`);
    console.log(`   Coordinator: ${config.COORDINATOR_URL}`);

    // Start coordinated operation
    setInterval(async () => {
        await bot.scanAndExecuteArbitrage();
    }, config.SCAN_INTERVAL);

    console.log(`🔄 Scanning every ${config.SCAN_INTERVAL}ms...`);
}

if (require.main === module) {
    main().catch(console.error);
}

export {
    JavaScriptBotCoordinator,
    CoordinatedArbitrageBot
};