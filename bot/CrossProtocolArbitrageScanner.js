import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { PROTOCOLS } from '../config/protocols.js';
const { DEX_PROTOCOLS, LENDING_PROTOCOLS, TOKENS } = PROTOCOLS;
import PriceFeed from '../services/PriceFeed.js';
import ProfitCalculator from '../utils/ProfitCalculator.js';
import DexLiquidityChecker from '../utils/DexLiquidityChecker.js';

class CrossProtocolArbitrageScanner extends EventEmitter {
    constructor(provider, signer, options = {}) {
        super();

        this.provider = provider;
        this.signer = signer;
        this.priceFeed = new PriceFeed(provider);
        this.profitCalculator = new ProfitCalculator(provider);
        this.liquidityChecker = new DexLiquidityChecker(provider);

        // Configuration
        this.minProfitUSD = options.minProfitUSD || 5;
        this.maxGasPrice = options.maxGasPrice || ethers.parseUnits('10', 'gwei'); // dynamic gwei
        this.scanInterval = options.scanInterval || 15000; // 15 seconds
        this.maxTradeSize = options.maxTradeSize || ethers.parseEther('50000'); // $50k max
        this.minLiquidityThreshold = options.minLiquidityThreshold || ethers.parseEther('10000'); // $10k min liquidity

        this.isRunning = false;
        this.scanCount = 0;
        this.opportunityCount = 0;
        this.lastScanTime = 0;

        // Protocol configurations
        this.dexProtocols = DEX_PROTOCOLS;
        this.lendingProtocols = LENDING_PROTOCOLS;

        // Token address to symbol map
        this.tokenAddressToSymbol = {};
        Object.values(TOKENS).forEach(token => {
            this.tokenAddressToSymbol[token.address] = token.symbol;
        });

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
                        ethers.parseEther('1'),
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

        // Multi-hop paths for arbitrage
        const paths = [
            [TOKENS.WETH.address, TOKENS.USDC.address],
            [TOKENS.WETH.address, TOKENS.USDT.address, TOKENS.USDC.address],
            [TOKENS.WETH.address, TOKENS.WBTC.address, TOKENS.USDC.address],
            [TOKENS.WETH.address, TOKENS.CAKE.address, TOKENS.USDC.address],
            [TOKENS.WBTC.address, TOKENS.WETH.address, TOKENS.USDC.address],
            [TOKENS.USDC.address, TOKENS.WETH.address, TOKENS.WBTC.address]
        ];

        for (const path of paths) {
            const dexPrices = {};

            // Get prices from each DEX
            for (const [dexName, dexConfig] of Object.entries(this.dexProtocols)) {
                if (dexConfig.contract) {
                    try {
                        const amounts = await dexConfig.contract.getAmountsOut(
                            ethers.parseEther('1'),
                            path
                        );
                        const outputAmount = parseFloat(ethers.formatEther(amounts[amounts.length - 1]));
                        dexPrices[dexName] = outputAmount;
                    } catch (error) {
                        console.warn(`⚠️ Failed to get price from ${dexName}:`, error.message);
                    }
                }
            }

            // Find arbitrage opportunities
            const sortedDexes = Object.entries(dexPrices).sort((a, b) => b[1] - a[1]);
            if (sortedDexes.length >= 2) {
                const bestDex = sortedDexes[0];
                const worstDex = sortedDexes[sortedDexes.length - 1];
                const spread = (bestDex[1] - worstDex[1]) / worstDex[1];

                if (spread > 0.001) { // 0.1% minimum spread
                    // Calculate slippage
                    const slippage = await this._calculateSlippage(path, bestDex[0], worstDex[0]);

                    const opportunity = {
                        type: 'dex-dex',
                        path,
                        buyDex: worstDex[0],
                        sellDex: bestDex[0],
                        buyOutput: worstDex[1],
                        sellOutput: bestDex[1],
                        spread: spread,
                        slippage: slippage,
                        estimatedProfit: (bestDex[1] - worstDex[1]) * 0.9 // Account for fees
                    };
                    opportunities.push(opportunity);
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
        try {
            // Use DeFiLlama API for real yield data
            const response = await fetch('https://yields.llama.fi/pools');
            const data = await response.json();

            // Filter for Venus and other lending protocols
            const lendingPools = data.data.filter(pool =>
                pool.project === 'venus' || pool.project === 'compound' || pool.project === 'aave'
            );

            for (const pool of lendingPools) {
                if (pool.apy > 10 && pool.tvlUsd > 100000) { // $10+ APY, $100k+ TVL
                    const opportunity = {
                        type: 'yield-farming',
                        pool: pool.pool,
                        project: pool.project,
                        underlying: pool.underlyingTokens,
                        apy: pool.apy,
                        tvl: pool.tvlUsd,
                        estimatedProfit: (pool.apy / 100) * pool.tvlUsd / 365 // Daily profit estimate
                    };
                    await this._evaluateAndExecuteOpportunity(opportunity);
                }
            }

            console.log(`🔍 Scanned ${lendingPools.length} yield farming pools`);
        } catch (error) {
            console.error('❌ Error scanning yield farming opportunities:', error);
        }
    }

    async _scanLiquidityMiningOpportunities() {
        try {
            // Use DeFiLlama API for liquidity mining APYs
            const response = await fetch('https://yields.llama.fi/pools');
            const data = await response.json();

            // Filter for DEX pools with rewards
            const miningPools = data.data.filter(pool =>
                (pool.project === 'pancakeswap' || pool.project === 'uniswap' || pool.project === 'sushiswap') &&
                pool.rewardTokens && pool.rewardTokens.length > 0
            );

            for (const pool of miningPools) {
                if (pool.apy > 15 && pool.tvlUsd > 50000) { // 15%+ APY, $50k+ TVL
                    const opportunity = {
                        type: 'liquidity-mining',
                        pool: pool.pool,
                        project: pool.project,
                        underlying: pool.underlyingTokens,
                        apy: pool.apy,
                        tvl: pool.tvlUsd,
                        rewards: pool.rewardTokens,
                        estimatedProfit: (pool.apy / 100) * pool.tvlUsd / 365
                    };
                    await this._evaluateAndExecuteOpportunity(opportunity);
                }
            }

            console.log(`🔍 Scanned ${miningPools.length} liquidity mining pools`);
        } catch (error) {
            console.error('❌ Error scanning liquidity mining opportunities:', error);
        }
    }

    async _getDEXPrice(tokenIn, tokenOut) {
        try {
            // Use the first available DEX for price reference
            const dexConfig = Object.values(this.dexProtocols)[0];
            if (dexConfig.contract) {
                const amounts = await dexConfig.contract.getAmountsOut(
                    ethers.parseEther('1'),
                    [tokenIn, tokenOut]
                );
                return parseFloat(ethers.formatEther(amounts[1]));
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

            // Parse reserve data using ray (10^27) for rates
            const RAY = 10n ** 27n;
            const supplyRate = Number(reserveData[2] || 0n) / Number(RAY);
            const borrowRate = Number(reserveData[3] || 0n) / Number(RAY);

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

            // Calculate costs with dynamic gas
            const feeData = await this.provider.getFeeData();
            const gasPrice = parseFloat(ethers.formatUnits(feeData.gasPrice, 'ether'));
            const gasCost = gasPrice * 200000; // 200k gas estimate
            const flashLoanFee = expectedProfit * 0.0009; // 0.09% Aave flash loan fee
            const protocolFees = expectedProfit * 0.003; // 0.3% DEX fees

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
            const symbol = this.tokenAddressToSymbol[token];
            if (symbol) {
                const liquidity = await this.liquidityChecker.checkDexLiquidity('PancakeSwap', symbol, 10000); // $10k
                if (!liquidity || !liquidity.sufficient) {
                    return { sufficient: false, reason: `Insufficient liquidity for ${symbol} on PancakeSwap` };
                }
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
        if (opportunity.type === 'dex-dex') {
            return await this._calculateDEXSlippage(opportunity.path, opportunity.buyDex, opportunity.sellDex);
        }
        return 0.01; // 1% default slippage estimate
    }

    async _calculateDEXSlippage(path, buyDex, sellDex) {
        try {
            const amountIn = ethers.parseEther('10');
            const buyAmounts = await this.dexProtocols[buyDex].contract.getAmountsOut(amountIn, path);
            const sellAmounts = await this.dexProtocols[sellDex].contract.getAmountsOut(amountIn, path);
            const buyOutput = buyAmounts[buyAmounts.length - 1];
            const sellOutput = sellAmounts[sellAmounts.length - 1];
            const slippage = (sellOutput - buyOutput) / sellOutput;
            return Math.abs(slippage);
        } catch (error) {
            return 0.01;
        }
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
            // Use Aave V3 flashLoan for execution
            const contractAddress = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4e2'; // Aave V3 BSC

            const contract = new ethers.Contract(contractAddress, [
                "function flashLoan(address receiver, address[] calldata assets, uint256[] calldata amounts, uint256[] calldata modes, address onBehalfOf, bytes calldata params, uint16 referralCode) external"
            ], this.signer);

            // Prepare parameters
            const params = this._prepareCrossProtocolParams(opportunity);

            const txResponse = await contract.flashLoan(
                params.receiver,
                params.assets,
                params.amounts,
                params.modes,
                params.onBehalfOf,
                params.strategyData,
                0 // referralCode
            );

            console.log(`✅ Cross-protocol arbitrage executed via Aave flashLoan: ${txResponse.hash}`);
            console.log(`   Type: ${opportunity.type}, Estimated Profit: $${profitAnalysis.expectedProfitUSD.toFixed(2)}`);

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
        // Prepare parameters for Aave V3 flashLoan call
        switch (opportunity.type) {
            case 'dex-dex':
                return {
                    assets: [opportunity.path[0]],
                    amounts: [ethers.parseEther('10')],
                    modes: [0], // no debt
                    onBehalfOf: this.signer.address,
                    receiver: process.env.FLASHLOAN_CALLBACK_CONTRACT || this.signer.address,
                    strategyData: ethers.AbiCoder.defaultAbiCoder.encode(
                        ['string', 'address[]', 'string', 'string'],
                        ['dex-dex', opportunity.path, opportunity.buyDex, opportunity.sellDex]
                    )
                };

            case 'dex-lending':
                return {
                    assets: [opportunity.token],
                    amounts: [ethers.parseEther('10')],
                    modes: [0],
                    onBehalfOf: this.signer.address,
                    receiver: process.env.FLASHLOAN_CALLBACK_CONTRACT || this.signer.address,
                    strategyData: ethers.AbiCoder.defaultAbiCoder.encode(
                        ['string', 'address'],
                        ['dex-lending', opportunity.token]
                    )
                };

            case 'lending-lending':
                return {
                    assets: [opportunity.token],
                    amounts: [ethers.parseEther('10')],
                    modes: [0],
                    onBehalfOf: this.signer.address,
                    receiver: process.env.FLASHLOAN_CALLBACK_CONTRACT || this.signer.address,
                    strategyData: ethers.AbiCoder.defaultAbiCoder.encode(
                        ['string', 'address', 'string', 'string'],
                        ['lending-lending', opportunity.token, opportunity.borrowProtocol, opportunity.lendProtocol]
                    )
                };

            case 'yield-farming':
                return {
                    assets: opportunity.underlying.slice(0, 1), // first token
                    amounts: [ethers.parseEther('10')],
                    modes: [0],
                    onBehalfOf: this.signer.address,
                    receiver: process.env.FLASHLOAN_CALLBACK_CONTRACT || this.signer.address,
                    strategyData: ethers.AbiCoder.defaultAbiCoder.encode(
                        ['string', 'string'],
                        ['yield-farming', opportunity.pool]
                    )
                };

            case 'liquidity-mining':
                return {
                    assets: opportunity.underlying.slice(0, 1),
                    amounts: [ethers.parseEther('10')],
                    modes: [0],
                    onBehalfOf: this.signer.address,
                    receiver: process.env.FLASHLOAN_CALLBACK_CONTRACT || this.signer.address,
                    strategyData: ethers.AbiCoder.defaultAbiCoder.encode(
                        ['string', 'string'],
                        ['liquidity-mining', opportunity.pool]
                    )
                };

            default:
                return {
                    assets: [],
                    amounts: [],
                    modes: [],
                    onBehalfOf: this.signer.address,
                    receiver: this.signer.address,
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

export default CrossProtocolArbitrageScanner;
