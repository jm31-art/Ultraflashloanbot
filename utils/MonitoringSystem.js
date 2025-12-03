const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class MonitoringSystem extends EventEmitter {
    constructor(options = {}) {
        super();
        this.logFile = options.logFile || 'bot_monitoring.log';
        this.alertThresholds = {
            maxGasPrice: options.maxGasPrice || 50e9, // 50 gwei
            minProfitMargin: options.minProfitMargin || 0.001, // 0.1%
            maxSlippage: options.maxSlippage || 0.005, // 0.5%
            maxFailedTransactions: options.maxFailedTransactions || 5,
            alertCooldown: options.alertCooldown || 300000 // 5 minutes
        };

        this.stats = {
            startTime: Date.now(),
            totalScans: 0,
            profitableOpportunities: 0,
            executedTrades: 0,
            failedTrades: 0,
            totalProfit: 0,
            totalLoss: 0,
            gasSpent: 0,
            lastAlertTime: 0,
            consecutiveFailures: 0
        };

        this.alerts = [];
        this.performanceHistory = [];
    }

    async logEvent(eventType, data) {
        const logEntry = {
            timestamp: Date.now(),
            type: eventType,
            data: data
        };

        // Update stats
        this.updateStats(eventType, data);

        // Check for alerts
        await this.checkAlerts(logEntry);

        // Emit event for real-time monitoring
        this.emit(eventType, logEntry);

        // Write to log file
        await this.writeToLog(logEntry);

        // Keep performance history
        this.performanceHistory.push(logEntry);
        if (this.performanceHistory.length > 1000) {
            this.performanceHistory.shift(); // Keep last 1000 entries
        }
    }

    updateStats(eventType, data) {
        this.stats.totalScans++;

        switch (eventType) {
            case 'arbitrage_found':
                this.stats.profitableOpportunities++;
                break;
            case 'trade_executed':
                this.stats.executedTrades++;
                this.stats.totalProfit += data.profit || 0;
                this.stats.gasSpent += data.gasCost || 0;
                this.stats.consecutiveFailures = 0;
                break;
            case 'trade_failed':
                this.stats.failedTrades++;
                this.stats.totalLoss += data.loss || 0;
                this.stats.consecutiveFailures++;
                break;
        }
    }

    async checkAlerts(logEntry) {
        const now = Date.now();
        const timeSinceLastAlert = now - this.stats.lastAlertTime;

        if (timeSinceLastAlert < this.alertThresholds.alertCooldown) {
            return; // Cooldown active
        }

        const alerts = [];

        // Check gas price alert
        if (logEntry.data.gasPrice > this.alertThresholds.maxGasPrice) {
            alerts.push({
                level: 'WARNING',
                message: `High gas price detected: ${logEntry.data.gasPrice} wei`,
                type: 'gas_price'
            });
        }

        // Check consecutive failures
        if (this.stats.consecutiveFailures >= this.alertThresholds.maxFailedTransactions) {
            alerts.push({
                level: 'CRITICAL',
                message: `High failure rate: ${this.stats.consecutiveFailures} consecutive failures`,
                type: 'failure_rate'
            });
        }

        // Check profit margin
        if (logEntry.data.profitMargin < this.alertThresholds.minProfitMargin) {
            alerts.push({
                level: 'WARNING',
                message: `Low profit margin: ${(logEntry.data.profitMargin * 100).toFixed(2)}%`,
                type: 'profit_margin'
            });
        }

        // Check slippage
        if (logEntry.data.slippage > this.alertThresholds.maxSlippage) {
            alerts.push({
                level: 'WARNING',
                message: `High slippage detected: ${(logEntry.data.slippage * 100).toFixed(2)}%`,
                type: 'slippage'
            });
        }

        // Emit alerts
        for (const alert of alerts) {
            this.stats.lastAlertTime = now;
            this.alerts.push({ ...alert, timestamp: now });
            this.emit('alert', alert);

            // Keep only last 100 alerts
            if (this.alerts.length > 100) {
                this.alerts.shift();
            }
        }
    }

    async writeToLog(logEntry) {
        try {
            const logLine = JSON.stringify(logEntry) + '\n';
            await fs.appendFile(this.logFile, logLine);
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    getStats() {
        const uptime = Date.now() - this.stats.startTime;
        const successRate = this.stats.executedTrades / Math.max(this.stats.executedTrades + this.stats.failedTrades, 1);

        return {
            ...this.stats,
            uptime,
            successRate,
            averageProfit: this.stats.totalProfit / Math.max(this.stats.executedTrades, 1),
            totalReturn: this.stats.totalProfit - this.stats.totalLoss - this.stats.gasSpent,
            alertsCount: this.alerts.length
        };
    }

    getRecentAlerts(limit = 10) {
        return this.alerts.slice(-limit);
    }

    getPerformanceHistory(hours = 24) {
        const cutoff = Date.now() - (hours * 60 * 60 * 1000);
        return this.performanceHistory.filter(entry => entry.timestamp > cutoff);
    }

    async generateReport() {
        const stats = this.getStats();
        const recentAlerts = this.getRecentAlerts(20);

        const report = {
            generatedAt: new Date().toISOString(),
            period: {
                start: new Date(stats.startTime).toISOString(),
                uptime: `${Math.floor(stats.uptime / (1000 * 60 * 60))}h ${Math.floor((stats.uptime % (1000 * 60 * 60)) / (1000 * 60))}m`
            },
            performance: {
                totalScans: stats.totalScans,
                profitableOpportunities: stats.profitableOpportunities,
                executedTrades: stats.executedTrades,
                failedTrades: stats.failedTrades,
                successRate: `${(stats.successRate * 100).toFixed(1)}%`,
                totalProfit: `$${stats.totalProfit.toFixed(2)}`,
                totalLoss: `$${stats.totalLoss.toFixed(2)}`,
                gasSpent: `$${stats.gasSpent.toFixed(2)}`,
                netReturn: `$${stats.totalReturn.toFixed(2)}`,
                averageProfit: `$${stats.averageProfit.toFixed(2)}`
            },
            alerts: recentAlerts,
            recommendations: this.generateRecommendations(stats, recentAlerts)
        };

        return report;
    }

    generateRecommendations(stats, alerts) {
        const recommendations = [];

        if (stats.successRate < 0.8) {
            recommendations.push('Consider adjusting profit thresholds or improving execution logic');
        }

        if (stats.consecutiveFailures > 3) {
            recommendations.push('Investigate recent transaction failures - possible network or configuration issues');
        }

        const highGasAlerts = alerts.filter(a => a.type === 'gas_price').length;
        if (highGasAlerts > 5) {
            recommendations.push('Gas prices are frequently high - consider adjusting gas price limits or timing');
        }

        if (stats.totalReturn < 0) {
            recommendations.push('Bot is currently at a loss - review strategy and risk parameters');
        }

        return recommendations;
    }

    // Health check method
    async healthCheck() {
        const stats = this.getStats();
        const isHealthy = stats.successRate > 0.7 && stats.consecutiveFailures < 5;

        return {
            healthy: isHealthy,
            checks: {
                successRate: stats.successRate > 0.7,
                failureRate: stats.consecutiveFailures < 5,
                uptime: stats.uptime > 0,
                recentActivity: (Date.now() - (this.performanceHistory[this.performanceHistory.length - 1]?.timestamp || 0)) < 300000 // 5 minutes
            }
        };
    }
}

module.exports = MonitoringSystem;