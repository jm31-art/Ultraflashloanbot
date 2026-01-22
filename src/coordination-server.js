// KILOCODE: COORDINATION SERVER
// src/coordination-server.js

const express = require('express');
const { BotCoordinationConfig, BotCoordinator } = require('../config/bot-coordination');

const app = express();
const PORT = process.env.COORDINATOR_PORT || 8080;

app.use(express.json());

// Initialize coordinator
const coordinator = new BotCoordinator();

// API Endpoints
app.post('/check-opportunity', async (req, res) => {
    try {
        const { bot_type, opportunity_hash, token_a, token_b, amount, expected_profit } = req.body;

        console.log(`🔍 Checking opportunity for ${bot_type}: ${opportunity_hash}`);

        const result = await coordinator.canBotExecuteOpportunity(bot_type, opportunity_hash, token_a, token_b);

        res.json({
            allowed: result.allowed,
            reason: result.reason,
            lockedBy: result.lockedBy || null
        });

    } catch (error) {
        console.error('Error checking opportunity:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/reserve-opportunity', (req, res) => {
    try {
        const { bot_type, opportunity_hash, ttl } = req.body;

        console.log(`🔒 Reserving opportunity for ${bot_type}: ${opportunity_hash}`);

        coordinator.reserveOpportunity(bot_type, opportunity_hash, ttl);

        res.json({ success: true });

    } catch (error) {
        console.error('Error reserving opportunity:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/operation-result', (req, res) => {
    try {
        const { bot_type, operation_id, success, profit, gas_used, error_type, timestamp } = req.body;

        console.log(`📊 Operation result from ${bot_type}: ${success ? 'SUCCESS' : 'FAILED'}`);

        // Update coordinator metrics (simplified)
        // In production, you might want to store this data

        res.json({ success: true });

    } catch (error) {
        console.error('Error recording operation result:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/status', (req, res) => {
    const status = coordinator.getCoordinationStatus();
    res.json({
        status: 'operational',
        coordination: status,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Coordination server running on port ${PORT}`);
    console.log(`📊 Status endpoint: http://localhost:${PORT}/status`);
    console.log(`❤️  Health endpoint: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Shutting down coordination server...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Shutting down coordination server...');
    process.exit(0);
});

module.exports = app;