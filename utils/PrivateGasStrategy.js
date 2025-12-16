/**
 * PRIVATE GAS STRATEGY
 * Conservative gas pricing for private execution
 * Prioritizes inclusion over speed, profit protection over competition
 */

import { ethers } from 'ethers';
import { provider as publicProvider } from '../src/dex/routers.js';

class PrivateGasStrategy {
    constructor() {
        // Conservative gas limits
        this.maxFeePerGasCap = ethers.parseUnits('20', 'gwei'); // $20 gwei max
        this.basePriorityFee = ethers.parseUnits('1', 'gwei'); // 1 gwei base priority
        this.dynamicPriorityMultiplier = 1.5; // 1.5x for high-value bundles

        // Bundle value thresholds
        this.highValueThreshold = 50; // $50+ bundles get priority boost
        this.mediumValueThreshold = 10; // $10+ bundles get moderate priority

        // Network congestion thresholds
        this.congestionThreshold = ethers.parseUnits('10', 'gwei'); // 10 gwei = congested
        this.lowCongestionThreshold = ethers.parseUnits('3', 'gwei'); // 3 gwei = low congestion

        // Cache for gas data
        this.gasDataCache = null;
        this.cacheTimeout = 10000; // 10 seconds
        this.lastCacheUpdate = 0;
    }

    /**
     * Calculate optimal gas parameters for private execution
     * @param {Object} options - Gas calculation options
     * @param {number} options.bundleValueUSD - Value of the bundle in USD
     * @param {number} options.profitMarginUSD - Profit margin in USD
     * @param {boolean} options.isHighPriority - Whether this is high priority
     * @returns {Object} Gas parameters
     */
    async calculateGasParameters(options = {}) {
        const { bundleValueUSD = 0, profitMarginUSD = 0, isHighPriority = false } = options;

        // Update gas data cache
        await this._updateGasDataCache();

        // Base gas parameters
        let maxFeePerGas = this.gasDataCache?.maxFeePerGas || ethers.parseUnits('5', 'gwei');
        let maxPriorityFeePerGas = this.basePriorityFee;

        // Apply conservative caps
        maxFeePerGas = maxFeePerGas > this.maxFeePerGasCap ? this.maxFeePerGasCap : maxFeePerGas;

        // Dynamic priority based on bundle value and network conditions
        maxPriorityFeePerGas = this._calculateDynamicPriority(
            maxPriorityFeePerGas,
            bundleValueUSD,
            this.gasDataCache?.gasPrice
        );

        // High priority override
        if (isHighPriority) {
            maxPriorityFeePerGas = ethers.parseUnits('2', 'gwei');
        }

        // Profit protection: Never spend more than 10% of profit on gas
        if (profitMarginUSD > 0) {
            const maxGasCostUSD = profitMarginUSD * 0.1; // 10% of profit
            const gasCostEstimate = this._estimateGasCostUSD(maxFeePerGas, maxPriorityFeePerGas);

            if (gasCostEstimate > maxGasCostUSD) {
                // Reduce gas price to stay within profit limits
                const reductionFactor = maxGasCostUSD / gasCostEstimate;
                maxFeePerGas = ethers.parseUnits(
                    Math.max(1, Number(ethers.formatUnits(maxFeePerGas, 'gwei')) * reductionFactor).toString(),
                    'gwei'
                );
                maxPriorityFeePerGas = ethers.parseUnits(
                    Math.max(0.1, Number(ethers.formatUnits(maxPriorityFeePerGas, 'gwei')) * reductionFactor).toString(),
                    'gwei'
                );
            }
        }

        // Final validation
        maxFeePerGas = this._validateGasPrice(maxFeePerGas);
        maxPriorityFeePerGas = this._validateGasPrice(maxPriorityFeePerGas);

        return {
            maxFeePerGas,
            maxPriorityFeePerGas,
            gasPrice: maxFeePerGas, // Fallback for legacy support
            strategy: 'private_conservative',
            bundleValueUSD,
            profitMarginUSD,
            estimatedCostUSD: this._estimateGasCostUSD(maxFeePerGas, maxPriorityFeePerGas)
        };
    }

