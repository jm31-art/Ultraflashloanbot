const { CACHE } = require('../config/performance');

class PriceImpactAnalyzer {
    constructor() {
        this.priceCache = new Map();
    }

    async analyzePriceImpact(token, amount, dex) {
        const cacheKey = `${token}-${dex}`;
        
        // Check cache first
        if (this.priceCache.has(cacheKey)) {
            const cached = this.priceCache.get(cacheKey);
            if (Date.now() - cached.timestamp < CACHE.priceTTL) {
                return cached.impact;
            }
        }

        // Calculate price impact
        const impact = await this.calculatePriceImpact(token, amount, dex);
        
        // Cache the result
        this.priceCache.set(cacheKey, {
            impact,
            timestamp: Date.now()
        });

        return impact;
    }

    async calculatePriceImpact(token, amount, dex) {
        // Implement specific DEX price impact calculation
        // This should be customized based on the DEX's pricing model
        const basePrice = await dex.getPrice(token);
        const executionPrice = await dex.getExecutionPrice(token, amount);
        
        const impact = Math.abs((executionPrice - basePrice) / basePrice * 100);
        return impact;
    }

    isAcceptableImpact(impact) {
        return impact <= parseFloat(process.env.MAX_PRICE_IMPACT || '1.0');
    }
}

module.exports = PriceImpactAnalyzer;
