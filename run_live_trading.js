const { ethers } = require('ethers');
const UnifiedStrategyManager = require('./bot/UnifiedStrategyManager');
require('dotenv').config();

async function main() {
    try {
        console.log('🚀 Starting Ultraflashloanbot Live Trading...');

        // Initialize provider
        const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL || process.env.RPC_URL);

        // Initialize signer
        const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

        console.log(`📡 Connected to network`);
        console.log(`💰 Wallet: ${signer.address}`);

        // Check balance
        const balance = await provider.getBalance(signer.address);
        const balanceBNB = ethers.formatEther(balance);
        console.log(`💰 Balance: ${balanceBNB} BNB ($${parseFloat(balanceBNB) * 567})`);

        // Initialize and start the unified strategy manager
        const manager = new UnifiedStrategyManager(provider, signer, {
            arbitrageWeight: 0.4,
            liquidationWeight: 0.2,
            nftWeight: 0.1,
            crossProtocolWeight: 0.1,
            multicoinWeight: 0.2,
            maxConcurrentStrategies: 3
        });

        // Initialize
        const initialized = await manager.initialize();
        if (!initialized) {
            throw new Error('Failed to initialize strategy manager');
        }

        // Start live trading
        await manager.start();

        console.log('✅ Live trading started successfully!');
        console.log('🎯 Bot is now scanning for arbitrage opportunities and executing profitable trades');

        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down bot...');
            await manager.stop();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('\n🛑 Shutting down bot...');
            await manager.stop();
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ Failed to start live trading:', error);
        process.exit(1);
    }
}

main();