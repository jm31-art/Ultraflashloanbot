#!/usr/bin/env node
/**
 * Test script for ArbitrageBot on Sepolia testnet
 * Tests deployment, initialization, and basic functionality
 */

require('dotenv').config();
const { ethers } = require('ethers');
const ArbitrageBot = require('../bot/ArbitrageBot');

// Sepolia testnet configuration
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/' + (process.env.INFURA_PROJECT_ID || 'YOUR_INFURA_PROJECT_ID');
const SEPOLIA_TOKENS = {
    WETH: { address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', decimals: 18 }, // Sepolia WETH
    USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },  // Sepolia USDC
    DAI: { address: '0x68194a729C2450ad26072b3D33ADaCbcef39D5741', decimals: 18 }   // Sepolia DAI
};

const SEPOLIA_DEX_CONFIGS = {
    UNISWAP: {
        router: '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008', // Uniswap V2 Router on Sepolia
        factory: '0x7E0987E5b3a30e3f2828572Bb659A548460a30077',
        name: 'Uniswap'
    },
    SUSHISWAP: {
        router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // SushiSwap Router on Sepolia
        factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
        name: 'SushiSwap'
    }
};

async function deployFlashloanContract(signer) {
    console.log('🔨 Deploying FlashloanArb contract on Sepolia...');

    try {
        // Load contract artifact (assuming compiled)
        const fs = require('fs');
        const path = require('path');
        const artifactPath = path.join(__dirname, '../artifacts/contracts/FlashloanArb.sol/FlashloanArb.json');

        if (!fs.existsSync(artifactPath)) {
            console.log('⚠️ Contract artifact not found, skipping deployment');
            return null;
        }

        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);

        const contract = await factory.deploy();
        await contract.waitForDeployment();

        console.log(`✅ FlashloanArb deployed at: ${await contract.getAddress()}`);
        return contract;
    } catch (error) {
        console.error('❌ Contract deployment failed:', error.message);
        return null;
    }
}

async function testArbitrageBot() {
    console.log('🧪 Testing ArbitrageBot on Sepolia testnet...\n');

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

        // Deploy FlashloanArb contract if applicable
        const flashloanContract = await deployFlashloanContract(signer);

        // Initialize ArbitrageBot with Sepolia configuration
        const bot = new ArbitrageBot(provider, signer, {
            minProfitUSD: 1.0,
            maxSlippage: 0.05,
            scanInterval: 30000, // 30 seconds for testing
            dexConfigs: SEPOLIA_DEX_CONFIGS,
            tokens: SEPOLIA_TOKENS
        });

        // Override flashloan contract if deployed
        if (flashloanContract) {
            bot.flashloanContract = flashloanContract;
        }

        console.log('✅ ArbitrageBot initialized for Sepolia');

        // Test initialization
        const initResult = await bot.initialize();
        if (initResult) {
            console.log('✅ Bot initialization successful');
        } else {
            console.log('❌ Bot initialization failed');
        }

        // Test JavaScript calculator
        console.log('\n🧪 Testing JavaScript arbitrage calculator...');
        const jsResult = await bot.runJSCalculator(0.1); // Small amount for testing

        if (jsResult.success) {
            console.log(`✅ JS calculator returned ${jsResult.opportunities.length} opportunities`);
            if (jsResult.opportunities.length > 0) {
                console.log('\n📊 Sample opportunity:');
                console.log(JSON.stringify(jsResult.opportunities[0], null, 2));
            }
        } else {
            console.log('❌ JS calculator failed:', jsResult.error);
        }

        // Test router contract initialization
        console.log('\n🧪 Testing router contract initialization...');
        try {
            const router = await bot.getRouterContract('UNISWAP');
            console.log('✅ Uniswap router contract initialized');

            // Test a simple view call
            const wethAddress = await router.WETH();
            console.log(`✅ Router WETH address: ${wethAddress}`);

        } catch (error) {
            console.log('❌ Router initialization failed:', error.message);
        }

        // Test price fetching
        console.log('\n🧪 Testing price fetching...');
        try {
            const priceData = await bot._getMulticallPrices(0.1);
            console.log(`✅ Price data fetched for ${Object.keys(priceData).length} DEXes`);
        } catch (error) {
            console.log('❌ Price fetching failed:', error.message);
        }

        // Get bot stats
        const stats = bot.getStats();
        console.log('\n📊 Bot Statistics:');
        console.log(JSON.stringify(stats, null, 2));

        console.log('\n✅ All tests completed! Bot is configured for Sepolia testnet.');
        console.log('💡 Testnet testing notes:');
        console.log('   1. Use testnet tokens (faucet: https://sepoliafaucet.com/)');
        console.log('   2. Monitor gas costs on testnet');
        console.log('   3. Test with small amounts first');
        console.log('   4. Verify contract deployments');

        // Stop the bot
        await bot.stop();

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
testArbitrageBot().catch(console.error);