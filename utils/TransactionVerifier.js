const { ethers } = require('ethers');
const { BigNumber } = require('ethers');
const SecureMEVProtector = require('./SecureMEVProtector');
const PoolManager = require('./PoolManager');
const fs = require('fs').promises;
const path = require('path');

class TransactionVerifier {
    constructor(provider, signer, network = 'mainnet') {
        this.provider = provider;
        this.signer = signer;
        this.verifiedTxCache = new Map();
        
        // Add slippage configuration for different pair types
        this.SLIPPAGE_CONFIG = {
            STABLE_PAIRS: {
                tokens: ['USDT', 'USDC', 'BUSD', 'DAI'],
                tolerance: 0.003, // 0.3%
                minLiquidityRatio: 2.0 // 200% of trade amount
            },
            BNB_PAIRS: {
                baseToken: 'BNB',
                tolerance: 0.01, // 1%
                minLiquidityRatio: 2.5 // 250% of trade amount
            },
            VOLATILE_PAIRS: {
                tolerance: 0.02, // 2%
                minLiquidityRatio: 3.0 // 300% of trade amount
            }
        };

        // Dynamic profit threshold based on gas price
        this.BASE_PROFIT_THRESHOLD = ethers.parseEther('0.01'); // 0.01 BNB
        this.MAX_GAS_PRICE_GWEI = 15; // Base gas price threshold in gwei
        
        this.mevProtector = new SecureMEVProtector(provider);
        this.poolManager = new PoolManager(provider, network);
    }

    async verifyTransaction(transaction) {
        try {
            // Security audit logging
            await this._logSecurityEvent('transaction_verification_started', {
                txHash: this._getTransactionHash(transaction),
                timestamp: Date.now(),
                signer: this.signer.address
            });

            // Verify basic parameters
            await this._verifyBasicParams(transaction);

            // Analyze MEV risks
            const mevAnalysis = await this.mevProtector.getProtectionStrategy(transaction);
            if (!mevAnalysis.safeToExecute) {
                await this._logSecurityEvent('mev_risk_detected', {
                    txHash: this._getTransactionHash(transaction),
                    threats: mevAnalysis.detectedThreats,
                    riskLevel: 'HIGH'
                });
                throw new Error(`MEV risk detected: ${mevAnalysis.detectedThreats.join(', ')}`);
            }

            // Update gas price if needed
            if (mevAnalysis.useFlashbots || mevAnalysis.increasedGasPrice > transaction.gasPrice) {
                transaction.gasPrice = BigNumber.from(mevAnalysis.increasedGasPrice);
                console.log('Using Flashbots for MEV protection');
                await this._logSecurityEvent('flashbots_protection_activated', {
                    txHash: this._getTransactionHash(transaction),
                    originalGasPrice: transaction.gasPrice?.toString(),
                    increasedGasPrice: mevAnalysis.increasedGasPrice?.toString()
                });
            }

            // Verify flashloan parameters if this is a flashloan transaction
            if (this._isFlashloanTransaction(transaction)) {
                await this._verifyFlashloanParameters(transaction);
            }
            
            // Simulate transaction
            const simResult = await this._simulateTransaction(transaction);
            
            // Verify profitability
            await this._verifyProfitability(transaction, simResult);
            
            // Verify gas costs
            await this._verifyGasCosts(transaction);
            
            // Verify contract interactions
            await this._verifyContractInteractions(transaction);
            
            // Cache verified transaction
            this.verifiedTxCache.set(this._getTransactionHash(transaction), {
                timestamp: Date.now(),
                verified: true,
                mevProtection: mevAnalysis
            });
            
            return {
                verified: true,
                gasEstimate: simResult.gasEstimate,
                expectedProfit: simResult.expectedProfit,
                safeToExecute: true,
                mevAnalysis: mevAnalysis
            };
        } catch (error) {
            console.error('Transaction verification failed:', error.message);
            return {
                verified: false,
                error: error.message,
                safeToExecute: false
            };
        }
    }

