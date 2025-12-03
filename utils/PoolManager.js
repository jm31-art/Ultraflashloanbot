const { ethers } = require('ethers');
const fs = require('fs');

class PoolManager {
    constructor(provider) {
        this.provider = provider;
        this.poolCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    async getPoolData(poolAddress) {
        try {
            // Check cache first
            const cached = this.poolCache.get(poolAddress);
            if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
                return cached.data;
            }

            // For PancakeSwap V2 style pools
            const poolContract = new ethers.Contract(
                poolAddress,
                [
                    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
                    'function token0() external view returns (address)',
                    'function token1() external view returns (address)',
                    'function totalSupply() external view returns (uint256)'
                ],
                this.provider
            );

            // Get basic pool data
            const [reserves, token0, token1, totalSupply] = await Promise.all([
                poolContract.getReserves(),
                poolContract.token0(),
                poolContract.token1(),
                poolContract.totalSupply().catch(() => ethers.BigNumber.from(0))
            ]);

            // Calculate total liquidity (simplified)
            const reserve0USD = this.estimateTokenValue(token0, reserves.reserve0);
            const reserve1USD = this.estimateTokenValue(token1, reserves.reserve1);
            const totalLiquidity = reserve0USD + reserve1USD;

            // Estimate 24h volume (simplified - in production use subgraph or API)
            const volume24h = this.estimateVolume(token0, token1, totalLiquidity);

            // Estimate fee (0.3% for most V2 pools)
            const fee = 0.003;

            const poolData = {
                address: poolAddress,
                token0,
                token1,
                reserve0: reserves.reserve0,
                reserve1: reserves.reserve1,
                totalLiquidity,
                volume24h,
                fee,
                lastUpdate: reserves.blockTimestampLast
            };

            // Cache the result
            this.poolCache.set(poolAddress, {
                data: poolData,
                timestamp: Date.now()
            });

            return poolData;

        } catch (error) {
            console.error(`Error getting pool data for ${poolAddress}:`, error.message);
            return null;
        }
    }

    estimateTokenValue(tokenAddress, amount) {
        // Simplified token value estimation
        const tokenPrices = {
            '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c': 300, // WBNB
            '0x55d398326f99059fF775485246999027B3197955': 1,   // USDT
            '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d': 1,   // USDC
            '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56': 1,   // BUSD
            '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c': 30000, // BTCB
            '0x2170Ed0880ac9A755fd29B2688956BD959F933F8': 2000,   // ETH
        };

        const price = tokenPrices[tokenAddress.toLowerCase()] || 1;
        return (parseFloat(ethers.utils.formatEther(amount)) * price);
    }

    estimateVolume(token0, token1, totalLiquidity) {
        // Simplified volume estimation based on liquidity
        // In production, use historical data or subgraph
        return totalLiquidity * 0.1; // Assume 10% of liquidity as daily volume
    }

    async findBestPoolsForPair(tokenA, tokenB, dexes = ['PancakeSwap', 'ApeSwap', 'SushiSwap']) {
        const poolAddresses = JSON.parse(fs.readFileSync('./config/pool_addresses.json', 'utf8'));
        const candidatePools = [];

        for (const dex of dexes) {
            const dexPools = poolAddresses[dex] || {};
            const pairKey = Object.keys(dexPools).find(key =>
                key.includes(tokenA.split('-')[0]) && key.includes(tokenB.split('-')[0])
            );

            if (pairKey && dexPools[pairKey]) {
                const poolData = await this.getPoolData(dexPools[pairKey]);
                if (poolData) {
                    candidatePools.push({
                        dex,
                        pair: pairKey,
                        address: dexPools[pairKey],
                        ...poolData
                    });
                }
            }
        }

        // Sort by liquidity and volume
        return candidatePools.sort((a, b) => {
            const scoreA = (a.totalLiquidity * 0.7) + (a.volume24h * 0.3);
            const scoreB = (b.totalLiquidity * 0.7) + (b.volume24h * 0.3);
            return scoreB - scoreA;
        });
    }

    async getOptimalFlashloanPool(tokenAddress, amount) {
        // Find pools that can support the flashloan amount
        const poolAddresses = JSON.parse(fs.readFileSync('./config/pool_addresses.json', 'utf8'));
        const suitablePools = [];

        for (const [dex, pools] of Object.entries(poolAddresses)) {
            for (const [pair, address] of Object.entries(pools)) {
                const poolData = await this.getPoolData(address);
                if (poolData) {
                    // Check if pool has enough liquidity for the token
                    const token0Liquidity = this.estimateTokenValue(poolData.token0, poolData.reserve0);
                    const token1Liquidity = this.estimateTokenValue(poolData.token1, poolData.reserve1);

                    // If the requested token is in this pool and has sufficient liquidity
                    if ((poolData.token0.toLowerCase() === tokenAddress.toLowerCase() && token0Liquidity > amount * 1.1) ||
                        (poolData.token1.toLowerCase() === tokenAddress.toLowerCase() && token1Liquidity > amount * 1.1)) {
                        suitablePools.push({
                            dex,
                            pair,
                            address,
                            ...poolData,
                            availableLiquidity: Math.max(token0Liquidity, token1Liquidity)
                        });
                    }
                }
            }
        }

        // Return pool with highest liquidity
        return suitablePools.sort((a, b) => b.availableLiquidity - a.availableLiquidity)[0];
    }

    async analyzePoolEfficiency(poolAddress) {
        const poolData = await this.getPoolData(poolAddress);
        if (!poolData) return null;

        // Calculate efficiency metrics
        const liquidityUtilization = poolData.volume24h / poolData.totalLiquidity;
        const impermanentLoss = this.calculateImpermanentLoss(poolData);
        const feeIncome = poolData.volume24h * poolData.fee;

        return {
            address: poolAddress,
            liquidityUtilization,
            impermanentLoss,
            feeIncome,
            efficiency: (feeIncome / poolData.totalLiquidity) * 100, // Annualized fee yield
            recommendation: this.getPoolRecommendation(liquidityUtilization, impermanentLoss)
        };
    }

    calculateImpermanentLoss(poolData) {
        // Simplified IL calculation
        // In production, use price change data
        return Math.random() * 0.1; // 0-10% IL
    }

    getPoolRecommendation(utilization, il) {
        if (utilization > 0.5 && il < 0.05) return 'EXCELLENT';
        if (utilization > 0.3 && il < 0.1) return 'GOOD';
        if (utilization > 0.1) return 'FAIR';
        return 'POOR';
    }

    clearCache() {
        this.poolCache.clear();
    }

    getCacheStats() {
        return {
            cachedPools: this.poolCache.size,
            cacheSize: JSON.stringify([...this.poolCache]).length
        };
    }
}

module.exports = PoolManager;
