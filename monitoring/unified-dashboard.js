// KILOCODE: UNIFIED MONITORING DASHBOARD
// monitoring/unified-dashboard.js

import WebSocket from 'ws';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class UnifiedMonitoringDashboard {

    constructor() {
        this.app = express();
        this.wss = null; // Will be initialized after HTTP server
        this.metrics = {
            pythonBot: {
                totalProfit: 0,
                totalOperations: 0,
                successfulOperations: 0,
                failedOperations: 0,
                successRate: 0,
                lastOperation: null,
                active: false,
                consecutiveFailures: 0,
                averageProfit: 0
            },
            javascriptBot: {
                totalProfit: 0,
                totalOperations: 0,
                successfulOperations: 0,
                failedOperations: 0,
                successRate: 0,
                lastOperation: null,
                active: false,
                consecutiveFailures: 0,
                averageProfit: 0
            },
            system: {
                totalProfit: 0,
                totalOperations: 0,
                conflicts: 0,
                coordinationFailures: 0,
                uptime: Date.now(),
                lastUpdate: null
            }
        };

        this.conflictHistory = [];
        this.performanceHistory = [];
        this.alerts = [];

        this.initializeServer();
    }

    initializeServer() {

        // Middleware
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, 'public')));

        // API Routes
        this.setupAPIRoutes();

        // Start HTTP server
        const server = this.app.listen(3000, () => {
            console.log('📈 Unified monitoring dashboard running on port 3000');
            console.log('🌐 Web dashboard: http://localhost:3000');
        });

        // Initialize WebSocket server
        this.wss = new WebSocket.Server({ server });
        this.setupWebSocket();
    }

    setupAPIRoutes() {

        // Bot reporting endpoints
        this.app.post('/report/python', (req, res) => {
            this.updatePythonMetrics(req.body);
            res.json({ status: 'received', timestamp: new Date().toISOString() });
        });

        this.app.post('/report/javascript', (req, res) => {
            this.updateJavaScriptMetrics(req.body);
            res.json({ status: 'received', timestamp: new Date().toISOString() });
        });

        this.app.post('/report/conflict', (req, res) => {
            this.recordConflict(req.body);
            res.json({ status: 'received', timestamp: new Date().toISOString() });
        });

        this.app.post('/report/coordination', (req, res) => {
            this.updateCoordinationMetrics(req.body);
            res.json({ status: 'received', timestamp: new Date().toISOString() });
        });

        // Real-time metrics endpoint
        this.app.get('/api/metrics', (req, res) => {
            res.json({
                ...this.metrics,
                timestamp: new Date().toISOString(),
                alerts: this.alerts.slice(-10) // Last 10 alerts
            });
        });

        // Historical data
        this.app.get('/api/history', (req, res) => {
            res.json({
                performance: this.performanceHistory.slice(-100), // Last 100 entries
                conflicts: this.conflictHistory.slice(-50) // Last 50 conflicts
            });
        });

        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                uptime: Date.now() - this.metrics.system.uptime,
                bots: {
                    python: this.metrics.pythonBot.active,
                    javascript: this.metrics.javascriptBot.active
                },
                timestamp: new Date().toISOString()
            });
        });

        // Serve dashboard HTML
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'index.html'));
        });
    }

    setupWebSocket() {

        this.wss.on('connection', (ws) => {
            console.log('📊 Monitoring client connected');

            // Send current metrics
            ws.send(JSON.stringify({
                type: 'METRICS_UPDATE',
                data: this.metrics,
                timestamp: new Date().toISOString()
            }));

            // Send recent alerts
            if (this.alerts.length > 0) {
                ws.send(JSON.stringify({
                    type: 'ALERTS_UPDATE',
                    data: this.alerts.slice(-5),
                    timestamp: new Date().toISOString()
                }));
            }
        });
    }

    updatePythonMetrics(data) {

        const bot = this.metrics.pythonBot;
        const profit = parseFloat(data.profit || 0);
        const success = data.success !== false; // Default to true if not specified

        bot.totalOperations += 1;
        bot.lastOperation = new Date().toISOString();
        bot.active = true;

        if (success) {
            bot.successfulOperations += 1;
            bot.totalProfit += profit;
            bot.consecutiveFailures = 0;
            bot.averageProfit = bot.totalProfit / bot.successfulOperations;
        } else {
            bot.failedOperations += 1;
            bot.consecutiveFailures += 1;
        }

        bot.successRate = bot.successfulOperations / bot.totalOperations;

        this.updateSystemMetrics();
        this.checkAlerts('python');
        this.recordPerformanceHistory();
        this.broadcastUpdate();

        console.log(`🐍 Python bot update: ${success ? 'SUCCESS' : 'FAILED'} - Profit: $${profit.toFixed(2)}`);
    }

    updateJavaScriptMetrics(data) {

        const bot = this.metrics.javascriptBot;
        const profit = parseFloat(data.profit || 0);
        const success = data.success !== false;

        bot.totalOperations += 1;
        bot.lastOperation = new Date().toISOString();
        bot.active = true;

        if (success) {
            bot.successfulOperations += 1;
            bot.totalProfit += profit;
            bot.consecutiveFailures = 0;
            bot.averageProfit = bot.totalProfit / bot.successfulOperations;
        } else {
            bot.failedOperations += 1;
            bot.consecutiveFailures += 1;
        }

        bot.successRate = bot.successfulOperations / bot.totalOperations;

        this.updateSystemMetrics();
        this.checkAlerts('javascript');
        this.recordPerformanceHistory();
        this.broadcastUpdate();

        console.log(`🟢 JavaScript bot update: ${success ? 'SUCCESS' : 'FAILED'} - Profit: $${profit.toFixed(2)}`);
    }

    updateCoordinationMetrics(data) {

        if (data.conflicts) {
            this.metrics.system.conflicts += data.conflicts;
        }

        if (data.failures) {
            this.metrics.system.coordinationFailures += data.failures;
        }

        this.broadcastUpdate();
    }

    recordConflict(conflictData) {

        this.metrics.system.conflicts += 1;

        const conflict = {
            ...conflictData,
            timestamp: new Date().toISOString(),
            id: `conflict_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };

        this.conflictHistory.push(conflict);

        // Keep only last 100 conflicts
        if (this.conflictHistory.length > 100) {
            this.conflictHistory = this.conflictHistory.slice(-100);
        }

        console.warn(`⚠️ Conflict recorded: ${conflictData.reason}`);

        // Create alert for critical conflicts
        if (conflictData.severity === 'high') {
            this.createAlert('HIGH_CONFLICT_RATE', `Critical conflict: ${conflictData.reason}`, 'error');
        }

        this.broadcastUpdate();
    }

    updateSystemMetrics() {

        this.metrics.system.totalProfit =
            this.metrics.pythonBot.totalProfit +
            this.metrics.javascriptBot.totalProfit;

        this.metrics.system.totalOperations =
            this.metrics.pythonBot.totalOperations +
            this.metrics.javascriptBot.totalOperations;

        this.metrics.system.lastUpdate = new Date().toISOString();
    }

    checkAlerts(botType) {

        const bot = this.metrics[botType + 'Bot'];

        // Check consecutive failures
        if (bot.consecutiveFailures >= 3) {
            this.createAlert('CONSECUTIVE_FAILURES',
                `${botType} bot has ${bot.consecutiveFailures} consecutive failures`, 'warning');
        }

        // Check low success rate
        if (bot.successRate < 0.7 && bot.totalOperations > 10) {
            this.createAlert('LOW_SUCCESS_RATE',
                `${botType} bot success rate: ${(bot.successRate * 100).toFixed(1)}%`, 'warning');
        }

        // Check high conflict rate
        const conflictRate = this.metrics.system.conflicts / Math.max(this.metrics.system.totalOperations, 1);
        if (conflictRate > 0.1 && this.metrics.system.totalOperations > 20) {
            this.createAlert('HIGH_CONFLICT_RATE',
                `Conflict rate: ${(conflictRate * 100).toFixed(1)}%`, 'error');
        }
    }

    createAlert(type, message, severity = 'info') {

        const alert = {
            id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type,
            message,
            severity,
            timestamp: new Date().toISOString(),
            acknowledged: false
        };

        this.alerts.push(alert);

        // Keep only last 50 alerts
        if (this.alerts.length > 50) {
            this.alerts = this.alerts.slice(-50);
        }

        console.log(`🚨 Alert created: ${type} - ${message}`);

        this.broadcastAlerts();
    }

    recordPerformanceHistory() {

        const entry = {
            timestamp: new Date().toISOString(),
            python: {
                profit: this.metrics.pythonBot.totalProfit,
                operations: this.metrics.pythonBot.totalOperations,
                successRate: this.metrics.pythonBot.successRate
            },
            javascript: {
                profit: this.metrics.javascriptBot.totalProfit,
                operations: this.metrics.javascriptBot.totalOperations,
                successRate: this.metrics.javascriptBot.successRate
            },
            system: {
                totalProfit: this.metrics.system.totalProfit,
                conflicts: this.metrics.system.conflicts
            }
        };

        this.performanceHistory.push(entry);

        // Keep only last 200 entries (about 30 minutes at 10-second intervals)
        if (this.performanceHistory.length > 200) {
            this.performanceHistory = this.performanceHistory.slice(-200);
        }
    }

    broadcastUpdate() {

        const update = {
            type: 'METRICS_UPDATE',
            data: this.metrics,
            timestamp: new Date().toISOString()
        };

        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(update));
            }
        });
    }

    broadcastAlerts() {

        const recentAlerts = this.alerts.slice(-5);

        const update = {
            type: 'ALERTS_UPDATE',
            data: recentAlerts,
            timestamp: new Date().toISOString()
        };

        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(update));
            }
        });
    }

    getMetrics() {
        return this.metrics;
    }

    getAlerts() {
        return this.alerts;
    }

    getHistory() {
        return {
            performance: this.performanceHistory,
            conflicts: this.conflictHistory
        };
    }
}

// Start unified monitoring
if (require.main === module) {
    const dashboard = new UnifiedMonitoringDashboard();

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('🛑 Shutting down unified monitoring dashboard...');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('🛑 Shutting down unified monitoring dashboard...');
        process.exit(0);
    });
}

export default UnifiedMonitoringDashboard;