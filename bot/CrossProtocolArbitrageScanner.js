const { EventEmitter } = require('events');
const { ethers } = require('ethers');
const { DEX_PROTOCOLS, LENDING_PROTOCOLS, TOKENS } = require('../config/protocols');
const PriceFeed = require('../services/PriceFeed');
const ProfitCalculator = require('../utils/ProfitCalculator');
const DexLiquidityChecker = require('../utils/DexLiquidityChecker');

class CrossProtocolArbitrageScanner extends EventEmitter {
    constructor(provider, signer, options = {}) {
        super();

        this.provider = provider;
        this.signer = signer;
        this.priceFeed = new PriceFeed(provider);
        this.profitCalculator = new ProfitCalculator(provider);
        this.liquidityChecker = new DexLiquidityChecker(provider);

        // Configuration
        this.minProfitUSD = options.minProfitUSD || 25;
        this.maxGasPrice = options.maxGasPrice || 5; // gwei
        this.scanInterval = options.scanInterval || 15000; // 15 seconds
        this.maxTradeSize = options.maxTradeSize || ethers.utils.parseEther('50000'); // $50k max
        this.minLiquidityThreshold = options.minLiquidityThreshold || ethers.utils.parseEther('10000'); // $10k min liquidity

        this.isRunning = false;
        this.scanCount = 0;
        this.opportunityCount = 0;
        this.lastScanTime = 0;

        // Protocol configurations
        this.dexProtocols = DEX_PROTOCOLS;
        this.lendingProtocols = LENDING_PROTOCOLS;

        // Cross-protocol opportunity types
        this.opportunityTypes = [
            'dex-dex',           // DEX to DEX arbitrage
            'dex-lending',       // DEX vs Lending rates
            'lending-lending',   // Lending protocol arbitrage
            'yield-farming',     // Cross-protocol yield opportunities
            'liquidity-mining'   // Liquidity mining arbitrage
        ];

        // Price tracking for TWAP calculations
        this.priceHistory = new Map();
        this.twapWindow = 10; // 10 price points for TWAP

        // Risk management
        this.maxSlippage = 0.015; // 1.5% max slippage
        this.maxPriceDeviation = 0.05; // 5% max price deviation from TWAP
        this.emergencyStop = false;

        this.emit('initialized');
    }

    async initialize() {
        try {
            console.log('🔄 Initializing Cross-Protocol Arbitrage Scanner...');

            // Initialize protocol contracts
            await this._initializeProtocolContracts();

            // Initialize price feeds
            await this.priceFeed.updatePrices(Object.values(TOKENS), Object.values(DEX_PROTOCOLS));

            // Initialize liquidity checker
            await this.liquidityChecker.initialize();

            // Verify connections
            await this._verifyConnections();

            console.log('✅ Cross-Protocol Arbitrage Scanner initialized successfully');
            return true;

        } catch (error) {
            console.error('❌ Failed to initialize Cross-Protocol Arbitrage Scanner:', error);
            return false;
        }
    }

