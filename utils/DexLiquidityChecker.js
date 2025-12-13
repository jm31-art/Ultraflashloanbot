const { ethers } = require("ethers");

// ABIs
const UNISWAP_V2_PAIR_ABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

const UNISWAP_V3_POOL_ABI = [
    "function liquidity() external view returns (uint128)",
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
];

const PANCAKE_V3_POOL_ABI = [
    "function liquidity() external view returns (uint128)",
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
];

const BALANCER_VAULT_ABI = [
    "function getPoolTokens(bytes32 poolId) external view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)"
];

const CURVE_POOL_ABI = [
    "function get_virtual_price() external view returns (uint256)",
    "function balances(uint256) external view returns (uint256)"
];

class DexLiquidityChecker {
    constructor(provider) {
        this.provider = provider;
        this.poolAddresses = require('../config/pool_addresses.json');
        this.tokenPrices = {
            '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c': 300, // WBNB
            '0x55d398326f99059fF775485246999027B3197955': 1,   // USDT
            '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d': 1,   // USDC
            '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56': 1,   // BUSD
            '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c': 30000, // BTCB
            '0x2170Ed0880ac9A755fd29B2688956BD959F933F8': 2000,   // ETH
            '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82': 2.5,    // CAKE
            '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3': 1,     // DAI
        };
    }

    async checkDexLiquidity(dexName, tokenSymbol, amount) {
        try {
            // Get pool address for the token pair
            const poolAddress = this.getPoolAddress(dexName, tokenSymbol);

            if (!poolAddress) {
                console.log(`No pool address found for ${tokenSymbol} on ${dexName}`);
                return null;
            }

            // Check liquidity based on DEX type
            if (dexName.includes('V3')) {
                return await this.checkV3Liquidity(poolAddress, tokenSymbol, amount);
            } else {
                return await this.checkV2Liquidity(poolAddress, tokenSymbol, amount);
            }
        } catch (error) {
            console.error(`Error checking liquidity for ${tokenSymbol} on ${dexName}:`, error.message);
            return null;
        }
    }

    getPoolAddress(dexName, tokenSymbol) {
        try {
            // Map dexName to config key
            const dexMap = {
                'PancakeSwap': 'PancakeV2',
                'PancakeSwapV2': 'PancakeV2',
                'PANCAKESWAP': 'PancakeV2',
                'ApeSwap': 'ApeSwap',
                'SushiSwap': 'SushiSwap',
                'JulSwap': 'JulSwap',
                'PancakeSwapV3': 'PancakeV3',
                'PancakeV3': 'PancakeV3'
            };

            const configKey = dexMap[dexName] || dexName;
            const dexPools = this.poolAddresses[configKey];

            if (!dexPools) {
                console.log(`No pool configuration found for DEX: ${dexName}`);
                return null;
            }

            // Find a pool that contains the token
            const tokenAddress = this.getTokenAddress(tokenSymbol);
            if (!tokenAddress) {
                console.log(`Unknown token symbol: ${tokenSymbol}`);
                return null;
            }

            // Look for pools containing this token
            for (const [pair, address] of Object.entries(dexPools)) {
                const [token0, token1] = pair.split('/');
                const token0Address = this.getTokenAddress(token0);
                const token1Address = this.getTokenAddress(token1);

                if (token0Address === tokenAddress || token1Address === tokenAddress) {
                    return address;
                }
            }

            console.log(`No pool found for ${tokenSymbol} on ${dexName}`);
            return null;
        } catch (error) {
            console.error(`Error getting pool address for ${tokenSymbol} on ${dexName}:`, error.message);
            return null;
        }
    }

    async checkV2Liquidity(poolAddress, tokenSymbol, amount) {
        try {
            const pair = new ethers.Contract(poolAddress, UNISWAP_V2_PAIR_ABI, this.provider);
            const reserves = await pair.getReserves();
            const token0 = await pair.token0();
            const token1 = await pair.token1();

            // Determine which reserve corresponds to our token
            const tokenAddress = this.getTokenAddress(tokenSymbol);
            const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();

            const reserve = isToken0 ? reserves.reserve0 : reserves.reserve1;
            const reserveUSD = this.estimateReserveValue(tokenAddress, reserve);

            // Calculate available liquidity (90% of reserves for safety)
            const available = reserve.mul(90).div(100);
            const availableUSD = this.estimateReserveValue(tokenAddress, available);

            return {
                available: available,
                availableUSD: availableUSD,
                totalReserve: reserve,
                totalReserveUSD: reserveUSD,
                sufficient: availableUSD >= amount
            };
        } catch (error) {
            console.error("Error checking V2 liquidity:", error.message);
            return null;
        }
    }

    async checkV3Liquidity(poolAddress, tokenSymbol, amount) {
        try {
            const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, this.provider);
            const liquidity = await pool.liquidity();

            // Estimate USD value (simplified - in production use proper calculations)
            const estimatedUSD = parseFloat(ethers.formatEther(liquidity)) * 1000; // Rough estimate

            return {
                available: liquidity,
                availableUSD: estimatedUSD,
                totalLiquidity: liquidity,
                sufficient: estimatedUSD >= amount
            };
        } catch (error) {
            console.error("Error checking V3 liquidity:", error.message);
            return null;
        }
    }

    getTokenAddress(symbol) {
        const tokenMap = {
            'WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
            'USDT': '0x55d398326f99059fF775485246999027B3197955',
            'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
            'BUSD': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
            'BTCB': '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
            'ETH': '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
            'CAKE': '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
            'DAI': '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3'
        };
        return tokenMap[symbol];
    }

    estimateReserveValue(tokenAddress, reserve) {
        const price = this.tokenPrices[tokenAddress.toLowerCase()] || 1;
        const amount = parseFloat(ethers.formatEther(reserve));
        return amount * price;
    }

    async getUniswapV3Liquidity(tokenAddress) {
        try {
            // This would normally query the Uniswap V3 factory for pool address
            // For testing, we'll simulate liquidity check
            return {
                available: ethers.parseEther("1000000"),
                fee: 0.0005 // 0.05%
            };
        } catch (error) {
            console.warn("Error checking Uniswap V3 liquidity:", error.message);
            return null;
        }
    }

    async getPancakeV3Liquidity(tokenAddress) {
        try {
            // This would normally query the PancakeSwap V3 factory for pool address
            // For testing, we'll simulate liquidity check
            return {
                available: ethers.parseEther("800000"),
                fee: 0.0002 // 0.02%
            };
        } catch (error) {
            console.warn("Error checking PancakeSwap V3 liquidity:", error.message);
            return null;
        }
    }

    async getBalancerLiquidity(tokenAddress) {
        try {
            // This would normally query Balancer vault for pool tokens and balances
            // For testing, we'll simulate liquidity check
            return {
                available: ethers.parseEther("500000"),
                fee: 0 // Balancer has no protocol fee
            };
        } catch (error) {
            console.warn("Error checking Balancer liquidity:", error.message);
            return null;
        }
    }

    async getCurveLiquidity(tokenAddress) {
        try {
            // This would normally query Curve pool for balances and virtual price
            // For testing, we'll simulate liquidity check
            return {
                available: ethers.parseEther("1200000"),
                fee: 0.0004 // 0.04%
            };
        } catch (error) {
            console.warn("Error checking Curve liquidity:", error.message);
            return null;
        }
    }
}

module.exports = DexLiquidityChecker;
