/**
 * ATOMIC ARBITRAGE + LIQUIDATION COMPOSER
 * Evaluates and composes atomic MEV opportunities from arbitrage and liquidation
 */

import { ethers } from 'ethers';
import { monitoring } from '../src/monitoring.js';

class MEVOpportunityComposer {
    constructor() {
        this.gasPriceCache = null;
        this.cacheTimeout = 30000; // 30 seconds
        this.lastCacheUpdate = 0;
    }

    /**
     * Evaluate combined arbitrage and liquidation opportunities
     * @param {Object} arbOpportunity - Arbitrage opportunity
     * @param {Object} liqOpportunity - Liquidation opportunity
     * @param {Object} gasStrategy - Gas pricing strategy
     * @returns {Object} Composition result
     */
    async evaluateCombinedOpportunity(arbOpportunity, liqOpportunity, gasStrategy) {
        try {
            // Individual profitability checks
            const arbProfit = this._calculateIndividualProfit(arbOpportunity, 'arbitrage');
            const liqProfit = this._calculateIndividualProfit(liqOpportunity, 'liquidation');

            // Skip if either is not profitable individually
            if (!arbProfit.isProfitable && !liqProfit.isProfitable) {
                monitoring.logSkippedPath('no_individual_profit', {
                    arbProfit: arbProfit.netProfit?.toFixed(2),
                    liqProfit: liqProfit.netProfit?.toFixed(2)
                });
                return { shouldCompose: false, reason: 'no individual profitability' };
            }

            // Calculate combined execution costs
            const combinedCosts = await this._calculateCombinedCosts(arbOpportunity, liqOpportunity, gasStrategy);

            // Calculate combined profit
            const totalRevenue = (arbProfit.revenue || 0) + (liqProfit.revenue || 0);
            const totalCosts = combinedCosts.totalGas + combinedCosts.flashloanFee;
            const combinedProfit = totalRevenue - totalCosts;

            // Individual execution profits for comparison
            const arbOnlyProfit = arbProfit.isProfitable ? arbProfit.netProfit : 0;
            const liqOnlyProfit = liqProfit.isProfitable ? liqProfit.netProfit : 0;
            const maxIndividualProfit = Math.max(arbOnlyProfit, liqOnlyProfit);

            // Composition decision logic
            const profitThreshold = Math.max(maxIndividualProfit * 0.1, 5); // 10% of max individual or $5 minimum

            if (combinedProfit > maxIndividualProfit + profitThreshold) {
                console.log(`🎯 ATOMIC MEV OPPORTUNITY: Combined profit $${combinedProfit.toFixed(2)} > max individual $${maxIndividualProfit.toFixed(2)}`);

                return {
                    shouldCompose: true,
                    combinedProfit: combinedProfit,
                    breakdown: {
                        arbitrageRevenue: arbProfit.revenue,
                        liquidationRevenue: liqProfit.revenue,
                        totalRevenue: totalRevenue,
                        combinedGasCost: combinedCosts.totalGas,
                        flashloanFee: combinedCosts.flashloanFee,
                        totalCosts: totalCosts
                    },
                    opportunities: {
                        arbitrage: arbOpportunity,
                        liquidation: liqOpportunity
                    }
                };
            } else {
                monitoring.logSkippedPath('atomic_not_profitable', {
                    combinedProfit: combinedProfit.toFixed(2),
                    maxIndividual: maxIndividualProfit.toFixed(2),
                    difference: (combinedProfit - maxIndividualProfit).toFixed(2)
                });

                return {
                    shouldCompose: false,
                    reason: 'combined profit not sufficiently higher',
                    combinedProfit: combinedProfit,
                    maxIndividualProfit: maxIndividualProfit
                };
            }

        } catch (error) {
            console.error('❌ MEV composition evaluation failed:', error.message);
            monitoring.logCriticalError(error, 'mev_composition');
            return { shouldCompose: false, reason: 'evaluation error' };
        }
    }

    /**
     * Calculate profit for individual opportunity
     * @private
     */
    _calculateIndividualProfit(opportunity, type) {
        if (!opportunity) {
            return { isProfitable: false, netProfit: 0, revenue: 0 };
        }

        try {
            let revenue = 0;
            let costs = 0;

            if (type === 'arbitrage') {
                // Arbitrage revenue from price difference
                revenue = opportunity.expectedProfitUSD || 0;
                costs = opportunity.gasCostUSD || 0;
            } else if (type === 'liquidation') {
                // Liquidation revenue from bonus
                const debtValue = opportunity.debtToCoverUSD || 0;
                const bonus = opportunity.liquidationBonus || 0.05; // 5% default
                revenue = debtValue * bonus;
                costs = opportunity.gasCostUSD || 0;
            }

            const netProfit = revenue - costs;
            const isProfitable = netProfit > 1; // $1 minimum profit threshold

            return {
                isProfitable,
                netProfit,
                revenue,
                costs
            };

        } catch (error) {
            console.warn(`⚠️ Individual ${type} profit calculation failed:`, error.message);
            return { isProfitable: false, netProfit: 0, revenue: 0 };
        }
    }

