const axios = require('axios');

class CoinAPIService {
    constructor() {
        // Try multiple environment variable names
        this.apiKey = process.env.COINAPI_KEY || process.env.COIN_API_KEY || process.env.COIN_API_SECRET;
        
        // Check for API key
        if (!this.apiKey) {
            console.warn("COINAPI_KEY environment variable not set - price fetching will be limited");
            this.enabled = false;
            return;
        }
        
        this.enabled = true;
        this.baseUrl = "https://rest.coinapi.io/v1";
        this.headers = {
            'X-CoinAPI-Key': this.apiKey,
            'Accept': 'application/json'
        };
        
        // Symbol mapping for CoinAPI
        this.symbolMap = {
            'USDT': 'USDT',
            'WBNB': 'BNB',  // Map WBNB to BNB for CoinAPI
            'ETH': 'ETH',
            'WETH': 'ETH',  // Map WETH to ETH
            'BTC': 'BTC',
            'CAKE': 'CAKE',
            'LINK': 'LINK'
        };
    }
    
    async getTokenPrice(symbol) {
        if (!this.enabled) {
            return null;
        }

        try {
            // Map token symbol to CoinAPI format
            const apiSymbol = this.symbolMap[symbol] || symbol;
            
            // Add retry logic
            const maxRetries = 3;
            let retryCount = 0;
            let lastError = null;

            while (retryCount < maxRetries) {
                try {
                    const response = await axios.get(
                        `${this.baseUrl}/exchangerate/${apiSymbol}/USD`,
                        { 
                            headers: this.headers,
                            timeout: 5000 // 5 second timeout
                        }
                    );
                    
                    if (response.status === 200) {
                        return {
                            price: parseFloat(response.data.rate),
                            timestamp: response.data.time,
                            source: 'coinapi'
                        };
                    }
                    return null;
                } catch (error) {
                    lastError = error;
                    if (error.response?.status === 429) {
                        // Rate limit hit - wait longer between retries
                        await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
                    }
                    retryCount++;
                }
            }

            // Log the final error after all retries
            if (lastError.response?.status === 429) {
                console.warn("CoinAPI rate limit reached after retries");
            } else {
                console.error(`Failed to fetch price from CoinAPI for ${symbol} after ${maxRetries} attempts:`, lastError.message);
            }
            return null;
            
        } catch (error) {
            if (error.response?.status === 429) {
                console.warn("CoinAPI rate limit reached");
            } else {
                console.error(`Error fetching price from CoinAPI for ${symbol}:`, error.message);
            }
            return null;
        }
    }
    
    async getExchangeRate(baseSymbol, quoteSymbol) {
        try {
            const base = this.symbolMap[baseSymbol] || baseSymbol;
            const quote = this.symbolMap[quoteSymbol] || quoteSymbol;
            
            const response = await axios.get(
                `${this.baseUrl}/exchangerate/${base}/${quote}`,
                { headers: this.headers }
            );
            
            if (response.status === 200) {
                return parseFloat(response.data.rate);
            }
            return null;
            
        } catch (error) {
            console.error(`Error fetching exchange rate from CoinAPI:`, error.message);
            return null;
        }
    }
}

module.exports = CoinAPIService;
