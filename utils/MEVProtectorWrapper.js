const SecureMEVProtector = require('./SecureMEVProtector');
const crypto = require('crypto');
const FlashbotsBundler = require('./FlashbotsBundler');

class MEVProtectorWrapper {
    constructor(provider) {
        this.provider = provider;
        this.secureProtector = null;
        this.sessionId = null;
        this.isInitialized = false;
        this.flashbotsBundler = null;
        this.deprecationWarningShown = false;
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            // Generate secure session ID
            this.sessionId = crypto.randomBytes(32).toString('hex');

            // Initialize secure MEV protector with options
            this.secureProtector = new SecureMEVProtector(this.provider, {
                timeoutMs: 10000,
                maxRetries: 3,
                sandboxed: true
            });
            this.isInitialized = true;

            // Show deprecation warning
            if (!this.deprecationWarningShown) {
                console.warn('WARNING: MEVProtectorWrapper is deprecated. Please use SecureMEVProtector directly for better security.');
                this.deprecationWarningShown = true;
            }

        } catch (error) {
            console.error('MEV Protector wrapper initialization failed:', error);
            throw error;
        }
    }

    async analyze_mempool(pendingTx) {
        try {
            await this.initialize();

            const txData = {
                hash: pendingTx.hash,
                from: pendingTx.from,
                to: pendingTx.to,
                value: pendingTx.value?.toString(),
                gasPrice: pendingTx.gasPrice?.toString(),
                maxFeePerGas: pendingTx.maxFeePerGas?.toString(),
                maxPriorityFeePerGas: pendingTx.maxPriorityFeePerGas?.toString(),
                input: pendingTx.data
            };

            // Delegate to secure implementation
            return await this.secureProtector.analyzeMempool(txData);
        } catch (error) {
            console.error('MEV analysis failed:', error);
            // Return safe default values if analysis fails
            return {
                sandwich_risk: 0,
                frontrun_risk: 0,
                gas_manipulation: 0,
                flashbots_risk: 0,
                total_risk: 0
            };
        }
    }

    async get_safe_gas_price(baseGas) {
        try {
            await this.initialize();

            // Delegate to secure implementation
            return await this.secureProtector.getSafeGasPrice(baseGas);
        } catch (error) {
            console.error('Safe gas price calculation failed:', error);
            // Return a safe default: 20% above base gas price
            return BigInt(Math.floor(Number(baseGas) * 1.2));
        }
    }

    async getProtectionStrategy(transaction) {
        try {
            await this.initialize();

            // Delegate to secure implementation
            const result = await this.secureProtector.getProtectionStrategy(transaction);

            // Initialize Flashbots bundler if Flashbots is recommended
            if (result.useFlashbots && !this.flashbotsBundler) {
                this.flashbotsBundler = new FlashbotsBundler(
                    this.provider,
                    null, // Will be set by caller
                    'mainnet'
                );
            }

            return result;
        } catch (error) {
            console.error('Protection strategy recommendation failed:', error);
            // Return safe default strategy
            return {
                safeToExecute: true,
                useFlashbots: false,
                increasedGasPrice: transaction.gasPrice,
                detectedThreats: []
            };
        }
    }

    async createFlashbotsBundle(arbitrageTx, signer) {
        if (!this.flashbotsBundler) {
            this.flashbotsBundler = new FlashbotsBundler(
                this.provider,
                signer,
                'mainnet'
            );
        }

        // Create bundle for arbitrage transaction
        const bundle = await this.flashbotsBundler.createArbitrageBundle(arbitrageTx);
        return bundle;
    }

    async submitFlashbotsBundle(bundle, targetBlockNumber) {
        if (!this.flashbotsBundler) {
            throw new Error('Flashbots bundler not initialized');
        }

        return await this.flashbotsBundler.submitBundle(bundle, targetBlockNumber);
    }

    cleanup() {
        if (this.secureProtector) {
            this.secureProtector.cleanup();
        }
        this.isInitialized = false;
    }
}

module.exports = MEVProtectorWrapper;
