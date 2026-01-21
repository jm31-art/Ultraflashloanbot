#!/usr/bin/env node

/**
 * Profitability Validation Script
 * Simulates 1 week (168 hours) of trading activity to validate profitability
 * against 15-35% monthly ROI target in optimal conditions.
 */

import ProfitCalculator from './utils/ProfitCalculator.js';
import { ethers } from 'ethers';

// Simulation parameters
const SIMULATION_HOURS = 168; // 1 week
const TARGET_MONTHLY_ROI_MIN = 15;
const TARGET_MONTHLY_ROI_MAX = 35;

// Market condition patterns (realistic crypto market behavior)
const MARKET_PATTERNS = {
    volatility: {
        low: { min: 0.005, max: 0.02, weight: 0.3 },    // 0.5-2% volatility
        medium: { min: 0.02, max: 0.05, weight: 0.5 },   // 2-5% volatility
        high: { min: 0.05, max: 0.15, weight: 0.2 }      // 5-15% volatility
    },
    opportunityFrequency: {
        low: { min: 1, max: 5, weight: 0.4 },           // 1-5 opportunities/hour
        medium: { min: 5, max: 15, weight: 0.4 },        // 5-15 opportunities/hour
        high: { min: 15, max: 30, weight: 0.2 }          // 15-30 opportunities/hour
    },
    competition: ['low', 'medium', 'high'],              // Competition levels
    networkCongestion: [0.5, 1.0, 1.5, 2.0]             // Network congestion multipliers
};

// Trading strategy parameters
const TRADING_PARAMS = {
    arbitrage: {
        baseProfitMargin: 0.005,    // 0.5% base profit margin
        tradeSizes: [10000, 25000, 50000, 100000, 250000], // USD trade sizes
        successRate: 0.85           // 85% success rate
    },
    liquidation: {
        baseBonus: 0.02,           // 2% base liquidation bonus
        eventFrequency: 0.1,       // 0.1 liquidations per hour on average
        bonusSizes: [5000, 15000, 30000] // USD bonus sizes
    },
    nft: {
        baseProfit: 0.03,          // 3% base NFT trading profit
        tradeFrequency: 0.05,      // 0.05 NFT trades per hour on average
        tradeSizes: [1000, 5000, 10000, 25000] // USD trade sizes
    }
};

class ProfitabilityValidator {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://localhost:8545');
        this.profitCalculator = new ProfitCalculator(this.provider);

        // Simulation state
        this.totalCapital = 100000; // Starting with $100k
        this.currentCapital = this.totalCapital;
        this.trades = [];
        this.hourlyStats = [];
        this.marketConditions = [];

