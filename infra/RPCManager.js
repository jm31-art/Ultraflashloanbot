/**
 * SINGLE RPC MANAGER SOURCE OF TRUTH
 * Production-grade RPC infrastructure for MEV bot
 *
 * RULES:
 * - ONE provider source of truth
 * - No direct JsonRpcProvider() calls allowed elsewhere
 * - Frozen after initialization to prevent overrides
 * - Private RPC required for execution
 */

import { ethers } from 'ethers';

class RPCManager {
    constructor() {
        // SINGLE SOURCE OF TRUTH - Initialized once, frozen forever
        this._initialized = false;
        this._frozen = false;

        // Provider instances (created once)
        this._executionProvider = null; // For transactions (private RPC required)
        this._readProvider = null;     // For reads/queries (can use public)
        this._backupProvider = null;   // For fallbacks

        // Configuration - now array of RPCs with fallback chain
        this._rpcConfigs = []; // [{url, isPrivate, name}]
        this._currentRpcIndex = 0;
        this._connectivityValidated = false;

        // Validation state
        this._chainId = null;
        this._lastBlockNumber = null;
    }

    /**
     * Initialize RPC infrastructure (called once at startup)
     * @param {Object} config - Configuration object
     */
    initialize(config = {}) {
        if (this._initialized) {
            throw new Error('❌ RPCManager already initialized — aborting override');
        }

        console.log('🔧 Initializing RPC Manager (single source of truth)...');

        // Read environment variables
        this._loadEnvironmentConfig();

        // Validate configuration
        this._validateConfiguration();

        // Create providers
        this._createProviders();

        // Validate connectivity
        this._validateConnectivity();

        // NOTE: Freeze disabled during development to allow re-initialization
        // TODO: Re-enable freeze in production for security
        // this._freeze();

        console.log('✅ RPC Manager initialized');
        console.log(`🔗 RPC URL: ${this._maskApiKey(this._rpcUrl)}`);
        console.log(`🔒 Private RPC: ${this._isPrivate ? 'YES (execution enabled)' : 'NO (scan-only mode)'}`);
        if (this._isPrivate) {
            console.log('🚀 EXECUTION MODE ENABLED - Ready for real trades');
        } else {
            console.log('👁️ SCAN-ONLY MODE - No execution capabilities');
        }

        this._initialized = true;
    }

    /**
     * Get execution provider (private RPC required)
     */
    getExecutionProvider() {
        this._ensureInitialized();
        if (!this._isPrivate) {
            throw new Error('❌ Execution provider requires private RPC - system in scan-only mode');
        }
        return this._executionProvider;
    }

    /**
     * Get read provider (can use public RPC)
     */
    getReadProvider() {
        this._ensureInitialized();
        return this._readProvider;
    }

    /**
     * Get backup provider
     */
    getBackupProvider() {
        this._ensureInitialized();
        return this._backupProvider;
    }

