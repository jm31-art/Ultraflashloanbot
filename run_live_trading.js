require('dotenv').config();

// Global RPC URL validator
function validateRpcUrl() {
    const rpcUrl = process.env.BSC_RPC_URL || process.env.RPC_URL;

    if (!rpcUrl) {
        throw new Error('❌ CRITICAL: RPC_URL environment variable is missing. Please set BSC_RPC_URL or RPC_URL in your .env file.');
    }

    if (typeof rpcUrl !== 'string') {
        throw new Error('❌ CRITICAL: RPC_URL must be a string value.');
    }

    const trimmedUrl = rpcUrl.trim();
    if (trimmedUrl.length === 0) {
        throw new Error('❌ CRITICAL: RPC_URL cannot be empty or only whitespace.');
    }

    // Check if URL has protocol, if not add https://
    let validUrl = trimmedUrl;
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
        validUrl = 'https://' + trimmedUrl;
        console.log(`📡 RPC URL missing protocol, auto-corrected to: ${validUrl}`);
    }

    // Basic URL validation (don't use new URL() to avoid clone errors)
    try {
        const urlPattern = /^https?:\/\/.+/;
        if (!urlPattern.test(validUrl)) {
            throw new Error('Invalid URL format');
        }
    } catch (error) {
        throw new Error(`❌ CRITICAL: RPC_URL "${validUrl}" is not a valid URL format.`);
    }

    console.log(`✅ RPC URL validated: ${validUrl}`);
    return validUrl;
}

// L — ERROR HANDLING & NO-CRASH POLICY
process.on('unhandledRejection', (reason, promise) => {
    console.error('ERROR: UNHANDLED_REJECTION:', reason);
    // Continue execution - do not exit
});

process.on('uncaughtException', (error) => {
    console.error('ERROR: UNCAUGHT_EXCEPTION:', error.message);
    // Continue execution - do not exit
});

const { ethers } = require('ethers');
const UnifiedStrategyManager = require('./bot/UnifiedStrategyManager');

async function main() {
    try {
        // SILENT STARTUP - NO LOGS

        // Validate RPC URL before any provider creation
        const rpcUrl = validateRpcUrl();

        // Initialize provider
        const provider = new ethers.JsonRpcProvider(rpcUrl, undefined);

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
