const { ethers } = require('ethers');
const axios = require('axios');
const { initMoralis, Moralis } = require('../utils/moralisSingleton');
const { DEX_CONFIGS, TOKENS } = require('../config/dex');

class DexPriceFeed {
    constructor(provider) {
        this.provider = provider;
        this.retryAttempts = 3;
        this.retryDelay = 1000;
        this.cache = new Map();
        this.cacheTimeout = 30000; // 30 seconds cache
        this.moralisInitialized = false;

        // RATE LIMITING: Prevent API overload and 413 errors
        this.lastApiCall = 0;
        this.minApiInterval = 500; // Minimum 500ms between API calls

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

            // Check if already initialized globally
            if (global.__MORALIS_STARTED__) {
                this.moralisInitialized = true;
                return; // Already initialized, don't log again
            }

            await initMoralis(process.env.MORALIS_API_KEY);

            this.moralisInitialized = true;
            // Only log once globally
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

            // Get prices from Moralis API (PRIMARY source for real-time DEX data)
            if (this.moralisInitialized) {
                try {
                    const moralisPrices = await this._getMoralisDexPrices(token0Address, token1Address, pair);
                    Object.assign(prices, moralisPrices);
                    console.log(`✅ Moralis API provided ${Object.keys(moralisPrices).length} DEXes for ${pair}`);
                } catch (error) {
                    console.warn('Moralis price fetch failed, will still use on-chain as backup:', error.message);
                }
            }

            // Get prices from on-chain DEX queries (ALWAYS run as backup/supplement)
            // This ensures we have data even if Moralis fails
            const dexPrices = await this._getDexPricesWithLiquidity(token0Address, token1Address);
            // Only add on-chain prices for DEXes not already covered by Moralis
            for (const [dexName, dexData] of Object.entries(dexPrices)) {
                if (!prices[dexName] && dexData) {
                    prices[dexName] = dexData;
                }
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
            // BSC MAIN DEXes - use correct exchange identifiers for Moralis
            const dexesToTry = [
                { name: 'pancakeswap', alias: 'pancakeswap' }, // Main PancakeSwap on BSC
                { name: 'biswap', alias: 'biswap' } // BiSwap on BSC
            ];

            for (const dex of dexesToTry) {
                // Implement retry logic for throttling
                let attempts = 0;
                const maxAttempts = 3;

                while (attempts < maxAttempts) {
                    try {
                        const dexPrices = await this._getMoralisDexPrice(token0Address, token1Address, dex.name);
                        if (dexPrices) {
                            prices[dex.alias] = {
                                price: dexPrices.price,
                                liquidity: dexPrices.liquidity || 'high',
                                priceImpact: dex.alias === 'pancakeswap' ? 0.001 : 0.002,
                                recommended: true
                            };

                            // Add alias for compatibility
                            if (dex.alias === 'pancakeswap') {
                                prices.pancakeswapv2 = prices[dex.alias];
                            }

                            console.log(`✅ Moralis fetched ${dex.alias} price for ${pair}: ${dexPrices.price.toFixed(6)}`);
                            break; // Success, exit retry loop
                        } else {
                            console.warn(`⚠️ Moralis returned no data for ${dex.name} on ${pair} (attempt ${attempts + 1})`);
                            break; // No data, don't retry
                        }
                    } catch (error) {
                        attempts++;
                        if (error.message.includes('rate limit') || error.message.includes('429') || error.message.includes('throttle')) {
                            console.warn(`⚠️ Moralis rate limited for ${dex.name}, retrying in ${200 * attempts}ms (attempt ${attempts}/${maxAttempts})`);
                            await new Promise(resolve => setTimeout(resolve, 200 * attempts));
                        } else {
                            console.warn(`⚠️ Moralis error for ${dex.name}: ${error.message}`);
                            break; // Non-rate-limit error, don't retry
                        }
                    }
                }

                // Small delay between different DEXes
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            const fetchedCount = Object.keys(prices).length;
            if (fetchedCount > 0) {
                console.log(`✅ Moralis API fetched prices for ${pair}: ${fetchedCount} DEXes`);
            } else {
                console.warn(`⚠️ Moralis API returned 0 DEXes for ${pair} - relying on on-chain data`);
            }

            return prices;

        } catch (error) {
            console.warn('Moralis DEX price fetch failed:', error.message);
            return {};
        }
    }

    async _getMoralisDexPrice(token0Address, token1Address, dexName) {
        try {
            // RATE LIMITING: Ensure minimum interval between API calls
            const now = Date.now();
            const timeSinceLastCall = now - this.lastApiCall;
            if (timeSinceLastCall < this.minApiInterval) {
                await new Promise(resolve => setTimeout(resolve, this.minApiInterval - timeSinceLastCall));
            }
            this.lastApiCall = Date.now();

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

            // Determine liquidity level (VERY lenient for arbitrage - we want to trade!)
            let level, recommended;
            if (avgPriceImpact < 0.5) {
                level = 'excellent';
                recommended = true;
            } else if (avgPriceImpact < 2.0) {
                level = 'good';
                recommended = true;
            } else if (avgPriceImpact < 10.0) {
                level = 'moderate';
                recommended = true;
            } else if (avgPriceImpact < 25.0) {
                level = 'low';
                recommended = true; // Allow for arbitrage even with higher impact
            } else {
                level = 'insufficient';
                recommended = false; // Only reject extreme cases (>25% impact)
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
        return TOKENS[symbol]?.address || ethers.ZeroAddress;
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

    // Estimate gas cost for a swap transaction with dynamic slippage
    async estimateGas(dexName, tokenIn, tokenOut, amountIn, slippage = null) {
        try {
            const dexKey = dexName.toUpperCase();
            const dexConfig = DEX_CONFIGS[dexKey];

            if (!dexConfig) {
                throw new Error(`DEX ${dexName} not configured`);
            }

            // Create router contract
            const router = new ethers.Contract(
                dexConfig.router,
                [
                    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
                    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'
                ],
                this.provider
            );

            // Get expected output amount
            const path = [tokenIn, tokenOut];
            const amountsOut = await router.getAmountsOut(amountIn, path);
            const expectedOut = amountsOut[amountsOut.length - 1];

            // Use dynamic slippage if not provided
            if (slippage === null) {
                const gasPrice = await this.provider.getFeeData().gasPrice;
                slippage = this._calculateDynamicSlippage({ spread: 0.005 }, gasPrice);
            }

            // Apply slippage protection
            const minAmountOut = expectedOut * BigInt(Math.floor((1 - slippage) * 1000)) / BigInt(1000);
            const deadline = Math.floor(Date.now() / 1000) + 300;

            // Estimate gas for the swap
            const gasEstimate = await router.swapExactTokensForTokens.estimateGas(
                amountIn,
                minAmountOut,
                path,
                ethers.ZeroAddress, // Use zero address for estimation
                deadline
            );

            return gasEstimate;
        } catch (error) {
            console.error(`Gas estimation failed for ${dexName}:`, error.message);
            // Return fallback gas estimate
            return BigInt(200000); // Conservative fallback
        }
    }

    // Calculate dynamic slippage based on market conditions
    _calculateDynamicSlippage(opportunity, gasPrice) {
        // Default slippage config (can be made configurable)
        const slippageConfig = {
            minSlippage: 0.003, // 0.3% minimum
            maxSlippage: 0.008, // 0.8% maximum
            defaultSlippage: 0.005 // 0.5% default
        };

        let slippage = slippageConfig.defaultSlippage;

        // Adjust based on spread - higher spread allows lower slippage
        if (opportunity.spread > 0.01) {
            slippage = Math.max(slippageConfig.minSlippage, slippage * 0.8); // Reduce slippage for high spreads
        } else if (opportunity.spread < 0.001) {
            slippage = Math.min(slippageConfig.maxSlippage, slippage * 1.5); // Increase slippage for low spreads
        }

        // Adjust based on gas price - higher gas price allows higher slippage
        const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
        if (gasPriceGwei > 10) {
            slippage = Math.min(slippageConfig.maxSlippage, slippage * 1.2); // Increase slippage for high gas
        }

        // Ensure within bounds
        slippage = Math.max(slippageConfig.minSlippage, Math.min(slippageConfig.maxSlippage, slippage));

        return slippage;
    }

    // Execute a swap transaction
    async swap(dexName, tokenIn, tokenOut, amountIn, minAmountOut, signer, options = {}) {
        try {
            const dexKey = dexName.toUpperCase();
            const dexConfig = DEX_CONFIGS[dexKey];

            if (!dexConfig) {
                throw new Error(`DEX ${dexName} not configured`);
            }

            // Create router contract
            const router = new ethers.Contract(
                dexConfig.router,
                ['function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'],
                signer
            );

            const path = [tokenIn, tokenOut];
            const deadline = Math.floor(Date.now() / 1000) + 300;

            // Execute the swap
            const tx = await router.swapExactTokensForTokens(
                amountIn,
                minAmountOut,
                path,
                signer.address,
                deadline,
                {
                    gasLimit: options.gasLimit || 500000,
                    gasPrice: options.gasPrice,
                    ...options
                }
            );

            return await tx.wait();
        } catch (error) {
            console.error(`Swap failed on ${dexName}:`, error.message);
            throw error;
        }
    }

    // Build swap transaction data without executing
    async buildSwapTx(dexName, tokenIn, tokenOut, amountIn, minAmountOut, toAddress, options = {}) {
        try {
            const dexKey = dexName.toUpperCase();
            const dexConfig = DEX_CONFIGS[dexKey];

            if (!dexConfig) {
                throw new Error(`DEX ${dexName} not configured`);
            }

            const path = [tokenIn, tokenOut];
            const deadline = Math.floor(Date.now() / 1000) + 300;

            // Encode the function call
            const routerInterface = new ethers.Interface([
                'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
            ]);

            const txData = routerInterface.encodeFunctionData('swapExactTokensForTokens', [
                amountIn,
                minAmountOut,
                path,
                toAddress,
                deadline
            ]);

            return {
                to: dexConfig.router,
                data: txData,
                value: 0,
                gasLimit: options.gasLimit || 500000,
                gasPrice: options.gasPrice,
                ...options
            };
        } catch (error) {
            console.error(`Failed to build swap tx for ${dexName}:`, error.message);
            throw error;
        }
    }

    clearCache() {
        this.cache.clear();
        console.log('Price feed cache cleared');
    }
}

module.exports = DexPriceFeed;