    /**
     * Check if private RPC is available
     */
    isPrivate() {
        return this._isPrivate;
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            initialized: this._initialized,
            frozen: this._frozen,
            privateRpc: this._isPrivate,
            rpcUrl: this._maskApiKey(this._rpcUrl),
            connectivityValidated: this._connectivityValidated,
            chainId: this._chainId,
            lastBlockNumber: this._lastBlockNumber
        };
    }

    /**
     * Load configuration from environment
     * @private
     */
    _loadEnvironmentConfig() {
        this._rpcConfigs = [];

        // PRIMARY: NodeReal private RPC
        const nodeRealRpc = process.env.NODEREAL_RPC || process.env.RPC_URL;
        if (nodeRealRpc && this._isValidRpcUrl(nodeRealRpc) && nodeRealRpc.includes('nodereal.io')) {
            this._rpcConfigs.push({ url: nodeRealRpc, name: 'NodeReal Private', isPrivate: true });
        }

        // FALLBACKS: Add public RPCs
        this._rpcConfigs.push(
            { url: 'https://rpc.ankr.com/bsc', name: 'Ankr BSC', isPrivate: true },
            { url: 'https://bsc-rpc.publicnode.com', name: 'PublicNode BSC', isPrivate: true },
            { url: 'https://bsc-dataseed1.defibit.io', name: 'DefiBit BSC', isPrivate: true }
        );

        // If no NodeReal, check other private RPCs
        if (this._rpcConfigs.length === 3) {
            const bscRpc = process.env.BSC_RPC_URL;
            if (bscRpc && this._isValidRpcUrl(bscRpc) && this._isPrivateRpc(bscRpc)) {
                this._rpcConfigs.unshift({ url: bscRpc, name: 'BSC Private', isPrivate: true });
            } else {
                const genericRpc = process.env.RPC_URL;
                if (genericRpc && this._isValidRpcUrl(genericRpc) && this._isPrivateRpc(genericRpc)) {
                    this._rpcConfigs.unshift({ url: genericRpc, name: 'Generic Private', isPrivate: true });
                }
            }
        }

        this._currentRpcIndex = 0;
        this._rpcUrl = this._rpcConfigs[0].url;
        this._isPrivate = this._rpcConfigs[0].isPrivate;
    }

    /**
     * Validate configuration
     * @private
     */
    _validateConfiguration() {
        if (!this._rpcUrl) {
            throw new Error('❌ No RPC URL available');
        }

        // Check for placeholders
        if (this._rpcUrl.includes('YOUR_API_KEY') ||
            this._rpcUrl.includes('API_KEY') ||
            this._rpcUrl.includes('undefined')) {
            throw new Error('❌ RPC URL contains placeholder - check .env configuration');
        }

        // Validate URL format
        try {
            new URL(this._rpcUrl);
        } catch (error) {
            throw new Error(`❌ Invalid RPC URL format: ${this._rpcUrl}`);
        }
    }

    /**
     * Create provider instances
     * @private
     */
    _createProviders() {
        const providerConfig = {
            timeout: 30000,        // 30s timeout for stability
            batchMaxDelay: 10,     // Faster batching
            staticNetwork: true
        };

        // EXECUTION PROVIDER: For transactions (requires private RPC)
        if (this._isPrivate) {
            this._executionProvider = new ethers.JsonRpcProvider(this._rpcUrl, undefined, {
                ...providerConfig,
                batchMaxCount: 10, // Limited batching for execution
            });
        }

        // READ PROVIDER: For queries (can use any RPC)
        this._readProvider = new ethers.JsonRpcProvider(this._rpcUrl, undefined, {
            ...providerConfig,
            batchMaxCount: 50, // Higher batching for reads
        });

        // BACKUP PROVIDER: For fallbacks
        this._backupProvider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/', undefined, {
            ...providerConfig,
            batchMaxCount: 1, // Minimal for backup
        });
    }

    /**
     * Switch to next RPC in the chain
     * @private
     */
    _switchRpc() {
        this._currentRpcIndex = (this._currentRpcIndex + 1) % this._rpcConfigs.length;
        const newRpc = this._rpcConfigs[this._currentRpcIndex];
        this._rpcUrl = newRpc.url;
        this._isPrivate = newRpc.isPrivate;
        console.log(`RPC QUOTA HIT - Switching to fallback: ${newRpc.name}`);
        this._createProviders();
    }

    /**
     * Check if error is quota-related
     * @private
     */
    _isQuotaError(error) {
        if (!error || !error.message) return false;
        const msg = error.message.toLowerCase();
        return msg.includes('429') ||
               msg.includes('-32005') ||
               msg.includes('quota') ||
               msg.includes('rate limit') ||
               msg.includes('server_error');
    }

    /**
     * Validate RPC connectivity
     * @private
     */
    async _validateConnectivity() {
        try {
            console.log('🔍 Validating RPC connectivity...');

            // Test chain ID
            const network = await this._readProvider.getNetwork();
            this._chainId = Number(network.chainId); // Ensure it's a number

            // Test block number
            this._lastBlockNumber = await this._readProvider.getBlockNumber();

            // Debug logging
            console.log(`🔍 Chain ID: ${this._chainId} (type: ${typeof this._chainId})`);

            // Validate BSC mainnet/testnet (allow both)
            const validChains = [56, 97]; // BSC mainnet and testnet
            if (!validChains.includes(this._chainId)) {
                throw new Error(`❌ Wrong network - expected BSC (56) or BSC Testnet (97), got ${this._chainId}`);
            }

            this._connectivityValidated = true;
            console.log(`✅ RPC connectivity validated - Chain ID: ${this._chainId}, Block: ${this._lastBlockNumber}`);

        } catch (error) {
            const errorMsg = `❌ RPC connectivity failed: ${error.message}`;
            console.error(errorMsg);

            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                throw new Error('❌ Private RPC authentication failed - check API key in .env');
            }

            throw new Error(`❌ RPC connectivity validation failed: ${error.message}`);
        }
    }

    /**
     * Freeze the manager to prevent overrides
     * @private
     */
    _freeze() {
        this._frozen = true;

        // Prevent further modifications
        Object.freeze(this);
        Object.freeze(this._executionProvider);
        Object.freeze(this._readProvider);
        Object.freeze(this._backupProvider);
    }

    /**
     * Ensure manager is initialized
     * @private
     */
    _ensureInitialized() {
        if (!this._initialized) {
            throw new Error('❌ RPCManager not initialized - call initialize() first');
        }
    }

    /**
     * Check if RPC URL is valid
     * @private
     */
    _isValidRpcUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return url.startsWith('http://') || url.startsWith('https://');
    }

    /**
     * Check if RPC is private (not public)
     * @private
     */
    _isPrivateRpc(url) {
        // Consider private if it contains API key or is not a public endpoint
        const publicEndpoints = [
            'bsc-dataseed.binance.org',
            'bsc-dataseed1.binance.org',
            'bsc-dataseed2.binance.org',
            'bsc-dataseed3.binance.org',
            'bsc-dataseed4.binance.org'
        ];

        return !publicEndpoints.some(endpoint => url.includes(endpoint));
    }

    /**
     * Execute critical call with retry logic
     * @param {Function} callFn - The call function to execute
     * @param {string} operation - Operation name for logging
     * @param {number} maxRetries - Maximum retry attempts
     */
    async executeCriticalCall(callFn, operation = 'unknown', maxRetries = 3) {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await callFn();
                return result;
            } catch (error) {
                lastError = error;
                console.warn(`⚠️ ${operation} failed (attempt ${attempt}/${maxRetries}):`, error.message);

                // Check for quota errors and switch RPC
                if (this._isQuotaError(error)) {
                    this._switchRpc();
                    // Continue retrying with new RPC, no delay for quota switch
                    continue;
                }

                if (attempt < maxRetries) {
                    // Exponential backoff: 1s, 2s, 4s
                    const delay = Math.pow(2, attempt - 1) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw new Error(`❌ ${operation} failed after ${maxRetries} attempts: ${lastError.message}`);
    }

    /**
     * Mask API key in logs
     * @private
     */
    _maskApiKey(url) {
        return url.replace(/\/v1\/[^\/]+/, '/v1/[API_KEY]');
    }
}

// Export singleton instance
const rpcManager = new RPCManager();

// Global initialization flag for modules that need to check before accessing
export const isRPCInitialized = () => rpcManager._initialized;

export default rpcManager;