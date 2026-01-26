import dotenv from "dotenv";
dotenv.config();

import { ethers } from 'ethers';
import UnifiedStrategyManager from './bot/UnifiedStrategyManager.js';
import rpcManager from './infra/RPCManager.js';

// L — ERROR HANDLING & NO-CRASH POLICY
process.on('unhandledRejection', (reason, promise) => {
    console.error('ERROR: UNHANDLED_REJECTION:', reason);
    // Continue execution - do not exit
});

process.on('uncaughtException', (error) => {
    console.error('ERROR: UNCAUGHT_EXCEPTION:', error.message);
    // Continue execution - do not exit
});

async function main() {
    try {
        console.log('💀 LIQUIDATION BOT STARTING - SPECIALIZED STRATEGY');
        console.log('🎯 Strategy: LIQUIDATION ONLY (no arbitrage overlap with Python bot)');
        console.log('🔄 Checking for liquidation opportunities...');

        // Initialize SINGLE RPC MANAGER (source of truth)
        rpcManager.initialize();

        // Get provider from SINGLE source of truth
        const provider = rpcManager.getReadProvider();

        // Initialize signer - USE SEPARATE WALLET FROM PYTHON BOT
        const LIQUIDATION_BOT_KEY = process.env.LIQUIDATION_BOT_KEY;
        if (!LIQUIDATION_BOT_KEY) {
            console.error('❌ LIQUIDATION_BOT_KEY not set in environment variables');
            console.error('💡 Set LIQUIDATION_BOT_KEY to a different wallet than PYTHON_BOT_PRIVATE_KEY');
            process.exit(1);
        }

        const signer = new ethers.Wallet(LIQUIDATION_BOT_KEY, provider);
        console.log(`💀 Liquidation Bot Wallet: ${signer.address}`);

        // SPECIALIZED FOR LIQUIDATION ONLY - NO OVERLAP WITH PYTHON ARBITRAGE BOT
        const manager = new UnifiedStrategyManager(provider, signer, {
            arbitrageWeight: 0.0,        // DISABLED - Python bot handles arbitrage
            liquidationWeight: 1.0,      // FULL FOCUS on liquidations
            nftWeight: 0.0,              // DISABLED
            crossProtocolWeight: 0.0,    // DISABLED
            multicoinWeight: 0.0,        // DISABLED
            maxConcurrentStrategies: 1
        });

        // Initialize
        const initialized = await manager.initialize();
        if (!initialized) {
            process.exit(1);
        }

        // Start live trading
        await manager.start();

        // Handle graceful shutdown (silent)
        process.on('SIGINT', async () => {
            await manager.stop();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            await manager.stop();
            process.exit(0);
        });

    } catch (error) {
        process.exit(1);
    }
}

main();
