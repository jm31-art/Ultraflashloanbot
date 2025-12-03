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

        // Alerting configuration
        this.telegramBotToken = options.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
        this.telegramChatId = options.telegramChatId || process.env.TELEGRAM_CHAT_ID;
        this.emailConfig = options.emailConfig || {
            smtpHost: process.env.SMTP_HOST,
            smtpPort: process.env.SMTP_PORT,
            username: process.env.SMTP_USERNAME,
            password: process.env.SMTP_PASSWORD,
            fromEmail: process.env.ALERT_FROM_EMAIL,
            toEmails: (process.env.ALERT_TO_EMAILS || '').split(',')
        };

        // Alert levels
        this.ALERT_LEVELS = {
            INFO: '📘',
            WARNING: '⚠️',
            CRITICAL: '🚨',
            SUCCESS: '✅'
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

        // Emit alerts and send notifications
        for (const alert of alerts) {
            this.stats.lastAlertTime = now;
            this.alerts.push({ ...alert, timestamp: now });
            this.emit('alert', alert);

            // Send external notifications for WARNING and CRITICAL alerts
            if (alert.level === 'WARNING' || alert.level === 'CRITICAL') {
                await this.sendTelegramAlert(alert);
                await this.sendEmailAlert(alert);
            }

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

    // Telegram alerting
    async sendTelegramAlert(alert) {
        if (!this.telegramBotToken || !this.telegramChatId) {
            return; // Telegram not configured
        }

        try {
            const emoji = this.ALERT_LEVELS[alert.level] || '📢';
            const message = `${emoji} **${alert.level} ALERT**\n\n` +
                          `**Type:** ${alert.type}\n` +
                          `**Message:** ${alert.message}\n` +
                          `**Time:** ${new Date(alert.timestamp).toISOString()}\n` +
                          `**Bot Status:** ${this.getStats().successRate.toFixed(1)}% success rate`;

            const url = `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chat_id: this.telegramChatId,
                    text: message,
                    parse_mode: 'Markdown'
                })
            });

            if (!response.ok) {
                console.error('Telegram alert failed:', response.statusText);
            }
        } catch (error) {
            console.error('Telegram alert error:', error);
        }
    }

    // Email alerting
    async sendEmailAlert(alert) {
        if (!this.emailConfig.smtpHost || !this.emailConfig.toEmails.length) {
            return; // Email not configured
        }

        try {
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransporter({
                host: this.emailConfig.smtpHost,
                port: this.emailConfig.smtpPort || 587,
                secure: false,
                auth: {
                    user: this.emailConfig.username,
                    pass: this.emailConfig.password
                }
            });

            const emoji = this.ALERT_LEVELS[alert.level] || '📢';
            const subject = `${emoji} ${alert.level} ALERT - Arbitrage Bot`;
            const html = `
                <h2>${emoji} ${alert.level} ALERT</h2>
                <p><strong>Type:</strong> ${alert.type}</p>
                <p><strong>Message:</strong> ${alert.message}</p>
                <p><strong>Time:</strong> ${new Date(alert.timestamp).toISOString()}</p>
                <hr>
                <h3>Bot Status</h3>
                <ul>
                    <li>Success Rate: ${this.getStats().successRate.toFixed(1)}%</li>
                    <li>Total Profit: $${this.getStats().totalProfit.toFixed(2)}</li>
                    <li>Consecutive Failures: ${this.getStats().consecutiveFailures}</li>
                </ul>
            `;

            for (const toEmail of this.emailConfig.toEmails) {
                if (toEmail.trim()) {
                    await transporter.sendMail({
                        from: this.emailConfig.fromEmail,
                        to: toEmail.trim(),
                        subject: subject,
                        html: html
                    });
                }
            }
        } catch (error) {
            console.error('Email alert error:', error);
        }
    }

    // Send success notifications
    async sendSuccessNotification(tradeData) {
        const successAlert = {
            level: 'SUCCESS',
            type: 'trade_executed',
            message: `Arbitrage executed! Profit: $${tradeData.profit.toFixed(2)}`,
            timestamp: Date.now(),
            tradeData
        };

        await this.sendTelegramAlert(successAlert);
        // Optional: send email for large profits
        if (tradeData.profit > 100) {
            await this.sendEmailAlert(successAlert);
        }
    }
}

module.exports = MonitoringSystem;