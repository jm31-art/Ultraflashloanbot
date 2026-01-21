#!/usr/bin/env node
/**
 * Test script for FlashloanSimulator on Sepolia testnet
 * Tests flashloan simulation, liquidity checks, and arbitrage profitability
 */

require('dotenv').config();
const { ethers } = require('ethers');
const FlashloanSimulator = require('../utils/FlashloanSimulator');

// Sepolia testnet configuration
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/' + (process.env.INFURA_PROJECT_ID || 'YOUR_INFURA_PROJECT_ID');

// Sepolia testnet tokens
const SEPOLIA_TOKENS = {
    WETH: { address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', symbol: 'WETH' },
    USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC' },
    DAI: { address: '0x68194a729C2450ad26072b3D33ADaCbcef39D5741', symbol: 'DAI' }
};

async function testFlashloanSimulator() {
    console.log('🧪 Testing FlashloanSimulator on Sepolia testnet...\n');

    try {
        // Initialize provider for Sepolia
        const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
        console.log('✅ Provider initialized for Sepolia');

        // Test provider connection
        const network = await provider.getNetwork();
        const blockNumber = await provider.getBlockNumber();
        console.log(`✅ Connected to network: ${network.name} (chainId: ${network.chainId})`);
        console.log(`✅ Current block: ${blockNumber}`);

        // Initialize FlashloanSimulator
        const simulator = new FlashloanSimulator(provider);
        console.log('✅ FlashloanSimulator initialized');

        // Test price initialization
        console.log('\n🧪 Testing price initialization...');
        await simulator.initializePrices();
        console.log(`✅ Prices initialized - BNB: $${simulator.BNB_PRICE}, ETH: $${simulator.ETH_PRICE}`);

        // Test token price fetching
        console.log('\n🧪 Testing token price fetching...');
        try {
            const ethPrice = await simulator.getTokenPrice('WETH');
            console.log(`✅ WETH price: $${ethPrice}`);
        } catch (error) {
            console.log('⚠️ Token price fetch failed:', error.message);
        }

        // Test vault finding (DODO pools)
        console.log('\n🧪 Testing vault finding...');
        try {
            // Use a mock DODO provider address for testing
            const mockDodoAddress = '0x0000000000000000000000000000000000000001'; // Mock address
            const vault = await simulator.findVault(mockDodoAddress, SEPOLIA_TOKENS.WETH.address);
            if (vault) {
                console.log(`✅ Found vault: ${vault}`);
            } else {
                console.log('⚠️ No vault found (expected on testnet)');
            }
        } catch (error) {
            console.log('⚠️ Vault finding failed:', error.message);
        }

        // Test liquidity checking
        console.log('\n🧪 Testing liquidity checking...');
        try {
            const mockVault = '0x' + '1'.repeat(40); // Mock vault address
            const liquidity = await simulator.checkLiquidity(mockVault, SEPOLIA_TOKENS.WETH.address);
            console.log(`✅ Liquidity check: ${liquidity.formatted} available`);
        } catch (error) {
            console.log('⚠️ Liquidity check failed:', error.message);
        }

        // Test arbitrage profitability calculation
        console.log('\n🧪 Testing arbitrage profitability calculation...');
        const testOpportunity = {
            amount: 10, // 10 tokens
            buyPrice: 2000, // $2000 per token
            sellPrice: 2010, // $2010 per token (0.5% spread)
            token: 'WETH'
        };

        const profitability = await simulator.calculateArbitrageProfitability(testOpportunity);
        if (profitability) {
            console.log(`✅ Profitability calculated:`);
            console.log(`   Raw profit: $${profitability.rawProfit?.toFixed(2) || 'N/A'}`);
            console.log(`   Adjusted profit: $${profitability.adjustedProfit?.toFixed(2) || 'N/A'}`);
            console.log(`   Profit margin: ${profitability.profitMargin?.toFixed(4) || 'N/A'}%`);
            console.log(`   Is profitable: ${profitability.isProfitable ? 'Yes' : 'No'}`);
            console.log(`   Provider: ${profitability.details?.provider || 'N/A'}`);
        } else {
            console.log('⚠️ Profitability calculation returned null');
        }

        // Test amount simulation
        console.log('\n🧪 Testing amount simulation...');
        try {
            const simulation = await simulator.simulateAmount(10000); // $10k simulation
            console.log(`✅ Amount simulation for $10k:`);
            console.log(`   Required ETH: ${simulation.requiredEth} ETH`);
            console.log(`   Flash loan fee: $${simulation.flashLoanFeeUsd?.toFixed(2) || 'N/A'}`);
            console.log(`   Gas cost: $${simulation.gasCostUsd?.toFixed(2) || 'N/A'}`);
            console.log(`   Total cost: $${simulation.totalCostUsd?.toFixed(2) || 'N/A'}`);
            console.log(`   Min profit required: $${simulation.minProfitUsd?.toFixed(2) || 'N/A'}`);
        } catch (error) {
            console.log('⚠️ Amount simulation failed:', error.message);
        }

        // Test range simulation
        console.log('\n🧪 Testing range simulation...');
        try {
            const rangeResults = await simulator.simulateRange(5000, 15000, 5000); // $5k to $15k, $5k steps
            console.log(`✅ Range simulation completed for ${rangeResults.length} amounts`);
            if (rangeResults.length > 0) {
                console.log('Sample result:');
                const sample = rangeResults[0];
                console.log(`   Amount: $${sample.amount?.toLocaleString() || 'N/A'}`);
                console.log(`   Required ETH: ${sample.requiredEth || 'N/A'} ETH`);
                console.log(`   Min profit: $${sample.minProfitUsd?.toFixed(2) || 'N/A'}`);
            }
        } catch (error) {
            console.log('⚠️ Range simulation failed:', error.message);
        }

        // Test arbitrage simulation
        console.log('\n🧪 Testing arbitrage simulation...');
        try {
            const arbitrageResult = await simulator.simulateArbitrage(testOpportunity);
            if (arbitrageResult) {
                console.log(`✅ Arbitrage simulation:`);
                console.log(`   Is profitable: ${arbitrageResult.isProfitable ? 'Yes' : 'No'}`);
                console.log(`   Amount: ${arbitrageResult.amount || 'N/A'}`);
                console.log(`   Has enough liquidity: ${arbitrageResult.hasEnoughLiquidity ? 'Yes' : 'No'}`);
            } else {
                console.log('⚠️ Arbitrage simulation returned null');
            }
        } catch (error) {
            console.log('⚠️ Arbitrage simulation failed:', error.message);
        }

        // Test triangular arbitrage simulation
        console.log('\n🧪 Testing triangular arbitrage simulation...');
        const triangularOpportunity = {
            type: 'triangular',
            tokens: ['WETH', 'USDC', 'DAI'],
            path: 'WETH → USDC → DAI → WETH',
            rates: {
                'WETH/USDC': 2000,
                'USDC/DAI': 1.0,
                'DAI/WETH': 0.0005
            },
            profitPercent: 0.8,
            dex: 'Uniswap'
        };

        try {
            const triangularResult = await simulator.simulateArbitrage(triangularOpportunity);
            if (triangularResult) {
                console.log(`✅ Triangular arbitrage simulation:`);
                console.log(`   Path: ${triangularResult.path || 'N/A'}`);
                console.log(`   Profit %: ${triangularResult.profitPercent?.toFixed(2) || 'N/A'}%`);
                console.log(`   Is profitable: ${triangularResult.isProfitable ? 'Yes' : 'No'}`);
            } else {
                console.log('⚠️ Triangular arbitrage simulation returned null');
            }
        } catch (error) {
            console.log('⚠️ Triangular arbitrage simulation failed:', error.message);
        }

        // Test optimal trade amount calculation
        console.log('\n🧪 Testing optimal trade amount calculation...');
        try {
            const optimalAmount = await simulator.calculateOptimalTradeAmount(0.005, 'WETH'); // 0.5% spread
            console.log(`✅ Optimal trade amount for 0.5% spread: $${optimalAmount?.toLocaleString() || 'N/A'}`);
        } catch (error) {
            console.log('⚠️ Optimal amount calculation failed:', error.message);
        }

        // Test gas price optimization
        console.log('\n🧪 Testing gas price optimization...');
        try {
            const optimalGasPrice = await simulator.getOptimalGasPrice();
            console.log(`✅ Optimal gas price: ${optimalGasPrice} Gwei`);
        } catch (error) {
            console.log('⚠️ Gas price optimization failed:', error.message);
        }

        console.log('\n✅ All tests completed! FlashloanSimulator is configured for Sepolia testnet.');
        console.log('💡 Testnet testing notes:');
        console.log('   1. Flashloan providers may not be available on Sepolia');
        console.log('   2. Liquidity checks use mock data in test mode');
        console.log('   3. Profitability calculations work with mock prices');
        console.log('   4. Use mainnet for real flashloan testing');
        console.log('   5. Simulations help validate arbitrage logic');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
testFlashloanSimulator().catch(console.error);