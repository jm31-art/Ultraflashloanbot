// Configuration for optimal performance
module.exports = {
    // Gas optimization settings
    GAS_SETTINGS: {
        maxGasPrice: '50000000000', // 50 Gwei
        minGasPrice: '5000000000',  // 5 Gwei
        gasLimit: 300000
    },
    
    // Network settings
    NETWORK: {
        maxParallelCalls: 5,
        retryAttempts: 3,
        timeoutMS: 30000
    },
    
    // Cache settings
    CACHE: {
        priceTTL: 1000, // 1 second price cache
        routeTTL: 30000, // 30 seconds route cache
        maxSize: 1000   // maximum cache entries
    },
    
    // Arbitrage settings
    ARBITRAGE: {
        minProfitUSD: '10',    // Minimum profit in USD
        maxSlippage: '0.5',    // Maximum slippage percentage
        maxRouteLength: 3      // Maximum number of hops
    }
}
