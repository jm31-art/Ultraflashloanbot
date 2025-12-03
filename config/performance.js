// Configuration for optimal performance - OPTIMIZED FOR HIGHER RETURNS
module.exports = {
    // Gas optimization settings - DYNAMIC PRICING ENABLED
    GAS_SETTINGS: {
        maxGasPrice: '80000000000', // 80 Gwei (increased for faster execution)
        minGasPrice: '3000000000',  // 3 Gwei (decreased for more opportunities)
        gasLimit: 250000,            // Reduced gas limit for efficiency
        dynamicPricing: true,        // Enable dynamic gas pricing
        batchSize: 3                 // Smaller batches for faster processing
    },

    // Network settings - INCREASED PARALLELISM
    NETWORK: {
        maxParallelCalls: 8,         // Increased from 5
        retryAttempts: 5,            // Increased retries
        timeoutMS: 20000             // Faster timeout
    },

    // Cache settings - OPTIMIZED FOR SPEED
    CACHE: {
        priceTTL: 500,               // Faster price updates (0.5s)
        routeTTL: 15000,             // Shorter route cache (15s)
        maxSize: 2000                // Larger cache for more data
    },

    // Arbitrage settings - LOWER THRESHOLDS FOR MORE OPPORTUNITIES
    ARBITRAGE: {
        minProfitUSD: '8',           // Reduced from $10
        maxSlippage: '0.3',          // Tighter slippage control
        maxRouteLength: 4,           // Allow longer routes
        enableTriangular: true,      // Enable triangular arbitrage
        minLiquidityThreshold: '5000' // Lower liquidity requirement
    }
}
