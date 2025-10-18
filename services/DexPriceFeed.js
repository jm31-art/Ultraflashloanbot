const { ethers } = require('ethers');
const axios = require('axios');
const poolAddresses = require('../config/pool_addresses.json');

class DexPriceFeed {
    constructor(provider) {
        this.provider = provider;
        this.UniswapV3PoolABI = [
            "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
            "function token0() external view returns (address)",
            "function token1() external view returns (address)"
        ];
        this.initializePoolContracts();
    }

    initializePoolContracts() {
        this.uniswapPools = {};
        this.pancakePools = {};

        for (const [pair, address] of Object.entries(poolAddresses.UniswapV3)) {
            this.uniswapPools[pair] = new ethers.Contract(address, this.UniswapV3PoolABI, this.provider);
        }

        for (const [pair, address] of Object.entries(poolAddresses.PancakeV3)) {
            this.pancakePools[pair] = new ethers.Contract(address, this.UniswapV3PoolABI, this.provider);
        }
    }

    async getUniswapV3Price(pair) {
        try {
            const pool = this.uniswapPools[pair];
            if (!pool) {
                throw new Error(`No Uniswap V3 pool found for ${pair}`);
            }

            const slot0 = await pool.slot0();
            const sqrtPriceX96 = slot0[0];
            const token0 = await pool.token0();
            const token1 = await pool.token1();
            
            // Convert sqrtPriceX96 to price
            const price = (Number(sqrtPriceX96) ** 2 / (2 ** 192)) * (10 ** 18);
            return { price, token0, token1 };
        } catch (error) {
            console.error(`Error fetching Uniswap V3 price for ${pair}:`, error.message);
            return null;
        }
    }

    async getPancakeV3Price(pair) {
        try {
            const pool = this.pancakePools[pair];
            if (!pool) {
                throw new Error(`No PancakeSwap V3 pool found for ${pair}`);
            }

            const slot0 = await pool.slot0();
            const sqrtPriceX96 = slot0[0];
            const token0 = await pool.token0();
            const token1 = await pool.token1();
            
            // Convert sqrtPriceX96 to price
            const price = (Number(sqrtPriceX96) ** 2 / (2 ** 192)) * (10 ** 18);
            return { price, token0, token1 };
        } catch (error) {
            console.error(`Error fetching PancakeSwap V3 price for ${pair}:`, error.message);
            return null;
        }
    }

    async getCoinGeckoPrice(coin) {
        try {
            const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
                params: {
                    ids: coin,
                    vs_currencies: 'usd'
                }
            });
            return response.data[coin].usd;
        } catch (error) {
            console.error(`Error fetching CoinGecko price for ${coin}:`, error.message);
            return null;
        }
    }

    async getAllPrices(pair) {
        const [uniswapPrice, pancakePrice] = await Promise.all([
            this.getUniswapV3Price(pair),
            this.getPancakeV3Price(pair)
        ]);

        // Get base token from pair name (e.g., "BTC/USDT" -> "bitcoin")
        const baseToken = pair.split('/')[0];
        const coinGeckoId = this.getCoinGeckoId(baseToken);
        const geckoPrice = await this.getCoinGeckoPrice(coinGeckoId);

        return {
            uniswap: uniswapPrice ? uniswapPrice.price : null,
            pancakeswap: pancakePrice ? pancakePrice.price : null,
            coingecko: geckoPrice,
            timestamp: Date.now()
        };
    }

    getCoinGeckoId(token) {
        const mapping = {
            'BNB': 'binancecoin',
            'WBNB': 'binancecoin',
            'BTC': 'bitcoin',
            'WBTC': 'bitcoin',
            'ETH': 'ethereum',
            'WETH': 'ethereum',
            'CAKE': 'pancakeswap-token',
            'USDT': 'tether',
            'USDC': 'usd-coin',
            'DAI': 'dai'
        };
        return mapping[token] || token.toLowerCase();
    }
}

module.exports = DexPriceFeed;
