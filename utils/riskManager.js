const Web3 = require('web3');
const performanceMonitor = require('./performanceMonitor');
const { ARBITRAGE } = require('../config/performance');

class RiskManager {
    constructor(web3Provider) {
        this.web3 = new Web3(web3Provider);
        this.circuitBreakers = {
            maxGasPrice: BigInt(50e9), // 50 Gwei
            minLiquidity: BigInt(1e18), // 1 ETH
            maxSlippage: 0.005, // 0.5% - Updated to match production config
            profitThreshold: BigInt(1e17), // 0.1 ETH
        };

        this.activePositions = new Map();
        this.riskScores = new Map();

        // BSC mainnet addresses
        this.wbnbAddress = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

        // Contract ABIs
        this.routerAbi = [
            {"inputs":[{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"}],"name":"getAmountsOut","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"view","type":"function"},
            {"inputs":[{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"uint256","name":"amountOutMin","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"swapExactTokensForTokens","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"nonpayable","type":"function"}
        ];

        this.pairAbi = [
            {"constant":true,"inputs":[],"name":"getReserves","outputs":[{"internalType":"uint112","name":"_reserve0","type":"uint112"},{"internalType":"uint112","name":"_reserve1","type":"uint112"},{"internalType":"uint32","name":"_blockTimestampLast","type":"uint32"}],"payable":false,"stateMutability":"view","type":"function"}
        ];
    }

    async evaluateTransaction(txData) {
        try {
            // Check circuit breakers
            if (!this.checkCircuitBreakers()) {
                throw new Error('Circuit breakers activated');
            }

            // Validate gas price
            const gasPrice = await this.web3.eth.getGasPrice();
            if (BigInt(gasPrice) > this.circuitBreakers.maxGasPrice) {
                throw new Error('Gas price too high');
            }

            // Check liquidity
            const liquidity = await this.checkLiquidity(txData.token);
            if (liquidity < this.circuitBreakers.minLiquidity) {
                throw new Error('Insufficient liquidity');
            }

            // Calculate potential slippage
            const slippage = await this.calculateSlippage(txData);
            if (slippage > this.circuitBreakers.maxSlippage) {
                throw new Error('Slippage too high');
            }

            // Estimate profit
            const estimatedProfit = await this.estimateProfit(txData);
            if (estimatedProfit < this.circuitBreakers.profitThreshold) {
                throw new Error('Insufficient profit margin');
            }

            return {
                safe: true,
                estimatedProfit,
                slippage,
                gasPrice
            };
        } catch (error) {
            performanceMonitor.logError(error, { type: 'risk_evaluation' });
            return {
                safe: false,
                error: error.message
            };
        }
    }

    async checkLiquidity(token) {
        try {
            // Check liquidity across multiple DEXes
            const dexes = ['pancakeswap', 'biswap', 'apeswap'];
            let totalLiquidity = BigInt(0);

            for (const dex of dexes) {
                try {
                    // Get pair address for token/WBNB
                    const pairAddress = await this.getPairAddress(dex, token, this.wbnbAddress);
                    if (pairAddress) {
                        const liquidity = await this.getPairLiquidity(pairAddress);
                        totalLiquidity += liquidity;
                    }
                } catch (error) {
                    continue; // Skip failed DEX checks
                }
            }

            return totalLiquidity;
        } catch (error) {
            console.error('Liquidity check failed:', error);
            return BigInt(0);
        }
    }

    async calculateSlippage(txData) {
        try {
            const { tokenIn, tokenOut, amountIn, dex } = txData;

            // Get current price
            const currentPrice = await this.getCurrentPrice(tokenIn, tokenOut, dex);

            // Simulate trade to get expected output
            const expectedOut = await this.simulateTrade(tokenIn, tokenOut, amountIn, dex);

            // Calculate slippage
            const priceImpact = Math.abs((expectedOut / amountIn) - currentPrice) / currentPrice;

            return Math.min(priceImpact, 1.0); // Cap at 100%
        } catch (error) {
            console.error('Slippage calculation failed:', error);
            return 0.5; // Conservative fallback
        }
    }

    async estimateProfit(txData) {
        try {
            const { amountIn, expectedProfit, gasCost, flashloanFee } = txData;

            // Calculate net profit after all costs
            const grossProfit = BigInt(expectedProfit);
            const gasCostWei = BigInt(gasCost || 0);
            const flashloanFeeWei = BigInt(Math.floor(amountIn * (flashloanFee || 0.0009))); // 0.09% default

            const netProfit = grossProfit - gasCostWei - flashloanFeeWei;

            return netProfit > 0 ? netProfit : BigInt(0);
        } catch (error) {
            console.error('Profit estimation failed:', error);
            return BigInt(0);
        }
    }

    async getPairAddress(dex, tokenA, tokenB) {
        // Implementation would query DEX factory contract
        // This is a simplified version
        return null; // Placeholder
    }

    async getPairLiquidity(pairAddress) {
        try {
            // Query pair contract for reserves
            const pairContract = new this.web3.eth.Contract(this.pairAbi, pairAddress);
            const reserves = await pairContract.methods.getReserves().call();
            return BigInt(reserves[0]) + BigInt(reserves[1]); // Total liquidity
        } catch (error) {
            return BigInt(0);
        }
    }

    async getCurrentPrice(tokenIn, tokenOut, dex) {
        // Get current exchange rate
        try {
            const routerAddress = this.getRouterAddress(dex);
            const router = new this.web3.eth.Contract(this.routerAbi, routerAddress);

            const amounts = await router.methods.getAmountsOut(
                this.web3.utils.toWei('1', 'ether'),
                [tokenIn, tokenOut]
            ).call();

            return parseFloat(this.web3.utils.fromWei(amounts[1], 'ether'));
        } catch (error) {
            return 1.0; // Fallback
        }
    }

    async simulateTrade(tokenIn, tokenOut, amountIn, dex) {
        try {
            const routerAddress = this.getRouterAddress(dex);
            const router = new this.web3.eth.Contract(this.routerAbi, routerAddress);

            const amounts = await router.methods.getAmountsOut(amountIn, [tokenIn, tokenOut]).call();
            return BigInt(amounts[amounts.length - 1]);
        } catch (error) {
            return BigInt(0);
        }
    }

    getRouterAddress(dex) {
        const routers = {
            'pancakeswap': '0x10ED43C718714eb63d5aA57B78B54704E256024E',
            'biswap': '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD48',
            'apeswap': '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7'
        };
        return routers[dex] || routers['pancakeswap'];
    }

    checkCircuitBreakers() {
        // Add custom circuit breaker logic
        return true;
    }

    updateRiskScore(token, score) {
        this.riskScores.set(token, score);
    }

    async monitorPosition(positionId, token, amount) {
        this.activePositions.set(positionId, {
            token,
            amount,
            timestamp: Date.now()
        });
    }

    async closePosition(positionId) {
        if (this.activePositions.has(positionId)) {
            const position = this.activePositions.get(positionId);
            this.activePositions.delete(positionId);
            return position;
        }
        return null;
    }
}

module.exports = RiskManager;
