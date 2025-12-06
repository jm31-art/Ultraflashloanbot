const { EventEmitter } = require('events');
const { ethers } = require('ethers');
const { LENDING_PROTOCOLS, TOKENS } = require('../config/protocols');
const PriceFeed = require('../services/PriceFeed');
const ProfitCalculator = require('../utils/ProfitCalculator');
const TransactionVerifier = require('../utils/TransactionVerifier');

class LiquidationBot extends EventEmitter {
    constructor(provider, signer, options = {}) {
        super();

        this.provider = provider;
        this.signer = signer;
        this.priceFeed = new PriceFeed(provider);
        this.profitCalculator = new ProfitCalculator(provider);
        this.verifier = new TransactionVerifier(provider, signer);

        // Configuration
        this.minProfitUSD = options.minProfitUSD || 50;
        this.maxGasPrice = options.maxGasPrice || 5; // gwei
        this.scanInterval = options.scanInterval || 30000; // 30 seconds
        this.maxLiquidationAmount = options.maxLiquidationAmount || ethers.parseEther('10000'); // $10k max
        this.liquidationBonusThreshold = options.liquidationBonusThreshold || 0.05; // 5% minimum bonus

        this.isRunning = false;
        this.lastScanTime = 0;
        this.liquidationCount = 0;
        this.successfulLiquidations = 0;

        // Lending protocol contracts
        this.lendingContracts = {};
        this.oracleContracts = {};

        // Health factor thresholds for monitoring
        this.healthFactorThreshold = 1.0; // Liquidate when HF < 1.0
        this.monitoringThreshold = 1.2; // Start monitoring when HF < 1.2

        // Risk management
        this.maxSlippage = 0.02; // 2% max slippage
        this.emergencyStop = false;

        this.emit('initialized');
    }

    async initialize() {
        try {
            console.log('🔄 Initializing Liquidation Bot...');

            // Initialize lending protocol contracts
            await this._initializeLendingContracts();

            // Initialize price feeds
            await this.priceFeed.updatePrices(Object.values(TOKENS), Object.values(LENDING_PROTOCOLS));

            // Verify contract connections
            await this._verifyConnections();

            console.log('✅ Liquidation Bot initialized successfully');
            return true;

        } catch (error) {
            console.error('❌ Failed to initialize Liquidation Bot:', error);
            return false;
        }
    }

    async _initializeLendingContracts() {
        // Initialize Aave V3
        if (LENDING_PROTOCOLS.AAVE) {
            const aaveAbi = [
                "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
                "function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)"
            ];
            this.lendingContracts.AAVE = new ethers.Contract(
                LENDING_PROTOCOLS.AAVE.pool,
                aaveAbi,
                this.signer
            );
        }

        // Initialize Compound V3
        if (LENDING_PROTOCOLS.COMPOUND) {
            const compoundAbi = [
                "function getHealthFactor(address account) view returns (uint256)",
                "function liquidateBorrow(address borrower, uint256 repayAmount, address cTokenCollateral) returns (uint256)"
            ];
            this.lendingContracts.COMPOUND = new ethers.Contract(
                LENDING_PROTOCOLS.COMPOUND.comet,
                compoundAbi,
                this.signer
            );
        }

        // Initialize Venus Protocol
        if (LENDING_PROTOCOLS.VENUS) {
            const venusAbi = [
                "function getAccountLiquidity(address account) view returns (uint256, uint256, uint256)",
                "function liquidateBorrow(address borrower, address underlyingBorrow, address underlyingCollateral, uint256 repayAmount) returns (uint256)"
            ];
            this.lendingContracts.VENUS = new ethers.Contract(
                LENDING_PROTOCOLS.VENUS.comptroller,
                venusAbi,
                this.signer
            );
        }
    }

    async _verifyConnections() {
        for (const [protocol, contract] of Object.entries(this.lendingContracts)) {
            try {
                // Simple call to verify connection
                if (protocol === 'AAVE') {
                    await contract.getUserAccountData(ethers.constants.AddressZero);
                }
                console.log(`✅ ${protocol} contract connected`);
            } catch (error) {
                console.warn(`⚠️ ${protocol} contract connection issue:`, error.message);
            }
        }
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('🚀 Starting Liquidation Bot...');

        while (this.isRunning) {
            try {
                await this._scanForLiquidationOpportunities();
                await new Promise(resolve => setTimeout(resolve, this.scanInterval));

            } catch (error) {
                console.error('❌ Error in liquidation scan loop:', error);
                await new Promise(resolve => setTimeout(resolve, this.scanInterval * 2)); // Wait longer on error
            }
        }
    }

    async _scanForLiquidationOpportunities() {
        if (this.emergencyStop) return;

        this.lastScanTime = Date.now();

        for (const [protocolName, protocol] of Object.entries(LENDING_PROTOCOLS)) {
            try {
                const opportunities = await this._scanProtocol(protocolName, protocol);

                for (const opportunity of opportunities) {
                    await this._evaluateAndExecuteLiquidation(protocolName, opportunity);
                }

            } catch (error) {
                console.error(`❌ Error scanning ${protocolName}:`, error);
            }
        }
    }