    async _verifyBasicParams(transaction) {
        // Verify nonce
        const currentNonce = await this.signer.getTransactionCount();
        if (transaction.nonce && transaction.nonce < currentNonce) {
            throw new Error('Invalid nonce');
        }

        // Verify value
        if (transaction.value && !BigNumber.isBigNumber(transaction.value)) {
            throw new Error('Invalid transaction value format');
        }

        // Verify gas price and check for sandwich resistance
        const currentGasPrice = (await this.provider.getFeeData()).gasPrice;
        const block = await this.provider.getBlock('latest');
        const baseFeePerGas = block.baseFeePerGas || currentGasPrice;
        
        // Calculate minimum safe gas price (120% of base fee to resist sandwiching)
        const minSafeGasPrice = baseFeePerGas.mul(120).div(100);
        
        if (transaction.gasPrice && 
            BigNumber.from(transaction.gasPrice).lt(minSafeGasPrice)) {
            throw new Error('Gas price too low for sandwich resistance');
        }

        // Check recent blocks for similar transactions (potential frontrunning)
        await this._checkRecentBlocksForSimilarTxs(transaction);
    }

    async _checkRecentBlocksForSimilarTxs(transaction) {
        const latestBlock = await this.provider.getBlockNumber();
        const numBlocksToCheck = 3; // Check last 3 blocks
        
        for (let i = 0; i < numBlocksToCheck; i++) {
            const block = await this.provider.getBlock(latestBlock - i, true);
            if (!block) continue;

            for (const tx of block.transactions) {
                if (tx.to === transaction.to && 
                    tx.data.slice(0, 10) === transaction.data.slice(0, 10)) {
                    // Similar transaction found in recent blocks
                    throw new Error('Similar transaction detected in recent blocks - possible frontrunning attempt');
                }
            }
        }
    }

    async _simulateTransaction(transaction) {
        try {
            // Create transaction request
            const txRequest = {
                to: transaction.to,
                from: this.signer.address,
                data: transaction.data,
                value: transaction.value || 0,
                gasPrice: transaction.gasPrice,
                nonce: transaction.nonce
            };

            // First simulation at current block
            const gasEstimate = await this.provider.estimateGas(txRequest);
            const result = await this.provider.call(txRequest);
            const initialProfit = this._calculateExpectedProfit(result);

            // Second simulation with next block conditions
            const block = await this.provider.getBlock('latest');
            const nextBlockSimulation = await this.provider.call(txRequest, {
                blockTag: block.number + 1
            });
            const nextBlockProfit = this._calculateExpectedProfit(nextBlockSimulation);

            // Check for significant profit deviation (slippage)
            const profitDeviation = initialProfit.sub(nextBlockProfit).abs();
            
            // Get pair type and appropriate slippage tolerance
            const pairType = await this._determinePairType(transaction);
            const maxAllowedDeviation = initialProfit.mul(
                Math.floor(this.SLIPPAGE_CONFIG[pairType].tolerance * 100)
            ).div(100);
            
            if (profitDeviation.gt(maxAllowedDeviation)) {
                throw new Error(`High slippage detected for ${pairType} - transaction may be vulnerable to sandwich attacks`);
            }

            return {
                gasEstimate,
                result,
                expectedProfit: initialProfit,
                slippage: profitDeviation.mul(100).div(initialProfit).toString() + '%',
                pairType
            };
        } catch (error) {
            throw new Error(`Transaction simulation failed: ${error.message}`);
        }
    }

    async _verifyProfitability(transaction, simResult) {
        const currentGasPrice = BigNumber.from(transaction.gasPrice || (await this.provider.getFeeData()).gasPrice);
        const gasCost = currentGasPrice.mul(simResult.gasEstimate);

        // Adjust profit threshold based on gas price
        const gasGwei = Number(ethers.formatUnits(currentGasPrice, 'gwei'));
        const adjustedThreshold = this.BASE_PROFIT_THRESHOLD.mul(
            Math.max(1, Math.floor(gasGwei / this.MAX_GAS_PRICE_GWEI))
        );
        
        if (simResult.expectedProfit.lte(gasCost.add(adjustedThreshold))) {
            throw new Error(`Transaction not profitable after gas costs (${gasGwei} gwei)`);
        }
    }

