const { ethers } = require('ethers');
const { DEX_CONFIGS, TOKENS, TRADING_PAIRS } = require('../config/dex');
const PriceFeed = require('../services/PriceFeed');
const FlashloanSimulator = require('../utils/FlashloanSimulator');

class ArbitrageBot {
    constructor(provider, signer, options = {}) {
        this.provider = provider;
        this.signer = signer;
        this.priceFeed = new PriceFeed(provider);
        this.simulator = new FlashloanSimulator(provider);
        this.minProfitUSD = options.minProfitUSD || 50;
        this.maxGasPrice = options.maxGasPrice || 5; // in gwei
        this.gasPriceRefund = options.gasPriceRefund || 1.5; // Refund if gas price spikes 1.5x
        this.scanInterval = options.scanInterval || 10000; // 10 seconds
        this.isRunning = false;
        this.bnbReserveRatio = 0.5; // Keep 50% in BNB
        this.btcReserveRatio = 0.5; // Keep 50% in BTC
    }

    async convertToBnbAndBtc(amount, token) {
        const bnbAmount = amount.mul(this.bnbReserveRatio);
        const btcAmount = amount.mul(this.btcReserveRatio);

        // Convert to BNB
        await this.swapTokens(
            token,
            TOKENS.BNB.address,
            bnbAmount,
            DEX_CONFIGS.BISWAP // Using BiSwap for best rates
        );

        // Convert to BTC
        await this.swapTokens(
            token,
            TOKENS.BTCB.address,
            btcAmount,
            DEX_CONFIGS.BISWAP
        );
    }

    async swapTokens(tokenIn, tokenOut, amount, dex) {
        const router = new ethers.Contract(
            dex.router,
            ['function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'],
            this.signer
        );

        const path = [tokenIn, tokenOut];
        const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

        const tx = await router.swapExactTokensForTokens(
            amount,
            0, // Accept any amount of tokens (be careful with this in production!)
            path,
            this.signer.address,
            deadline,
            {
                gasLimit: 300000,
                gasPrice: ethers.utils.parseUnits(this.maxGasPrice.toString(), 'gwei')
            }
        );

        return await tx.wait();
    }

    async checkAndRefundGas(txHash) {
        const receipt = await this.provider.getTransactionReceipt(txHash);
        const gasUsed = receipt.gasUsed;
        const gasPrice = receipt.effectiveGasPrice;

        // If gas price spiked during transaction
        if (gasPrice.gt(ethers.utils.parseUnits(this.maxGasPrice.toString(), 'gwei').mul(this.gasPriceRefund))) {
            const refundAmount = gasUsed.mul(gasPrice.sub(ethers.utils.parseUnits(this.maxGasPrice.toString(), 'gwei')));
            console.log(`Gas price spiked! Refunding ${ethers.utils.formatEther(refundAmount)} BNB`);
            
            // Implement your refund logic here
            // This could be from a designated refund wallet or treasury
        }
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('Starting arbitrage bot...');

        while (this.isRunning) {
            try {
                // Get current gas price
                const gasPrice = await this.provider.getGasPrice();
                const gasPriceGwei = ethers.utils.formatUnits(gasPrice, 'gwei');

                if (gasPriceGwei > this.maxGasPrice) {
                    console.log(`Gas price too high: ${gasPriceGwei} gwei > ${this.maxGasPrice} gwei`);
                    continue;
                }

                // Update prices
                const prices = await this.priceFeed.updatePrices(TOKENS, DEX_CONFIGS);
                
                // Find opportunities
                const opportunities = this.priceFeed.getArbitrageOpportunities(prices);

                for (const opp of opportunities) {
                    // Simulate the trade
                    const simulation = await this.simulator.simulateArbitrage(opp);

                    if (simulation.isProfitable && simulation.adjustedProfit >= this.minProfitUSD) {
                        console.log(`Found profitable opportunity:`);
                        console.log(JSON.stringify(opp, null, 2));
                        console.log(`Estimated profit: $${simulation.adjustedProfit}`);

                        // Execute the trade
                        const tx = await this.executeArbitrage(opp);
                        await this.checkAndRefundGas(tx.hash);

                        // Convert profits
                        const profitAmount = ethers.utils.parseEther(simulation.adjustedProfit.toString());
                        await this.convertToBnbAndBtc(profitAmount, opp.token);
                    }
                }

            } catch (error) {
                console.error('Error in arbitrage loop:', error);
            }

            // Wait before next scan
            await new Promise(resolve => setTimeout(resolve, this.scanInterval));
        }
    }

    stop() {
        this.isRunning = false;
        console.log('Stopping arbitrage bot...');
    }
}

module.exports = ArbitrageBot;
