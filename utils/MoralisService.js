const Moralis = require("moralis").default;

/**
 * MoralisService - Singleton for Moralis API initialization
 * Prevents multiple initializations and [C0009] errors
 */
class MoralisService {
    constructor() {
        this.initialized = false;
        this.moralisClient = null;
        this.apiKey = null;
    }

    /**
     * Initialize Moralis API (singleton pattern)
     * @param {string} apiKey - Moralis API key
     * @returns {Promise<Object>} Moralis client instance
     */
    async initialize(apiKey) {
        if (this.initialized) {
            console.log("ℹ️ Moralis already initialized - skipping");
            return this.moralisClient;
        }

        if (!apiKey) {
            throw new Error("Moralis API key is required");
        }

        try {
            console.log("🔄 Initializing Moralis API...");
            await Moralis.start({ apiKey });

            this.initialized = true;
            this.apiKey = apiKey;
            this.moralisClient = Moralis;

            console.log("✅ Moralis API initialized successfully");
            return this.moralisClient;

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
        return this.moralisClient;
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
        this.moralisClient = null;
        this.apiKey = null;
    }
}

// Export singleton instance
const moralisService = new MoralisService();

module.exports = moralisService;