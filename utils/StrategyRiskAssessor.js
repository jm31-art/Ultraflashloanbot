const { EventEmitter } = require('events');
const { ethers } = require('ethers');

class StrategyRiskAssessor extends EventEmitter {
    constructor(provider) {
        super();

        this.provider = provider;

        // Risk thresholds
        this.riskThresholds = {
            maxDrawdown: 0.1, // 10% max drawdown
            maxConsecutiveLosses: 5,
            minWinRate: 0.3, // 30% minimum win rate
            maxVolatility: 0.05, // 5% max volatility
            maxCorrelation: 0.7, // 70% max correlation between strategies
            maxSlippage: 0.02, // 2% max slippage
            maxGasPriceSpike: 2.0 // 2x max gas price spike
        };

        // Risk metrics tracking
        this.strategyRiskMetrics = new Map();
        this.portfolioRiskMetrics = {
            totalExposure: 0,
            totalDrawdown: 0,
            correlationMatrix: new Map(),
            volatility: 0,
            sharpeRatio: 0,
            maxDrawdown: 0
        };

        // Emergency stop conditions
        this.emergencyStopTriggered = false;
        this.emergencyStopReason = null;

        // Risk assessment history
        this.riskHistory = [];
        this.maxHistorySize = 1000;

        console.log('StrategyRiskAssessor initialized');
    }

    // Assess risk for a specific strategy opportunity
    async assessStrategyRisk(strategyName, opportunity) {
        try {
            const strategyMetrics = this.strategyRiskMetrics.get(strategyName) || this._initializeStrategyMetrics(strategyName);

            // Calculate various risk factors
            const riskFactors = await this._calculateRiskFactors(strategyName, opportunity, strategyMetrics);

            // Aggregate risk score
            const riskScore = this._calculateRiskScore(riskFactors);

            // Determine if opportunity should be recommended
            const recommended = this._shouldRecommendOpportunity(riskScore, riskFactors, strategyMetrics);

            // Update strategy metrics
            this._updateStrategyMetrics(strategyName, opportunity, riskFactors, recommended);

            // Check for emergency stop conditions
            this._checkEmergencyStopConditions(strategyName, strategyMetrics);

            const assessment = {
                strategy: strategyName,
                riskScore: riskScore,
                recommended: recommended,
                riskFactors: riskFactors,
                assessmentTime: Date.now(),
                emergencyStop: this.emergencyStopTriggered
            };

            // Store assessment in history
            this._addToHistory(assessment);

            return assessment;

        } catch (error) {
            console.error(`Error assessing risk for ${strategyName}:`, error);
            return {
                strategy: strategyName,
                riskScore: 1.0, // High risk on error
                recommended: false,
                error: error.message,
                assessmentTime: Date.now()
            };
        }
    }

    _initializeStrategyMetrics(strategyName) {
        const metrics = {
            totalTrades: 0,
            successfulTrades: 0,
            consecutiveLosses: 0,
            totalProfit: 0,
            totalLoss: 0,
            winRate: 0,
            currentDrawdown: 0,
            maxDrawdown: 0,
            volatility: 0,
            lastTradeTime: null,
            exposure: 0,
            errorCount: 0,
            lastErrorTime: null
        };

        this.strategyRiskMetrics.set(strategyName, metrics);
        return metrics;
    }

    async _calculateRiskFactors(strategyName, opportunity, strategyMetrics) {
        const riskFactors = {
            slippageRisk: 0,
            liquidityRisk: 0,
            volatilityRisk: 0,
            gasRisk: 0,
            correlationRisk: 0,
            drawdownRisk: 0,
            historicalPerformanceRisk: 0,
            marketConditionRisk: 0
        };

        // Slippage risk
        riskFactors.slippageRisk = this._calculateSlippageRisk(opportunity);

        // Liquidity risk
        riskFactors.liquidityRisk = await this._calculateLiquidityRisk(opportunity);

        // Volatility risk
        riskFactors.volatilityRisk = this._calculateVolatilityRisk(opportunity, strategyMetrics);

        // Gas risk
        riskFactors.gasRisk = await this._calculateGasRisk();

        // Correlation risk
        riskFactors.correlationRisk = this._calculateCorrelationRisk(strategyName, opportunity);

        // Drawdown risk
        riskFactors.drawdownRisk = this._calculateDrawdownRisk(strategyMetrics);

        // Historical performance risk
        riskFactors.historicalPerformanceRisk = this._calculateHistoricalPerformanceRisk(strategyMetrics);

        // Market condition risk
        riskFactors.marketConditionRisk = await this._calculateMarketConditionRisk();

        return riskFactors;
    }

