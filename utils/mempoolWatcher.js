import { ethers } from 'ethers';
import { EventEmitter } from 'events';

class MempoolWatcher extends EventEmitter {
    constructor(provider, wsUrl) {
        super();
        this.provider = provider;
        this.wsUrl = wsUrl || 'wss://bsc-mainnet.nodereal.io/ws/v1/YOUR_API_KEY';
        this.wsProvider = null;
        this.isWatching = false;
        this.dexRouters = new Set();
        this.largeTxThreshold = ethers.parseEther('0.001'); // 0.001 BNB threshold
        console.log('📡 MempoolWatcher: Initialized');
    }

    /**
     * Add DEX router addresses to monitor
     */
    addDexRouters(routers) {
        routers.forEach(router => {
            this.dexRouters.add(router.toLowerCase());
        });
        console.log(`📡 MempoolWatcher: Monitoring ${this.dexRouters.size} DEX routers`);
    }

    /**
     * Start mempool watching
     */
    async start() {
        if (this.isWatching) return;

        try {
            console.log('📡 MempoolWatcher: Starting WebSocket connection...');
            this.wsProvider = new ethers.WebSocketProvider(this.wsUrl);

            // Monitor pending transactions
            this.wsProvider.on('pending', async (txHash) => {
                try {
                    const tx = await this.wsProvider.getTransaction(txHash);
                    if (tx && tx.to && this.dexRouters.has(tx.to.toLowerCase())) {
                        await this._analyzeDexTransaction(tx);
                    }
                } catch (error) {
                    // Silent error handling
                }
            });

            this.isWatching = true;
            console.log('📡 MempoolWatcher: Active - monitoring DEX transactions');

        } catch (error) {
            console.error('❌ MempoolWatcher: Failed to start:', error.message);
            this.emit('error', error);
        }
    }

    /**
     * Stop mempool watching
     */
    stop() {
        if (this.wsProvider) {
            this.wsProvider.removeAllListeners();
            this.wsProvider = null;
        }
        this.isWatching = false;
        console.log('📡 MempoolWatcher: Stopped');
    }

    /**
     * Analyze DEX transaction for arbitrage opportunities
     */
    async _analyzeDexTransaction(tx) {
        try {
            // Check if transaction value is significant (> 0.001 BNB)
            if (tx.value && tx.value > this.largeTxThreshold) {
                console.log(`📡 MempoolWatcher: Large DEX transaction detected (${ethers.formatEther(tx.value)} BNB)`);

                // Emit event for arbitrage bot to trigger immediate scan
                this.emit('largeDexTransaction', {
                    txHash: tx.hash,
                    to: tx.to,
                    value: tx.value,
                    gasPrice: tx.gasPrice,
                    timestamp: Date.now()
                });

                // Also check for potential price impact
                await this._simulatePriceImpact(tx);
            }

            // Check for sandwich attack patterns
            if (tx.data && tx.data.startsWith('0x7ff36ab5')) { // swapExactETHForTokens
                this.emit('potentialSandwich', {
                    txHash: tx.hash,
                    type: 'swapExactETHForTokens',
                    timestamp: Date.now()
                });
            }

        } catch (error) {
            // Silent error handling
        }
    }

    /**
     * Simulate price impact of pending transaction
     */
    async _simulatePriceImpact(tx) {
        try {
            // Decode transaction if it's a swap
            if (tx.data && tx.data.length >= 10) {
                const methodId = tx.data.substring(0, 10);

                // Common DEX swap methods
                const swapMethods = [
                    '0x7ff36ab5', // swapExactETHForTokens
                    '0x18cbafe5', // swapExactTokensForETH
                    '0x38ed1739', // swapExactTokensForTokens
                    '0x8803dbee', // swapTokensForExactTokens
                    '0x4a25d94a', // swapTokensForExactETH
                    '0x5c60da1b'  // swapETHForExactTokens
                ];

                if (swapMethods.includes(methodId)) {
                    // Emit price impact event
                    this.emit('priceImpactDetected', {
                        txHash: tx.hash,
                        method: methodId,
                        router: tx.to,
                        estimatedImpact: this._estimateImpact(tx),
                        timestamp: Date.now()
                    });
                }
            }
        } catch (error) {
            // Silent error handling
        }
    }

    /**
     * Estimate price impact (simplified)
     */
    _estimateImpact(tx) {
        // Simplified impact estimation based on transaction value
        const value = tx.value || 0n;
        const impactPercent = Number(value) / 1e18 * 100; // Rough estimate
        return Math.min(impactPercent, 5.0); // Cap at 5%
    }

    /**
     * Get watcher status
     */
    getStatus() {
        return {
            isWatching: this.isWatching,
            dexRoutersCount: this.dexRouters.size,
            wsConnected: this.wsProvider ? true : false,
            largeTxThreshold: ethers.formatEther(this.largeTxThreshold)
        };
    }
}

export default MempoolWatcher;