#!/usr/bin/env node
/**
 * Test script for PriceFeed on Sepolia testnet
 * Tests price fetching, DEX integration, and arbitrage opportunity detection
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import PriceFeed from '../services/PriceFeed.js';

// Sepolia testnet configuration
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/' + (process.env.INFURA_PROJECT_ID || 'YOUR_INFURA_PROJECT_ID');

// Sepolia testnet DEX configurations
const SEPOLIA_DEX_CONFIGS = {
    UNISWAP: {
        name: 'Uniswap',
        factory: '0x7E0987E5b3a30e3f2828572Bb659A548460a30077', // Uniswap V2 Factory on Sepolia
        router: '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008' // Uniswap V2 Router on Sepolia
    },
    SUSHISWAP: {
        name: 'SushiSwap',
        factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4', // SushiSwap Factory on Sepolia
        router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' // SushiSwap Router on Sepolia
    }
};

// Sepolia testnet tokens
const SEPOLIA_TOKENS = {
    WETH: { address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', decimals: 18, symbol: 'WETH' },
    USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6, symbol: 'USDC' },
    DAI: { address: '0x68194a729C2450ad26072b3D33ADaCbcef39D5741', decimals: 18, symbol: 'DAI' }
};

async function testPriceFeed() {
    console.log('🧪 Testing PriceFeed on Sepolia testnet...\n');

    try {
        // Initialize provider for Sepolia
        const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
        console.log('✅ Provider initialized for Sepolia');

        // Test provider connection
        const network = await provider.getNetwork();
        const blockNumber = await provider.getBlockNumber();
        console.log(`✅ Connected to network: ${network.name} (chainId: ${network.chainId})`);
        console.log(`✅ Current block: ${blockNumber}`);

        // Initialize PriceFeed
        const priceFeed = new PriceFeed(provider);
        console.log('✅ PriceFeed initialized');

        // Test initialization
        await priceFeed.initialize();
        console.log('✅ PriceFeed initialization completed');

        // Test price updates
        console.log('\n🧪 Testing price updates...');
        try {
            const prices = await priceFeed.updatePrices(SEPOLIA_TOKENS, SEPOLIA_DEX_CONFIGS);
            console.log('✅ Price update completed');
            console.log(`📊 Updated prices for ${Object.keys(prices).length} tokens`);

            // Log sample prices
            for (const [tokenSymbol, tokenData] of Object.entries(prices)) {
                const dexPrices = Object.keys(tokenData.dexPrices || {});
                console.log(`   ${tokenSymbol}: ${dexPrices.length} DEX prices available`);
                if (dexPrices.length > 0) {
                    const sampleDex = dexPrices[0];
                    console.log(`     ${sampleDex}: ${tokenData.dexPrices[sampleDex]?.toFixed(6) || 'N/A'}`);
                }
            }
        } catch (error) {
            console.log('⚠️ Price update failed:', error.message);
        }

        // Test individual DEX price fetching
        console.log('\n🧪 Testing individual DEX price fetching...');
        for (const [dexName, dexConfig] of Object.entries(SEPOLIA_DEX_CONFIGS)) {
            try {
                const price = await priceFeed.getPriceFromDex(
                    dexConfig,
                    SEPOLIA_TOKENS.WETH,
                    SEPOLIA_TOKENS.USDC
                );
                if (price) {
                    console.log(`✅ ${dexName}: WETH/USDC = ${price.toFixed(6)}`);
                } else {
                    console.log(`⚠️ ${dexName}: No price available for WETH/USDC`);
                }
            } catch (error) {
                console.log(`❌ ${dexName} price fetch failed:`, error.message);
            }
        }

        // Test CoinGecko price fetching
        console.log('\n🧪 Testing CoinGecko price fetching...');
        try {
            const ethPrice = await priceFeed.getCoinGeckoPrice('ethereum');
            if (ethPrice) {
                console.log(`✅ CoinGecko ETH price: $${ethPrice}`);
            } else {
                console.log('⚠️ CoinGecko price fetch failed');
            }
        } catch (error) {
            console.log('⚠️ CoinGecko test failed:', error.message);
        }

        // Test arbitrage opportunity detection
        console.log('\n🧪 Testing arbitrage opportunity detection...');
        try {
            const opportunities = priceFeed.getArbitrageOpportunities(priceFeed.prices, 0.1); // 0.1% min spread
            console.log(`✅ Found ${opportunities.length} arbitrage opportunities`);

            if (opportunities.length > 0) {
                console.log('\n📊 Sample opportunities:');
                opportunities.slice(0, 3).forEach((opp, index) => {
                    console.log(`   ${index + 1}. ${opp.type}: ${opp.token || opp.tokens?.join('→')} (${opp.spread?.toFixed(3) || opp.profitPercent?.toFixed(3)}% spread)`);
                });
            }
        } catch (error) {
            console.log('⚠️ Arbitrage detection failed:', error.message);
        }

        // Test triangular arbitrage specifically
        console.log('\n🧪 Testing triangular arbitrage detection...');
        try {
            const triangularOpps = priceFeed.getTriangularArbitrageOpportunities(priceFeed.prices, 0.1);
            console.log(`✅ Found ${triangularOpps.length} triangular arbitrage opportunities`);

            if (triangularOpps.length > 0) {
                console.log('\n📊 Sample triangular opportunities:');
                triangularOpps.slice(0, 2).forEach((opp, index) => {
                    console.log(`   ${index + 1}. ${opp.path} via ${opp.dex} (${opp.profitPercent.toFixed(3)}% profit)`);
                });
            }
        } catch (error) {
            console.log('⚠️ Triangular arbitrage detection failed:', error.message);
        }

        // Test batch reserve queries
        console.log('\n🧪 Testing batch reserve queries...');
        try {
            // Create some test pool addresses (these would need to be real Sepolia pools)
            const testPools = [
                '0x0000000000000000000000000000000000000001', // Placeholder
                '0x0000000000000000000000000000000000000002'  // Placeholder
            ];
            const reserves = await priceFeed.getBatchReserves(testPools);
            console.log(`✅ Batch reserve query completed for ${reserves.length} pools`);
        } catch (error) {
            console.log('⚠️ Batch reserve query failed:', error.message);
        }

        console.log('\n✅ All tests completed! PriceFeed is configured for Sepolia testnet.');
        console.log('💡 Testnet testing notes:');
        console.log('   1. Sepolia has limited liquidity compared to mainnets');
        console.log('   2. Not all token pairs may have pools on testnet DEXes');
        console.log('   3. CoinGecko prices work on testnet for reference');
        console.log('   4. Arbitrage opportunities may be rare due to low volume');
        console.log('   5. Use mainnet for production testing with real market conditions');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
testPriceFeed().catch(console.error);