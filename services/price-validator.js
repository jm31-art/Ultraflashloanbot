const { spawn } = require('child_process');

class PriceValidator {
    constructor() {
        this.stablecoins = new Set(['USDT', 'USDC', 'BUSD', 'DAI']);
        this.maxStablecoinDeviation = 0.05;  // 5% for stablecoins
        this.maxTokenDeviation = 0.20;       // 20% for other tokens
        this.minLiquidityUsd = 100000;      // $100k minimum liquidity
        this.minSourceCount = 3;            // Minimum number of price sources
    }

    async validatePrice(token, price, liquidity = null) {
        if (!price || price <= 0) return false;
        
        // Check if token is a stablecoin
        if (this.stablecoins.has(token)) {
            if (Math.abs(price - 1.0) > this.maxStablecoinDeviation) {
                console.log(`Warning: ${token} price ${price} deviates >5% from $1.00`);
                return false;
            }
        }
        
        // Validate liquidity if provided
        if (liquidity !== null && liquidity < this.minLiquidityUsd) {
            console.log(`Warning: ${token} liquidity ${liquidity} below minimum ${this.minLiquidityUsd}`);
            return false;
        }
        
        return true;
    }

    async validatePairPrice(baseToken, quoteToken, price, baseLiquidity, quoteLiquidity) {
        // Both stablecoins - should be very close to 1:1
        if (this.stablecoins.has(baseToken) && this.stablecoins.has(quoteToken)) {
            if (Math.abs(price - 1.0) > this.maxStablecoinDeviation) {
                console.log(`Warning: ${baseToken}/${quoteToken} price ${price} deviates >5% from 1.0`);
                return false;
            }
        }

        // Validate liquidity
        if (baseLiquidity < this.minLiquidityUsd || quoteLiquidity < this.minLiquidityUsd) {
            console.log(`Warning: ${baseToken}/${quoteToken} insufficient liquidity`);
            return false;
        }

        return true;
    }

    async getPythonPrice(token) {
        return new Promise((resolve, reject) => {
            const python = spawn('python', ['scripts/get_price.py', token]);
            let output = '';

            python.stdout.on('data', (data) => {
                output += data.toString();
            });

            python.stderr.on('data', (data) => {
                console.error(`Python Error: ${data}`);
            });

            python.on('close', (code) => {
                if (code !== 0) {
                    reject(`Python process exited with code ${code}`);
                    return;
                }
                try {
                    const price = parseFloat(output.trim());
                    resolve(price);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async crossValidatePrice(token, price) {
        try {
            const pythonPrice = await this.getPythonPrice(token);
            if (!pythonPrice) return false;

            const deviation = Math.abs(price - pythonPrice) / pythonPrice;
            const maxAllowedDeviation = this.stablecoins.has(token) ? 
                this.maxStablecoinDeviation : this.maxTokenDeviation;

            if (deviation > maxAllowedDeviation) {
                console.log(`Warning: ${token} price ${price} deviates >${maxAllowedDeviation*100}% from Python price ${pythonPrice}`);
                return false;
            }

            return true;
        } catch (e) {
            console.error(`Error cross-validating price: ${e}`);
            return false;
        }
    }
}

module.exports = PriceValidator;
