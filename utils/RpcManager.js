/**
 * RPC Manager - Central RPC call management with rate limiting and adaptive backoff
 * Prevents RPC overload and handles rate limit errors gracefully
 */

class RpcManager {
    constructor() {
        this.callQueue = [];
        this.activeCalls = 0;
        this.maxConcurrentCalls = 5;
        this.minInterval = 100; // Minimum 100ms between calls
        this.lastCallTime = 0;

        // Adaptive backoff for rate limit errors
        this.backoffMultiplier = 1.5;
        this.maxBackoffTime = 30000; // 30 seconds max backoff
        this.backoffTime = 1000; // Start with 1 second

        // Statistics
        this.stats = {
            totalCalls: 0,
            successfulCalls: 0,
            rateLimitErrors: 0,
            otherErrors: 0,
            averageResponseTime: 0
        };

        // Error patterns to detect rate limiting
        this.rateLimitPatterns = [
            'rate limit',
            '429',
            'too many requests',
            'method eth_call in batch triggered rate limit',
            'method eth_getLogs in batch triggered rate limit',
            'method eth_getFilterChanges in batch triggered rate limit'
        ];
    }

    /**
     * Execute an RPC call with rate limiting and retry logic
     * @param {Function} callFn - Function that returns a Promise for the RPC call
     * @param {Object} options - Options for the call
     * @returns {Promise} Result of the RPC call
     */
    async executeCall(callFn, options = {}) {
        const maxRetries = options.maxRetries || 3;
        let attempt = 0;

        while (attempt < maxRetries) {
            try {
                // Wait for rate limit and queue management
                await this._waitForSlot();

                const startTime = Date.now();
                this.activeCalls++;
                this.stats.totalCalls++;

                const result = await callFn();

                const responseTime = Date.now() - startTime;
                this.stats.successfulCalls++;
                this.stats.averageResponseTime =
                    (this.stats.averageResponseTime + responseTime) / 2;

                this.activeCalls--;
                this.lastCallTime = Date.now();

                return result;

            } catch (error) {
                this.activeCalls--;

                // Check if this is a rate limit error
                const isRateLimit = this._isRateLimitError(error);

                if (isRateLimit && attempt < maxRetries - 1) {
                    this.stats.rateLimitErrors++;
                    console.warn(`⚠️ RPC rate limit detected, backing off for ${this.backoffTime}ms (attempt ${attempt + 1}/${maxRetries})`);

                    await this._backoff();
                    attempt++;
                    continue;
                } else {
                    this.stats.otherErrors++;
                    throw error;
                }
            }
        }

        throw new Error(`RPC call failed after ${maxRetries} attempts`);
    }

    /**
     * Wait for an available slot in the call queue
     * @private
     */
    async _waitForSlot() {
        return new Promise((resolve) => {
            const checkSlot = () => {
                const timeSinceLastCall = Date.now() - this.lastCallTime;

                if (this.activeCalls < this.maxConcurrentCalls && timeSinceLastCall >= this.minInterval) {
                    resolve();
                } else {
                    setTimeout(checkSlot, 50); // Check again in 50ms
                }
            };

            checkSlot();
        });
    }

    /**
     * Check if an error is a rate limit error
     * @private
     */
    _isRateLimitError(error) {
        const errorMessage = error.message || error.toString();
        return this.rateLimitPatterns.some(pattern =>
            errorMessage.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    /**
     * Implement exponential backoff for rate limit errors
     * @private
     */
    async _backoff() {
        await new Promise(resolve => setTimeout(resolve, this.backoffTime));

        // Increase backoff time exponentially, but cap it
        this.backoffTime = Math.min(
            this.backoffTime * this.backoffMultiplier,
            this.maxBackoffTime
        );
    }

    /**
     * Reset backoff time after successful calls
     */
    resetBackoff() {
        this.backoffTime = 1000;
    }

    /**
     * Get statistics about RPC calls
     */
    getStats() {
        return {
            ...this.stats,
            activeCalls: this.activeCalls,
            backoffTime: this.backoffTime,
            queueLength: this.callQueue.length
        };
    }

    /**
     * Clean shutdown
     */
    cleanup() {
        this.callQueue = [];
        this.activeCalls = 0;
    }
}

// Export singleton instance
const rpcManager = new RpcManager();

export default rpcManager;