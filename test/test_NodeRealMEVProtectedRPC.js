#!/usr/bin/env node
/**
 * Test NodeReal MEV Protected RPC WebSocket Monitoring
 */

import NodeRealMEVProtectedRPC from '../src/mev/NodeRealMEVProtectedRPC.js';

async function testNodeRealMEVProtectedRPC() {
    console.log('🧪 Testing NodeRealMEVProtectedRPC...\n');

    try {
        // Test 1: Class instantiation
        console.log('🧪 Test 1: Class instantiation...');
        const mevRpc = new NodeRealMEVProtectedRPC({
            wsEndpoint: 'wss://test-ws.nodereal.io/ws/v1/test_key',
            apiKey: 'test_api_key',
            reconnectInterval: 1000, // 1 second for testing
            maxReconnectAttempts: 2,
            mevAlertThreshold: 0.5
        });

        console.log('✅ NodeRealMEVProtectedRPC instantiated successfully');

        // Test 2: Check initial state
        console.log('\n🧪 Test 2: Initial state verification...');
        expect(mevRpc.options.wsEndpoint).toBe('wss://test-ws.nodereal.io/ws/v1/test_key');
        expect(mevRpc.options.apiKey).toBe('test_api_key');
        expect(mevRpc.isConnected).toBe(false);
        expect(mevRpc.stats.totalBlocks).toBe(0);
        expect(mevRpc.stats.totalTransactions).toBe(0);
        console.log('✅ Initial state verified');

        // Test 3: Statistics tracking
        console.log('\n🧪 Test 3: Statistics tracking...');
        const initialStats = mevRpc.getStats();
        expect(initialStats).toHaveProperty('totalBlocks');
        expect(initialStats).toHaveProperty('totalTransactions');
        expect(initialStats).toHaveProperty('mevAlerts');
        expect(initialStats).toHaveProperty('isConnected');
        expect(initialStats.isConnected).toBe(false);
        console.log('✅ Statistics tracking verified');

        // Test 4: MEV alert triggering
        console.log('\n🧪 Test 4: MEV alert system...');
        let alertReceived = false;
        let alertData = null;

        mevRpc.on('mevAlert', (alert) => {
            alertReceived = true;
            alertData = alert;
        });

        // Manually trigger an alert
        mevRpc.triggerMEVAlert('test_attack', {
            testData: 'value',
            riskScore: 0.95  // Use 0.95 to trigger high severity
        });

        expect(mevRpc.stats.mevAlerts).toBe(1);
        expect(mevRpc.stats.alertsTriggered).toBe(1);
        expect(alertReceived).toBe(true);
        expect(alertData.type).toBe('test_attack');
        expect(alertData.severity).toBe('high'); // riskScore > 0.9
        console.log('✅ MEV alert system working');

        // Test 5: Block processing
        console.log('\n🧪 Test 5: Block processing...');
        let blockReceived = false;
        let blockData = null;

        mevRpc.on('newBlock', (block) => {
            blockReceived = true;
            blockData = block;
        });

        const mockBlock = {
            number: '0x123456',
            transactions: [
                { hash: '0xabc123', to: '0x123', input: '0x7ff36ab5' },
                { hash: '0xdef456', to: '0x456', input: '0x18cbafe5' }
            ]
        };

        mevRpc.handleNewBlock(mockBlock);

        expect(mevRpc.stats.totalBlocks).toBe(1);
        expect(blockReceived).toBe(true);
        expect(blockData).toBe(mockBlock);
        console.log('✅ Block processing working');

        // Test 6: Transaction processing
        console.log('\n🧪 Test 6: Transaction processing...');
        let txReceived = false;
        let txHash = null;

        mevRpc.on('pendingTransaction', (hash) => {
            txReceived = true;
            txHash = hash;
        });

        const mockTxHash = '0x123456789abcdef123456789abcdef123456789abcdef';
        mevRpc.handlePendingTransaction(mockTxHash);

        expect(mevRpc.stats.totalTransactions).toBe(1);
        expect(txReceived).toBe(true);
        expect(txHash).toBe(mockTxHash);
        console.log('✅ Transaction processing working');

        // Test 7: MEV pattern detection
        console.log('\n🧪 Test 7: MEV pattern detection...');
        let sandwichAlertReceived = false;

        mevRpc.on('mevAlert', (alert) => {
            if (alert.type === 'sandwich') {
                sandwichAlertReceived = true;
            }
        });

        // Create a mock block with sandwich attack pattern
        const sandwichBlock = {
            number: '0x123457',
            transactions: [
                {
                    to: '0x10ed43c718714eb63d5aa57b78b54704e256024e', // PCS Router
                    input: '0x7ff36ab500000000000000000000000000000000000000000000000000000000'
                },
                {
                    to: '0x10ed43c718714eb63d5aa57b78b54704e256024e', // Same router
                    input: '0x7ff36ab500000000000000000000000000000000000000000000000000000000'
                },
                {
                    to: '0x10ed43c718714eb63d5aa57b78b54704e256024e', // Same router
                    input: '0x7ff36ab500000000000000000000000000000000000000000000000000000000'
                }
            ]
        };

        mevRpc.analyzeBlockForMEV(sandwichBlock);
        expect(mevRpc.stats.suspiciousTxCount).toBeGreaterThan(0);
        console.log('✅ MEV pattern detection working');

        // Test 8: Cleanup
        console.log('\n🧪 Test 8: Cleanup and disconnection...');
        let disconnected = false;

        mevRpc.on('disconnected', () => {
            disconnected = true;
        });

        // Handle WebSocket errors gracefully during testing
        mevRpc.on('error', (error) => {
            // Ignore WebSocket connection errors during testing
            if (error.message.includes('WebSocket was closed')) {
                return;
            }
            console.warn('Test WebSocket error (ignoring):', error.message);
        });

        // Mock connection
        mevRpc.isConnected = true;
        mevRpc.stats.connectedAt = Date.now();

        // Disconnect with a small delay to allow async operations
        await new Promise(resolve => setTimeout(resolve, 100));

        mevRpc.disconnect();

        // Wait a bit for disconnect event
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mevRpc.isConnected).toBe(false);
        expect(disconnected).toBe(true);
        console.log('✅ Cleanup working');

        console.log('\n✅ All tests passed! NodeRealMEVProtectedRPC is working correctly.');
        console.log('\n📊 Final Statistics:');
        console.log(JSON.stringify(mevRpc.getStats(), null, 2));

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Simple assertion function since we don't have Chai
function expect(actual) {
    return {
        toBe: (expected) => {
            if (actual !== expected) {
                throw new Error(`Expected ${expected}, but got ${actual}`);
            }
        },
        toBeGreaterThan: (expected) => {
            if (actual <= expected) {
                throw new Error(`Expected ${actual} to be greater than ${expected}`);
            }
        },
        toHaveProperty: (prop) => {
            if (!(prop in actual)) {
                throw new Error(`Expected object to have property ${prop}`);
            }
        }
    };
}

// Run the test
testNodeRealMEVProtectedRPC().catch(console.error);