import { ethers } from 'ethers';
import { EventEmitter } from 'events';

class MempoolWatcher extends EventEmitter {
  constructor(dexRouters, config = {}) {
    super();
    this.dexRouters = new Set(dexRouters.map(r => r.toLowerCase()));
    this.largeTxThreshold = ethers.parseEther(config.largeTxThreshold || '0.1');
    this.microTxThreshold = ethers.parseEther('0.001');
    this.priceImpactThreshold = 1.0; // %
    this.maxReconnectAttempts = 10;
    this.reconnectInterval = 30000; // 30s
    this.reconnectAttempts = 0;
    this.isWatching = false;
    this.wsProvider = null;
  }

  async start() {
    if (this.isWatching) return;
    console.log('📡 MempoolWatcher: Attempting connection...');

    // Try primary public WSS
    try {
      const primaryWsUrl = 'wss://bsc-ws-node.nariox.org:443';
      this.wsProvider = new ethers.WebSocketProvider(primaryWsUrl);

      // Error handler with reconnect
      this.wsProvider.on('error', (error) => {
        console.warn(`⚠️ MEMPOOLWATCHER: Primary WSS error: ${error.message}`);
        this._handleReconnect();
      });

      // Test connection with increased timeout
      await Promise.race([
        this.wsProvider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 15000))
      ]);

