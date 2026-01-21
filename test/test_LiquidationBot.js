#!/usr/bin/env node
/**
 * Test script for LiquidationBot on Sepolia testnet
 * Tests initialization, position scanning, and basic functionality
 */

require('dotenv').config();
const { ethers } = require('ethers');
const { LiquidationBot } = require('../bot/LiquidationBot');

// Sepolia testnet configuration
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/' + (process.env.INFURA_PROJECT_ID || 'YOUR_INFURA_PROJECT_ID');

// Sepolia testnet protocol addresses
const SEPOLIA_PROTOCOLS = {
    LENDING_PROTOCOLS: {
        AAVE: {
            enabled: true,
            pool: '0x6Ae43d3271ff6888e7Fc43Fd7321EF205df9809d0', // Aave V3 Pool on Sepolia
            lendingPool: '0x6Ae43d3271ff6888e7Fc43Fd7321EF205df9809d0'
        },
        COMPOUND: {
            enabled: false, // Compound not available on Sepolia
            comet: null
        },
        VENUS: {
            enabled: false, // Venus not available on Sepolia
            comptroller: null
        }
    },
    TOKENS: {
        WETH: { address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', decimals: 18 },
        USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
        DAI: { address: '0x68194a729C2450ad26072b3D33ADaCbcef39D5741', decimals: 18 },
        WBTC: { address: '0x7ccF0411c793FD371E6B3C0F4b9B2F0C2BF6EB2f', decimals: 8 }
    }
};

async function testLiquidationBot() {
    console.log('🧪 Testing LiquidationBot on Sepolia testnet...\n');

    try {
        // Initialize provider for Sepolia
        const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
        console.log('✅ Provider initialized for Sepolia');

        // Test provider connection
        const network = await provider.getNetwork();
        const blockNumber = await provider.getBlockNumber();
        console.log(`✅ Connected to network: ${network.name} (chainId: ${network.chainId})`);
        console.log(`✅ Current block: ${blockNumber}`);

        // Create signer (dummy for testing)
        const dummyPrivateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
        const signer = new ethers.Wallet(dummyPrivateKey, provider);
        console.log('✅ Signer created (dummy for testing)');

        // Initialize LiquidationBot with Sepolia configuration
        const bot = new LiquidationBot(provider, signer, {
            minProfitUSD: 0.20,
            maxGasPrice: 5,
            scanInterval: 30000, // 30 seconds for testing
            maxLiquidationAmount: ethers.parseEther('1000'), // Smaller amount for testing
            protocols: SEPOLIA_PROTOCOLS.LENDING_PROTOCOLS,
            tokens: SEPOLIA_PROTOCOLS.TOKENS
        });

        console.log('✅ LiquidationBot initialized for Sepolia');

        // Test initialization
        const initResult = await bot.initialize();
        if (initResult) {
            console.log('✅ Bot initialization successful');
        } else {
            console.log('❌ Bot initialization failed');
        }

        // Test contract connections
        console.log('\n🧪 Testing protocol contract connections...');
        const stats = bot.getStats();
        const connectedProtocols = stats.protocols.filter(p => p.contractConnected);
        console.log(`✅ Connected to ${connectedProtocols.length} protocols: ${connectedProtocols.map(p => p.name).join(', ')}`);

        // Test health factor calculation (mock position)
        console.log('\n🧪 Testing health factor calculation...');
        try {
            // Use zero address as test (will likely fail but tests the function)
            const healthFactor = await bot._calculateHealthFactor('AAVE', { user: ethers.ZeroAddress });
            console.log(`✅ Health factor calculation returned: ${healthFactor}`);
        } catch (error) {
            console.log('⚠️ Health factor calculation failed (expected for test address):', error.message);
        }

        // Test position scanning (limited scan)
        console.log('\n🧪 Testing position scanning...');
        try {
            // Run a single scan iteration
            await bot._scanForLiquidationOpportunities();
            console.log('✅ Position scanning completed');
        } catch (error) {
            console.log('⚠️ Position scanning failed:', error.message);
        }

        // Test profit calculation
        console.log('\n🧪 Testing profit calculation...');
        try {
            const mockOpportunity = {
                collateralAsset: SEPOLIA_PROTOCOLS.TOKENS.WETH.address,
                debtAsset: SEPOLIA_PROTOCOLS.TOKENS.USDC.address,
                maxLiquidationAmount: ethers.parseEther('1'),
                liquidationBonus: 0.05
            };
            const profitAnalysis = await bot._calculateLiquidationProfit('AAVE', mockOpportunity, ethers.parseEther('0.1'));
            console.log(`✅ Profit calculation returned: $${profitAnalysis.expectedProfitUSD.toFixed(2)}`);
        } catch (error) {
            console.log('⚠️ Profit calculation failed:', error.message);
        }

        // Test heartbeat
        console.log('\n🧪 Testing heartbeat...');
        const heartbeat = await bot.heartbeat();
        console.log(`✅ Heartbeat successful: ${JSON.stringify(heartbeat)}`);

        // Get final stats
        const finalStats = bot.getStats();
        console.log('\n📊 Final Bot Statistics:');
        console.log(JSON.stringify(finalStats, null, 2));

        console.log('\n✅ All tests completed! LiquidationBot is configured for Sepolia testnet.');
        console.log('💡 Testnet testing notes:');
        console.log('   1. Use testnet tokens (faucet: https://sepoliafaucet.com/)');
        console.log('   2. AAVE V3 is available on Sepolia for testing');
        console.log('   3. Monitor gas costs on testnet');
        console.log('   4. Test with small amounts first');
        console.log('   5. Compound and Venus not available on Sepolia');

        // Stop the bot
        await bot.stop();

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
testLiquidationBot().catch(console.error);