    /**
     * Calculate combined execution costs
     * @private
     */
    async _calculateCombinedCosts(arbOpportunity, liqOpportunity, gasStrategy) {
        try {
            // Update gas price cache
            await this._updateGasPriceCache();

            // Estimate gas for combined execution
            const combinedGasEstimate = this._estimateCombinedGas(arbOpportunity, liqOpportunity);
            const gasPrice = this.gasPriceCache?.gasPrice || ethers.parseUnits('5', 'gwei');

            const gasCostWei = combinedGasEstimate * gasPrice;
            const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));
            const bnbPrice = 567; // Approximation
            const gasCostUSD = gasCostEth * bnbPrice;

            // Flashloan fee (only once for combined execution)
            const flashloanAmount = arbOpportunity?.amountIn || liqOpportunity?.debtToCover || ethers.parseEther('1');
            const flashloanFeeRate = 0.0009; // 0.09%
            const flashloanFeeUSD = parseFloat(ethers.formatEther(flashloanAmount)) * flashloanFeeRate * bnbPrice;

            return {
                totalGas: gasCostUSD,
                flashloanFee: flashloanFeeUSD,
                gasEstimate: combinedGasEstimate
            };

        } catch (error) {
            console.warn('⚠️ Combined cost calculation failed:', error.message);
            // Return conservative estimates
            return {
                totalGas: 10, // $10 gas estimate
                flashloanFee: 5, // $5 flashloan fee estimate
                gasEstimate: 500000n
            };
        }
    }

    /**
     * Estimate gas for combined execution
     * @private
     */
    _estimateCombinedGas(arbOpportunity, liqOpportunity) {
        let totalGas = 200000n; // Base gas

        // Add arbitrage gas
        if (arbOpportunity) {
            totalGas += 300000n; // Arbitrage execution gas
        }

        // Add liquidation gas
        if (liqOpportunity) {
            totalGas += 400000n; // Liquidation execution gas
        }

        // Add flashloan gas (shared)
        totalGas += 150000n;

        // Add buffer for atomic execution
        totalGas = totalGas * 120n / 100n; // 20% buffer

        return totalGas;
    }

    /**
     * Update gas price cache
     * @private
     */
    async _updateGasPriceCache() {
        const now = Date.now();
        if (now - this.lastCacheUpdate < this.cacheTimeout && this.gasPriceCache) {
            return;
        }

        try {
            // Import provider dynamically to avoid circular dependency
            const { provider } = await import('../src/dex/routers.js');
            this.gasPriceCache = await provider.getFeeData();
            this.lastCacheUpdate = now;
        } catch (error) {
            console.warn('⚠️ Gas price cache update failed:', error.message);
        }
    }

    /**
     * Create execution plan for atomic MEV
     * @param {Object} compositionResult - Result from evaluateCombinedOpportunity
     * @returns {Object} Execution plan
     */
    createExecutionPlan(compositionResult) {
        if (!compositionResult.shouldCompose) {
            return null;
        }

        const { opportunities, combinedProfit, breakdown } = compositionResult;

        return {
            type: 'atomic_mev',
            profit: combinedProfit,
            minProfit: combinedProfit * 0.8, // 80% of expected profit
            opportunities: opportunities,
            breakdown: breakdown,
            executionOrder: [
                'flashloan',
                'arbitrage',
                'liquidation',
                'repayment'
            ],
            riskLevel: 'medium', // Atomic execution has some risk
            timeout: 120000 // 2 minutes
        };
    }

    /**
     * Get composer statistics
     */
    getStats() {
        return {
            cacheTimeout: this.cacheTimeout,
            lastCacheUpdate: new Date(this.lastCacheUpdate).toISOString(),
            gasPriceCache: this.gasPriceCache ? {
                gasPrice: ethers.formatUnits(this.gasPriceCache.gasPrice || 0, 'gwei'),
                maxFeePerGas: ethers.formatUnits(this.gasPriceCache.maxFeePerGas || 0, 'gwei'),
                maxPriorityFeePerGas: ethers.formatUnits(this.gasPriceCache.maxPriorityFeePerGas || 0, 'gwei')
            } : null
        };
    }
}

// Export singleton instance
const mevOpportunityComposer = new MEVOpportunityComposer();

export default mevOpportunityComposer;