      console.log('📡 MEMPOOLWATCHER: Connected successfully to primary public WSS');
      this._setupPendingListener();
      this.isWatching = true;
      this.reconnectAttempts = 0;
      return;
    } catch (error) {
      console.warn(`⚠️ MEMPOOLWATCHER: Primary WSS failed: ${error.message}`);
    }

    // Fallback to secondary public WSS
    try {
      const fallbackWsUrl = 'wss://bsc-ws.publicnode.com';
      this.wsProvider = new ethers.WebSocketProvider(fallbackWsUrl);

      this.wsProvider.on('error', (error) => {
        console.warn(`⚠️ MEMPOOLWATCHER: Fallback WSS error: ${error.message}`);
        this._handleReconnect();
      });

      await Promise.race([
        this.wsProvider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
      ]);

      console.log('📡 MEMPOOLWATCHER: Connected to fallback public WSS');
      this._setupPendingListener();
      this.isWatching = true;
      this.reconnectAttempts = 0;
      return;
    } catch (fallbackError) {
      console.warn(`⚠️ MEMPOOLWATCHER: All WebSocket connections failed: ${fallbackError.message}`);
      // Instead of reconnecting, disable mempool watching to prevent bot crash
      console.log('📡 MEMPOOLWATCHER: Disabling mempool watching - bot will continue with block-based scanning');
      this.isWatching = false;
      this.wsProvider = null;
    }
  }

  _handleReconnect() {
    this.isWatching = false;
    this.wsProvider = null;
    this.reconnectAttempts++;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Exponential backoff, max 30s
      console.log(`📡 MEMPOOLWATCHER: Reconnecting in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => this.start(), delay);
    } else {
      console.log('📡 MEMPOOLWATCHER: Max reconnect attempts reached, switching to block-based scanning');
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.start();
      }, 300000); // Retry in 5 min
    }
  }

  _setupPendingListener() {
    this.wsProvider.on('pending', async (txHash) => {
      try {
        const tx = await this.wsProvider.getTransaction(txHash);
        if (tx && tx.to && this.dexRouters.has(tx.to.toLowerCase())) {
          await this._analyzeDexTransaction(tx);
        }
      } catch (error) {
        // Silent
      }
    });
    console.log('📡 MempoolWatcher: Active - monitoring DEX transactions');
  }

  async _analyzeDexTransaction(tx) {
    try {
      const txValue = tx.value || 0n;
      const valueBNB = ethers.formatEther(txValue);

      // LOG ALL DEX TRANSACTIONS DETECTED
      console.log(`📡 MEMPOOL: DEX TX DETECTED - ${valueBNB} BNB to ${tx.to.substring(0, 10)}... - Hash: ${tx.hash.substring(0, 10)}...`);

      const isLargeTx = txValue > this.largeTxThreshold;

      // Check if transaction meets criteria for deep multi-hop scan
      if (isLargeTx) {
        console.log(`🚨🚨🚨 MEMPOOL: LARGE DEX TX DETECTED (${valueBNB} BNB) - TRIGGERING DEEP MULTI-HOP SCAN! 🚨🚨🚨`);

        // Emit event for deep multi-hop arbitrage scan (4-6 paths)
        this.emit('largeDexTransaction', {
          txHash: tx.hash,
          to: tx.to,
          value: txValue,
          gasPrice: tx.gasPrice,
          timestamp: Date.now(),
          triggerType: 'large_tx',
          multiHopScan: true,
          minPaths: 4,
          maxPaths: 6
        });
      }

      // Check for price impact requiring multi-hop analysis
      const priceImpact = await this._simulatePriceImpact(tx);
      if (priceImpact && priceImpact.estimatedImpact > this.priceImpactThreshold) {
        console.log(`🚨🚨🚨 MEMPOOL: HIGH IMPACT TX DETECTED (${priceImpact.estimatedImpact.toFixed(2)}%) - TRIGGERING MULTI-HOP ARB SCAN! 🚨🚨🚨`);

        this.emit('priceImpactDetected', {
          txHash: tx.hash,
          method: priceImpact.method,
          router: tx.to,
          estimatedImpact: priceImpact.estimatedImpact,
          timestamp: Date.now(),
          triggerType: 'price_impact',
          multiHopScan: true,
          minPaths: 4,
          maxPaths: 6
        });
      }

      // Check for ANY micro DEX transaction for immediate execution
      const isMicroTx = txValue > this.microTxThreshold;
      if (isMicroTx) {
        console.log(`🚨🚨🚨 MEMPOOL: MICRO DEX TX DETECTED (${valueBNB} BNB) - TRIGGERING IMMEDIATE ARB SCAN! 🚨🚨🚨`);

        this.emit('microDexTransaction', {
          txHash: tx.hash,
          to: tx.to,
          value: txValue,
          gasPrice: tx.gasPrice,
          timestamp: Date.now(),
          triggerType: 'micro_tx',
          immediateExecution: true,
          minProfitThreshold: 0.20
        });
      }

      // Check for sandwich attack patterns - trigger immediate execution
      if (tx.data && tx.data.startsWith('0x7ff36ab5')) { // swapExactETHForTokens
        console.log('🚨🚨🚨 MEMPOOL: SANDWICH PATTERN DETECTED - EXECUTING ATOMIC CYCLE! 🚨🚨🚨');
        this.emit('potentialSandwich', {
          txHash: tx.hash,
          type: 'swapExactETHForTokens',
          timestamp: Date.now(),
          triggerType: 'sandwich',
          atomicExecution: true
        });
      }

    } catch (error) {
      // Silent error handling
    }
  }

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
          const estimatedImpact = this._estimateImpact(tx);

          // Return impact data for caller to decide on multi-hop scan
          return {
            txHash: tx.hash,
            method: methodId,
            router: tx.to,
            estimatedImpact: estimatedImpact,
            timestamp: Date.now()
          };
        }
      }
    } catch (error) {
      // Silent error handling
    }
    return null;
  }

  _estimateImpact(tx) {
    // Simplified impact estimation based on transaction value
    const value = tx.value || 0n;
    const impactPercent = Number(value) / 1e18 * 100; // Rough estimate
    return Math.min(impactPercent, 5.0); // Cap at 5%
  }

  stop() {
    if (this.wsProvider) {
      this.wsProvider.removeAllListeners();
      this.wsProvider = null;
    }
    this.isWatching = false;
    console.log('📡 MempoolWatcher: Stopped');
  }

  getStatus() {
    return {
      isWatching: this.isWatching,
      dexRoutersCount: this.dexRouters.size,
      wsConnected: this.wsProvider ? true : false
    };
  }
}

export default MempoolWatcher;