    async _verifyGasCosts(transaction) {
        const balance = await this.signer.getBalance();
        const maxGasCost = BigNumber.from(transaction.gasPrice || (await this.provider.getFeeData()).gasPrice)
            .mul(transaction.gasLimit || 500000);

        // Add buffer for potential gas price increases
        const gasCostWithBuffer = maxGasCost.mul(120).div(100); // 20% buffer

        if (balance.lt(gasCostWithBuffer)) {
            throw new Error('Insufficient balance for gas costs (including safety buffer)');
        }

        // Check if gas price is competitive enough
        const block = await this.provider.getBlock('latest');
        const pendingBlock = await this.provider.getBlock('pending');
        const recentTxs = pendingBlock ? pendingBlock.transactions : [];
        
        if (recentTxs.length > 0) {
            const competitiveGasPrice = await this._calculateCompetitiveGasPrice(recentTxs);
            if (BigNumber.from(transaction.gasPrice).lt(competitiveGasPrice)) {
                throw new Error('Gas price not competitive enough for current market conditions');
            }
        }
    }

    async _calculateCompetitiveGasPrice(recentTxs) {
        // Get gas prices from recent transactions
        const gasPrices = recentTxs.map(tx => BigNumber.from(tx.gasPrice));
        if (gasPrices.length === 0) return BigNumber.from(0);

        // Sort gas prices in ascending order
        gasPrices.sort((a, b) => a.lt(b) ? -1 : 1);

        // Get 75th percentile gas price for competitive edge
        const index = Math.floor(gasPrices.length * 0.75);
        const competitivePrice = gasPrices[index];

        // Add 10% buffer for safety
        return competitivePrice.mul(110).div(100);
    }

    async _verifyContractInteractions(transaction) {
        if (!transaction.to) {
            throw new Error('Invalid contract address');
        }

        try {
            // Verify contract exists
            const code = await this.provider.getCode(transaction.to);
            if (code === '0x') {
                throw new Error('Contract does not exist');
            }

            // Verify method signature
            const methodId = transaction.data.slice(0, 10);
            if (!this._isValidMethodSignature(methodId)) {
                throw new Error('Invalid method signature');
            }
        } catch (error) {
            throw new Error(`Contract verification failed: ${error.message}`);
        }
    }

