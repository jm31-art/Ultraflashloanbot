const { CACHE } = require('../config/performance');

class CacheManager {
    constructor() {
        this.priceCache = new Map();
        this.routeCache = new Map();
        this.tokenCache = new Map();
        
        // Cleanup intervals
        setInterval(() => this.cleanupCache(this.priceCache, CACHE.priceTTL), 5000);
        setInterval(() => this.cleanupCache(this.routeCache, CACHE.routeTTL), 30000);
    }

    setPrice(token, price) {
        if (this.priceCache.size >= CACHE.maxSize) {
            this.removeOldest(this.priceCache);
        }
        this.priceCache.set(token, {
            value: price,
            timestamp: Date.now()
        });
    }

    getPrice(token) {
        const cached = this.priceCache.get(token);
        if (cached && Date.now() - cached.timestamp < CACHE.priceTTL) {
            return cached.value;
        }
        return null;
    }

    setRoute(key, route) {
        if (this.routeCache.size >= CACHE.maxSize) {
            this.removeOldest(this.routeCache);
        }
        this.routeCache.set(key, {
            value: route,
            timestamp: Date.now()
        });
    }

    getRoute(key) {
        const cached = this.routeCache.get(key);
        if (cached && Date.now() - cached.timestamp < CACHE.routeTTL) {
            return cached.value;
        }
        return null;
    }

    setToken(address, tokenInfo) {
        this.tokenCache.set(address, tokenInfo);
    }

    getToken(address) {
        return this.tokenCache.get(address);
    }

    cleanupCache(cache, ttl) {
        const now = Date.now();
        for (const [key, data] of cache.entries()) {
            if (now - data.timestamp > ttl) {
                cache.delete(key);
            }
        }
    }

    removeOldest(cache) {
        let oldest = Infinity;
        let oldestKey = null;
        
        for (const [key, data] of cache.entries()) {
            if (data.timestamp < oldest) {
                oldest = data.timestamp;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            cache.delete(oldestKey);
        }
    }

    clear() {
        this.priceCache.clear();
        this.routeCache.clear();
        this.tokenCache.clear();
    }
}

module.exports = new CacheManager();
