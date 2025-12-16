/**
 * TOKEN & PAIR VALIDATION UTILITY
 * Pre-flight validation to prevent undefined token errors
 */

import { TOKENS } from '../config/dex.js';
import { ethers } from 'ethers';

class TokenValidator {
    constructor() {
        this.validatedTokens = new Set();
        this.validatedPairs = new Set();
        this.supportedDEXes = ['PANCAKESWAP', 'BISWAP'];
    }

    /**
     * Validate token before use
     * @param {string} tokenAddress - Token contract address
     * @returns {boolean} True if token is valid
     */
    validateToken(tokenAddress) {
        if (!tokenAddress || typeof tokenAddress !== 'string') {
            return false;
        }

        // Check if it's a valid Ethereum address
        try {
            ethers.getAddress(tokenAddress);
        } catch (error) {
            return false;
        }

        // Check if token exists in our configuration
        const tokenData = this._findTokenInConfig(tokenAddress);
        if (!tokenData) {
            return false;
        }

        // Validate required metadata
        if (!this._hasRequiredMetadata(tokenData)) {
            return false;
        }

        // Cache validation result
        this.validatedTokens.add(tokenAddress.toLowerCase());
        return true;
    }

    /**
     * Validate token pair before arbitrage simulation
     * @param {Array} path - Token path array
     * @param {string} dexName - DEX name
     * @returns {boolean} True if pair is valid for the DEX
     */
    validatePair(path, dexName) {
        if (!Array.isArray(path) || path.length < 2) {
            return false;
        }

        // Validate all tokens in path
        for (const tokenAddress of path) {
            if (!this.validateToken(tokenAddress)) {
                return false;
            }
        }

        // Check if DEX is supported
        if (!this.supportedDEXes.includes(dexName?.toUpperCase())) {
            return false;
        }

        // Check if pair is registered for this DEX
        if (!this._isPairSupportedOnDEX(path, dexName)) {
            return false;
        }

        // Cache validation result
        const pairKey = `${path.join('-')}-${dexName}`.toLowerCase();
        this.validatedPairs.add(pairKey);
        return true;
    }

    /**
     * Validate liquidation position data
     * @param {Object} position - Liquidation position
     * @returns {boolean} True if position data is valid
     */
    validateLiquidationPosition(position) {
        if (!position || typeof position !== 'object') {
            return false;
        }

        // Required fields
        const requiredFields = ['user', 'collateralAsset', 'debtAsset', 'maxLiquidationAmount'];
        for (const field of requiredFields) {
            if (!position[field]) {
                return false;
            }
        }

        // Validate addresses
        const addresses = [position.user, position.collateralAsset, position.debtAsset];
        for (const address of addresses) {
            if (!this.validateToken(address)) {
                return false;
            }
        }

        // Validate amounts
        if (!position.maxLiquidationAmount || position.maxLiquidationAmount.isZero()) {
            return false;
        }

        return true;
    }

    /**
     * Get validation statistics
     * @returns {Object} Validation stats
     */
    getStats() {
        return {
            validatedTokens: this.validatedTokens.size,
            validatedPairs: this.validatedPairs.size,
            supportedDEXes: this.supportedDEXes.length
        };
    }

    /**
     * Find token in configuration
     * @private
     */
    _findTokenInConfig(tokenAddress) {
        const normalizedAddress = tokenAddress.toLowerCase();

        // Search through all token collections
        for (const tokenCollection of [TOKENS]) {
            for (const [symbol, token] of Object.entries(tokenCollection)) {
                if (token && token.address && token.address.toLowerCase() === normalizedAddress) {
                    return { ...token, symbol };
                }
            }
        }

        return null;
    }

    /**
     * Check if token has required metadata
     * @private
     */
    _hasRequiredMetadata(tokenData) {
        const requiredFields = ['address', 'decimals', 'symbol'];

        for (const field of requiredFields) {
            if (!tokenData[field]) {
                return false;
            }
        }

        // Validate decimals is a number
        if (typeof tokenData.decimals !== 'number' || tokenData.decimals < 0 || tokenData.decimals > 18) {
            return false;
        }

        return true;
    }

    /**
     * Check if pair is supported on DEX
     * @private
     */
    _isPairSupportedOnDEX(path, dexName) {
        // For now, assume all pairs are supported if tokens are valid
        // In production, this could check against DEX-specific pair lists
        return true;
    }
}

// Export singleton instance
const tokenValidator = new TokenValidator();

export default tokenValidator;