/**
 * RPC LOAD REDUCTION UTILITY
 * Separates providers for logs vs execution, implements batching and backoff
 */

import { ethers } from 'ethers';

class RpcManager {
    constructor() {
        // Separate providers for different operations
        this.logProvider = null; // For event listening and logs
        this.execProvider = null; // For transactions and calls
        this.backupProvider = null; // Fallback provider

        // Batching configuration
        this.batchSize = 10; // Max requests per batch
        this.batchInterval = 100; // ms between batches
        this.lastBatchTime = 0;

        // Rate limiting and backoff
        this.requestQueue = [];
        this.processingQueue = false;
        this.backoffMultiplier = 2;
        this.maxBackoffDelay = 30000; // 30 seconds
        this.currentBackoffDelay = 1000; // Start with 1 second

        // Request tracking
        this.requestCounts = new Map(); // provider -> count in window
        this.rateLimitWindow = 60000; // 1 minute
        this.maxRequestsPerWindow = 100; // Conservative limit
        this.lastResetTime = Date.now();
    }

    /**
     * Initialize providers with private BSC RPC
     * @param {string} rpcUrl - Primary RPC URL (should be private endpoint)
     */
    initialize(rpcUrl) {
      try {
        // PRIVATE BSC RPC CONFIGURATION: Higher limits, better stability
        const providerConfig = {
          timeout: 30000,        // 30s timeout for stability
          batchMaxDelay: 10,     // Faster batching
          staticNetwork: true
        };
  
        // LOG PROVIDER: For event listening (lower priority, no batching)
        this.logProvider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
          ...providerConfig,
          batchMaxCount: 1, // No batching for logs to avoid conflicts
        });
  
        // EXEC PROVIDER: For transactions and critical calls (higher priority, batched)
        this.execProvider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
          ...providerConfig,
          batchMaxCount: this.batchSize,
        });
  
        // BACKUP PROVIDER: For fallback operations (minimal config)
        this.backupProvider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
          ...providerConfig,
          batchMaxCount: 1,
        });
  
        console.log('✅ RPC Manager initialized with private BSC endpoints');
        console.log(`🔗 RPC URL: ${rpcUrl.replace(/\/v1\/[^\/]+/, '/v1/[API_KEY]')}`); // Hide API key
      } catch (error) {
        console.error('❌ Failed to initialize RPC providers:', error.message);
      }
    }

    /**
     * Get provider for log operations
     */
    getLogProvider() {
        return this.logProvider || this.execProvider;
    }

    /**
     * Get provider for execution operations
     */
    getExecProvider() {
        return this.execProvider || this.logProvider;
    }

    /**
     * Get backup provider
     */
    getBackupProvider() {
        return this.backupProvider || this.execProvider || this.logProvider;
    }

    /**
     * Execute batched eth_getLogs requests
     * @param {Array} logRequests - Array of log request objects
     * @returns {Promise<Array>} Array of log responses
     */
    async batchGetLogs(logRequests) {
        if (!Array.isArray(logRequests) || logRequests.length === 0) {
            return [];
        }

        // Split into batches to avoid rate limits
        const batches = this._chunkArray(logRequests, this.batchSize);
        const results = [];

        for (const batch of batches) {
            try {
                // Rate limiting check
                await this._checkRateLimit('logs');

                // Execute batch with backoff
                const batchResults = await this._executeWithBackoff(async () => {
                    const promises = batch.map(request =>
                        this.getLogProvider().getLogs(request)
                    );
                    return await Promise.allSettled(promises);
                });

                // Process results
                for (const result of batchResults) {
                    if (result.status === 'fulfilled') {
                        results.push(result.value);
                    } else {
                        console.warn('⚠️ Batch log request failed:', result.reason.message);
                        results.push([]); // Empty array for failed requests
                    }
                }

                // Delay between batches
                await this._delayBetweenBatches();

            } catch (error) {
                console.warn('⚠️ Batch execution failed:', error.message);
                // Add empty results for failed batch
                results.push(...new Array(batch.length).fill([]));
            }
        }

        return results.flat();
    }

    /**
     * Execute critical call with retry and backoff
     * @param {Function} callFn - Function that returns a promise
     * @param {string} operation - Operation name for logging
     * @returns {Promise} Call result
     */
    async executeCriticalCall(callFn, operation = 'critical_call') {
        return await this._executeWithBackoff(async () => {
            await this._checkRateLimit('exec');
            return await callFn();
        }, operation);
    }

    /**
     * Execute with exponential backoff
     * @private
     */
    async _executeWithBackoff(operation, context = 'operation') {
        let attempt = 0;
        let delay = this.currentBackoffDelay;

        while (attempt < 3) { // Max 3 attempts
            try {
                const result = await operation();
                this.currentBackoffDelay = 1000; // Reset on success
                return result;
            } catch (error) {
                attempt++;

                if (error.message.includes('rate limit') || error.message.includes('429') ||
                    error.message.includes('timeout') || error.code === 'TIMEOUT') {

                    if (attempt < 3) {
                        console.warn(`⚠️ ${context} rate limited, retrying in ${delay}ms (attempt ${attempt}/3)`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        delay = Math.min(delay * this.backoffMultiplier, this.maxBackoffDelay);
                        continue;
                    }
                }

                // Non-retryable error or max attempts reached
                throw error;
            }
        }
    }

    /**
     * Check rate limits
     * @private
     */
    async _checkRateLimit(providerType) {
        const now = Date.now();

        // Reset window if needed
        if (now - this.lastResetTime > this.rateLimitWindow) {
            this.requestCounts.clear();
            this.lastResetTime = now;
        }

        const currentCount = this.requestCounts.get(providerType) || 0;

        if (currentCount >= this.maxRequestsPerWindow) {
            const waitTime = this.rateLimitWindow - (now - this.lastResetTime);
            console.warn(`⚠️ Rate limit reached for ${providerType}, waiting ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return; // Will retry after wait
        }

        this.requestCounts.set(providerType, currentCount + 1);
    }

    /**
     * Delay between batches
     * @private
     */
    async _delayBetweenBatches() {
        const now = Date.now();
        const timeSinceLastBatch = now - this.lastBatchTime;

        if (timeSinceLastBatch < this.batchInterval) {
            const delay = this.batchInterval - timeSinceLastBatch;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        this.lastBatchTime = now;
    }

    /**
     * Chunk array into smaller arrays
     * @private
     */
    _chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Get connection status
     */
    async getStatus() {
        const status = {
            logProvider: false,
            execProvider: false,
            backupProvider: false,
            batchSize: this.batchSize,
            currentBackoffDelay: this.currentBackoffDelay
        };

        try {
            if (this.logProvider) {
                await this.logProvider.getBlockNumber();
                status.logProvider = true;
            }
        } catch (error) {
            // Log provider down
        }

        try {
            if (this.execProvider) {
                await this.execProvider.getBlockNumber();
                status.execProvider = true;
            }
        } catch (error) {
            // Exec provider down
        }

        try {
            if (this.backupProvider) {
                await this.backupProvider.getBlockNumber();
                status.backupProvider = true;
            }
        } catch (error) {
            // Backup provider down
        }

        return status;
    }
}

// Export singleton instance
const rpcManager = new RpcManager();

export default rpcManager;