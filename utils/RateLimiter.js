const { NetworkError } = require('./CustomError');

class RateLimiter {
    constructor(options = {}) {
        this.maxRequests = options.maxRequests || 100; // requests per window
        this.windowMs = options.windowMs || 60000; // 1 minute window
        this.requests = new Map(); // endpoint -> timestamps array
        this.globalRequests = []; // global request timestamps
        this.blockDuration = options.blockDuration || 300000; // 5 minutes block
        this.blockedEndpoints = new Map(); // endpoint -> block expiry
    }

    canMakeRequest(endpoint = 'global') {
        const now = Date.now();

        // Check if endpoint is blocked
        const blockExpiry = this.blockedEndpoints.get(endpoint);
        if (blockExpiry && now < blockExpiry) {
            throw new NetworkError(
                `Endpoint ${endpoint} is rate limited until ${new Date(blockExpiry).toISOString()}`,
                endpoint,
                429
            );
        }

        // Clean old requests
        this._cleanOldRequests(endpoint, now);

        // Check request count
        const requestTimestamps = endpoint === 'global' ? this.globalRequests : this.requests.get(endpoint) || [];

        if (requestTimestamps.length >= this.maxRequests) {
            // Block the endpoint
            const blockExpiry = now + this.blockDuration;
            this.blockedEndpoints.set(endpoint, blockExpiry);

            throw new NetworkError(
                `Rate limit exceeded for ${endpoint}. Blocked until ${new Date(blockExpiry).toISOString()}`,
                endpoint,
                429
            );
        }

        return true;
    }

    recordRequest(endpoint = 'global') {
        const now = Date.now();

        if (endpoint === 'global') {
            this.globalRequests.push(now);
        } else {
            if (!this.requests.has(endpoint)) {
                this.requests.set(endpoint, []);
            }
            this.requests.get(endpoint).push(now);
        }
    }

    async makeRequest(endpoint, requestFn, options = {}) {
        const maxRetries = options.maxRetries || 3;
        const baseDelay = options.baseDelay || 1000; // 1 second

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Check rate limit
                this.canMakeRequest(endpoint);

                // Make the request
                const result = await requestFn();

                // Record successful request
                this.recordRequest(endpoint);

                return result;

            } catch (error) {
                if (error.code === 'NETWORK_ERROR' && error.details.statusCode === 429) {
                    // Rate limited, wait and retry
                    if (attempt < maxRetries) {
                        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
                        console.warn(`Rate limited on ${endpoint}, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                }

                // Record failed request
                this.recordRequest(endpoint);

                throw error;
            }
        }
    }

    _cleanOldRequests(endpoint, now) {
        const windowStart = now - this.windowMs;

        if (endpoint === 'global') {
            this.globalRequests = this.globalRequests.filter(timestamp => timestamp > windowStart);
        } else {
            const endpointRequests = this.requests.get(endpoint) || [];
            const filtered = endpointRequests.filter(timestamp => timestamp > windowStart);
            if (filtered.length === 0) {
                this.requests.delete(endpoint);
            } else {
                this.requests.set(endpoint, filtered);
            }
        }

        // Clean expired blocks
        for (const [blockedEndpoint, expiry] of this.blockedEndpoints.entries()) {
            if (now > expiry) {
                this.blockedEndpoints.delete(blockedEndpoint);
            }
        }
    }

    getStats(endpoint = null) {
        const now = Date.now();

        if (endpoint) {
            const requestTimestamps = this.requests.get(endpoint) || [];
            const recentRequests = requestTimestamps.filter(timestamp => now - timestamp < this.windowMs);
            const isBlocked = this.blockedEndpoints.has(endpoint);

            return {
                endpoint,
                requestsInWindow: recentRequests.length,
                maxRequests: this.maxRequests,
                windowMs: this.windowMs,
                isBlocked,
                blockExpiry: isBlocked ? this.blockedEndpoints.get(endpoint) : null
            };
        }

        // Global stats
        const recentGlobalRequests = this.globalRequests.filter(timestamp => now - timestamp < this.windowMs);
        const blockedEndpoints = Array.from(this.blockedEndpoints.entries()).map(([ep, expiry]) => ({
            endpoint: ep,
            blockExpiry: expiry
        }));

        return {
            globalRequestsInWindow: recentGlobalRequests.length,
            maxRequests: this.maxRequests,
            windowMs: this.windowMs,
            blockedEndpoints,
            activeEndpoints: Array.from(this.requests.keys())
        };
    }

    async waitForSlot(endpoint = 'global') {
        while (true) {
            try {
                this.canMakeRequest(endpoint);
                return; // Slot available
            } catch (error) {
                if (error.code === 'NETWORK_ERROR' && error.details.statusCode === 429) {
                    // Rate limited, wait before checking again
                    const waitTime = this.windowMs / this.maxRequests; // Conservative wait time
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
                throw error; // Re-throw other errors
            }
        }
    }

    reset(endpoint = null) {
        if (endpoint) {
            this.requests.delete(endpoint);
            this.blockedEndpoints.delete(endpoint);
        } else {
            this.requests.clear();
            this.globalRequests = [];
            this.blockedEndpoints.clear();
        }
    }

    // Specific rate limiters for common services
    static createCoinGeckoLimiter() {
        return new RateLimiter({
            maxRequests: 30, // CoinGecko free tier: 30 requests/minute
            windowMs: 60000,
            blockDuration: 300000
        });
    }

    static createInfuraLimiter() {
        return new RateLimiter({
            maxRequests: 100000, // Infura free tier: 100k requests/day
            windowMs: 86400000, // 24 hours
            blockDuration: 3600000 // 1 hour block
        });
    }

    static createDEXLimiter() {
        return new RateLimiter({
            maxRequests: 1000, // Conservative limit for DEX RPC calls
            windowMs: 60000,
            blockDuration: 300000
        });
    }

    static createAPILimiter() {
        return new RateLimiter({
            maxRequests: 100, // Conservative limit for external APIs
            windowMs: 60000,
            blockDuration: 300000
        });
    }
}

module.exports = RateLimiter;
