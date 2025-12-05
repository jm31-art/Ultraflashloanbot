const { ethers } = require('ethers');
const axios = require('axios');
const Moralis = require('moralis').default;
const { DEX_CONFIGS, TOKENS } = require('../config/dex');

class DexPriceFeed {
    constructor(provider) {
        this.provider = provider;
        this.retryAttempts = 3;
        this.retryDelay = 1000;
        this.cache = new Map();
        this.cacheTimeout = 30000; // 30 seconds cache
        this.moralisInitialized = false;

        // DEX Router ABIs for price queries
        this.routerAbi = [
            'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
            'function getAmountsIn(uint amountOut, address[] memory path) public view returns (uint[] memory amounts)'
        ];

        // Initialize Moralis
        this._initializeMoralis();
    }

    async _initializeMoralis() {
        try {
            if (!process.env.MORALIS_API_KEY) {
                console.warn('MORALIS_API_KEY not found in environment variables');
                return;
            }

            await Moralis.start({
                apiKey: process.env.MORALIS_API_KEY
            });

            this.moralisInitialized = true;
            console.log('✅ Moralis API initialized for live DEX prices');
        } catch (error) {
            console.warn('Failed to initialize Moralis:', error.message);
            this.moralisInitialized = false;
        }
    }

    async getAllPrices(pair) {
        const cacheKey = `prices_${pair}`;
        const cached = this.cache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }

