const Joi = require('joi');
const { ethers } = require('ethers');
const { ConfigurationError } = require('./CustomError');

class ConfigValidator {
    constructor(provider = null) {
        this.provider = provider;

        this.dexConfigSchema = Joi.object({
            name: Joi.string().required(),
            factory: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
            router: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
            fee: Joi.number().min(0).max(1).required(),
            initCode: Joi.string().pattern(/^0x[a-fA-F0-9]+$/).optional()
        });

        this.tokenConfigSchema = Joi.object({
            symbol: Joi.string().required(),
            name: Joi.string().required(),
            address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
            decimals: Joi.number().integer().min(0).max(18).required(),
            minLiquidity: Joi.string().optional(),
            maxTradeSize: Joi.string().optional()
        });

        this.poolAddressesSchema = Joi.object().pattern(
            Joi.string(),
            Joi.object().pattern(
                Joi.string(),
                Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/)
            )
        );
    }

    validateDEXConfig(config) {
        const { error, value } = this.dexConfigSchema.validate(config, { abortEarly: false });
        if (error) {
            throw new ConfigurationError(
                `Invalid DEX configuration: ${error.details.map(d => d.message).join(', ')}`,
                'dexConfig',
                'DEXConfigObject'
            );
        }
        return value;
    }

    validateTokenConfig(config) {
        const { error, value } = this.tokenConfigSchema.validate(config, { abortEarly: false });
        if (error) {
            throw new ConfigurationError(
                `Invalid token configuration: ${error.details.map(d => d.message).join(', ')}`,
                'tokenConfig',
                'TokenConfigObject'
            );
        }
        return value;
    }

    validatePoolAddresses(config) {
        const { error, value } = this.poolAddressesSchema.validate(config, { abortEarly: false });
        if (error) {
            throw new ConfigurationError(
                `Invalid pool addresses configuration: ${error.details.map(d => d.message).join(', ')}`,
                'poolAddresses',
                'PoolAddressesObject'
            );
        }
        return value;
    }

    validateArbitrageConfig(config) {
        const arbitrageSchema = Joi.object({
            minProfitUSD: Joi.number().min(0).default(50),
            maxGasPrice: Joi.number().min(1).max(500).default(5), // gwei
            gasPriceRefund: Joi.number().min(1).max(2).default(1.5),
            scanInterval: Joi.number().min(1000).max(60000).default(10000), // ms
            slippageTolerance: Joi.number().min(0).max(0.1).default(0.005), // 0.5%
            deadlineBuffer: Joi.number().min(30).max(3600).default(300), // seconds
            maxConsecutiveErrors: Joi.number().min(1).max(50).default(10),
            errorPauseTime: Joi.number().min(10000).max(300000).default(60000), // ms
            enableMEVProtection: Joi.boolean().default(true),
            enableFlashbots: Joi.boolean().default(false),
            riskMultiplier: Joi.number().min(0.1).max(5).default(1.0)
        });

        const { error, value } = arbitrageSchema.validate(config, { abortEarly: false });
        if (error) {
            throw new ConfigurationError(
                `Invalid arbitrage configuration: ${error.details.map(d => d.message).join(', ')}`,
                'arbitrageConfig',
                'ArbitrageConfigObject'
            );
        }
        return value;
    }

    validateNetworkConfig(config) {
        const networkSchema = Joi.object({
            chainId: Joi.number().integer().positive().required(),
            name: Joi.string().valid('mainnet', 'testnet', 'bsc', 'polygon', 'arbitrum').required(),
            rpcUrl: Joi.string().uri().required(),
            blockTime: Joi.number().min(1).max(30).default(3), // seconds
            maxGasLimit: Joi.number().min(1000000).max(30000000).default(8000000),
            nativeCurrency: Joi.object({
                name: Joi.string().required(),
                symbol: Joi.string().required(),
                decimals: Joi.number().integer().min(0).max(18).required()
            }).required()
        });

        const { error, value } = networkSchema.validate(config, { abortEarly: false });
        if (error) {
            throw new ConfigurationError(
                `Invalid network configuration: ${error.details.map(d => d.message).join(', ')}`,
                'networkConfig',
                'NetworkConfigObject'
            );
        }
        return value;
    }

    validateAllConfigs(configs) {
        const validatedConfigs = {};

        try {
            // Validate DEX configs
            if (configs.dex) {
                validatedConfigs.dex = {};
                for (const [dexName, dexConfig] of Object.entries(configs.dex)) {
                    validatedConfigs.dex[dexName] = this.validateDEXConfig(dexConfig);
                }
            }

            // Validate token configs
            if (configs.tokens) {
                validatedConfigs.tokens = {};
                for (const [tokenSymbol, tokenConfig] of Object.entries(configs.tokens)) {
                    validatedConfigs.tokens[tokenSymbol] = this.validateTokenConfig(tokenConfig);
                }
            }

            // Validate pool addresses
            if (configs.poolAddresses) {
                validatedConfigs.poolAddresses = this.validatePoolAddresses(configs.poolAddresses);
            }

            // Validate arbitrage config
            if (configs.arbitrage) {
                validatedConfigs.arbitrage = this.validateArbitrageConfig(configs.arbitrage);
            }

            // Validate network config
            if (configs.network) {
                validatedConfigs.network = this.validateNetworkConfig(configs.network);
            }

            return validatedConfigs;

        } catch (error) {
            console.error('Configuration validation failed:', error.message);
            throw error;
        }
    }

    // Address checksum validation
    validateAddressChecksum(address, expectedChecksum = null) {
        try {
            const ethers = require('ethers');
            const checksummed = ethers.getAddress(address);
            if (expectedChecksum && checksummed !== expectedChecksum) {
                throw new ConfigurationError(
                    `Address checksum mismatch: expected ${expectedChecksum}, got ${checksummed}`,
                    'address',
                    'ChecksummedAddress'
                );
            }
            return checksummed;
        } catch (error) {
            throw new ConfigurationError(
                `Invalid Ethereum address: ${address}`,
                'address',
                'ValidEthereumAddress'
            );
        }
    }

    // Batch address validation
    validateAddressBatch(addresses) {
        const validated = {};
        const errors = [];

        for (const [key, address] of Object.entries(addresses)) {
            try {
                validated[key] = this.validateAddressChecksum(address);
            } catch (error) {
                errors.push(`${key}: ${error.message}`);
            }
        }

        if (errors.length > 0) {
            throw new ConfigurationError(
                `Address validation errors: ${errors.join('; ')}`,
                'addressBatch',
                'ValidAddressBatch'
            );
        }

        return validated;
    }

    // Dynamic deadline calculation based on network congestion
    async calculateDynamicDeadline(baseDeadline = 300, gasPrice, complexity = 'simple') {
        try {
            // Get current gas price if not provided
            if (!gasPrice && this.provider) {
                gasPrice = (await this.provider.getFeeData()).gasPrice;
                gasPrice = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
            }

            // Base deadline adjustment based on gas price
            let deadlineMultiplier = 1;

            if (gasPrice > 20) {
                deadlineMultiplier = 1.5; // High congestion - increase deadline
            } else if (gasPrice > 10) {
                deadlineMultiplier = 1.2; // Medium congestion
            } else if (gasPrice < 3) {
                deadlineMultiplier = 0.8; // Low congestion - can be more aggressive
            }

            // Adjust for transaction complexity
            const complexityMultipliers = {
                'simple': 1,
                'complex': 1.3,
                'triangular': 1.5
            };

            const complexityMultiplier = complexityMultipliers[complexity] || 1;

            // Calculate final deadline
            const calculatedDeadline = Math.floor(baseDeadline * deadlineMultiplier * complexityMultiplier);

            // Ensure deadline is within reasonable bounds
            const minDeadline = 60; // 1 minute minimum
            const maxDeadline = 1800; // 30 minutes maximum

            return Math.max(minDeadline, Math.min(maxDeadline, calculatedDeadline));

        } catch (error) {
            console.warn('Error calculating dynamic deadline, using base deadline:', error.message);
            return baseDeadline;
        }
    }
}

module.exports = ConfigValidator;