    async _scanProtocol(protocolName, protocol) {
        const opportunities = [];

        try {
            // Get positions at risk (this would typically come from a subgraph or on-chain scanning)
            // For now, we'll use a placeholder - in production, implement proper position discovery
            const positionsAtRisk = await this._getPositionsAtRisk(protocolName, protocol);

            for (const position of positionsAtRisk) {
                const healthFactor = await this._calculateHealthFactor(protocolName, position);

                if (healthFactor < this.monitoringThreshold) {
                    const opportunity = {
                        protocol: protocolName,
                        user: position.user,
                        healthFactor,
                        collateralAsset: position.collateralAsset,
                        debtAsset: position.debtAsset,
                        maxLiquidationAmount: position.maxLiquidationAmount,
                        liquidationBonus: position.liquidationBonus
                    };

                    opportunities.push(opportunity);
                }
            }

        } catch (error) {
            console.error(`❌ Error scanning ${protocolName} positions:`, error);
        }

        return opportunities;
    }

    async _getPositionsAtRisk(protocolName, protocol) {
        // Placeholder - in production, implement:
        // 1. Subgraph queries for positions with HF < 1.2
        // 2. On-chain scanning of recent borrows
        // 3. Event monitoring for positions becoming at risk

        // For demo purposes, return empty array
        // This would be replaced with actual position discovery logic
        return [];
    }

    async _calculateHealthFactor(protocolName, position) {
        try {
            switch (protocolName) {
                case 'AAVE':
                    const userData = await this.lendingContracts.AAVE.getUserAccountData(position.user);
                    return ethers.formatEther(userData.healthFactor);

                case 'COMPOUND':
                    const hf = await this.lendingContracts.COMPOUND.getHealthFactor(position.user);
                    return ethers.formatEther(hf);

                case 'VENUS':
                    const [, , shortfall] = await this.lendingContracts.VENUS.getAccountLiquidity(position.user);
                    return shortfall.gt(0) ? 0.5 : 2.0; // Simplified

                default:
                    return 2.0; // Default healthy
            }
        } catch (error) {
            console.error(`❌ Error calculating health factor for ${protocolName}:`, error);
            return 2.0; // Assume healthy on error
        }
    }

    async _evaluateAndExecuteLiquidation(protocolName, opportunity) {
        try {
            // Skip if health factor is still above liquidation threshold
            if (opportunity.healthFactor >= this.healthFactorThreshold) {
                return;
            }

            // Calculate optimal liquidation amount
            const optimalAmount = await this._calculateOptimalLiquidationAmount(opportunity);

            // Calculate expected profit
            const profitAnalysis = await this._calculateLiquidationProfit(protocolName, opportunity, optimalAmount);

            if (!profitAnalysis.isProfitable || profitAnalysis.expectedProfitUSD < this.minProfitUSD) {
                return;
            }

            console.log(`💰 Found profitable liquidation opportunity:`);
            console.log(`   Protocol: ${protocolName}`);
            console.log(`   User: ${opportunity.user}`);
            console.log(`   Health Factor: ${opportunity.healthFactor}`);
            console.log(`   Expected Profit: $${profitAnalysis.expectedProfitUSD.toFixed(2)}`);

            // Execute liquidation
            await this._executeLiquidation(protocolName, opportunity, optimalAmount, profitAnalysis);

        } catch (error) {
            console.error('❌ Error evaluating liquidation opportunity:', error);
        }
    }

    async _calculateOptimalLiquidationAmount(opportunity) {
        // Calculate optimal amount based on:
        // 1. Maximum liquidation amount allowed
        // 2. Available liquidity in debt asset
        // 3. Gas costs and slippage
        // 4. Liquidation bonus

        let optimalAmount = opportunity.maxLiquidationAmount;

        // Cap at our maximum liquidation amount
        if (optimalAmount.gt(this.maxLiquidationAmount)) {
            optimalAmount = this.maxLiquidationAmount;
        }

        // Consider available liquidity (placeholder - implement actual liquidity checks)
        const availableLiquidity = await this._getAvailableLiquidity(opportunity.debtAsset);
        if (optimalAmount.gt(availableLiquidity)) {
            optimalAmount = availableLiquidity;
        }

        return optimalAmount;
    }

    async _getAvailableLiquidity(asset) {
        // Placeholder - implement actual liquidity checking
        // Check flash loan availability, DEX liquidity, etc.
        return ethers.parseEther('100000'); // $100k placeholder
    }