        // Results tracking
        this.totalProfits = 0;
        this.totalLosses = 0;
        this.successfulTrades = 0;
        this.failedTrades = 0;
    }

    /**
     * Generate realistic market conditions for current hour
     */
    generateMarketConditions(hour) {
        // Create cyclical patterns (market tends to be more volatile during certain hours)
        const hourOfDay = hour % 24;
        const dayOfWeek = Math.floor(hour / 24);

        // Weekend effect - higher volatility on weekends
        const isWeekend = dayOfWeek >= 5;
        const weekendMultiplier = isWeekend ? 1.3 : 1.0;

        // Time-of-day effect - higher activity during business hours
        const businessHourMultiplier = (hourOfDay >= 8 && hourOfDay <= 20) ? 1.2 : 0.8;

        // Select volatility level based on weights
        const volatilityLevel = this.weightedRandomSelect(MARKET_PATTERNS.volatility);
        const baseVolatility = this.randomBetween(volatilityLevel.min, volatilityLevel.max);
        const volatility = baseVolatility * weekendMultiplier * businessHourMultiplier;

        // Select opportunity frequency
        const opportunityLevel = this.weightedRandomSelect(MARKET_PATTERNS.opportunityFrequency);
        const baseFrequency = this.randomBetween(opportunityLevel.min, opportunityLevel.max);
        const opportunityFrequency = Math.round(baseFrequency * businessHourMultiplier);

        // Random competition and congestion
        const competition = MARKET_PATTERNS.competition[Math.floor(Math.random() * MARKET_PATTERNS.competition.length)];
        const networkCongestion = MARKET_PATTERNS.networkCongestion[Math.floor(Math.random() * MARKET_PATTERNS.networkCongestion.length)];

        const conditions = {
            volatility,
            opportunityFrequency,
            competition,
            networkCongestion,
            isOptimal: volatility <= 0.03 && competition === 'low' && networkCongestion <= 1.0,
            hour,
            hourOfDay,
            dayOfWeek
        };

        this.marketConditions.push(conditions);
        this.profitCalculator.updateMarketConditions(conditions);

        return conditions;
    }

    /**
     * Weighted random selection from options
     */
    weightedRandomSelect(options) {
        const totalWeight = Object.values(options).reduce((sum, opt) => sum + opt.weight, 0);
        let random = Math.random() * totalWeight;

        for (const [key, option] of Object.entries(options)) {
            random -= option.weight;
            if (random <= 0) {
                return option;
            }
        }
    }

    /**
     * Generate random number between min and max
     */
    randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    /**
     * Simulate arbitrage opportunities for current hour
     */
    async simulateArbitrageOpportunities(conditions) {
        const opportunities = [];
        const numOpportunities = Math.round(conditions.opportunityFrequency * (0.8 + Math.random() * 0.4)); // ±20% variation

        for (let i = 0; i < numOpportunities; i++) {
            const tradeSize = TRADING_PARAMS.arbitrage.tradeSizes[Math.floor(Math.random() * TRADING_PARAMS.arbitrage.tradeSizes.length)];
            const profitMargin = TRADING_PARAMS.arbitrage.baseProfitMargin * (0.5 + Math.random() * 1.5); // 50-200% of base

            // Simulate price spread
            const buyPrice = 1.0;
            const sellPrice = buyPrice * (1 + profitMargin);

            const opportunity = {
                token: 'WETH', // Using WETH as example
                amount: tradeSize,
                buyPrice,
                sellPrice,
                protocol: 'Uniswap',
                type: 'arbitrage'
            };

            opportunities.push(opportunity);
        }

        return opportunities;
    }

    /**
     * Simulate liquidation events for current hour
     */
    simulateLiquidationEvents(conditions) {
        const events = [];
        const numEvents = Math.random() < TRADING_PARAMS.liquidation.eventFrequency ? 1 : 0;

        for (let i = 0; i < numEvents; i++) {
            const bonusSize = TRADING_PARAMS.liquidation.bonusSizes[Math.floor(Math.random() * TRADING_PARAMS.liquidation.bonusSizes.length)];
            const bonus = bonusSize * (0.8 + Math.random() * 0.4); // ±20% variation

            const event = {
                type: 'liquidation',
                bonus,
                protocol: 'Venus',
                collateral: 'WETH'
            };

            events.push(event);
        }

        return events;
    }

    /**
     * Simulate NFT trading opportunities for current hour
     */
    simulateNFTTrades(conditions) {
        const trades = [];
        const numTrades = Math.random() < TRADING_PARAMS.nft.tradeFrequency ? 1 : 0;

        for (let i = 0; i < numTrades; i++) {
            const tradeSize = TRADING_PARAMS.nft.tradeSizes[Math.floor(Math.random() * TRADING_PARAMS.nft.tradeSizes.length)];
            const profit = tradeSize * TRADING_PARAMS.nft.baseProfit * (0.5 + Math.random() * 1.0); // 50-150% of base

            const trade = {
                type: 'nft',
                tradeSize,
                profit,
                collection: 'BoredApeYachtClub'
            };

            trades.push(trade);
        }

        return trades;
    }

    /**
     * Execute a trade and calculate profitability
     */
    async executeTrade(trade, conditions) {
        let profit = 0;
        let costs = { gasCost: 0, flashLoanFee: 0, slippage: 0, dexFees: 0 };
        let success = true;

        try {
            if (trade.type === 'arbitrage') {
                // Use ProfitCalculator to calculate arbitrage profitability
                const result = await this.profitCalculator.calculateArbitrageProfitability(trade);

                if (result.isProfitable) {
                    profit = result.adjustedProfit;
                    costs = result.costs;
                } else {
                    profit = result.adjustedProfit; // Could be negative
                    success = Math.random() < TRADING_PARAMS.arbitrage.successRate; // Apply success rate
                }

            } else if (trade.type === 'liquidation') {
                // Liquidation bonuses are more predictable
                profit = trade.bonus;
                costs.gasCost = this.profitCalculator.calculateDynamicGasCost(trade.bonus, trade);

            } else if (trade.type === 'nft') {
                // NFT trading profits
                profit = trade.profit;
                costs.gasCost = 5.0; // Fixed gas cost for NFT trades
                costs.dexFees = trade.tradeSize * 0.005; // 0.5% DEX fees
            }

            // Apply success rate for non-liquidation trades
            if (trade.type !== 'liquidation' && !success) {
                profit = -costs.gasCost; // Loss of gas cost on failure
            }

        } catch (error) {
            console.error(`Trade execution error: ${error.message}`);
            profit = -5.0; // Gas cost on error
            success = false;
        }

        const tradeResult = {
            ...trade,
            profit,
            costs,
            success,
            conditions: { ...conditions },
            timestamp: new Date(Date.now() + (conditions.hour * 60 * 60 * 1000)).toISOString()
        };

        this.trades.push(tradeResult);

        // Update capital
        this.currentCapital += profit;
        if (profit > 0) {
            this.totalProfits += profit;
            this.successfulTrades++;
        } else {
            this.totalLosses += Math.abs(profit);
            this.failedTrades++;
        }

        return tradeResult;
    }

    /**
     * Run the complete simulation
     */
    async runSimulation() {
        console.log('🚀 Starting profitability validation simulation...');
        console.log(`📊 Simulating ${SIMULATION_HOURS} hours of trading activity`);
        console.log(`💰 Starting capital: $${this.totalCapital.toLocaleString()}`);
        console.log(`🎯 Target monthly ROI: ${TARGET_MONTHLY_ROI_MIN}-${TARGET_MONTHLY_ROI_MAX}%\n`);

        for (let hour = 0; hour < SIMULATION_HOURS; hour++) {
            const conditions = this.generateMarketConditions(hour);

            // Generate opportunities
            const arbitrageOpportunities = await this.simulateArbitrageOpportunities(conditions);
            const liquidationEvents = this.simulateLiquidationEvents(conditions);
            const nftTrades = this.simulateNFTTrades(conditions);

            const allTrades = [...arbitrageOpportunities, ...liquidationEvents, ...nftTrades];

            // Execute trades
            const hourlyResults = [];
            for (const trade of allTrades) {
                const result = await this.executeTrade(trade, conditions);
                hourlyResults.push(result);
            }

            // Track hourly statistics
            const hourlyProfit = hourlyResults.reduce((sum, trade) => sum + trade.profit, 0);
            const hourlyStats = {
                hour,
                conditions,
                trades: hourlyResults.length,
                profit: hourlyProfit,
                capital: this.currentCapital,
                profitableTrades: hourlyResults.filter(t => t.profit > 0).length
            };

            this.hourlyStats.push(hourlyStats);

            // Progress indicator
            if (hour % 24 === 0) {
                const progress = ((hour / SIMULATION_HOURS) * 100).toFixed(1);
                console.log(`📈 Day ${Math.floor(hour / 24) + 1}/7 complete (${progress}%): $${this.currentCapital.toLocaleString()}`);
            }
        }

        console.log('\n✅ Simulation complete!');
        this.generateReport();
    }

    /**
     * Calculate ROI metrics
     */
    calculateROI() {
        const totalReturn = this.currentCapital - this.totalCapital;
        const weeklyROI = (totalReturn / this.totalCapital) * 100;
        const monthlyROI = weeklyROI * 4.33; // Approximate weeks per month

        return {
            totalReturn,
            weeklyROI,
            monthlyROI,
            isWithinTarget: monthlyROI >= TARGET_MONTHLY_ROI_MIN && monthlyROI <= TARGET_MONTHLY_ROI_MAX
        };
    }

    /**
     * Generate comprehensive profitability report
     */
    generateReport() {
        const roi = this.calculateROI();

        console.log('\n' + '='.repeat(80));
        console.log('📊 PROFITABILITY VALIDATION REPORT');
        console.log('='.repeat(80));

        console.log('\n💰 FINANCIAL SUMMARY:');
        console.log(`Starting Capital: $${this.totalCapital.toLocaleString()}`);
        console.log(`Ending Capital: $${this.currentCapital.toLocaleString()}`);
        console.log(`Total Return: $${roi.totalReturn.toLocaleString()}`);
        console.log(`Weekly ROI: ${roi.weeklyROI.toFixed(2)}%`);
        console.log(`Monthly ROI: ${roi.monthlyROI.toFixed(2)}%`);

        console.log('\n🎯 TARGET COMPARISON:');
        const targetStatus = roi.isWithinTarget ? '✅ WITHIN TARGET' : '❌ OUTSIDE TARGET';
        console.log(`Target Range: ${TARGET_MONTHLY_ROI_MIN}-${TARGET_MONTHLY_ROI_MAX}%`);
        console.log(`Status: ${targetStatus}`);

        console.log('\n📈 TRADING STATISTICS:');
        console.log(`Total Trades: ${this.trades.length}`);
        console.log(`Successful Trades: ${this.successfulTrades}`);
        console.log(`Failed Trades: ${this.failedTrades}`);
        console.log(`Success Rate: ${((this.successfulTrades / this.trades.length) * 100).toFixed(1)}%`);
        console.log(`Total Profits: $${this.totalProfits.toLocaleString()}`);
        console.log(`Total Losses: $${this.totalLosses.toLocaleString()}`);

        // Trade breakdown by type
        const arbitrageTrades = this.trades.filter(t => t.type === 'arbitrage');
        const liquidationTrades = this.trades.filter(t => t.type === 'liquidation');
        const nftTrades = this.trades.filter(t => t.type === 'nft');

        console.log('\n🔄 TRADE BREAKDOWN:');
        console.log(`Arbitrage Trades: ${arbitrageTrades.length} ($${arbitrageTrades.reduce((sum, t) => sum + t.profit, 0).toFixed(2)})`);
        console.log(`Liquidation Events: ${liquidationTrades.length} ($${liquidationTrades.reduce((sum, t) => sum + t.profit, 0).toFixed(2)})`);
        console.log(`NFT Trades: ${nftTrades.length} ($${nftTrades.reduce((sum, t) => sum + t.profit, 0).toFixed(2)})`);

        // Market condition analysis
        const optimalHours = this.marketConditions.filter(c => c.isOptimal).length;
        const optimalPeriodReturn = this.hourlyStats
            .filter((_, i) => this.marketConditions[i].isOptimal)
            .reduce((sum, h) => sum + h.profit, 0);

        console.log('\n🌤️ MARKET CONDITION ANALYSIS:');
        console.log(`Optimal Hours: ${optimalHours}/${SIMULATION_HOURS} (${((optimalHours/SIMULATION_HOURS)*100).toFixed(1)}%)`);
        console.log(`Optimal Period Return: $${optimalPeriodReturn.toFixed(2)}`);
        console.log(`Avg Hourly Profit (Optimal): $${(optimalPeriodReturn/optimalHours).toFixed(2)}`);

        const suboptimalHours = SIMULATION_HOURS - optimalHours;
        const suboptimalReturn = roi.totalReturn - optimalPeriodReturn;
        console.log(`Suboptimal Hours: ${suboptimalHours}/${SIMULATION_HOURS} (${((suboptimalHours/SIMULATION_HOURS)*100).toFixed(1)}%)`);
        console.log(`Suboptimal Period Return: $${suboptimalReturn.toFixed(2)}`);
        console.log(`Avg Hourly Profit (Suboptimal): $${(suboptimalReturn/suboptimalHours).toFixed(2)}`);

        // Cost analysis
        const totalGasCosts = this.trades.reduce((sum, t) => sum + (t.costs.gasCost || 0), 0);
        const totalFlashFees = this.trades.reduce((sum, t) => sum + (t.costs.flashLoanFee || 0), 0);
        const totalSlippage = this.trades.reduce((sum, t) => sum + (t.costs.slippage || 0), 0);
        const totalDexFees = this.trades.reduce((sum, t) => sum + (t.costs.dexFees || 0), 0);

        console.log('\n💸 COST ANALYSIS:');
        console.log(`Total Gas Costs: $${totalGasCosts.toFixed(2)}`);
        console.log(`Total Flash Loan Fees: $${totalFlashFees.toFixed(2)}`);
        console.log(`Total Slippage: $${totalSlippage.toFixed(2)}`);
        console.log(`Total DEX Fees: $${totalDexFees.toFixed(2)}`);
        console.log(`Total Costs: $${(totalGasCosts + totalFlashFees + totalSlippage + totalDexFees).toFixed(2)}`);

        console.log('\n' + '='.repeat(80));
        console.log('🏁 SIMULATION SUMMARY');
        console.log('='.repeat(80));

        if (roi.isWithinTarget) {
            console.log('✅ SUCCESS: Monthly ROI is within the target range of 15-35%');
            console.log(`📈 Achieved ${roi.monthlyROI.toFixed(2)}% monthly ROI`);
        } else if (roi.monthlyROI < TARGET_MONTHLY_ROI_MIN) {
            console.log('❌ BELOW TARGET: Monthly ROI is below the minimum 15%');
            console.log(`📉 Achieved only ${roi.monthlyROI.toFixed(2)}% monthly ROI`);
        } else {
            console.log('⚠️ ABOVE TARGET: Monthly ROI exceeds the maximum 35%');
            console.log(`📈 Achieved ${roi.monthlyROI.toFixed(2)}% monthly ROI`);
        }

        console.log('\n💡 RECOMMENDATIONS:');
        if (!roi.isWithinTarget) {
            if (roi.monthlyROI < TARGET_MONTHLY_ROI_MIN) {
                console.log('- Consider increasing trade frequency during optimal market conditions');
                console.log('- Optimize gas costs and slippage parameters');
                console.log('- Focus on higher-profit arbitrage opportunities');
            } else {
                console.log('- Implement stricter risk management to control returns');
                console.log('- Consider position sizing limits');
                console.log('- Add more conservative trading parameters');
            }
        } else {
            console.log('- Current parameters provide balanced profitability');
            console.log('- Monitor market conditions for optimal timing');
            console.log('- Consider scaling up during optimal periods');
        }
    }
}

// Run the simulation
async function main() {
    try {
        const validator = new ProfitabilityValidator();
        await validator.runSimulation();
    } catch (error) {
        console.error('Simulation failed:', error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default ProfitabilityValidator;