    _calculateSlippageRisk(opportunity) {
        const expectedSlippage = opportunity.expectedSlippage || 0.005; // 0.5% default
        const maxSlippage = this.riskThresholds.maxSlippage;

        if (expectedSlippage > maxSlippage) {
            return 1.0; // Maximum risk
        }

        return expectedSlippage / maxSlippage;
    }

    async _calculateLiquidityRisk(opportunity) {
        // Check liquidity for tokens involved
        const tokens = this._getTokensFromOpportunity(opportunity);
        let totalLiquidityRisk = 0;

        for (const token of tokens) {
            try {
                // This would integrate with liquidity checking services
                const liquidity = await this._getTokenLiquidity(token);
                const minLiquidity = opportunity.minLiquidity || 10000; // $10k minimum

                if (liquidity < minLiquidity) {
                    totalLiquidityRisk += 1.0;
                } else {
                    totalLiquidityRisk += Math.max(0, 1 - (liquidity / minLiquidity));
                }
            } catch (error) {
                totalLiquidityRisk += 0.5; // Medium risk on error
            }
        }

        return Math.min(1.0, totalLiquidityRisk / tokens.length);
    }

    async _getTokenLiquidity(tokenAddress) {
        // Placeholder - integrate with DEX liquidity APIs
        // Return mock liquidity for now
        return 50000; // $50k mock liquidity
    }

    _calculateVolatilityRisk(opportunity, strategyMetrics) {
        const strategyVolatility = strategyMetrics.volatility || 0.02; // 2% default
        const maxVolatility = this.riskThresholds.maxVolatility;

        return Math.min(1.0, strategyVolatility / maxVolatility);
    }

    async _calculateGasRisk() {
        try {
            const gasPrice = (await this.provider.getFeeData()).gasPrice;
            const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));

            // Compare to recent average (simplified)
            const avgGasPrice = 5; // 5 gwei average
            const gasSpike = gasPriceGwei / avgGasPrice;