        try {
            const [token0, token1] = pair.split('/');
            const token0Address = TOKENS[token0]?.address;
            const token1Address = TOKENS[token1]?.address;

            if (!token0Address || !token1Address) {
                throw new Error(`Invalid token pair: ${pair}`);
            }

            const prices = {};

            // Get prices from Moralis API (primary source for real-time DEX data)
            if (this.moralisInitialized) {
                try {
                    const moralisPrices = await this._getMoralisDexPrices(token0Address, token1Address, pair);
                    Object.assign(prices, moralisPrices);
                } catch (error) {
                    console.warn('Moralis price fetch failed, falling back to on-chain queries:', error.message);
                }
            }

            // Get prices from on-chain DEX queries with liquidity checks (fallback/backup)
            if (Object.keys(prices).length === 0) {
                const dexPrices = await this._getDexPricesWithLiquidity(token0Address, token1Address);
                Object.assign(prices, dexPrices);
            }

            // Get prices from external APIs (final fallback)
            const apiPrices = await this._getApiPrices(pair);
            Object.assign(prices, apiPrices);

            // Add timestamp
            prices.timestamp = Date.now();

            // Cache the result
            this.cache.set(cacheKey, { data: prices, timestamp: Date.now() });

            return prices;

        } catch (error) {
            console.error(`Error getting prices for ${pair}:`, error.message);

            // Return cached data if available, otherwise fallback
            if (cached) {
                console.log(`Using cached prices for ${pair}`);
                return cached.data;
            }

            // Fallback to basic prices
            return {
                pancakeswap: await this._getFallbackPrice(pair),
                timestamp: Date.now()
            };
        }
    }

    async _getMoralisDexPrices(token0Address, token1Address, pair) {
        const prices = {};
        const [token0, token1] = pair.split('/');

        try {
            // Fetch PancakeSwap prices from Moralis
            const pancakePrices = await this._getMoralisDexPrice(token0Address, token1Address, 'pancakeswapv2');
            if (pancakePrices) {
                prices.pancakeswapv2 = {
                    price: pancakePrices.price,
                    liquidity: pancakePrices.liquidity || 'high',
                    priceImpact: 0.001, // Low impact for major DEX
                    recommended: true
                };
                prices.pancakeswap = prices.pancakeswapv2; // Alias for compatibility
            }

            // Fetch PancakeSwap V3 prices
            const pancakeV3Prices = await this._getMoralisDexPrice(token0Address, token1Address, 'pancakeswapv3');
            if (pancakeV3Prices) {
                prices.pancakeswapv3 = {
                    price: pancakeV3Prices.price,
                    liquidity: pancakeV3Prices.liquidity || 'excellent',
                    priceImpact: 0.0005, // Very low impact for V3
                    recommended: true
                };
            }

            // Fetch Biswap prices
            const biswapPrices = await this._getMoralisDexPrice(token0Address, token1Address, 'biswap');
            if (biswapPrices) {
                prices.biswap = {
                    price: biswapPrices.price,
                    liquidity: biswapPrices.liquidity || 'good',
                    priceImpact: 0.002, // Moderate impact
                    recommended: true
                };
            }

            // Fetch Uniswap V2 prices (if available on BSC)
            const uniswapPrices = await this._getMoralisDexPrice(token0Address, token1Address, 'uniswapv2');
            if (uniswapPrices) {
                prices.uniswap = {
                    price: uniswapPrices.price,
                    liquidity: uniswapPrices.liquidity || 'moderate',
                    priceImpact: 0.003, // Higher impact
                    recommended: true
                };
            }

            console.log(`✅ Moralis API fetched prices for ${pair}: ${Object.keys(prices).length} DEXes`);
            return prices;

        } catch (error) {
            console.warn('Moralis DEX price fetch failed:', error.message);
            return {};
        }
    }

    async _getMoralisDexPrice(token0Address, token1Address, dexName) {
        try {
            // Use Moralis EvmApi to get token prices from specific DEX
            const response = await Moralis.EvmApi.token.getTokenPrice({
                address: token0Address,
                chain: '0x38', // BSC mainnet
                exchange: dexName
            });

            if (response.raw && response.raw.usdPrice) {
                // Get pair price by comparing with token1
                const token0Price = response.raw.usdPrice;

                // Get token1 price for comparison
                const token1Response = await Moralis.EvmApi.token.getTokenPrice({
                    address: token1Address,
                    chain: '0x38',
                    exchange: dexName
                });

                if (token1Response.raw && token1Response.raw.usdPrice) {
                    const token1Price = token1Response.raw.usdPrice;
                    const pairPrice = token0Price / token1Price;

                    return {
                        price: pairPrice,
                        liquidity: this._estimateLiquidityFromVolume(response.raw),
                        volume24h: response.raw.volume24h || 0
                    };
                }
            }

            return null;
        } catch (error) {
            // Silently handle individual DEX failures
            return null;
        }
    }

    _estimateLiquidityFromVolume(tokenData) {
        const volume = tokenData.volume24h || 0;

        if (volume > 10000000) return 'excellent'; // $10M+ daily volume
        if (volume > 1000000) return 'high';      // $1M+ daily volume
        if (volume > 100000) return 'good';       // $100K+ daily volume
        if (volume > 10000) return 'moderate';    // $10K+ daily volume
        return 'low';
    }

    async _getDexPricesWithLiquidity(token0Address, token1Address) {
        const prices = {};
        const amountIn = ethers.parseEther('1'); // 1 token for price calculation

        for (const [dexKey, dexConfig] of Object.entries(DEX_CONFIGS)) {
            try {
                const routerContract = new ethers.Contract(
                    dexConfig.router,
                    this.routerAbi,
                    this.provider
                );

                // Try token0 -> token1
                try {
                    const amountsOut = await routerContract.getAmountsOut(amountIn, [token0Address, token1Address]);
                    const price = parseFloat(ethers.formatEther(amountsOut[1]));

                    // Check liquidity by testing different amounts
                    const liquidityCheck = await this._checkLiquidity(routerContract, token0Address, token1Address, price);

                    prices[dexKey.toLowerCase()] = {
                        price: price,
                        liquidity: liquidityCheck.level,
                        priceImpact: liquidityCheck.priceImpact,
                        recommended: liquidityCheck.recommended
                    };
                } catch (error) {
                    // Try token1 -> token0 if direct path fails
                    try {
                        const amountsOut = await routerContract.getAmountsOut(amountIn, [token1Address, token0Address]);
                        const price = 1 / parseFloat(ethers.formatEther(amountsOut[1]));

                        // Check liquidity for reverse direction
                        const liquidityCheck = await this._checkLiquidity(routerContract, token1Address, token0Address, price);

                        prices[dexKey.toLowerCase()] = {
                            price: price,
                            liquidity: liquidityCheck.level,
                            priceImpact: liquidityCheck.priceImpact,
                            recommended: liquidityCheck.recommended
                        };
                    } catch (reverseError) {
                        // DEX doesn't have this pair or insufficient liquidity
                        prices[dexKey.toLowerCase()] = null;
                    }
                }
            } catch (error) {
                prices[dexKey.toLowerCase()] = null;
            }
        }

        return prices;
    }

    async _checkLiquidity(routerContract, tokenIn, tokenOut, basePrice) {
        try {
            // Test with different amounts to check liquidity
            const testAmounts = [
                ethers.parseEther('10'),   // Small trade
                ethers.parseEther('100'),  // Medium trade
                ethers.parseEther('1000')  // Large trade
            ];

            let totalPriceImpact = 0;
            let successfulTests = 0;

            for (const testAmount of testAmounts) {
                try {
                    const amountsOut = await routerContract.getAmountsOut(testAmount, [tokenIn, tokenOut]);
                    const testPrice = parseFloat(ethers.formatEther(amountsOut[1])) / parseFloat(ethers.formatEther(testAmount));
                    const priceImpact = Math.abs((testPrice - basePrice) / basePrice) * 100;

                    totalPriceImpact += priceImpact;
                    successfulTests++;
                } catch (error) {
                    // Trade would fail at this size
                    break;
                }
            }

            const avgPriceImpact = successfulTests > 0 ? totalPriceImpact / successfulTests : 100;

            // Determine liquidity level (more lenient for arbitrage)
            let level, recommended;
            if (avgPriceImpact < 0.5) {
                level = 'excellent';
                recommended = true;
            } else if (avgPriceImpact < 1.0) {
                level = 'good';
                recommended = true;
            } else if (avgPriceImpact < 3.0) {
                level = 'moderate';
                recommended = true;
            } else if (avgPriceImpact < 8.0) {
                level = 'low';
                recommended = true; // Still allow for arbitrage
            } else {
                level = 'insufficient';
                recommended = false; // Only reject extreme cases
            }

            return {
                level,
                priceImpact: avgPriceImpact,
                recommended,
                maxTradeSize: successfulTests > 0 ? testAmounts[successfulTests - 1] : ethers.BigNumber.from(0)
            };

        } catch (error) {
            return {
                level: 'unknown',
                priceImpact: 100,
                recommended: false,
                maxTradeSize: ethers.BigNumber.from(0)
            };
        }
    }

    async _getApiPrices(pair) {
        const prices = {};

        try {
            // Try 1inch API for BSC
            const response = await axios.get(`https://api.1inch.io/v5.0/56/quote`, {
                params: {
                    fromTokenAddress: this._getTokenAddress(pair.split('/')[0]),
                    toTokenAddress: this._getTokenAddress(pair.split('/')[1]),
                    amount: ethers.parseEther('1').toString()
                },
                timeout: 5000
            });

            if (response.data?.toTokenAmount) {
                prices.oneinch = {
                    price: parseFloat(ethers.formatEther(response.data.toTokenAmount)),
                    liquidity: 'api',
                    priceImpact: 0,
                    recommended: true
                };
            }
        } catch (error) {
            // 1inch API failed
        }

        return prices;
    }

    async _getFallbackPrice(pair) {
        // Simple fallback pricing based on known rates
        const fallbacks = {
            'WBNB/USDT': 567.0,
            'USDT/USDC': 1.0,
            'WBNB/BTCB': 0.0082
        };

        return {
            price: fallbacks[pair] || 1.0,
            liquidity: 'fallback',
            priceImpact: 0,
            recommended: false
        };
    }

    _getTokenAddress(symbol) {
        return TOKENS[symbol]?.address || ethers.constants.AddressZero;
    }

    async getPrice(token0, token1) {
        const pair = `${token0}/${token1}`;
        const prices = await this.getAllPrices(pair);

        // Return the best available price (prefer good liquidity)
        const dexes = Object.keys(prices).filter(dex =>
            prices[dex] &&
            typeof prices[dex] === 'object' &&
            prices[dex].recommended === true
        );

        if (dexes.length > 0) {
            // Return price from DEX with best liquidity
            const bestDex = dexes[0]; // Could sort by liquidity level
            return prices[bestDex].price;
        }

        // Fallback to any available price
        for (const dex of Object.keys(prices)) {
            if (prices[dex] && typeof prices[dex] === 'object' && prices[dex].price) {
                return prices[dex].price;
            }
        }

        // Final fallback
        return this._getFallbackPrice(pair).price;
    }

    clearCache() {
        this.cache.clear();
        console.log('Price feed cache cleared');
    }
}

module.exports = DexPriceFeed;