    /**
     * Calculate dynamic priority fee based on bundle value and network
     * @private
     */
    _calculateDynamicPriority(basePriority, bundleValueUSD, networkGasPrice) {
        let priorityFee = basePriority;

        // Value-based priority boost
        if (bundleValueUSD >= this.highValueThreshold) {
            priorityFee = ethers.parseUnits(
                (Number(ethers.formatUnits(priorityFee, 'gwei')) * this.dynamicPriorityMultiplier * 1.5).toString(),
                'gwei'
            );
        } else if (bundleValueUSD >= this.mediumValueThreshold) {
            priorityFee = ethers.parseUnits(
                (Number(ethers.formatUnits(priorityFee, 'gwei')) * this.dynamicPriorityMultiplier).toString(),
                'gwei'
            );
        }

        // Network congestion adjustment
        if (networkGasPrice) {
            if (networkGasPrice > this.congestionThreshold) {
                // High congestion - slight priority increase
                priorityFee = ethers.parseUnits(
                    (Number(ethers.formatUnits(priorityFee, 'gwei')) * 1.2).toString(),
                    'gwei'
                );
            } else if (networkGasPrice < this.lowCongestionThreshold) {
                // Low congestion - reduce priority
                priorityFee = ethers.parseUnits(
                    Math.max(0.1, Number(ethers.formatUnits(priorityFee, 'gwei')) * 0.8).toString(),
                    'gwei'
                );
            }
        }

        return priorityFee;
    }

    /**
     * Estimate gas cost in USD
     * @private
     */
    _estimateGasCostUSD(maxFeePerGas, maxPriorityFeePerGas) {
        // Conservative gas limit for MEV bundles
        const gasLimit = 500000n; // 500k gas

        // Use effective gas price (maxFeePerGas includes priority fee)
        const effectiveGasPrice = maxFeePerGas;

        const gasCostWei = gasLimit * effectiveGasPrice;
        const gasCostEth = Number(ethers.formatEther(gasCostWei));
        const bnbPrice = 567; // Approximation

        return gasCostEth * bnbPrice;
    }

    /**
     * Validate gas price is within safe bounds
     * @private
     */
    _validateGasPrice(gasPrice) {
        const minGasPrice = ethers.parseUnits('0.1', 'gwei');
        const maxGasPrice = this.maxFeePerGasCap;

        if (gasPrice < minGasPrice) {
            return minGasPrice;
        }

        if (gasPrice > maxGasPrice) {
            return maxGasPrice;
        }

        return gasPrice;
    }

    /**
     * Update gas data cache
     * @private
     */
    async _updateGasDataCache() {
        const now = Date.now();
        if (now - this.lastCacheUpdate < this.cacheTimeout && this.gasDataCache) {
            return;
        }

        try {
            this.gasDataCache = await publicProvider.getFeeData();
            this.lastCacheUpdate = now;
        } catch (error) {
            console.warn('⚠️ Gas data cache update failed:', error.message);
            // Keep old cache if available
        }
    }

    /**
     * Check if gas strategy should be used for an opportunity
     * @param {Object} opportunity - Trading opportunity
     * @returns {boolean} Whether to use private gas strategy
     */
    shouldUsePrivateGas(opportunity) {
        // Always use private gas for MEV bundles
        if (opportunity.type === 'mev_bundle' || opportunity.mode === 'MEV_BUNDLE') {
            return true;
        }

        // Use private gas for high-value opportunities
        if (opportunity.expectedProfitUSD >= this.highValueThreshold) {
            return true;
        }

        // Use private gas for liquidation opportunities (safer)
        if (opportunity.protocol && opportunity.healthFactor) {
            return true;
        }

        return false;
    }

    /**
     * Get strategy statistics
     */
    getStats() {
        return {
            maxFeePerGasCap: ethers.formatUnits(this.maxFeePerGasCap, 'gwei'),
            basePriorityFee: ethers.formatUnits(this.basePriorityFee, 'gwei'),
            dynamicPriorityMultiplier: this.dynamicPriorityMultiplier,
            highValueThreshold: this.highValueThreshold,
            mediumValueThreshold: this.mediumValueThreshold,
            cacheTimeout: this.cacheTimeout,
            lastCacheUpdate: new Date(this.lastCacheUpdate).toISOString(),
            gasDataCache: this.gasDataCache ? {
                gasPrice: ethers.formatUnits(this.gasDataCache.gasPrice || 0, 'gwei'),
                maxFeePerGas: ethers.formatUnits(this.gasDataCache.maxFeePerGas || 0, 'gwei'),
                maxPriorityFeePerGas: ethers.formatUnits(this.gasDataCache.maxPriorityFeePerGas || 0, 'gwei')
            } : null
        };
    }
}

// Export singleton instance
const privateGasStrategy = new PrivateGasStrategy();

export default privateGasStrategy;