    async _calculateLiquidationProfit(protocolName, opportunity, liquidationAmount) {
        try {
            // Get prices
            const collateralPrice = await this.priceFeed.getPrice(opportunity.collateralAsset);
            const debtPrice = await this.priceFeed.getPrice(opportunity.debtAsset);

            // Calculate collateral received
            const debtValueUSD = parseFloat(ethers.formatEther(liquidationAmount)) * debtPrice;
            const collateralReceived = (debtValueUSD / collateralPrice) * (1 + opportunity.liquidationBonus);

            // Calculate gas costs
            const gasEstimate = await this._estimateLiquidationGas(protocolName);
            const gasPrice = (await this.provider.getFeeData()).gasPrice;
            const gasCost = gasEstimate * gasPrice; // BigInt multiplication

            // Calculate flash loan fee (0.09% for Aave)
            const flashLoanFee = liquidationAmount.mul(9).div(10000);

            // Calculate net profit
            const collateralValueUSD = collateralReceived * collateralPrice;
            const costsUSD = parseFloat(ethers.formatEther(gasCost.add(flashLoanFee))) * debtPrice;
            const netProfitUSD = collateralValueUSD - debtValueUSD - costsUSD;

            return {
                isProfitable: netProfitUSD > 0,
                expectedProfitUSD: netProfitUSD,
                collateralReceived,
                gasCost,
                flashLoanFee,
                netProfit: ethers.parseEther(netProfitUSD.toString())
            };

        } catch (error) {
            console.error('❌ Error calculating liquidation profit:', error);
            return { isProfitable: false, expectedProfitUSD: 0 };
        }
    }

    async _estimateLiquidationGas(protocolName) {
        // Gas estimates for different protocols
        const gasEstimates = {
            AAVE: 400000,
            COMPOUND: 350000,
            VENUS: 300000
        };

        return ethers.BigNumber.from(gasEstimates[protocolName] || 400000);
    }

    async _executeLiquidation(protocolName, opportunity, amount, profitAnalysis) {
        try {
            this.liquidationCount++;

            // Create liquidation transaction
            const tx = await this._createLiquidationTx(protocolName, opportunity, amount);

            // Verify transaction
            const verification = await this.verifier.verifyTransaction(tx);
            if (!verification.verified) {
                throw new Error(`Transaction verification failed: ${verification.error}`);
            }

            // Execute transaction
            console.log(`🔥 Executing liquidation for ${ethers.formatEther(amount)} ${opportunity.debtAsset}`);
            const txResponse = await this.signer.sendTransaction(tx);

            console.log(`✅ Liquidation transaction submitted: ${txResponse.hash}`);

            // Wait for confirmation
            const receipt = await txResponse.wait();

            if (receipt.status === 1) {
                this.successfulLiquidations++;
                console.log(`🎉 Liquidation successful! Profit: $${profitAnalysis.expectedProfitUSD.toFixed(2)}`);

                this.emit('liquidationExecuted', {
                    protocol: protocolName,
                    txHash: txResponse.hash,
                    profit: profitAnalysis.expectedProfitUSD,
                    amount: amount
                });
            } else {
                console.error('❌ Liquidation transaction failed');
            }

        } catch (error) {
            console.error('❌ Error executing liquidation:', error);
        }
    }

    async _createLiquidationTx(protocolName, opportunity, amount) {
        // This would call the FlashloanArb contract's executeLiquidation function
        // For now, return a placeholder transaction

        const contractAddress = process.env.FLASHLOAN_ARB_CONTRACT;
        if (!contractAddress) {
            throw new Error('FlashloanArb contract address not configured');
        }

        const contract = new ethers.Contract(contractAddress, [
            "function executeLiquidation(address lendingProtocol, address borrower, address debtAsset, address collateralAsset, uint256 debtToCover, uint256 minProfit) external"
        ], this.signer);

        // Estimate min profit (90% of expected)
        const minProfit = opportunity.expectedProfitUSD * 0.9;

        return await contract.populateTransaction.executeLiquidation(
            this.lendingContracts[protocolName].address,
            opportunity.user,
            opportunity.debtAsset,
            opportunity.collateralAsset,
            amount,
            ethers.parseEther(minProfit.toString())
        );
    }

    // Emergency controls
    emergencyStop() {
        this.emergencyStop = true;
        console.log('🚨 Liquidation Bot emergency stop activated');
    }

    resume() {
        this.emergencyStop = false;
        console.log('✅ Liquidation Bot resumed');
    }

    // Statistics and monitoring
    getStats() {
        return {
            isRunning: this.isRunning,
            liquidationCount: this.liquidationCount,
            successfulLiquidations: this.successfulLiquidations,
            successRate: this.liquidationCount > 0 ? (this.successfulLiquidations / this.liquidationCount) * 100 : 0,
            lastScanTime: this.lastScanTime,
            emergencyStop: this.emergencyStop
        };
    }

    async stop() {
        console.log('🛑 Stopping Liquidation Bot...');
        this.isRunning = false;
        console.log('✅ Liquidation Bot stopped');
    }
}

module.exports = LiquidationBot;
