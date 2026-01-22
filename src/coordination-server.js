// KILOCODE: COORDINATION SERVER
// src/coordination-server.js

import express from 'express';
import { BotCoordinationConfig, BotCoordinator } from '../config/bot-coordination.js';

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

app.post('/register-bot', (req, res) => {
    try {
        const { bot_type, config } = req.body;

        console.log(`📝 Registering bot: ${bot_type}`);

        // Store bot registration (in production, use database)
        // For now, just acknowledge

        res.json({
            success: true,
            bot_type: bot_type,
            registered_at: new Date().toISOString()
        });

    } catch (error) {
        console.error('Bot registration failed:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/health-report', (req, res) => {
    try {
        const { bot_type, success_rate, consecutive_failures, last_profit, last_operation } = req.body;

        console.log(`❤️ Health report from ${bot_type}: ${success_rate * 100}% success rate`);

        // Store health data (in production, use database/time-series storage)
        // For now, just acknowledge

        res.json({ success: true });

    } catch (error) {
        console.error('Health report processing failed:', error);
        res.status(500).json({ error: 'Health report failed' });
    }
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

export default app;