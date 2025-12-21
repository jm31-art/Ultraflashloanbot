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

        // Configuration
        this._rpcUrl = null;
        this._isPrivate = false;
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
        // PRIMARY: Private RPC (NodeReal)
        const privateRpc = process.env.BSC_RPC_URL || process.env.RPC_URL;

        if (privateRpc && this._isValidRpcUrl(privateRpc)) {
            this._rpcUrl = privateRpc;
            this._isPrivate = this._isPrivateRpc(privateRpc);
            return;
        }

        // SECONDARY: Backup private RPC (if configured)
        const backupRpc = process.env.BSC_RPC_BACKUP_URL;
        if (backupRpc && this._isValidRpcUrl(backupRpc)) {
            this._rpcUrl = backupRpc;
            this._isPrivate = this._isPrivateRpc(backupRpc);
            console.log('⚠️ Using backup private RPC');
            return;
        }

        // TERTIARY: Public RPC (scan-only mode)
        this._rpcUrl = 'https://bsc-dataseed.binance.org/';
        this._isPrivate = false;
        console.log('⚠️ No private RPC available - entering scan-only mode');
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
     * Validate RPC connectivity
     * @private
     */
    async _validateConnectivity() {
        try {
            console.log('🔍 Validating RPC connectivity...');

            // Test chain ID
            this._chainId = await this._readProvider.getNetwork().then(network => network.chainId);

            // Test block number
            this._lastBlockNumber = await this._readProvider.getBlockNumber();

            // Validate BSC mainnet (allow both mainnet and testnet)
            if (this._chainId !== 56 && this._chainId !== 97) { // BSC mainnet or testnet
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