    _calculateExpectedProfit(result) {
        // Decode transaction result to calculate expected profit
        try {
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], result);
            return BigNumber.from(decoded[0]);
        } catch (error) {
            return BigNumber.from(0);
        }
    }

    _isValidMethodSignature(methodId) {
        // List of valid method signatures for arbitrage
        const validMethods = new Set([
            // Common DEX methods
            '0x7c025200', // swap
            '0x38ed1739', // swapExactTokensForTokens
            '0x8803dbee', // swapTokensForExactTokens
            '0x7ff36ab5', // swapExactETHForTokens
            '0x4a25d94a', // swapTokensForExactETH
            '0x18cbafe5', // swapExactTokensForETH
            '0xfb3bdb41', // swapETHForExactTokens
            
            // Uniswap V3 specific
            '0xc04b8d59', // exactInputSingle
            '0x414bf389', // exactInput
            '0xdb3e2198', // exactOutputSingle
            '0xf28c0498', // exactOutput
            
            // SushiSwap specific
            '0x022c0d9f', // swap
            '0x54cf2aeb', // swapExactTokensForTokensSupportingFeeOnTransferTokens
            
            // Flashloan methods
            '0x5c11d795', // executeOperation
            '0x09424b2e', // executeArbitrage
            '0xab9c4b5d', // flashloan
            '0x51cff8d9'  // executeOperation (Aave V2)
        ]);

        return validMethods.has(methodId);
    }

    _getTransactionHash(transaction) {
        return ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'uint256', 'bytes', 'uint256'],
                [transaction.to, transaction.value || 0, transaction.data, transaction.nonce || 0]
            )
        );
    }

    async settlePendingTransaction(txHash) {
        try {
            // Wait for transaction confirmation
            const receipt = await this.provider.waitForTransaction(txHash, 1); // Wait for 1 confirmation

            // Verify transaction success
            if (!receipt.status) {
                throw new Error('Transaction failed');
            }

            // Calculate actual profit/loss
            const profitLoss = await this._calculateActualProfitLoss(receipt);

            return {
                success: true,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                effectiveGasPrice: receipt.effectiveGasPrice.toString(),
                profitLoss: profitLoss.toString(),
                logs: receipt.logs
            };
        } catch (error) {
            console.error('Transaction settlement failed:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async _calculateActualProfitLoss(receipt) {
        // Calculate actual gas cost
        const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
        
        // Decode transaction logs to find profit
        let profit = BigNumber.from(0);
        for (const log of receipt.logs) {
            try {
                // Look for profit events
                if (this._isProfitEvent(log)) {
                    profit = profit.add(this._decodeProfitFromLog(log));
                }
            } catch (error) {
                console.warn('Error decoding log:', error.message);
            }
        }

        return profit.sub(gasCost);
    }

    _isProfitEvent(log) {
        // Add your profit event signatures here
        const profitEventSignatures = [
            ethers.id('ProfitGenerated(uint256)'),
            ethers.id('ArbitrageComplete(uint256,uint256)')
        ];

        return profitEventSignatures.includes(log.topics[0]);
    }

    _decodeProfitFromLog(log) {
        try {
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], log.data);
            return BigNumber.from(decoded[0]);
        } catch (error) {
            return BigNumber.from(0);
        }
    }

    cleanup() {
        if (this.mevProtector) {
            this.mevProtector.cleanup();
        }
        this.verifiedTxCache.clear();
    }

    _isFlashloanTransaction(transaction) {
        const methodId = transaction.data.slice(0, 10);
        const flashloanMethods = new Set([
            '0x5c11d795', // executeOperation
            '0x09424b2e', // executeArbitrage
            '0xab9c4b5d', // flashloan
            '0x51cff8d9'  // executeOperation (Aave V2)
        ]);
        
        return flashloanMethods.has(methodId);
    }

    async _verifyFlashloanParameters(transaction) {
        try {
            // Decode flashloan parameters
            const params = this._decodeFlashloanParams(transaction.data);
            
            // Verify loan amount is reasonable
            await this._verifyLoanAmount(params.amount, params.token);
            
            // Check protocol fees
            await this._verifyProtocolFees(params);
            
            // Verify token liquidity
            await this._verifyTokenLiquidity(params.token, params.amount);
            
        } catch (error) {
            throw new Error(`Flashloan parameter verification failed: ${error.message}`);
        }
    }

    _decodeFlashloanParams(data) {
        try {
            // Remove method signature
            const params = data.slice(10);
            
            // Decode parameters based on known flashloan interfaces
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                ['address', 'uint256', 'bytes'],
                '0x' + params
            );
            
            return {
                token: decoded[0],
                amount: decoded[1],
                params: decoded[2]
            };
        } catch (error) {
            throw new Error('Failed to decode flashloan parameters');
        }
    }

    async _verifyLoanAmount(amount, token) {
        // Get token decimals
        const tokenContract = new ethers.Contract(
            token,
            ['function decimals() view returns (uint8)'],
            this.provider
        );
        const decimals = await tokenContract.decimals();

        // Convert to human readable
        const humanAmount = ethers.formatUnits(amount, decimals);
        
        // Check if amount is suspiciously large
        if (parseFloat(humanAmount) > 1000000) { // 1M tokens
            throw new Error('Flashloan amount too large - high risk transaction');
        }
    }

    async _verifyProtocolFees(params) {
        // Estimate protocol fees (0.09% for most protocols)
        const estimatedFee = params.amount.mul(9).div(10000);
        
        // Get token balance of sender
        const tokenContract = new ethers.Contract(
            params.token,
            ['function balanceOf(address) view returns (uint256)'],
            this.provider
        );
        const balance = await tokenContract.balanceOf(this.signer.address);
        
        // Verify we have enough to cover fees
        if (balance.lt(estimatedFee)) {
            throw new Error('Insufficient balance to cover flashloan fees');
        }
    }

    async _verifyTokenLiquidity(token, amount) {
        try {
            const pools = await this.poolManager.getRelevantPools(token);
            let totalLiquidity = BigNumber.from(0);
            const pairType = await this._getPairType(token);
            const requiredRatio = this.SLIPPAGE_CONFIG[pairType].minLiquidityRatio;
            
            // Enhanced liquidity verification with depth analysis
            const liquidityDepths = [];
            
            for (const pool of pools) {
                const liquidity = await this.poolManager.getLiquidityInPool(pool.address, token);
                totalLiquidity = totalLiquidity.add(liquidity);
                
                // Analyze liquidity depth at different levels
                const depths = await this._analyzeLiquidityDepth(pool, token, amount);
                liquidityDepths.push({
                    pool: pool.address,
                    dex: pool.dex,
                    depths
                });
                
                console.log(`Pool ${pool.dex} - ${pool.pair}: ${
                    ethers.formatEther(liquidity)} ${token} (Depth Analysis: ${
                    JSON.stringify(depths)})`);
            }
            
            // Verify sufficient liquidity with pair-specific requirements
            const requiredLiquidity = amount.mul(Math.floor(requiredRatio * 100)).div(100);
            if (totalLiquidity.lt(requiredLiquidity)) {
                throw new Error(`Insufficient liquidity for ${pairType}. Required: ${
                    ethers.formatEther(requiredLiquidity)}, Available: ${
                    ethers.formatEther(totalLiquidity)}`);
            }
            
            return {
                totalLiquidity,
                pools: pools.length,
                isLiquid: true,
                liquidityDepths
            };
        } catch (error) {
            throw new Error(`Liquidity verification failed: ${error.message}`);
        }
    }

    async _analyzeLiquidityDepth(pool, token, amount) {
        // Analyze liquidity at different depth levels: 25%, 50%, 75%, 100% of trade amount
        const depthLevels = [0.25, 0.5, 0.75, 1.0];
        const depths = {};
        
        for (const level of depthLevels) {
            const testAmount = amount.mul(Math.floor(level * 100)).div(100);
            const price = await this.poolManager.getTokenPrice(pool.address, token, testAmount);
            depths[`${level * 100}%`] = {
                amount: ethers.formatEther(testAmount),
                price: price.toString()
            };
        }
        
        return depths;
    }

    async _determinePairType(transaction) {
        const params = this._decodeFlashloanParams(transaction.data);
        return await this._getPairType(params.token);
    }

    async _getPairType(token) {
        const tokenSymbol = await this._getTokenSymbol(token);
        
        if (this.SLIPPAGE_CONFIG.STABLE_PAIRS.tokens.includes(tokenSymbol)) {
            return 'STABLE_PAIRS';
        }
        
        if (tokenSymbol === this.SLIPPAGE_CONFIG.BNB_PAIRS.baseToken) {
            return 'BNB_PAIRS';
        }
        
        return 'VOLATILE_PAIRS';
    }

    async _getTokenSymbol(tokenAddress) {
        const tokenContract = new ethers.Contract(
            tokenAddress,
            ['function symbol() view returns (string)'],
            this.provider
        );
        return await tokenContract.symbol();
    }

    async _logSecurityEvent(eventType, data) {
        try {
            const logEntry = {
                timestamp: new Date().toISOString(),
                eventType,
                sessionId: this.sessionId || 'unknown',
                signer: this.signer.address,
                ...data
            };

            const logFile = path.join(__dirname, '..', 'logs', 'security-audit.log');
            await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
        } catch (error) {
            console.warn('Failed to log security event:', error.message);
        }
    }
}

module.exports = TransactionVerifier;
