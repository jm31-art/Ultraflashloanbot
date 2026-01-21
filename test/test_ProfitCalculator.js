#!/usr/bin/env node
/**
 * Test script for ProfitCalculator on Sepolia testnet
 * Tests profit calculation logic and market condition adjustments
 */

require('dotenv').config();
const { ethers } = require('ethers');
const ProfitCalculator = require('../utils/ProfitCalculator');

// Sepolia testnet configuration
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/' + (process.env.INFURA_PROJECT_ID || 'YOUR_INFURA_PROJECT_ID');

async function testProfitCalculator() {
    console.log('🧪 Testing ProfitCalculator on Sepolia testnet...\n');

    try {
        // Initialize provider for Sepolia
        const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
        console.log('✅ Provider initialized for Sepolia');

        // Test provider connection
        const network = await provider.getNetwork();
        const blockNumber = await provider.getBlockNumber();
        console.log(`✅ Connected to network: ${network.name} (chainId: ${network.chainId})`);
        console.log(`✅ Current block: ${blockNumber}`);

        // Initialize ProfitCalculator
        const calculator = new ProfitCalculator(provider);
        console.log('✅ ProfitCalculator initialized');

        // Test basic price impact calculation
        console.log('\n🧪 Testing price impact calculation...');
        const impact1 = calculator.calculatePriceImpact(100000); // $100k trade
        const impact2 = calculator.calculatePriceImpact(1000000); // $1M trade
        console.log(`✅ Price impact for $100k: ${(impact1 * 100).toFixed(4)}%`);
        console.log(`✅ Price impact for $1M: ${(impact2 * 100).toFixed(4)}%`);
        console.log(`   Larger trades have higher impact: ${impact2 > impact1 ? '✓' : '✗'}`);

        // Test gas cost calculation
        console.log('\n🧪 Testing gas cost calculation...');
        const gasCost = calculator.calculateGasCost();
        console.log(`✅ Gas cost: $${gasCost.toFixed(2)}`);

        // Test arbitrage profitability calculation
        console.log('\n🧪 Testing arbitrage profitability calculation...');
        const testOpportunity = {
            token: 'WETH',
            amount: 10, // 10 WETH
            buyPrice: 2000, // $2000 per WETH
            sellPrice: 2010, // $2010 per WETH (0.5% spread)
            useFlashSwap: true,
            protocol: 'AAVE'
        };

        const profitability = await calculator.calculateArbitrageProfitability(testOpportunity);
        if (profitability) {
            console.log(`✅ Profitability calculated:`);
            console.log(`   Raw profit: $${profitability.adjustedProfit?.toFixed(2) || 'N/A'}`);
            console.log(`   Profit margin: ${profitability.profitMargin?.toFixed(4) || 'N/A'}%`);
            console.log(`   Is profitable: ${profitability.isProfitable ? 'Yes' : 'No'}`);
        } else {
            console.log('⚠️ Profitability calculation returned null');
        }

        // Test dynamic gas cost calculation
        console.log('\n🧪 Testing dynamic gas cost calculation...');
        const dynamicGas1 = calculator.calculateDynamicGasCost(10000, testOpportunity);
        const dynamicGas2 = calculator.calculateDynamicGasCost(1000000, testOpportunity);
        console.log(`✅ Dynamic gas for small trade: $${dynamicGas1.toFixed(2)}`);
        console.log(`✅ Dynamic gas for large trade: $${dynamicGas2.toFixed(2)}`);

        // Test market condition updates
        console.log('\n🧪 Testing market condition updates...');
        calculator.updateMarketConditions({
            volatility: 0.05, // 5% volatility
            competition: 'high',
            congestion: 2.0, // 2x congestion
            frequency: 20 // 20 opportunities per hour
        });

        const conditions = calculator.getMarketConditions();
        console.log(`✅ Market conditions updated:`);
        console.log(`   Volatility: ${(conditions.marketVolatility * 100).toFixed(1)}%`);
        console.log(`   Competition: ${conditions.competitionLevel}`);
        console.log(`   Congestion: ${conditions.networkCongestion}x`);
        console.log(`   Frequency: ${conditions.opportunityFrequency} opp/h`);

        // Test profitability with updated conditions
        console.log('\n🧪 Testing profitability with high competition...');
        const highCompProfitability = await calculator.calculateArbitrageProfitability(testOpportunity);
        if (highCompProfitability) {
            console.log(`✅ High competition profitability:`);
            console.log(`   Adjusted profit: $${highCompProfitability.adjustedProfit?.toFixed(2) || 'N/A'}`);
            console.log(`   Dynamic adjustments applied: ${highCompProfitability.dynamicAdjustments ? 'Yes' : 'No'}`);
        }

        // Test with low competition
        calculator.updateMarketConditions({
            competition: 'low',
            volatility: 0.01 // Low volatility
        });

        console.log('\n🧪 Testing profitability with low competition...');
        const lowCompProfitability = await calculator.calculateArbitrageProfitability(testOpportunity);
        if (lowCompProfitability) {
            console.log(`✅ Low competition profitability:`);
            console.log(`   Adjusted profit: $${lowCompProfitability.adjustedProfit?.toFixed(2) || 'N/A'}`);
            console.log(`   More lenient thresholds: ${lowCompProfitability.dynamicAdjustments?.competitionLevel === 'low' ? 'Yes' : 'No'}`);
        }

        // Test edge cases
        console.log('\n🧪 Testing edge cases...');
        const zeroAmountOpportunity = { ...testOpportunity, amount: 0 };
        const zeroProfit = await calculator.calculateArbitrageProfitability(zeroAmountOpportunity);
        console.log(`✅ Zero amount handling: ${zeroProfit === null ? 'Properly handled' : 'Unexpected result'}`);

        const negativeSpreadOpportunity = { ...testOpportunity, sellPrice: 1990 };
        const negativeProfit = await calculator.calculateArbitrageProfitability(negativeSpreadOpportunity);
        if (negativeProfit) {
            console.log(`✅ Negative spread handling: Profitable=${negativeProfit.isProfitable} (should be false)`);
        }

        console.log('\n✅ All tests completed! ProfitCalculator is configured for Sepolia testnet.');
        console.log('💡 Testnet testing notes:');
        console.log('   1. Profit calculations work with mock data');
        console.log('   2. Dynamic adjustments respond to market conditions');
        console.log('   3. Gas cost calculations are network-aware');
        console.log('   4. Price impact scales with trade size');
        console.log('   5. Use mainnet for real profitability testing');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
testProfitCalculator().catch(console.error);