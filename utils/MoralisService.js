import { initMoralis, getMoralis } from '../src/bootstrap/moralis.bootstrap.js';

/**
 * MoralisService - Wrapper for centralized Moralis initialization
 * Uses the singleton bootstrap to prevent multiple initializations
 */
class MoralisService {
    constructor() {
        this.initialized = false;
        this.apiKey = null;
    }

    /**
     * Initialize Moralis API using centralized bootstrap
     * @param {string} apiKey - Moralis API key
     * @returns {Promise<Object>} Moralis client instance
     */
    async initialize(apiKey) {
        if (this.initialized) {
            console.log("ℹ️ Moralis already initialized - skipping");
            return getMoralis();
        }

        if (!apiKey) {
            throw new Error("Moralis API key is required");
        }

        try {
            console.log("🔄 Initializing Moralis API via bootstrap...");
            await initMoralis();

            this.initialized = true;
            this.apiKey = apiKey;

            console.log("✅ Moralis API initialized successfully via bootstrap");
            return getMoralis();

        } catch (error) {
            console.error("❌ Failed to initialize Moralis:", error.message);
            throw error;
        }
    }

    /**
     * Get Moralis client instance
     * @returns {Object|null} Moralis client or null if not initialized
     */
    getClient() {
        if (!this.initialized) {
            return null;
        }
        return getMoralis();
    }

    /**
     * Check if Moralis is initialized
     * @returns {boolean} True if initialized
     */
    isInitialized() {
        return this.initialized;
    }

    /**
     * Reset Moralis state (for testing only)
     */
    reset() {
        this.initialized = false;
        this.apiKey = null;
    }
}

// Export singleton instance
const moralisService = new MoralisService();

export default moralisService;