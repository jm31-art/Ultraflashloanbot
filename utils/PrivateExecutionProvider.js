/**
 * PRIVATE EXECUTION PROVIDER
 * Routes all write operations through private relay, reads through public RPC
 * Prevents MEV leakage and front-running attacks
 */

import { ethers } from 'ethers';
import { submitPrivateTx, getPrivateRelayStatus } from '../src/mev/privateRelay.js';
import { provider as publicProvider } from '../src/dex/routers.js';

class PrivateExecutionProvider {
    constructor() {
        this.privateRelayAvailable = false;
        this.lastRelayCheck = 0;
        this.relayCheckInterval = 30000; // 30 seconds

        // Initialize relay status
        this._checkRelayStatus();
    }

    /**
     * Check if private relay is available
     * @private
     */
    async _checkRelayStatus() {
        const now = Date.now();
        if (now - this.lastRelayCheck < this.relayCheckInterval) {
            return this.privateRelayAvailable;
        }

        try {
            const status = await getPrivateRelayStatus();
            this.privateRelayAvailable = status.available;
            this.lastRelayCheck = now;
            return this.privateRelayAvailable;
        } catch (error) {
            console.warn('⚠️ Private relay status check failed:', error.message);
            this.privateRelayAvailable = false;
            return false;
        }
    }

    /**
     * Execute transaction privately (MANDATORY for all write operations)
     * @param {ethers.Signer} signer - The signer
     * @param {Object} txRequest - Transaction request
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Transaction result
     */
    async sendTransaction(signer, txRequest, options = {}) {
        // Always check relay status before execution
        const relayAvailable = await this._checkRelayStatus();

        if (!relayAvailable) {
            if (options.allowPublicFallback) {
                console.warn('⚠️ Private relay unavailable, falling back to public execution');
                return await this._sendPublicTransaction(signer, txRequest);
            } else {
                throw new Error('Private relay unavailable and public fallback disabled');
            }
        }

        try {
            // Submit via private relay
            const result = await submitPrivateTx(txRequest, publicProvider);

            console.log(`🔒 Private transaction submitted: ${result.hash}`);

            // Wait for confirmation
            const receipt = await publicProvider.waitForTransaction(result.hash, 1, 120000); // 2 min timeout

            if (receipt.status === 1) {
                console.log(`✅ Private transaction confirmed: ${result.hash}`);
                return {
                    success: true,
                    hash: result.hash,
                    receipt: receipt,
                    privateRelay: true
                };
            } else {
                throw new Error('Transaction reverted');
            }

        } catch (error) {
            console.error('❌ Private transaction failed:', error.message);

            // Fallback to public if allowed
            if (options.allowPublicFallback) {
                console.warn('🔄 Falling back to public execution after private failure');
                return await this._sendPublicTransaction(signer, txRequest);
            }

            throw error;
        }
    }

    /**
     * Send transaction via public mempool (fallback only)
     * @private
     */
    async _sendPublicTransaction(signer, txRequest) {
        try {
            console.log('📢 Sending transaction via public mempool (fallback)');

            const tx = await signer.sendTransaction(txRequest);
            console.log(`📤 Public transaction submitted: ${tx.hash}`);

            const receipt = await tx.wait();

            if (receipt.status === 1) {
                console.log(`✅ Public transaction confirmed: ${tx.hash}`);
                return {
                    success: true,
                    hash: tx.hash,
                    receipt: receipt,
                    privateRelay: false
                };
            } else {
                throw new Error('Transaction reverted');
            }

        } catch (error) {
            console.error('❌ Public transaction failed:', error.message);
            throw error;
        }
    }

    /**
     * Read operations use public RPC (safe for reads)
     * @param {string} method - RPC method
     * @param {Array} params - Method parameters
     * @returns {Promise} RPC result
     */
    async call(method, params = []) {
        // All read operations go through public RPC
        return await publicProvider.send(method, params);
    }

    /**
     * Get block number (read operation)
     */
    async getBlockNumber() {
        return await publicProvider.getBlockNumber();
    }

    /**
     * Get block (read operation)
     */
    async getBlock(blockNumber) {
        return await publicProvider.getBlock(blockNumber);
    }

    /**
     * Get transaction (read operation)
     */
    async getTransaction(txHash) {
        return await publicProvider.getTransaction(txHash);
    }

    /**
     * Get transaction receipt (read operation)
     */
    async getTransactionReceipt(txHash) {
        return await publicProvider.getTransactionReceipt(txHash);
    }

    /**
     * Get logs (read operation)
     */
    async getLogs(filter) {
        return await publicProvider.getLogs(filter);
    }

    /**
     * Get fee data (read operation)
     */
    async getFeeData() {
        return await publicProvider.getFeeData();
    }

    /**
     * Get network (read operation)
     */
    async getNetwork() {
        return await publicProvider.getNetwork();
    }

    /**
     * Wait for transaction (read operation)
     */
    async waitForTransaction(txHash, confirmations = 1, timeout = 120000) {
        return await publicProvider.waitForTransaction(txHash, confirmations, timeout);
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            privateRelayAvailable: this.privateRelayAvailable,
            lastRelayCheck: new Date(this.lastRelayCheck).toISOString(),
            relayCheckInterval: this.relayCheckInterval
        };
    }
}

// Export singleton instance
const privateExecutionProvider = new PrivateExecutionProvider();

export default privateExecutionProvider;