    async _initializeProtocolContracts() {
        // Initialize DEX protocol contracts
        for (const [dexName, dexConfig] of Object.entries(DEX_PROTOCOLS)) {
            if (dexConfig.router) {
                const routerAbi = [
                    "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)",
                    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] memory path, address to, uint deadline) external returns (uint[] memory amounts)"
                ];

                this.dexProtocols[dexName].contract = new ethers.Contract(
                    dexConfig.router,
                    routerAbi,
                    this.signer
                );
            }
        }

        // Initialize lending protocol contracts
        for (const [lendingName, lendingConfig] of Object.entries(LENDING_PROTOCOLS)) {
            if (lendingConfig.pool) {
                const lendingAbi = [
                    "function getReserveData(address asset) view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint40, address)",
                    "function getUserAccountData(address user) view returns (uint256, uint256, uint256, uint256, uint256, uint256)"
                ];

                this.lendingProtocols[lendingName].contract = new ethers.Contract(
                    lendingConfig.pool,
                    lendingAbi,
                    this.signer
                );
            }
        }
    }

    async _verifyConnections() {
        // Verify DEX connections
        for (const [dexName, dexConfig] of Object.entries(this.dexProtocols)) {
            if (dexConfig.contract) {
                try {
                    await dexConfig.contract.getAmountsOut(
                        ethers.utils.parseEther('1'),
                        [TOKENS.WETH.address, TOKENS.USDC.address]
                    );
                    console.log(`✅ ${dexName} DEX connected`);
                } catch (error) {
                    console.warn(`⚠️ ${dexName} DEX connection issue:`, error.message);
                }
            }
        }

        // Verify lending protocol connections
        for (const [lendingName, lendingConfig] of Object.entries(this.lendingProtocols)) {
            if (lendingConfig.contract) {
                try {
                    await lendingConfig.contract.getReserveData(TOKENS.WETH.address);
                    console.log(`✅ ${lendingName} lending protocol connected`);
                } catch (error) {
                    console.warn(`⚠️ ${lendingName} lending connection issue:`, error.message);
                }
            }
        }
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('🚀 Starting Cross-Protocol Arbitrage Scanner...');

        while (this.isRunning) {
            try {
                await this._scanForCrossProtocolOpportunities();
                await new Promise(resolve => setTimeout(resolve, this.scanInterval));

            } catch (error) {
                console.error('❌ Error in cross-protocol scan loop:', error);
                await new Promise(resolve => setTimeout(resolve, this.scanInterval * 2));
            }
        }
    }

    async _scanForCrossProtocolOpportunities() {
        if (this.emergencyStop) return;

        this.scanCount++;
        this.lastScanTime = Date.now();

        try {
            // Update price feeds
            await this.priceFeed.updatePrices(Object.values(TOKENS), Object.values(DEX_PROTOCOLS));

            // Scan different opportunity types
            for (const opportunityType of this.opportunityTypes) {
                await this._scanOpportunityType(opportunityType);
            }

        } catch (error) {
            console.error('❌ Error scanning cross-protocol opportunities:', error);
        }
    }

    async _scanOpportunityType(opportunityType) {
        switch (opportunityType) {
            case 'dex-dex':
                await this._scanDEXtoDEXArbitrage();
                break;
            case 'dex-lending':
                await this._scanDEXvsLendingArbitrage();
                break;
            case 'lending-lending':
                await this._scanLendingArbitrage();
                break;
            case 'yield-farming':
                await this._scanYieldFarmingOpportunities();
                break;
            case 'liquidity-mining':
                await this._scanLiquidityMiningOpportunities();
                break;
        }
    }

    async _scanDEXtoDEXArbitrage() {
        const opportunities = [];

        // Compare prices across DEXs for the same token pairs
        const tokenPairs = [
            [TOKENS.WETH.address, TOKENS.USDC.address],
            [TOKENS.WBTC.address, TOKENS.WETH.address],
            [TOKENS.USDC.address, TOKENS.USDT.address],
            [TOKENS.WETH.address, TOKENS.WBTC.address]
        ];

        for (const [tokenIn, tokenOut] of tokenPairs) {
            const dexPrices = {};

            // Get prices from each DEX
            for (const [dexName, dexConfig] of Object.entries(this.dexProtocols)) {
                if (dexConfig.contract) {
                    try {
                        const amounts = await dexConfig.contract.getAmountsOut(
                            ethers.utils.parseEther('1'),
                            [tokenIn, tokenOut]
                        );
                        const price = parseFloat(ethers.utils.formatEther(amounts[1]));
                        dexPrices[dexName] = price;
                    } catch (error) {
                        console.warn(`⚠️ Failed to get price from ${dexName}:`, error.message);
                    }
                }
            }

            // Find arbitrage opportunities
            const dexNames = Object.keys(dexPrices);
            for (let i = 0; i < dexNames.length; i++) {
                for (let j = i + 1; j < dexNames.length; j++) {
                    const dex1 = dexNames[i];
                    const dex2 = dexNames[j];
                    const price1 = dexPrices[dex1];
                    const price2 = dexPrices[dex2];

                    if (price1 && price2) {
                        const priceDiff = Math.abs(price1 - price2);
                        const avgPrice = (price1 + price2) / 2;
                        const priceSpread = priceDiff / avgPrice;

                        if (priceSpread > 0.001) { // 0.1% minimum spread
                            const opportunity = {
                                type: 'dex-dex',
                                tokenIn,
                                tokenOut,
                                buyDex: price1 < price2 ? dex1 : dex2,
                                sellDex: price1 < price2 ? dex2 : dex1,
                                buyPrice: Math.min(price1, price2),
                                sellPrice: Math.max(price1, price2),
                                spread: priceSpread,
                                estimatedProfit: priceDiff * 0.9 // Account for fees
                            };
                            opportunities.push(opportunity);
                        }
                    }
                }
            }
        }

        // Evaluate opportunities
        for (const opportunity of opportunities) {
            await this._evaluateAndExecuteOpportunity(opportunity);
        }
    }

    async _scanDEXvsLendingArbitrage() {
        // Compare DEX swap rates vs lending protocol borrow/lend rates
        const opportunities = [];

        for (const token of Object.values(TOKENS)) {
            // Get DEX price for token swap
            const dexPrice = await this._getDEXPrice(token.address, TOKENS.USDC.address);

            // Get lending rates
            const lendingRates = await this._getLendingRates(token.address);

            // Compare rates for arbitrage
            if (dexPrice && lendingRates.supplyRate && lendingRates.borrowRate) {
                // Check if DEX swap is cheaper than lending borrow + repay
                const lendingCost = lendingRates.borrowRate + lendingRates.supplyRate;
                const dexCost = 1 - dexPrice; // Simplified

                if (dexCost < lendingCost * 0.9) { // 10% cheaper
                    const opportunity = {
                        type: 'dex-lending',
                        token: token.address,
                        dexPrice,
                        lendingCost,
                        estimatedProfit: (lendingCost - dexCost) * 1000, // Simplified profit calc
                        protocol: 'combined'
                    };
                    opportunities.push(opportunity);
                }
            }
        }

        for (const opportunity of opportunities) {
            await this._evaluateAndExecuteOpportunity(opportunity);
        }
    }

    async _scanLendingArbitrage() {
        // Compare lending rates across protocols
        const opportunities = [];

        for (const token of Object.values(TOKENS)) {
            const protocolRates = {};

            // Get rates from each lending protocol
            for (const [protocolName, protocolConfig] of Object.entries(this.lendingProtocols)) {
                if (protocolConfig.contract) {
                    try {
                        const rates = await this._getLendingRatesForProtocol(protocolName, token.address);
                        protocolRates[protocolName] = rates;
                    } catch (error) {
                        console.warn(`⚠️ Failed to get rates from ${protocolName}:`, error.message);
                    }
                }
            }

            // Find rate differences
            const protocols = Object.keys(protocolRates);
            for (let i = 0; i < protocols.length; i++) {
                for (let j = i + 1; j < protocols.length; j++) {
                    const protocol1 = protocols[i];
                    const protocol2 = protocols[j];
                    const rates1 = protocolRates[protocol1];
                    const rates2 = protocolRates[protocol2];

                    if (rates1 && rates2) {
                        // Check borrow rate differences
                        const borrowRateDiff = Math.abs(rates1.borrowRate - rates2.borrowRate);
                        if (borrowRateDiff > 0.001) { // 0.1% minimum difference
                            const opportunity = {
                                type: 'lending-lending',
                                token: token.address,
                                borrowProtocol: rates1.borrowRate < rates2.borrowRate ? protocol1 : protocol2,
                                lendProtocol: rates1.borrowRate < rates2.borrowRate ? protocol2 : protocol1,
                                rateDifference: borrowRateDiff,
                                estimatedProfit: borrowRateDiff * 10000 // Simplified
                            };
                            opportunities.push(opportunity);
                        }
                    }
                }
            }
        }

        for (const opportunity of opportunities) {
            await this._evaluateAndExecuteOpportunity(opportunity);
        }
    }

    async _scanYieldFarmingOpportunities() {
        // Scan for cross-protocol yield farming opportunities
        // This would involve comparing APYs across different protocols
        // Implementation would depend on specific yield farming contracts
        console.log('🔍 Scanning yield farming opportunities...');
        // Placeholder for yield farming logic
    }

    async _scanLiquidityMiningOpportunities() {
        // Scan for liquidity mining arbitrage
        // Compare rewards vs impermanent loss across protocols
        console.log('🔍 Scanning liquidity mining opportunities...');
        // Placeholder for liquidity mining logic
    }

    async _getDEXPrice(tokenIn, tokenOut) {
        try {
            // Use the first available DEX for price reference
            const dexConfig = Object.values(this.dexProtocols)[0];
            if (dexConfig.contract) {
                const amounts = await dexConfig.contract.getAmountsOut(
                    ethers.utils.parseEther('1'),
                    [tokenIn, tokenOut]
                );
                return parseFloat(ethers.utils.formatEther(amounts[1]));
            }
        } catch (error) {
            console.warn('⚠️ Failed to get DEX price:', error.message);
        }
        return null;
    }

    async _getLendingRates(tokenAddress) {
        // Aggregate lending rates across protocols
        let totalSupplyRate = 0;
        let totalBorrowRate = 0;
        let protocolCount = 0;

        for (const [protocolName, protocolConfig] of Object.entries(this.lendingProtocols)) {
            if (protocolConfig.contract) {
                try {
                    const rates = await this._getLendingRatesForProtocol(protocolName, tokenAddress);
                    if (rates) {
                        totalSupplyRate += rates.supplyRate;
                        totalBorrowRate += rates.borrowRate;
                        protocolCount++;
                    }
                } catch (error) {
                    // Continue with other protocols
                }
            }
        }

        if (protocolCount > 0) {
            return {
                supplyRate: totalSupplyRate / protocolCount,
                borrowRate: totalBorrowRate / protocolCount
            };
        }

        return null;
    }

    async _getLendingRatesForProtocol(protocolName, tokenAddress) {
        try {
            const protocol = this.lendingProtocols[protocolName];
            if (!protocol.contract) return null;

            const reserveData = await protocol.contract.getReserveData(tokenAddress);

            // Parse reserve data based on protocol
            // This is simplified - actual implementation would depend on protocol ABIs
            const supplyRate = parseFloat(ethers.utils.formatEther(reserveData[2] || 0));
            const borrowRate = parseFloat(ethers.utils.formatEther(reserveData[3] || 0));

            return { supplyRate, borrowRate };
        } catch (error) {
            console.warn(`⚠️ Failed to get lending rates for ${protocolName}:`, error.message);
            return null;
        }
    }

    async _evaluateAndExecuteOpportunity(opportunity) {
        try {
            this.opportunityCount++;

            // Calculate profit potential
            const profitAnalysis = await this._calculateCrossProtocolProfit(opportunity);

            if (!profitAnalysis.isProfitable || profitAnalysis.expectedProfitUSD < this.minProfitUSD) {
                return;
            }

            // Check liquidity and slippage
            const liquidityCheck = await this._checkLiquidityAndSlippage(opportunity);
            if (!liquidityCheck.sufficient) {
                return;
            }

            // Check price deviation from TWAP
            const twapCheck = await this._checkTWAPDeviation(opportunity);
            if (!twapCheck.withinBounds) {
                console.log(`⚠️ Price deviation too high for opportunity: ${opportunity.type}`);
                return;
            }

            console.log(`💰 Found cross-protocol opportunity:`);
            console.log(`   Type: ${opportunity.type}`);
            console.log(`   Estimated Profit: $${profitAnalysis.expectedProfitUSD.toFixed(2)}`);
            console.log(`   Details:`, opportunity);

            // Execute opportunity
            await this._executeCrossProtocolArbitrage(opportunity, profitAnalysis);

        } catch (error) {
            console.error('❌ Error evaluating cross-protocol opportunity:', error);
        }
    }

    async _calculateCrossProtocolProfit(opportunity) {
        try {
            let expectedProfit = 0;

            switch (opportunity.type) {
                case 'dex-dex':
                    expectedProfit = opportunity.estimatedProfit;
                    break;
                case 'dex-lending':
                    expectedProfit = opportunity.estimatedProfit;
                    break;
                case 'lending-lending':
                    expectedProfit = opportunity.estimatedProfit;
                    break;
                default:
                    expectedProfit = opportunity.estimatedProfit || 0;
            }

            // Calculate costs
            const gasCost = 0.005; // 0.005 ETH gas estimate
            const flashLoanFee = expectedProfit * 0.0003; // 0.03% flash loan fee
            const protocolFees = expectedProfit * 0.001; // 0.1% protocol fees

            const totalCosts = gasCost + flashLoanFee + protocolFees;
            const netProfit = expectedProfit - totalCosts;

            // Convert to USD
            const ethPrice = await this.priceFeed.getPrice(TOKENS.WETH.address);
            const expectedProfitUSD = netProfit * ethPrice;

            return {
                isProfitable: netProfit > 0,
                expectedProfitUSD: expectedProfitUSD,
                grossProfit: expectedProfit,
                totalCosts: totalCosts,
                netProfit: netProfit
            };

        } catch (error) {
            console.error('❌ Error calculating cross-protocol profit:', error);
            return { isProfitable: false, expectedProfitUSD: 0 };
        }
    }

    async _checkLiquidityAndSlippage(opportunity) {
        // Check liquidity for the tokens involved
        const tokens = this._getTokensFromOpportunity(opportunity);

        for (const token of tokens) {
            const liquidity = await this.liquidityChecker.getLiquidity(token);
            if (liquidity.lt(this.minLiquidityThreshold)) {
                return { sufficient: false, reason: `Insufficient liquidity for ${token}` };
            }
        }

        // Check slippage
        const slippage = await this._calculateSlippage(opportunity);
        if (slippage > this.maxSlippage) {
            return { sufficient: false, reason: `Slippage too high: ${(slippage * 100).toFixed(2)}%` };
        }

        return { sufficient: true };
    }

    _getTokensFromOpportunity(opportunity) {
        const tokens = [];
        if (opportunity.tokenIn) tokens.push(opportunity.tokenIn);
        if (opportunity.tokenOut) tokens.push(opportunity.tokenOut);
        if (opportunity.token) tokens.push(opportunity.token);
        return tokens;
    }

    async _calculateSlippage(opportunity) {
        // Calculate expected slippage for the trade
        // This would involve checking order book depth, etc.
        return 0.01; // 1% default slippage estimate
    }

    async _checkTWAPDeviation(opportunity) {
        // Check if current price deviates too much from TWAP
        const token = opportunity.tokenIn || opportunity.token;
        if (!token) return { withinBounds: true };

        const currentPrice = await this.priceFeed.getPrice(token);
        const twapPrice = await this._getTWAPPrice(token);

        if (!twapPrice) return { withinBounds: true };

        const deviation = Math.abs(currentPrice - twapPrice) / twapPrice;

        return {
            withinBounds: deviation <= this.maxPriceDeviation,
            deviation: deviation,
            currentPrice: currentPrice,
            twapPrice: twapPrice
        };
    }

    async _getTWAPPrice(token) {
        const history = this.priceHistory.get(token) || [];
        if (history.length < this.twapWindow) return null;

        const sum = history.reduce((acc, price) => acc + price, 0);
        return sum / history.length;
    }

    async _executeCrossProtocolArbitrage(opportunity, profitAnalysis) {
        try {
            // Create cross-protocol arbitrage transaction
            const tx = await this._createCrossProtocolArbitrageTx(opportunity);

            // Execute via FlashloanArb contract
            const contractAddress = process.env.FLASHLOAN_ARB_CONTRACT;
            if (!contractAddress) {
                throw new Error('FlashloanArb contract address not configured');
            }

            const contract = new ethers.Contract(contractAddress, [
                "function executeCrossProtocolArbitrage(address[] calldata tokens, address[] calldata protocols, uint256[] calldata amounts, bytes calldata strategyData) external"
            ], this.signer);

            // Prepare parameters based on opportunity type
            const params = this._prepareCrossProtocolParams(opportunity);

            const txResponse = await contract.executeCrossProtocolArbitrage(
                params.tokens,
                params.protocols,
                params.amounts,
                params.strategyData
            );

            console.log(`✅ Cross-protocol arbitrage executed: ${txResponse.hash}`);

            this.emit('crossProtocolArbitrageExecuted', {
                opportunity: opportunity,
                txHash: txResponse.hash,
                profit: profitAnalysis.expectedProfitUSD,
                type: opportunity.type
            });

        } catch (error) {
            console.error('❌ Error executing cross-protocol arbitrage:', error);
        }
    }

    async _createCrossProtocolArbitrageTx(opportunity) {
        // Create transaction for cross-protocol arbitrage
        // This would involve complex multi-protocol logic
        return {}; // Placeholder
    }

    _prepareCrossProtocolParams(opportunity) {
        // Prepare parameters for the FlashloanArb contract call
        switch (opportunity.type) {
            case 'dex-dex':
                return {
                    tokens: [opportunity.tokenIn, opportunity.tokenOut],
                    protocols: [this.dexProtocols[opportunity.buyDex].router, this.dexProtocols[opportunity.sellDex].router],
                    amounts: [ethers.utils.parseEther('10')], // Example amount
                    strategyData: ethers.utils.defaultAbiCoder.encode(
                        ['string', 'address', 'address'],
                        ['dex-dex', opportunity.tokenIn, opportunity.tokenOut]
                    )
                };

            case 'dex-lending':
                return {
                    tokens: [opportunity.token],
                    protocols: [this.dexProtocols.PANCAKESWAP.router, this.lendingProtocols.AAVE.pool],
                    amounts: [ethers.utils.parseEther('10')],
                    strategyData: ethers.utils.defaultAbiCoder.encode(
                        ['string', 'address'],
                        ['dex-lending', opportunity.token]
                    )
                };

            default:
                return {
                    tokens: [],
                    protocols: [],
                    amounts: [],
                    strategyData: '0x'
                };
        }
    }

    // Emergency controls
    emergencyStop() {
        this.emergencyStop = true;
        console.log('🚨 Cross-Protocol Arbitrage Scanner emergency stop activated');
    }

    resume() {
        this.emergencyStop = false;
        console.log('✅ Cross-Protocol Arbitrage Scanner resumed');
    }

    // Statistics and monitoring
    getStats() {
        return {
            isRunning: this.isRunning,
            scanCount: this.scanCount,
            opportunityCount: this.opportunityCount,
            lastScanTime: this.lastScanTime,
            emergencyStop: this.emergencyStop,
            opportunityTypes: this.opportunityTypes
        };
    }

    async stop() {
        console.log('🛑 Stopping Cross-Protocol Arbitrage Scanner...');
        this.isRunning = false;
        console.log('✅ Cross-Protocol Arbitrage Scanner stopped');
    }
}

module.exports = CrossProtocolArbitrageScanner;
