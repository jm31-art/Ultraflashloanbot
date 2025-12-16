import { ethers } from 'ethers';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

class PriceService {
    constructor(provider = null) {
        // Allow provider to be passed in for testing
        this.provider = provider;

        // Default config if file doesn't exist
        this.CONFIG = {
            bsc_rpc: 'https://bsc-dataseed.binance.org/',
            router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
            apiEndpoints: {
                coingecko: 'https://api.coingecko.com/api/v3',
                dexscreener: 'https://api.dexscreener.com/latest'
            },
            symbol_map: {
                'BNB': 'binancecoin',
                'USDT': 'tether',
                'BTC': 'bitcoin',
                'ETH': 'ethereum'
            }
        };

        try {
            const configPath = path.join(__dirname, '../config/price_sources.json');
            const fileConfig = JSON.parse(fs.readFileSync(configPath));
            this.CONFIG = { ...this.CONFIG, ...fileConfig };
        } catch (error) {
            // Use defaults if config file doesn't exist
        }
        
        this.routerAbi = [
            {
                inputs: [
                    { internalType: "uint256", name: "amountIn", type: "uint256" },
                    { internalType: "address[]", name: "path", type: "address[]" }
                ],
                name: "getAmountsOut",
                outputs: [{ internalType: "uint256[]", name: "", type: "uint256[]" }],
                stateMutability: "view",
                type: "function"
            }
        ];
        
        this.router = new ethers.Contract(this.CONFIG.router, this.routerAbi, this.provider);
        this.priceCache = {};
        this.lastUpdate = {};
        this.CACHE_TTL = 10000; // 10 seconds
    }

    async getLivePrice(base = "BNB", quote = "USDT", path = []) {
        const cacheKey = `${base}-${quote}`;
        const now = Date.now();
        
        // Check cache
        if (this.priceCache[cacheKey] && 
            now - this.lastUpdate[cacheKey] < this.CACHE_TTL) {
            return this.priceCache[cacheKey];
        }
        
        let price = null;
        
        // Try DexScreener first with corrected endpoint
        try {
            const res = await axios.get(`${this.CONFIG.apiEndpoints.dexscreener}/pairs/bsc/${this.CONFIG.router}`);
            if (res.data?.pairs) {
                const pair = res.data.pairs.find(p => 
                    (p.baseToken.symbol === base && p.quoteToken.symbol === quote) ||
                    (p.baseToken.symbol === quote && p.quoteToken.symbol === base)
                );
                if (pair) {
                    price = parseFloat(pair.priceUsd);
                    if (pair.baseToken.symbol === quote) {
                        price = 1 / price;
                    }
                }
            }
        } catch (e) {
            console.log(`DexScreener error for ${base}/${quote}:`, e.message);
        }
        
        // Try on-chain router if path provided
        if (!price && path.length) {
            try {
                const amountIn = ethers.parseUnits("1", 18);
                const amounts = await this.router.getAmountsOut(amountIn, path);
                price = parseFloat(ethers.formatUnits(amounts[amounts.length - 1], 18));
            } catch (e) {
                console.log(`Router error for ${base}/${quote}:`, e.message);
            }
        }
        
        // Fallback to CoinGecko
        if (!price) {
            try {
                const ids = [
                    this.CONFIG.symbol_map[base],
                    this.CONFIG.symbol_map[quote]
                ].join(",");
                
                const response = await axios.get(
                    `${this.CONFIG.apiEndpoints.coingecko}/simple/price?ids=${ids}&vs_currencies=usd`
                );
                
                const data = response.data;
                if (data[this.CONFIG.symbol_map[base]] && data[this.CONFIG.symbol_map[quote]]) {
                    price = data[this.CONFIG.symbol_map[base]].usd / 
                           data[this.CONFIG.symbol_map[quote]].usd;
                }
            } catch (e) {
                console.log(`CoinGecko error for ${base}/${quote}:`, e.message);
            }
        }
        
        if (price) {
            this.priceCache[cacheKey] = price;
            this.lastUpdate[cacheKey] = now;
        }
        
        return price;
    }

    async getPriceImpact(token, amount, dex) {
        try {
            // Get price for 1 token
            const baseAmount = ethers.parseUnits("1", 18);
            const basePrice = await this.router.getAmountsOut(
                baseAmount,
                [token, '0x55d398326f99059fF775485246999027B3197955'] // USDT address
            );

            // Get price for actual amount
            const actualAmount = ethers.parseUnits(amount.toString(), 18);
            const actualPrice = await this.router.getAmountsOut(
                actualAmount,
                [token, '0x55d398326f99059fF775485246999027B3197955'] // USDT address
            );
            
            // Calculate price impact
            const baseRate = basePrice[1] / baseAmount;
            const actualRate = actualPrice[1] / actualAmount;
            const impact = (baseRate - actualRate) / baseRate;
            
            return impact;
        } catch (e) {
            console.log(`Error calculating price impact:`, e.message);
            return 0.01; // Default 1% impact if calculation fails
        }
    }

    async calculateOptimalAmount(token, maxAmount, dex) {
        const steps = 10;
        const stepSize = maxAmount / steps;
        let optimalAmount = 0;
        let maxProfit = 0;
        
        for (let i = 1; i <= steps; i++) {
            const amount = stepSize * i;
            const impact = await this.getPriceImpact(token, amount, dex);
            const profit = amount * (1 - impact) - amount;
            
            if (profit > maxProfit) {
                maxProfit = profit;
                optimalAmount = amount;
            }
        }
        
        return {
            amount: optimalAmount,
            expectedProfit: maxProfit,
            priceImpact: await this.getPriceImpact(token, optimalAmount, dex)
        };
    }
}

export default PriceService;
