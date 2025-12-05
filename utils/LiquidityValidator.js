const { ethers } = require('ethers');

class LiquidityValidator {
    constructor() {
        this.ethers = ethers;
    }

    calculateProfit(amount, buyPrice, sellPrice) {
        // Convert amount to BigNumber to handle large numbers precisely
        const amountBN = ethers.parseUnits(amount.toString(), 18);
        const buyPriceBN = ethers.parseUnits(buyPrice.toString(), 18);
        const sellPriceBN = ethers.parseUnits(sellPrice.toString(), 18);

        // Calculate: amount * buyPrice - amount * sellPrice
        // This gives us the direct price difference
        const boughtAmount = amountBN.mul(buyPriceBN).div(ethers.constants.WeiPerEther);
        const soldAmount = amountBN.mul(sellPriceBN).div(ethers.constants.WeiPerEther);
        const profit = soldAmount.sub(boughtAmount);

        return {
            profit: ethers.formatEther(profit),
            tokensBought: ethers.formatEther(tokensReceived),
            amountReceived: ethers.formatEther(sellAmount)
        };
    }

    calculateNetProfit(amount, buyPrice, sellPrice, fees) {
        const { profit } = this.calculateProfit(amount, buyPrice, sellPrice);
        const profitBN = ethers.parseEther(profit);
        
        // Subtract all fees
        const totalFeesBN = ethers.parseEther(fees.toString());
        const netProfitBN = profitBN.sub(totalFeesBN);

        return ethers.formatEther(netProfitBN);
    }

    isProfitable(amount, buyPrice, sellPrice, fees) {
        const netProfit = this.calculateNetProfit(amount, buyPrice, sellPrice, fees);
        return parseFloat(netProfit) > 0;
    }

    calculatePriceImpact(amount, price, liquidity) {
        // Simplified price impact calculation
        // Impact = (amount / liquidity) * 100
        const impact = (amount / liquidity) * 100;
        return Math.min(impact, 100); // Cap at 100%
    }

    validateLiquidity(token, dex, requiredLiquidity) {
        // Implementation would check actual DEX liquidity
        // This is a placeholder that should be implemented with real DEX queries
        return true;
    }
}

module.exports = LiquidityValidator;
