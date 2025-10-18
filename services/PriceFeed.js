const { ethers } = require('ethers');
const axios = require('axios');

const PAIR_ABI = [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'
];

class PriceFeed {
    constructor(provider) {
        this.provider = provider;
        this.prices = {};
        this.lastUpdate = 0;
        this.UPDATE_INTERVAL = 10000; // 10 seconds
    }

    async getPriceFromDex(dexConfig, token0, token1) {
        const factory = new ethers.Contract(dexConfig.factory, [
            'function getPair(address tokenA, address tokenB) external view returns (address pair)'
        ], this.provider);

        const pairAddress = await factory.getPair(token0.address, token1.address);
        if (pairAddress === ethers.constants.AddressZero) return null;

        const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
        const reserves = await pair.getReserves();
        
        const price = (reserves[1] * (10 ** token0.decimals)) / 
                     (reserves[0] * (10 ** token1.decimals));
        
        return price;
    }

    async getCoinGeckoPrice(tokenId) {
        try {
            const response = await axios.get(
                `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`
            );
            return response.data[tokenId].usd;
        } catch (error) {
            console.error(`Failed to fetch CoinGecko price for ${tokenId}:`, error.message);
            return null;
        }
    }

    async updatePrices(tokens, dexConfigs) {
        const now = Date.now();
        if (now - this.lastUpdate < this.UPDATE_INTERVAL) {
            return this.prices;
        }

        const newPrices = {};

        // Get prices from multiple DEXes
        for (const [tokenSymbol, tokenData] of Object.entries(tokens)) {
            newPrices[tokenSymbol] = {
                dexPrices: {},
                geckoPrice: null
            };

            // Get CoinGecko price as reference
            const geckoPrice = await this.getCoinGeckoPrice(tokenSymbol.toLowerCase());
            if (geckoPrice) {
                newPrices[tokenSymbol].geckoPrice = geckoPrice;
            }

            // Get DEX prices
            for (const [dexName, dexConfig] of Object.entries(dexConfigs)) {
                try {
                    const price = await this.getPriceFromDex(
                        dexConfig,
                        tokenData,
                        tokens.USDT // Using USDT as base for price comparison
                    );
                    if (price) {
                        newPrices[tokenSymbol].dexPrices[dexName] = price;
                    }
                } catch (error) {
                    console.error(`Failed to get ${tokenSymbol} price from ${dexName}:`, error.message);
                }
            }
        }

        this.prices = newPrices;
        this.lastUpdate = now;
        return this.prices;
    }

    getArbitrageOpportunities(prices, minSpreadPercent = 0.5) {
        const opportunities = [];

        for (const tokenSymbol of Object.keys(prices)) {
            const tokenPrices = prices[tokenSymbol].dexPrices;
            const dexes = Object.keys(tokenPrices);

            for (let i = 0; i < dexes.length; i++) {
                for (let j = i + 1; j < dexes.length; j++) {
                    const dex1 = dexes[i];
                    const dex2 = dexes[j];
                    const price1 = tokenPrices[dex1];
                    const price2 = tokenPrices[dex2];

                    const spread = Math.abs(price1 - price2) / Math.min(price1, price2) * 100;

                    if (spread >= minSpreadPercent) {
                        opportunities.push({
                            token: tokenSymbol,
                            buyDex: price1 < price2 ? dex1 : dex2,
                            sellDex: price1 < price2 ? dex2 : dex1,
                            buyPrice: Math.min(price1, price2),
                            sellPrice: Math.max(price1, price2),
                            spread
                        });
                    }
                }
            }
        }

        return opportunities;
    }
}

module.exports = PriceFeed;
