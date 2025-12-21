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
        // SILENT STARTUP - NO LOGS

        // Initialize SINGLE RPC MANAGER (source of truth)
        rpcManager.initialize();

        // Get provider from SINGLE source of truth
        const provider = rpcManager.getReadProvider();

        // Initialize signer
        const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

        // Initialize and start the unified strategy manager
        const manager = new UnifiedStrategyManager(provider, signer, {
            arbitrageWeight: 1.0, // Focus exclusively on arbitrage
            liquidationWeight: 0.0,
            nftWeight: 0.0,
            crossProtocolWeight: 0.0,
            multicoinWeight: 0.0,
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
