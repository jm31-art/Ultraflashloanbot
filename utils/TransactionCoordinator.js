/**
 * Transaction Coordinator - Shared concurrency control and nonce safety
 * Ensures one active transaction per wallet and proper nonce management
 */

class TransactionCoordinator {
    constructor() {
        this.activeTransactions = new Map(); // wallet -> active tx promise
        this.nonceLocks = new Map(); // wallet -> nonce lock
        this.pendingQueue = new Map(); // wallet -> queue of pending txs
        this.lastNonce = new Map(); // wallet -> last used nonce

        // Statistics
        this.stats = {
            totalTransactions: 0,
            successfulTransactions: 0,
            failedTransactions: 0,
            queuedTransactions: 0,
            averageQueueTime: 0
        };
    }

    /**
     * Execute a transaction with concurrency control and nonce safety
     * @param {Object} params - Transaction parameters
     * @param {ethers.Signer} params.signer - The signer/wallet
     * @param {Function} params.txFn - Function that returns transaction promise
     * @param {Object} params.options - Options for execution
     * @returns {Promise} Transaction result
     */
    async executeTransaction({ signer, txFn, options = {} }) {
        const walletAddress = await signer.getAddress();
        const startTime = Date.now();

        this.stats.totalTransactions++;

        return new Promise(async (resolve, reject) => {
            // Check if wallet has active transaction
            if (this.activeTransactions.has(walletAddress)) {
                // Queue the transaction
                this._enqueueTransaction(walletAddress, { signer, txFn, options, resolve, reject, startTime });
                this.stats.queuedTransactions++;
                console.log(`📋 Transaction queued for ${walletAddress} (active tx in progress)`);
                return;
            }

            // Execute immediately
            this._executeImmediately(walletAddress, { signer, txFn, options, resolve, reject, startTime });
        });
    }

    /**
     * Execute transaction immediately (no queue)
     * @private
     */
    async _executeImmediately(walletAddress, { signer, txFn, options, resolve, reject, startTime }) {
        // Mark as active
        this.activeTransactions.set(walletAddress, true);

        try {
            // Acquire nonce lock
            await this._acquireNonceLock(walletAddress, signer);

            // Execute the transaction
            const result = await txFn();

            this.stats.successfulTransactions++;

            // Update nonce
            if (result && result.nonce !== undefined) {
                this.lastNonce.set(walletAddress, result.nonce + 1);
            }

            resolve(result);

        } catch (error) {
            this.stats.failedTransactions++;
            reject(error);
        } finally {
            // Release active transaction lock
            this.activeTransactions.delete(walletAddress);

            // Process next queued transaction
            this._processQueue(walletAddress);
        }
    }

    /**
     * Enqueue transaction for later execution
     * @private
     */
    _enqueueTransaction(walletAddress, txData) {
        if (!this.pendingQueue.has(walletAddress)) {
            this.pendingQueue.set(walletAddress, []);
        }

        this.pendingQueue.get(walletAddress).push(txData);
    }

    /**
     * Process queued transactions for a wallet
     * @private
     */
    async _processQueue(walletAddress) {
        const queue = this.pendingQueue.get(walletAddress);
        if (!queue || queue.length === 0) {
            return;
        }

        // Get next transaction
        const nextTx = queue.shift();

        if (queue.length === 0) {
            this.pendingQueue.delete(walletAddress);
        }

        // Execute next transaction
        const queueTime = Date.now() - nextTx.startTime;
        this.stats.averageQueueTime = (this.stats.averageQueueTime + queueTime) / 2;

        console.log(`🚀 Processing queued transaction for ${walletAddress} (queued ${queueTime}ms)`);

        this._executeImmediately(walletAddress, nextTx);
    }

    /**
     * Acquire nonce lock to ensure sequential nonce usage
     * @private
     */
    async _acquireNonceLock(walletAddress, signer) {
        // Wait for any existing nonce operation
        if (this.nonceLocks.has(walletAddress)) {
            await this.nonceLocks.get(walletAddress);
        }

        // Create new nonce lock
        let nonceLockResolve;
        const nonceLock = new Promise(resolve => {
            nonceLockResolve = resolve;
        });

        this.nonceLocks.set(walletAddress, nonceLock);

        try {
            // Get current nonce from network
            let currentNonce = await signer.provider.getTransactionCount(walletAddress, 'pending');

            // Use cached nonce if higher (handles pending txs)
            const cachedNonce = this.lastNonce.get(walletAddress);
            if (cachedNonce !== undefined && cachedNonce > currentNonce) {
                currentNonce = cachedNonce;
            }

            // Update cache
            this.lastNonce.set(walletAddress, currentNonce);

            return currentNonce;

        } finally {
            // Release nonce lock
            nonceLockResolve();
            this.nonceLocks.delete(walletAddress);
        }
    }

    /**
     * Get nonce for wallet (safe to call concurrently)
     * @param {string} walletAddress - Wallet address
     * @param {ethers.Signer} signer - Signer instance
     * @returns {Promise<number>} Next nonce
     */
    async getNonce(walletAddress, signer) {
        return this._acquireNonceLock(walletAddress, signer);
    }

    /**
     * Check if wallet has active transaction
     * @param {string} walletAddress - Wallet address
     * @returns {boolean} True if active transaction
     */
    hasActiveTransaction(walletAddress) {
        return this.activeTransactions.has(walletAddress);
    }

    /**
     * Get queue length for wallet
     * @param {string} walletAddress - Wallet address
     * @returns {number} Queue length
     */
    getQueueLength(walletAddress) {
        const queue = this.pendingQueue.get(walletAddress);
        return queue ? queue.length : 0;
    }

    /**
     * Get statistics
     */
    getStats() {
        const activeWallets = Array.from(this.activeTransactions.keys());
        const queuedWallets = Array.from(this.pendingQueue.keys());

        return {
            ...this.stats,
            activeWallets: activeWallets.length,
            queuedWallets: queuedWallets.length,
            totalQueued: Array.from(this.pendingQueue.values()).reduce((sum, queue) => sum + queue.length, 0),
            activeTransactions: activeWallets,
            queuedTransactions: Object.fromEntries(
                Array.from(this.pendingQueue.entries()).map(([wallet, queue]) => [wallet, queue.length])
            )
        };
    }

    /**
     * Emergency cleanup
     */
    emergencyCleanup() {
        this.activeTransactions.clear();
        this.nonceLocks.clear();
        this.pendingQueue.clear();

        console.log('🚨 Transaction Coordinator emergency cleanup completed');
    }
}

// Export singleton instance
const transactionCoordinator = new TransactionCoordinator();

export default transactionCoordinator;