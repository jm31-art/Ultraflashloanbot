/**
 * Test script to verify Nodereal MEV Protection integration
 */

const SecureMEVProtector = require('./utils/SecureMEVProtector');
const chainConnection = require('./utils/chainConnection');

async function testNoderealIntegration() {
    console.log('🧪 Testing Nodereal MEV Protection Integration...\n');

    try {
        // Test 1: Check environment variables
        console.log('1️⃣ Checking environment configuration...');
        const noderealRpc = process.env.NODEREAL_RPC;
        const noderealApiKey = process.env.NODEREAL_API_KEY;

        console.log(`   NODEREAL_RPC: ${noderealRpc ? '✅ Configured' : '❌ Not configured'}`);
        console.log(`   NODEREAL_API_KEY: ${noderealApiKey && noderealApiKey !== 'your_nodereal_api_key_here' ? '✅ Configured' : '❌ Not configured'}`);

        // Test 2: Test Nodereal configuration directly
        console.log('\n2️⃣ Testing Nodereal configuration...');
        const protector = new SecureMEVProtector();

        // Check if Nodereal is configured
        const noderealEnabled = protector.noderealEnabled;
        const noderealConfig = protector.noderealConfig;

        console.log(`   Nodereal Enabled: ${noderealEnabled ? '✅' : '❌'}`);
        console.log(`   RPC URL: ${noderealConfig.rpcUrl}`);
        console.log(`   API Key Configured: ${noderealConfig.apiKey && noderealConfig.apiKey !== 'your_nodereal_api_key_here' ? '✅' : '❌'}`);

        // Test 3: Check protection status (without AI initialization)
        console.log('\n3️⃣ Checking protection status...');
        const status = protector.getProtectionStatus();
        console.log(`   Overall Protection Level: ${status.overallProtectionLevel}`);
        console.log(`   Nodereal Configured: ${status.noderealEnabled}`);

        // Test 4: Enable Nodereal protection
        console.log('\n4️⃣ Enabling Nodereal protection...');
        const enabled = await protector.enableNoderealProtection({
            protectionLevel: 'high',
            features: {
                sandwichProtection: true,
                frontrunProtection: true,
                backrunProtection: true,
                privateMempool: true
            }
        });

        if (enabled) {
            console.log('   ✅ Nodereal protection enabled');
        } else {
            console.log('   ⚠️ Nodereal protection not enabled (API key not configured)');
        }

        // Test 5: Test chain connection with Nodereal
        console.log('\n5️⃣ Testing chain connection...');
        try {
            const provider = await chainConnection.getHTTPProvider();
            const blockNumber = await provider.getBlockNumber();
            console.log(`   ✅ Connected to blockchain, current block: ${blockNumber}`);

            // Check if using Nodereal
            const connectionUrl = provider.connection.url;
            if (connectionUrl.includes('nodereal.io')) {
                console.log('   🔒 Using Nodereal MEV-protected endpoint');
            } else {
                console.log('   ℹ️ Using alternative endpoint:', connectionUrl);
            }
        } catch (error) {
            console.log('   ❌ Chain connection failed:', error.message);
        }

        // Test 6: Test basic chain connection functionality
        console.log('\n6️⃣ Testing basic functionality...');
        try {
            // Test that the protector has the expected methods
            const hasEnableMethod = typeof protector.enableNoderealProtection === 'function';
            const hasStatusMethod = typeof protector.getProtectionStatus === 'function';

            console.log(`   enableNoderealProtection method: ${hasEnableMethod ? '✅' : '❌'}`);
            console.log(`   getProtectionStatus method: ${hasStatusMethod ? '✅' : '❌'}`);
            console.log(`   Nodereal config available: ${protector.noderealConfig ? '✅' : '❌'}`);
        } catch (error) {
            console.log('   ❌ Basic functionality test failed:', error.message);
        }

        console.log('\n🎉 Nodereal integration test completed!');

        // Summary
        console.log('\n📊 Summary:');
        console.log(`   Overall Protection Level: ${status.overallProtectionLevel}`);
        console.log(`   Nodereal Enabled: ${status.noderealEnabled}`);
        console.log(`   AI Protector Ready: ${status.aiReady}`);

        if (status.noderealEnabled && status.aiReady) {
            console.log('   ✅ Full MEV protection active!');
        } else if (status.noderealEnabled || status.aiReady) {
            console.log('   ⚠️ Partial MEV protection active');
        } else {
            console.log('   ❌ No MEV protection active');
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        // Cleanup
        if (chainConnection) {
            chainConnection.destroy();
        }
    }
}

// Run the test
if (require.main === module) {
    testNoderealIntegration().then(() => {
        process.exit(0);
    }).catch((error) => {
        console.error('Test execution failed:', error);
        process.exit(1);
    });
}

module.exports = { testNoderealIntegration };