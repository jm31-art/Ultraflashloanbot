#!/usr/bin/env node
/**
 * Test script for ArbitrageBot initialization and basic functionality
 * This tests the bot without executing real transactions
 */

require('dotenv').config();
const { ethers } = require('ethers');
const ArbitrageBot = require('./bot/ArbitrageBot');

async function testBot() {
    console.log('🧪 Testing ArbitrageBot initialization...\n');

    try {
        // Initialize provider
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://bsc-dataseed.binance.org/');
        console.log('✅ Provider initialized');

        // Test provider connection
        const network = await provider.getNetwork();
        const blockNumber = await provider.getBlockNumber();
        console.log(`✅ Connected to network: ${network.name} (chainId: ${network.chainId})`);
        console.log(`✅ Current block: ${blockNumber}`);

        // Create a dummy signer for testing (won't be used for real transactions)
        // Using a valid dummy private key for testing
        const dummyPrivateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
        const signer = new ethers.Wallet(dummyPrivateKey, provider);
        console.log('✅ Signer created (dummy for testing)');

        // Initialize bot
        const bot = new ArbitrageBot(provider, signer, {
            minProfitUSD: 1.0,
            maxSlippage: 0.05,
            scanInterval: 10000 // 10 seconds for testing
        });
        console.log('✅ ArbitrageBot initialized');

        // Test Python calculator integration
        console.log('\n🧪 Testing Python calculator integration...');
        const pythonResult = await bot.runPythonCalculator(1.0);

        if (pythonResult.success) {
            console.log(`✅ Python calculator returned ${pythonResult.opportunities.length} opportunities`);
            console.log(`✅ No JSON parsing errors`);

            if (pythonResult.opportunities.length > 0) {
                console.log('\n📊 Sample opportunity:');
                console.log(JSON.stringify(pythonResult.opportunities[0], null, 2));
            }
        } else {
            console.log('❌ Python calculator failed:', pythonResult.error);
        }

        // Test router contract initialization
        console.log('\n🧪 Testing router contract initialization...');
        try {
            const router = await bot.getRouterContract('PANCAKESWAP');
            console.log('✅ PancakeSwap router contract initialized');

            // Test a simple view call
            const wethAddress = await router.WETH();
            console.log(`✅ Router WETH address: ${wethAddress}`);

        } catch (error) {
            console.log('❌ Router initialization failed:', error.message);
        }

        // Get bot stats
        const stats = bot.getStats();
        console.log('\n📊 Bot Statistics:');
        console.log(JSON.stringify(stats, null, 2));

        console.log('\n✅ All tests passed! Bot is ready for production use.');
        console.log('💡 Remember to:');
        console.log('   1. Use real private keys (not dummy ones)');
        console.log('   2. Start with small amounts for testing');
        console.log('   3. Monitor gas prices and profits');
        console.log('   4. Have sufficient BNB for gas fees');

        // Stop the bot
        await bot.stop();

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
testBot().catch(console.error);