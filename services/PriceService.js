const { ethers } = require('ethers');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class PriceService {
    constructor() {
        const configPath = path.join(__dirname, '../config/price_sources.json');
        this.CONFIG = JSON.parse(fs.readFileSync(configPath));
        
        this.provider = new ethers.providers.JsonRpcProvider(this.CONFIG.bsc_rpc);
        
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
        
        // Try DexScreener first
        try {
            const res = await axios.get(this.CONFIG.dexscreener_url + `${base}/${quote}`);
            if (res.data?.pairs?.length) {
                price = parseFloat(res.data.pairs[0].priceUsd);
            }
        } catch (e) {
            console.log(`DexScreener error for ${base}/${quote}:`, e.message);
        }
        
        // Try on-chain router if path provided
        if (!price && path.length) {
            try {
                const amountIn = ethers.utils.parseUnits("1", 18);
                const amounts = await this.router.getAmountsOut(amountIn, path);
                price = parseFloat(ethers.utils.formatUnits(amounts[amounts.length - 1], 18));
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
                    `${this.CONFIG.coingecko_url}?ids=${ids}&vs_currencies=usd`
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
            const baseAmount = ethers.utils.parseUnits("1", 18);
            const basePrice = await this.router.getAmountsOut(
                baseAmount,
                [token, this.TOKENS.USDT]
            );
            
            // Get price for actual amount
            const actualAmount = ethers.utils.parseUnits(amount.toString(), 18);
            const actualPrice = await this.router.getAmountsOut(
                actualAmount,
                [token, this.TOKENS.USDT]
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

module.exports = PriceService;
