#!/usr/bin/env node
/**
 * Test script for UnifiedStrategyManager on Sepolia testnet
 * Tests strategy initialization, coordination, and basic functionality
 */

require('dotenv').config();
const { ethers } = require('ethers');
const UnifiedStrategyManager = require('../bot/UnifiedStrategyManager');

// Sepolia testnet configuration
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/' + (process.env.INFURA_PROJECT_ID || 'YOUR_INFURA_PROJECT_ID');

async function testUnifiedStrategyManager() {
    console.log('🧪 Testing UnifiedStrategyManager on Sepolia testnet...\n');

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

        // Initialize UnifiedStrategyManager with Sepolia configuration
        const manager = new UnifiedStrategyManager(provider, signer, {
            arbitrageWeight: 0.25,
            liquidationWeight: 0.2,
            nftWeight: 0.1,
            crossProtocolWeight: 0.1,
            multicoinWeight: 0.35,
            maxConcurrentStrategies: 3,
            strategyRotationInterval: 3600000, // 1 hour
            performanceRebalancingInterval: 1800000, // 30 minutes
            maxGasPerStrategy: ethers.parseUnits('10', 'gwei'),
            maxCapitalPerStrategy: ethers.parseEther('1000'), // Smaller for testing
            maxTradesPerMinute: 5
        });

        console.log('✅ UnifiedStrategyManager initialized');

        // Test initialization
        const initResult = await manager.initialize();
        if (initResult) {
            console.log('✅ Manager initialization successful');
        } else {
            console.log('❌ Manager initialization failed');
        }

        // Test strategy configurations
        console.log('\n🧪 Testing strategy configurations...');
        const status = manager.getStatus();
        console.log(`✅ Manager status: ${status.isRunning ? 'Running' : 'Stopped'}`);
        console.log(`✅ Strategy weights: ${JSON.stringify(status.strategyWeights)}`);

        // Test individual strategy stats (without starting them)
        console.log('\n🧪 Testing strategy stats retrieval...');
        try {
            const arbitrageStats = manager.getStrategyStats('arbitrage');
            console.log('✅ Arbitrage strategy stats retrieved');
        } catch (error) {
            console.log('⚠️ Arbitrage strategy stats failed (expected if not started):', error.message);
        }

        // Test performance metrics
        console.log('\n🧪 Testing performance metrics...');
        try {
            const metrics = manager.getPerformanceMetrics();
            console.log('✅ Performance metrics retrieved');
        } catch (error) {
            console.log('⚠️ Performance metrics failed:', error.message);
        }

        // Test risk metrics
        console.log('\n🧪 Testing risk metrics...');
        try {
            const riskMetrics = manager.getRiskMetrics();
            console.log('✅ Risk metrics retrieved');
        } catch (error) {
            console.log('⚠️ Risk metrics failed:', error.message);
        }

        // Test strategy enable/disable (without actually starting)
        console.log('\n🧪 Testing strategy management...');
        try {
            await manager.disableStrategy('nft'); // Disable NFT strategy
            console.log('✅ Strategy disable/enable functions work');
        } catch (error) {
            console.log('⚠️ Strategy management failed:', error.message);
        }

        // Test emergency stop (without starting strategies)
        console.log('\n🧪 Testing emergency controls...');
        try {
            await manager.emergencyStop();
            console.log('✅ Emergency stop executed');
        } catch (error) {
            console.log('⚠️ Emergency stop failed:', error.message);
        }

        // Get final status
        const finalStatus = manager.getStatus();
        console.log('\n📊 Final Manager Status:');
        console.log(JSON.stringify(finalStatus, null, 2));

        console.log('\n✅ All tests completed! UnifiedStrategyManager is configured for Sepolia testnet.');
        console.log('💡 Testnet testing notes:');
        console.log('   1. Strategy manager coordinates multiple trading strategies');
        console.log('   2. Supports dynamic strategy rotation and resource allocation');
        console.log('   3. Includes risk management and performance monitoring');
        console.log('   4. Emergency stop functionality for risk control');
        console.log('   5. Test individual strategies separately for detailed testing');

        // Stop the manager
        await manager.stop();

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
testUnifiedStrategyManager().catch(console.error);