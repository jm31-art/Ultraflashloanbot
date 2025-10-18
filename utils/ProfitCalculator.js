const { ethers } = require("hardhat");
const PriceService = require("../services/PriceService");

class ProfitCalculator {
    constructor(provider) {
        this.provider = provider;
        this.priceService = new PriceService();
        this.SLIPPAGE_TOLERANCE = 0.005; // 0.5%
        this.MIN_PROFIT_MARGIN = 0.001; // 0.1% minimum profit margin
        this.gasPrice = 3; // Gwei - reduced for better profitability
        this.gasLimit = 650000; // Optimized gas estimate
        this.ETH_PRICE = 1650; // Current ETH price
        this.BASE_PRICE_IMPACT = 0.0001; // 0.01% base impact
    }

    calculatePriceImpact(amount) {
        // 0.01% impact per $1M traded, capped at 0.1%
        const impactPerMillion = amount / 1000000 * this.BASE_PRICE_IMPACT;
        return Math.min(impactPerMillion, 0.001);
    }

    calculateGasCost() {
        const gasInETH = (this.gasPrice * 1e-9) * this.gasLimit;
        return gasInETH * this.ETH_PRICE;
    }

    async calculateArbitrageProfitability(opportunity) {
        try {
            const { token, amount, buyPrice, sellPrice, useFlashSwap } = opportunity;

            // Calculate raw profit
            const rawProfit = amount * (sellPrice - buyPrice);

            // Calculate fees
            const flashLoanFee = amount * (useFlashSwap ? 0.0005 : 0.003); // 0.05% for flash swaps, 0.3% for flash loans
            const gasCost = this.calculateGasCost();
            const priceImpact = this.calculatePriceImpact(amount);

            // Calculate total costs
            const impactCost = amount * priceImpact;
            const totalCosts = flashLoanFee + gasCost + impactCost;

            // Calculate final profit
            const netProfit = rawProfit - totalCosts;
            const profitMargin = (netProfit / amount) * 100;
            const priceSpread = ((sellPrice - buyPrice) / buyPrice) * 100;

            return {
                rawProfit,
                costs: {
                    flashLoanFee,
                    gasCost,
                    impactCost
                },
                priceImpact,
                adjustedProfit: netProfit,
                profitMargin,
                isProfitable: netProfit > 0,
                details: {
                    priceSpread,
                    token,
                    gasPrice: this.gasPrice
                }
            };
        } catch (e) {
            console.error("Error calculating profitability:", e);
            return null;
        }
    }
}

module.exports = ProfitCalculator;
