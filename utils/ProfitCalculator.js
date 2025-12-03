const { ethers } = require("hardhat");
const PriceService = require("../services/PriceService");
const FlashProvider = require("./FlashProvider");

class ProfitCalculator {
    constructor(provider) {
        this.provider = provider;
        this.priceService = new PriceService();
        this.flashProvider = new FlashProvider(provider);
        this.SLIPPAGE_TOLERANCE = 0.005; // 0.5%
        this.MIN_PROFIT_MARGIN = 0.001; // 0.1% minimum profit margin
        this.gasPrice = 3; // Gwei - reduced for better profitability
        this.gasLimit = 650000; // Optimized gas estimate
        this.ETH_PRICE = 1650; // Current ETH price
        this.BASE_PRICE_IMPACT = 0.0001; // 0.01% base impact

        // Dynamic fee adjustment parameters
        this.marketVolatility = 0.02; // 2% base volatility
        this.competitionLevel = 'medium'; // low, medium, high
        this.networkCongestion = 1.0; // Multiplier for gas costs
        this.opportunityFrequency = 10; // Opportunities per hour

        // Async consistency: Use mutex for critical calculations
        this.calculationMutex = new Map();
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
        // Async consistency: Use mutex to prevent race conditions
        const opportunityKey = `${opportunity.token}-${opportunity.amount}`;
        if (this.calculationMutex.get(opportunityKey)) {
            // Return cached result if calculation is in progress
            return this.calculationMutex.get(opportunityKey);
        }

        try {
            const { token, amount, buyPrice, sellPrice, useFlashSwap, protocol } = opportunity;

            // Set mutex to prevent concurrent calculations
            this.calculationMutex.set(opportunityKey, { inProgress: true });

            // Calculate raw profit
            const rawProfit = amount * (sellPrice - buyPrice);

            // Use dynamic flash loan fee based on protocol
            let flashLoanFee = 0;
            if (protocol) {
                const feeAmount = await this.flashProvider.estimateFlashCost(
                    ethers.utils.parseUnits(amount.toString(), 18),
                    protocol
                );
                flashLoanFee = parseFloat(ethers.utils.formatEther(feeAmount));
            } else {
                // Fallback to default DODO fee for backward compatibility
                flashLoanFee = amount * 0.0002; // 0.02% DODO flashloan fee from simulation
            }

            // Dynamic gas cost calculation based on network conditions
            const gasCost = this.calculateDynamicGasCost(amount, opportunity);

            const priceImpact = this.calculatePriceImpact(amount);

            // Calculate total costs
            const impactCost = amount * priceImpact;
            const totalCosts = flashLoanFee + gasCost + impactCost;

            // Calculate final profit
            const netProfit = rawProfit - totalCosts;
            const profitMargin = (netProfit / amount) * 100;
            const priceSpread = ((sellPrice - buyPrice) / buyPrice) * 100;

            // Apply dynamic fee adjustments for high-frequency trading
            const adjustedResult = await this.applyDynamicFeeAdjustments({
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
                    protocol: protocol || 'DODO',
                    gasPrice: this.gasPrice
                }
            }, opportunity);

            // Clear mutex and return result
            this.calculationMutex.delete(opportunityKey);
            return adjustedResult;

        } catch (e) {
            console.error("Error calculating profitability:", e);
            // Clear mutex on error
            this.calculationMutex.delete(opportunityKey);
            return null;
        }
    }

    calculateDynamicGasCost(amount, opportunity) {
        // Base gas cost
        let gasCost = 3.22; // $3.22 base gas cost

        // Adjust based on network congestion
        gasCost *= this.networkCongestion;

        // Adjust based on market volatility (higher volatility = higher gas costs)
        if (this.marketVolatility > 0.03) {
            gasCost *= 1.3; // +30% for high volatility
        }

        // Adjust based on competition level
        if (this.competitionLevel === 'high') {
            gasCost *= 1.5; // +50% for high competition
        } else if (this.competitionLevel === 'low') {
            gasCost *= 0.8; // -20% for low competition
        }

        // Adjust based on opportunity size (larger trades need more gas)
        if (amount > 500000) {
            gasCost *= 1.2; // +20% for large opportunities
        }

        return gasCost;
    }

    async applyDynamicFeeAdjustments(baseResult, opportunity) {
        // Apply market condition adjustments
        let adjustedProfit = baseResult.adjustedProfit;
        let adjustedMargin = baseResult.profitMargin;

        // Competition-based adjustments
        if (this.competitionLevel === 'high') {
            // In high competition, require higher profit margins
            const minMargin = 0.5; // 0.5% minimum
            if (adjustedMargin < minMargin) {
                adjustedProfit = 0; // Mark as unprofitable
                adjustedMargin = 0;
            }
        } else if (this.competitionLevel === 'low') {
            // In low competition, can accept lower margins
            const minMargin = 0.1; // 0.1% minimum
            if (adjustedMargin < minMargin) {
                adjustedProfit = 0;
                adjustedMargin = 0;
            }
        }

        // Volatility-based adjustments
        if (this.marketVolatility > 0.05) {
            // High volatility requires higher margins for safety
            adjustedProfit *= 0.9; // Reduce profit estimate by 10%
            adjustedMargin *= 0.9;
        }

        // Opportunity frequency adjustments
        if (this.opportunityFrequency > 15) {
            // High frequency trading - can be more aggressive
            adjustedProfit *= 1.05; // Slight increase in profit estimate
            adjustedMargin *= 1.05;
        }

        return {
            ...baseResult,
            adjustedProfit,
            profitMargin: adjustedMargin,
            isProfitable: adjustedProfit > 0,
            dynamicAdjustments: {
                competitionLevel: this.competitionLevel,
                marketVolatility: this.marketVolatility,
                networkCongestion: this.networkCongestion,
                opportunityFrequency: this.opportunityFrequency,
                profitMultiplier: adjustedProfit / baseResult.adjustedProfit,
                marginMultiplier: adjustedMargin / baseResult.profitMargin
            }
        };
    }

    // Update market conditions (to be called periodically)
    updateMarketConditions(conditions) {
        if (conditions.volatility !== undefined) {
            this.marketVolatility = Math.max(0.005, Math.min(0.2, conditions.volatility)); // Clamp between 0.5% and 20%
        }
        if (conditions.competition !== undefined) {
            this.competitionLevel = conditions.competition; // 'low', 'medium', 'high'
        }
        if (conditions.congestion !== undefined) {
            this.networkCongestion = Math.max(0.1, Math.min(5.0, conditions.congestion)); // Clamp between 0.1x and 5x
        }
        if (conditions.frequency !== undefined) {
            this.opportunityFrequency = Math.max(1, Math.min(100, conditions.frequency)); // Clamp between 1 and 100
        }
    }

    // Get current market condition parameters
    getMarketConditions() {
        return {
            marketVolatility: this.marketVolatility,
            competitionLevel: this.competitionLevel,
            networkCongestion: this.networkCongestion,
            opportunityFrequency: this.opportunityFrequency
        };
    }
}

module.exports = ProfitCalculator;