            return Math.min(1.0, gasSpike / this.riskThresholds.maxGasPriceSpike);
        } catch (error) {
            return 0.5; // Medium risk on error
        }
    }

    _calculateCorrelationRisk(strategyName, opportunity) {
        // Calculate correlation with other active strategies
        let totalCorrelation = 0;
        let correlationCount = 0;

        for (const [otherStrategy, metrics] of this.strategyRiskMetrics) {
            if (otherStrategy !== strategyName && metrics.totalTrades > 0) {
                // Simplified correlation calculation
                const correlation = this._calculateStrategyCorrelation(strategyName, otherStrategy);
                totalCorrelation += correlation;
                correlationCount++;
            }
        }

        if (correlationCount === 0) return 0;

        const avgCorrelation = totalCorrelation / correlationCount;
        return Math.min(1.0, avgCorrelation / this.riskThresholds.maxCorrelation);
    }

    _calculateStrategyCorrelation(strategy1, strategy2) {
        // Simplified correlation calculation
        // In production, this would use statistical correlation of returns
        return 0.3; // 30% mock correlation
    }

    _calculateDrawdownRisk(strategyMetrics) {
        const currentDrawdown = strategyMetrics.currentDrawdown || 0;
        const maxDrawdown = strategyMetrics.maxDrawdown || 0;
        const maxAllowedDrawdown = this.riskThresholds.maxDrawdown;

        // Use the higher of current or max drawdown
        const relevantDrawdown = Math.max(currentDrawdown, maxDrawdown);

        return Math.min(1.0, relevantDrawdown / maxAllowedDrawdown);
    }

    _calculateHistoricalPerformanceRisk(strategyMetrics) {
        const winRate = strategyMetrics.winRate || 0;
        const minWinRate = this.riskThresholds.minWinRate;

        if (winRate < minWinRate) {
            return Math.min(1.0, (minWinRate - winRate) / minWinRate);
        }

        return 0;
    }

    async _calculateMarketConditionRisk() {
        // Assess overall market conditions
        try {
            // This would integrate with market data APIs
            // For now, return low risk
            return 0.2; // 20% base market risk
        } catch (error) {
            return 0.5; // Medium risk on error
        }
    }

    _calculateRiskScore(riskFactors) {
        // Weighted average of risk factors
        const weights = {
            slippageRisk: 0.15,
            liquidityRisk: 0.15,
            volatilityRisk: 0.15,
            gasRisk: 0.1,
            correlationRisk: 0.1,
            drawdownRisk: 0.15,
            historicalPerformanceRisk: 0.1,
            marketConditionRisk: 0.1
        };

        let totalScore = 0;
        let totalWeight = 0;

        for (const [factor, weight] of Object.entries(weights)) {
            totalScore += riskFactors[factor] * weight;
            totalWeight += weight;
        }

        return totalScore / totalWeight;
    }

    _shouldRecommendOpportunity(riskScore, riskFactors, strategyMetrics) {
        // Don't recommend if risk score is too high
        if (riskScore > 0.7) {
            return false;
        }

        // Don't recommend if drawdown risk is too high
        if (riskFactors.drawdownRisk > 0.8) {
            return false;
        }

        // Don't recommend if consecutive losses are too high
        if (strategyMetrics.consecutiveLosses >= this.riskThresholds.maxConsecutiveLosses) {
            return false;
        }

        // Don't recommend if emergency stop is triggered
        if (this.emergencyStopTriggered) {
            return false;
        }

        return true;
    }

    _updateStrategyMetrics(strategyName, opportunity, riskFactors, recommended) {
        const metrics = this.strategyRiskMetrics.get(strategyName);

        // Update exposure
        metrics.exposure += opportunity.amount || 0;

        // This would be updated after trade execution
        // For now, just track the assessment
    }

    recordTrade(strategyName, tradeResult) {
        const metrics = this.strategyRiskMetrics.get(strategyName);
        if (!metrics) return;

        metrics.totalTrades++;
        metrics.lastTradeTime = Date.now();

        if (tradeResult.profit > 0) {
            metrics.successfulTrades++;
            metrics.consecutiveLosses = 0;
            metrics.totalProfit += tradeResult.profit;
        } else {
            metrics.consecutiveLosses++;
            metrics.totalLoss += Math.abs(tradeResult.profit);
        }

        // Update win rate
        metrics.winRate = metrics.totalTrades > 0 ? metrics.successfulTrades / metrics.totalTrades : 0;

        // Update drawdown
        this._updateDrawdown(strategyName, tradeResult);

        // Update volatility (simplified)
        metrics.volatility = this._calculateStrategyVolatility(metrics);

        this.strategyRiskMetrics.set(strategyName, metrics);

        // Check emergency stop conditions
        this._checkEmergencyStopConditions(strategyName, metrics);
    }

    _updateDrawdown(strategyName, tradeResult) {
        const metrics = this.strategyRiskMetrics.get(strategyName);

        // Simplified drawdown calculation
        if (tradeResult.profit < 0) {
            metrics.currentDrawdown += Math.abs(tradeResult.profit);
            metrics.maxDrawdown = Math.max(metrics.maxDrawdown, metrics.currentDrawdown);
        } else {
            // Recovery - reduce drawdown
            metrics.currentDrawdown = Math.max(0, metrics.currentDrawdown - tradeResult.profit);
        }
    }

    _calculateStrategyVolatility(metrics) {
        // Simplified volatility calculation
        if (metrics.totalTrades < 2) return 0;

        const avgReturn = (metrics.totalProfit - metrics.totalLoss) / metrics.totalTrades;
        return Math.sqrt(avgReturn * avgReturn); // Placeholder
    }

    _checkEmergencyStopConditions(strategyName, metrics) {
        if (this.emergencyStopTriggered) return;

        // Check max drawdown
        if (metrics.currentDrawdown >= this.riskThresholds.maxDrawdown) {
            this._triggerEmergencyStop(`Max drawdown exceeded for ${strategyName}: ${metrics.currentDrawdown}`);
            return;
        }

        // Check consecutive losses
        if (metrics.consecutiveLosses >= this.riskThresholds.maxConsecutiveLosses) {
            this._triggerEmergencyStop(`Max consecutive losses exceeded for ${strategyName}: ${metrics.consecutiveLosses}`);
            return;
        }

        // Check win rate
        if (metrics.winRate < this.riskThresholds.minWinRate && metrics.totalTrades > 10) {
            this._triggerEmergencyStop(`Win rate too low for ${strategyName}: ${metrics.winRate}`);
            return;
        }

        // Check portfolio-level emergency conditions
        this._checkPortfolioEmergencyConditions();
    }

    _checkPortfolioEmergencyConditions() {
        let totalDrawdown = 0;
        let totalTrades = 0;

        for (const metrics of this.strategyRiskMetrics.values()) {
            totalDrawdown += metrics.currentDrawdown;
            totalTrades += metrics.totalTrades;
        }

        // Portfolio drawdown check
        if (totalDrawdown >= this.riskThresholds.maxDrawdown * 2) { // 20% portfolio drawdown
            this._triggerEmergencyStop(`Portfolio drawdown too high: ${totalDrawdown}`);
        }
    }

    _triggerEmergencyStop(reason) {
        this.emergencyStopTriggered = true;
        this.emergencyStopReason = reason;

        console.log(`🚨 EMERGENCY STOP TRIGGERED: ${reason}`);

        this.emit('emergencyStop', {
            reason: reason,
            timestamp: Date.now(),
            portfolioRiskMetrics: this.portfolioRiskMetrics
        });
    }

    _getTokensFromOpportunity(opportunity) {
        const tokens = [];
        if (opportunity.tokenIn) tokens.push(opportunity.tokenIn);
        if (opportunity.tokenOut) tokens.push(opportunity.tokenOut);
        if (opportunity.token) tokens.push(opportunity.token);
        if (opportunity.collateralAsset) tokens.push(opportunity.collateralAsset);
        if (opportunity.debtAsset) tokens.push(opportunity.debtAsset);
        return tokens;
    }

    _addToHistory(assessment) {
        this.riskHistory.push(assessment);

        // Keep history size manageable
        if (this.riskHistory.length > this.maxHistorySize) {
            this.riskHistory.shift();
        }
    }

    // Public methods
    getRiskMetrics() {
        return {
            emergencyStopTriggered: this.emergencyStopTriggered,
            emergencyStopReason: this.emergencyStopReason,
            strategyMetrics: Object.fromEntries(this.strategyRiskMetrics),
            portfolioMetrics: this.portfolioRiskMetrics,
            riskThresholds: this.riskThresholds
        };
    }

    getStrategyRiskMetrics(strategyName) {
        return this.strategyRiskMetrics.get(strategyName) || null;
    }

    resetEmergencyStop() {
        this.emergencyStopTriggered = false;
        this.emergencyStopReason = null;
        console.log('Emergency stop reset');
    }

    updateRiskThresholds(newThresholds) {
        this.riskThresholds = {
            ...this.riskThresholds,
            ...newThresholds
        };
        console.log('Risk thresholds updated');
    }

    getRiskHistory(limit = 100) {
        return this.riskHistory.slice(-limit);
    }

    shouldEmergencyStop() {
        return this.emergencyStopTriggered;
    }
}

module.exports = StrategyRiskAssessor;
