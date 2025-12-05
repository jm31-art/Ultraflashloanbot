const { ethers } = require('ethers');

class LiquidityChecker {
    constructor(provider) {
        this.provider = provider;
        this.minStableLiquidity = ethers.parseUnits('1000000', 18); // $1M minimum for stables
        this.dexFactories = {
            PancakeSwap: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
            ApeSwap: "0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6",
            BiSwap: "0x858E3312ed3A876947EA49d572A7C42DE08af7EE",
            MDEX: "0x3CD1C46068dAEa5Ebb0d3f55F6915B10648062B8",
            UniswapV2: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
            SushiSwap: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4"
        };

        this.pairABI = [
            "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
            "function token0() external view returns (address)",
            "function token1() external view returns (address)",
            "function totalSupply() external view returns (uint256)"
        ];

        this.factoryABI = [
            "function getPair(address tokenA, address tokenB) external view returns (address pair)"
        ];
    }

    async checkPairLiquidity(dex, tokenA, tokenB) {
        try {
            const pairAddress = await this.getPairAddress(dex, tokenA, tokenB);
            if (!pairAddress || pairAddress === '0x0000000000000000000000000000000000000000') {
                return {
                    reserveA: ethers.BigNumber.from(0),
                    reserveB: ethers.BigNumber.from(0),
                    totalLiquidity: ethers.BigNumber.from(0),
                    pairAddress: null
                };
            }

            const pair = new ethers.Contract(pairAddress, this.pairABI, this.provider);
            const [reserve0, reserve1] = await pair.getReserves();
            const token0 = await pair.token0();

            // Determine which reserve belongs to which token
            const reserveA = token0.toLowerCase() === tokenA.toLowerCase() ? reserve0 : reserve1;
            const reserveB = token0.toLowerCase() === tokenA.toLowerCase() ? reserve1 : reserve0;

            // Calculate total liquidity in USD (simplified - would need price feeds in production)
            const totalLiquidity = this.calculateUSDValue(reserveA, reserveB, tokenA, tokenB);

            return {
                reserveA: reserveA,
                reserveB: reserveB,
                totalLiquidity: totalLiquidity,
                pairAddress: pairAddress
            };
        } catch (error) {
            console.error(`Error checking liquidity for ${dex} ${tokenA}-${tokenB}:`, error.message);
            return {
                reserveA: ethers.BigNumber.from(0),
                reserveB: ethers.BigNumber.from(0),
                totalLiquidity: ethers.BigNumber.from(0),
                pairAddress: null
            };
        }
    }

    async getPairAddress(dex, tokenA, tokenB) {
        try {
            const factoryAddress = this.dexFactories[dex];
            if (!factoryAddress) {
                throw new Error(`Factory address not found for DEX: ${dex}`);
            }

            const factory = new ethers.Contract(factoryAddress, this.factoryABI, this.provider);
            return await factory.getPair(tokenA, tokenB);
        } catch (error) {
            console.error(`Error getting pair address for ${dex}:`, error.message);
            return null;
        }
    }

    async findDeepestLiquidityPool(tokenA, tokenB) {
        const dexes = Object.keys(this.dexFactories);
        const liquidityResults = [];

        // Check liquidity across all DEXes in parallel
        const promises = dexes.map(async (dex) => {
            const liquidity = await this.checkPairLiquidity(dex, tokenA, tokenB);
            return {
                dex: dex,
                ...liquidity
            };
        });

        const results = await Promise.all(promises);

        // Filter out pools with zero liquidity and sort by total liquidity
        const validPools = results.filter(result => result.totalLiquidity.gt(0));
        const sortedPools = validPools.sort((a, b) => {
            if (a.totalLiquidity.gt(b.totalLiquidity)) return -1;
            if (a.totalLiquidity.lt(b.totalLiquidity)) return 1;
            return 0;
        });

        return {
            deepestPool: sortedPools[0] || null,
            allPools: sortedPools,
            totalDexes: dexes.length,
            validPools: validPools.length
        };
    }

    async checkDODOLiquidity(token) {
        const dodoPools = {
            USDT: "0x5BDCf4962FDED6B7156E710400F4C4c031f600dC",
            USDC: "0x6098A5638d8D7e9Ed2f952d35B2b67c34EC6B476",
            BUSD: "0x5BDCf4962FDED6B7156E710400F4C4c031f600dC"
        };

        const poolAddress = dodoPools[token];
        if (!poolAddress) {
            return ethers.BigNumber.from(0);
        }

        try {
            const pool = new ethers.Contract(
                poolAddress,
                ["function getLiquidity(address) view returns (uint256)"],
                this.provider
            );
            return await pool.getLiquidity(token);
        } catch (error) {
            console.error(`Error checking DODO liquidity for ${token}:`, error.message);
            return ethers.BigNumber.from(0);
        }
    }

    async isLiquiditySufficient(dex, tokenA, tokenB, amount) {
        const liquidity = await this.checkPairLiquidity(dex, tokenA, tokenB);

        // For stablecoins, require higher liquidity
        const isStablePair = this.isStablecoin(tokenA) && this.isStablecoin(tokenB);
        const requiredLiquidity = isStablePair ?
            this.minStableLiquidity :
            ethers.parseUnits('100000', 18); // $100k for non-stables

        // Check if liquidity is at least 10x the trade amount
        const minLiquidity = ethers.parseUnits(amount.toString(), 18).mul(10);
        return liquidity.totalLiquidity.gte(minLiquidity) &&
               liquidity.totalLiquidity.gte(requiredLiquidity);
    }

    isStablecoin(token) {
        const stables = ['USDT', 'USDC', 'BUSD', 'DAI', 'FRAX'];
        return stables.some(stable => token.toLowerCase().includes(stable.toLowerCase()));
    }

    calculateUSDValue(reserveA, reserveB, tokenA, tokenB) {
        // Simplified calculation - in production, use price oracles
        // This is a placeholder that returns the sum of reserves
        return reserveA.add(reserveB);
    }

    async getPoolDepthAnalysis(tokenA, tokenB) {
        const analysis = await this.findDeepestLiquidityPool(tokenA, tokenB);

        const depthAnalysis = {
            tokenPair: `${tokenA}-${tokenB}`,
            deepestPool: analysis.deepestPool,
            liquidityDistribution: analysis.allPools.map(pool => ({
                dex: pool.dex,
                liquidity: ethers.formatEther(pool.totalLiquidity),
                percentage: analysis.deepestPool ?
                    (pool.totalLiquidity.mul(100).div(analysis.deepestPool.totalLiquidity)).toString() + '%' : '0%'
            })),
            coverage: `${analysis.validPools}/${analysis.totalDexes} DEXes have liquidity`,
            recommendation: analysis.deepestPool ? `Use ${analysis.deepestPool.dex} for best liquidity` : 'No liquidity found'
        };

        return depthAnalysis;
    }
}

module.exports = LiquidityChecker;
