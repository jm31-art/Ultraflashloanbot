import { ethers } from 'ethers';
import axios from 'axios';
import DexPriceFeed from './DexPriceFeed.js';
import fallbackPriceService from './FallbackPriceService.js';

const PAIR_ABI = [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)'
];

const FACTORY_ABI = [
    'function getPair(address tokenA, address tokenB) external view returns (address pair)',
    'function allPairs(uint) external view returns (address pair)',
    'function allPairsLength() external view returns (uint)'
];

class PriceFeed {
    constructor(provider) {
        this.provider = provider;
        this.dexPriceFeed = new DexPriceFeed(provider);
        this.prices = {};
        this.lastUpdate = 0;
        this.UPDATE_INTERVAL = 10000; // 10 seconds
        this.pairCache = new Map();
        this.tokenPaths = new Map();
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Initialize path cache for common pairs
            await this.initializeCommonPaths();
            this.initialized = true;
        } catch (error) {
            console.error('Failed to initialize price feed:', error);
            throw error;
        }
    }

    async initializeCommonPaths() {
        const basePairs = [
            ['WBNB', 'USDT'],
            ['WBNB', 'BUSD'],
            ['WBNB', 'USDC'],
            ['ETH', 'USDT'],
            ['BTCB', 'USDT']
        ];

        for (const [token0Symbol, token1Symbol] of basePairs) {
            const key = `${token0Symbol}-${token1Symbol}`;
            this.tokenPaths.set(key, {
                initialized: false,
                pairs: []
            });
        }
    }

    async getPriceFromDex(dexConfig, token0, token1) {
        try {
            // Null checks for dexConfig
            if (!dexConfig || !dexConfig.factory || !dexConfig.name) {
                // Silent skip for invalid configs
                return null;
            }

            // Skip if same token
            if (token0.address.toLowerCase() === token1.address.toLowerCase()) {
                return 1; // Price ratio is 1:1 for same token
            }

            // Validate token addresses
            if (!token0.address || !token1.address || !ethers.isAddress(token0.address) || !ethers.isAddress(token1.address)) {
                console.warn(`⚠️ Invalid token addresses provided - skipping`);
                return null;
            }

            // Skip invalid factory addresses
            if (dexConfig.factory === '0x0000000000000000000000000000000000000000' || !ethers.isAddress(dexConfig.factory)) {
                console.warn(`⚠️ Invalid factory address for ${dexConfig.name} - skipping`);
                return null;
            }

            // Normalize addresses to checksum format
            const normalizedToken0 = token0.address.toLowerCase() < token1.address.toLowerCase()
                ? ethers.getAddress(token0.address)
                : ethers.getAddress(token1.address);
            const normalizedToken1 = token0.address.toLowerCase() < token1.address.toLowerCase()
                ? ethers.getAddress(token1.address)
                : ethers.getAddress(token0.address);
            const normalizedFactory = ethers.getAddress(dexConfig.factory);

            const factory = new ethers.Contract(normalizedFactory, [
                'function getPair(address tokenA, address tokenB) external view returns (address pair)'
            ], this.provider);

            // Try both token orderings
            let pairAddress = await factory.getPair(normalizedToken0, normalizedToken1);
            let reversed = false;

            if (pairAddress === ethers.ZeroAddress) {
                pairAddress = await factory.getPair(normalizedToken1, normalizedToken0);
                reversed = true;
            }

            if (pairAddress === ethers.ZeroAddress) {
                console.log(`No pair found for ${token0.symbol}/${token1.symbol} on ${dexConfig.name}`);
                return null;
            }

            const normalizedPair = ethers.getAddress(pairAddress);
            const pair = new ethers.Contract(normalizedPair, PAIR_ABI, this.provider);
            const reserves = await pair.getReserves();

            // Handle zero reserves
            if (reserves[0].isZero() || reserves[1].isZero()) {
                console.log(`Zero reserves for ${token0.symbol}/${token1.symbol} pair on ${dexConfig.name}`);
                return null;
            }

            // Use BigNumber for precise calculations
            const reserve0 = ethers.BigNumber.from(reserves[0]);
            const reserve1 = ethers.BigNumber.from(reserves[1]);
            const decimals0 = ethers.BigNumber.from(10).pow(token0.decimals);
            const decimals1 = ethers.BigNumber.from(10).pow(token1.decimals);

            const price = reserve1.mul(decimals0).div(reserve0.mul(decimals1));
            return parseFloat(ethers.formatUnits(price, 0));

        } catch (error) {
            // Try on-chain fallback for better price detection in Extreme Mode
            try {
                return await this._getOnChainPriceFallback(dexConfig, token0, token1);
            } catch (fallbackError) {
                // Silent failure for bootstrap mode
                return null;
            }
        }
    }

    async getCoinGeckoPrice(tokenId) {
        const maxRetries = 3;
        let retries = 0;

        while (retries < maxRetries) {
            try {
                const response = await axios.get(
                    `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`,
                    { timeout: 5000 } // 5 second timeout
                );
                if (response.data && response.data[tokenId] && response.data[tokenId].usd) {
                    return response.data[tokenId].usd;
                }
                throw new Error('Invalid response format');
            } catch (error) {
                retries++;
                if (error.response && error.response.status === 429) {
                    // Rate limit hit - wait longer
                    await new Promise(resolve => setTimeout(resolve, 2000 * retries));
                } else if (retries === maxRetries) {
                    console.error(`Failed to fetch CoinGecko price for ${tokenId} after ${maxRetries} attempts:`, error.message);
                    return null;
                }
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        return null;
    }

    async updatePrices(tokens, dexConfigs) {
        const now = Date.now();
        if (now - this.lastUpdate < this.UPDATE_INTERVAL) {
            return this.prices;
        }

        const newPrices = {};
        const stableTokens = ['USDT', 'USDC', 'BUSD'];
        const baseTokens = ['WBNB', 'ETH', 'BTCB'];

        // Convert tokens array to object keyed by symbol if needed
        let tokensObj = tokens;
        if (Array.isArray(tokens)) {
            tokensObj = {};
            for (const token of tokens) {
                if (token && token.symbol) {
                    tokensObj[token.symbol] = token;
                }
            }
        }

        // Get prices from DexPriceFeed for live DEX data
        const dexPrices = {};
        for (const tokenSymbol of Object.keys(tokensObj)) {
            if (tokenSymbol !== 'USDT') { // Skip USDT as base
                try {
                    const pair = `${tokenSymbol}/USDT`;
                    const prices = await this.dexPriceFeed.getAllPrices(pair);
                    dexPrices[tokenSymbol] = prices;
                } catch (error) {
                    console.error(`Failed to get DEX prices for ${tokenSymbol}:`, error.message);
                }
            }
        }

        // Get prices from multiple DEXes
        for (const [tokenSymbol, tokenData] of Object.entries(tokensObj)) {
            newPrices[tokenSymbol] = {
                dexPrices: {},
                geckoPrice: null,
                basePrice: null
            };

            // For stable tokens, set price to 1
            if (stableTokens.includes(tokenSymbol)) {
                newPrices[tokenSymbol].basePrice = 1;
                continue;
            }

            // For base tokens, try to get price from stable pairs first
            if (baseTokens.includes(tokenSymbol)) {
                for (const stableSymbol of stableTokens) {
                    if (tokensObj[stableSymbol]) {
                        const price = await this.getPriceFromDex(
                            dexConfigs.PANCAKESWAP,
                            tokenData,
                            tokensObj[stableSymbol]
                        );
                        if (price) {
                            newPrices[tokenSymbol].basePrice = price;
                            break;
                        }
                    }
                }
            }

            // Get DEX prices from DexPriceFeed (live data)
            if (dexPrices[tokenSymbol]) {
                newPrices[tokenSymbol].dexPrices = dexPrices[tokenSymbol];
            }

            // Fallback to factory-based approach if DexPriceFeed fails
            if (Object.keys(newPrices[tokenSymbol].dexPrices).length === 0) {
                for (const [dexName, dexConfig] of Object.entries(dexConfigs)) {
                    try {
                        const price = await this.getPriceFromDex(
                            dexConfig,
                            tokenData,
                            tokensObj.USDT // Using USDT as base for price comparison
                        );
                        if (price) {
                            newPrices[tokenSymbol].dexPrices[dexName] = price;
                        }
                    } catch (error) {
                        console.error(`Failed to get ${tokenSymbol} price from ${dexName}:`, error.message);
                    }
                }
            }
        }

        this.prices = newPrices;
        this.lastUpdate = now;
        return this.prices;
    }

    getArbitrageOpportunities(prices, minSpreadPercent = 0.5) {
        const opportunities = [];

        // Two-token arbitrage
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
                            type: 'two-token',
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

        // Triangular arbitrage
        const triangularOpportunities = this.getTriangularArbitrageOpportunities(prices, minSpreadPercent);
        opportunities.push(...triangularOpportunities);

        return opportunities;
    }

    getTriangularArbitrageOpportunities(prices, minSpreadPercent = 0.5) {
        const opportunities = [];
        const tokens = Object.keys(prices);

        // Common base tokens for triangular arbitrage
        const baseTokens = ['USDT', 'USDC', 'BUSD', 'WBNB'];

        for (const baseToken of baseTokens) {
            if (!prices[baseToken]) continue;

            // Find pairs with the base token
            const pairsWithBase = tokens.filter(token =>
                token !== baseToken &&
                prices[token] &&
                prices[token].dexPrices &&
                Object.keys(prices[token].dexPrices).length > 0
            );

            // Check triangular opportunities: base -> token1 -> token2 -> base
            for (let i = 0; i < pairsWithBase.length; i++) {
                for (let j = i + 1; j < pairsWithBase.length; j++) {
                    const token1 = pairsWithBase[i];
                    const token2 = pairsWithBase[j];

                    // Check if we have prices for token1/token2 pair
                    if (!prices[token1].dexPrices || !prices[token2].dexPrices) continue;

                    const opportunity = this.calculateTriangularProfit(
                        baseToken, token1, token2, prices, minSpreadPercent
                    );

                    if (opportunity) {
                        opportunities.push(opportunity);
                    }
                }
            }
        }

        return opportunities;
    }

    calculateTriangularProfit(baseToken, token1, token2, prices, minSpreadPercent) {
        // Get prices for all three pairs with enhanced cross-pair pricing
        const baseToToken1Prices = prices[token1].dexPrices;
        const baseToToken2Prices = prices[token2].dexPrices;

        // Enhanced cross-pair pricing using multiple DEXes and weighted averages
        const token1ToToken2Prices = this.calculateEnhancedCrossPairPrices(token1, token2, prices);

        // Get all available DEXes that support all three pairs
        const availableDexes = this.findCommonDexes([baseToken, token1, token2], prices);

        for (const dex of availableDexes) {
            if (!baseToToken1Prices[dex] || !baseToToken2Prices[dex] || !token1ToToken2Prices[dex]) continue;

            // Calculate the triangular arbitrage with more precision
            const baseToToken1 = baseToToken1Prices[dex];
            const baseToToken2 = baseToToken2Prices[dex];
            const token1ToToken2 = token1ToToken2Prices[dex];

            // Account for DEX fees in triangular arbitrage (typically 0.3% per swap)
            const dexFee = 0.003; // 0.3% per swap

            // Path: base -> token1 -> token2 -> base
            // 1. base -> token1 (with fee)
            const amountToken1 = (1 * (1 - dexFee)) / baseToToken1;

            // 2. token1 -> token2 (with fee)
            const amountToken2 = (amountToken1 * (1 - dexFee)) * token1ToToken2;

            // 3. token2 -> base (with fee)
            const finalAmount = (amountToken2 * (1 - dexFee)) * baseToToken2;

            const profit = finalAmount - 1;
            const profitPercent = profit * 100;

            // Only consider opportunities with sufficient profit after fees
            if (profitPercent >= minSpreadPercent && profit > 0) {
                return {
                    type: 'triangular',
                    tokens: [baseToken, token1, token2],
                    path: `${baseToken} -> ${token1} -> ${token2} -> ${baseToken}`,
                    dex: dex,
                    profit: profit,
                    profitPercent: profitPercent,
                    rates: {
                        [`${baseToken}/${token1}`]: baseToToken1,
                        [`${token1}/${token2}`]: token1ToToken2,
                        [`${token2}/${baseToken}`]: baseToToken2
                    },
                    fees: {
                        dexFee: dexFee,
                        totalFees: 1 - Math.pow(1 - dexFee, 3) // Total fee impact
                    }
                };
            }
        }

        return null;
    }

    calculateEnhancedCrossPairPrices(token1, token2, prices) {
        // Enhanced cross-pair pricing using weighted average across DEXes
        const crossPrices = {};
        const baseTokens = ['USDT', 'USDC', 'BUSD', 'WBNB'];

        for (const base of baseTokens) {
            if (!prices[token1].dexPrices || !prices[token2].dexPrices) continue;

            const token1BasePrices = prices[token1].dexPrices;
            const token2BasePrices = prices[token2].dexPrices;

            // Calculate weighted average price across DEXes
            const dexes = Object.keys(token1BasePrices);
            let totalWeight = 0;
            let weightedPrice = 0;

            for (const dex of dexes) {
                if (token2BasePrices[dex]) {
                    const token1ToBase = token1BasePrices[dex];
                    const token2ToBase = token2BasePrices[dex];
                    const crossPrice = token1ToBase / token2ToBase;

                    // Weight by liquidity (simplified - in production use actual liquidity)
                    const weight = 1; // Equal weight for now
                    weightedPrice += crossPrice * weight;
                    totalWeight += weight;
                }
            }

            if (totalWeight > 0) {
                crossPrices[base] = weightedPrice / totalWeight;
            }
        }

        // Return the most reliable cross price (prefer USDT/USDC pairs)
        return crossPrices.USDT || crossPrices.USDC || crossPrices.BUSD || crossPrices.WBNB || {};
    }

    findCommonDexes(tokens, prices) {
        // Find DEXes that support all tokens in the triangular path
        const dexSets = tokens.map(token => {
            if (!prices[token] || !prices[token].dexPrices) return new Set();
            return new Set(Object.keys(prices[token].dexPrices));
        });

        // Find intersection of all DEX sets
        if (dexSets.length === 0) return [];

        let commonDexes = dexSets[0];
        for (let i = 1; i < dexSets.length; i++) {
            commonDexes = new Set([...commonDexes].filter(dex => dexSets[i].has(dex)));
        }

        return Array.from(commonDexes);
    }



    /**
     * On-chain price fallback for Extreme Mode bootstrap
     */
    async _getOnChainPriceFallback(dexConfig, token0, token1) {
        try {
            // Use PancakeSwap factory as fallback for BSC
            const fallbackFactory = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'; // PancakeSwap factory
            const factory = new ethers.Contract(fallbackFactory, [
                'function getPair(address tokenA, address tokenB) external view returns (address pair)'
            ], this.provider);

            const normalizedToken0 = ethers.getAddress(token0.address);
            const normalizedToken1 = ethers.getAddress(token1.address);

            let pairAddress = await factory.getPair(normalizedToken0, normalizedToken1);
            if (pairAddress === ethers.ZeroAddress) {
                pairAddress = await factory.getPair(normalizedToken1, normalizedToken0);
            }

            if (pairAddress === ethers.ZeroAddress) {
                return null; // No pair found
            }

            const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
            const reserves = await pair.getReserves();

            if (reserves[0].isZero() || reserves[1].isZero()) {
                return null; // No liquidity
            }

            // Calculate price
            const reserve0 = ethers.BigNumber.from(reserves[0]);
            const reserve1 = ethers.BigNumber.from(reserves[1]);
            const decimals0 = ethers.BigNumber.from(10).pow(token0.decimals);
            const decimals1 = ethers.BigNumber.from(10).pow(token1.decimals);

            const price = reserve1.mul(decimals0).div(reserve0.mul(decimals1));
            return parseFloat(ethers.formatUnits(price, 0));

        } catch (error) {
            // Silent failure for bootstrap mode
            return null;
        }
    }

    async getTokenPrice(token) {
        try {
            const price = await super.getTokenPrice(token);
            if (price) return price;

            // Use fallback if primary sources fail
            return await fallbackPriceService.getFallbackPrice(token);
        } catch (error) {
            console.warn(`Failed to get price for ${token}, using fallback`);
            return await fallbackPriceService.getFallbackPrice(token);
        }
    }
}

export default PriceFeed;
