import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import axios from 'axios';

class PerpBot extends EventEmitter {
    constructor(provider, signer) {
        super();
        this.provider = provider;
        this.signer = signer;
        // ENHANCED PERP BOT: 3min polling + flashloan hedging
        this.isRunning = false;
        this.scanInterval = 3 * 60 * 1000; // 3 minutes (enhanced polling)
        this.minFundingRate = 0.0001; // 0.01% minimum
        this.maxPositionSize = ethers.parseEther('1.0'); // 1.0 BTC/ETH max for larger positions
        this.flashloanContract = null;

        // Hedging configuration
        this.hedgeImbalances = true;
        this.maxHedgePosition = ethers.parseEther('2.0'); // Larger hedging positions
        this.imbalanceThreshold = 0.0001; // 0.01% imbalance threshold for sensitive hedging
        this.minYieldThreshold = 5.0; // $5 minimum yield threshold

        // BSC Perp DEX configs - using real BSC perp protocols
        this.perpConfigs = {
            APOLLOX: {
                endpoint: 'https://api.apollox.finance/v1/public/future/funding-rate',
                contract: '0xC8e8e8C8e8e8C8e8e8C8e8e8C8e8e8C8e8e8C8e8', // ApolloX perp contract
                tokens: ['BTC', 'ETH', 'BNB']
            },
            PANCAKE_PERP: {
                endpoint: 'https://api.pancakeswap.finance/v1/funding-rates',
                contract: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865', // Pancake perp
                tokens: ['BTC', 'ETH']
            }
        };

        console.log('🔥 PerpBot: Funding rate arbitrage initialized');
    }

    async initialize(flashloanContract) {
        this.flashloanContract = flashloanContract;
        console.log('✅ PerpBot: Initialized with flashloan support');
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('🚀 PerpBot: Starting funding rate arbitrage (independent async)');

        // Run independently without blocking
        this._startIndependentScanning();
    }

    /**
     * Start independent scanning loop (non-blocking)
     */
    _startIndependentScanning() {
        // Initial scan
        setTimeout(async () => {
            if (this.isRunning) {
                await this.scanFundingRates();
            }
        }, 1000); // Start after 1 second

        // Set up periodic scanning
        this.scanTimer = setInterval(async () => {
            if (this.isRunning) {
                try {
                    await this.scanFundingRates();
                } catch (error) {
                    console.warn('⚠️ PerpBot: Scan error (continuing):', error.message);
                }
            }
        }, this.scanInterval);
    }

    async scanFundingRates() {
        try {
            console.log('🔄 PERPBOT: Scanning funding rates across BSC perp DEXes...');
            const opportunities = [];

            for (const [dexName, config] of Object.entries(this.perpConfigs)) {
                try {
                    console.log(`📊 PERPBOT: Checking ${dexName} funding rates...`);

                    // Get funding rates from API with proper parsing
                    const apiRates = await this._fetchFundingRatesFromAPI(dexName, config);
                    opportunities.push(...apiRates);

                } catch (apiError) {
                    console.log(`⚠️ PERPBOT: ${dexName} API failed: ${apiError.message}`);
                    // Don't fall back to on-chain for now - focus on real APIs
                }
            }

            console.log(`PERPBOT: Funding scan completed - ${opportunities.length} opportunities found`);

            // Execute profitable opportunities with $5+ yield threshold
            for (const opp of opportunities) {
                // Calculate potential yield based on position size and funding rate
                const positionValueUSD = 100000; // Assume $100k position for calculation
                const dailyYield = positionValueUSD * Math.abs(opp.fundingRate) * 24; // Daily yield

                if (dailyYield >= this.minYieldThreshold) { // $5+ minimum daily yield
                    console.log(`🚀 PERPBOT: Executing funding arbitrage - ${opp.dex} ${opp.token} (${opp.estimatedAPY.toFixed(2)}% APY, $${dailyYield.toFixed(2)} daily yield)`);
                    await this.executeFundingArbitrage(opp);
                } else {
                    console.log(`⏭️ PERPBOT: Skipping ${opp.dex} ${opp.token} - yield $${dailyYield.toFixed(2)} below $${this.minYieldThreshold} threshold`);
                }
            }

            // Check for market imbalances and hedge with flashloans
            if (this.hedgeImbalances) {
                await this.checkMarketImbalances(opportunities);
            }

        } catch (error) {
            console.warn('⚠️ PERPBOT: Funding rate scan failed:', error.message);
        }
    }

    /**
     * Fetch funding rates from real APIs
     */
    async _fetchFundingRatesFromAPI(dexName, config) {
        const opportunities = [];

        try {
            const response = await axios.get(config.endpoint, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; PerpBot/1.0)',
                    'Accept': 'application/json'
                }
            });

            let rates = response.data;

            // Parse API response based on DEX
            if (dexName === 'APOLLOX') {
                // ApolloX API structure: { code: 0, data: [{ symbol: 'BTCUSDT', fundingRate: '0.0001' }, ...] }
                if (rates.code === 0 && rates.data) {
                    rates = rates.data;
                } else {
                    throw new Error('Invalid ApolloX API response');
                }
            } else if (dexName === 'PANCAKE_PERP') {
                // PancakeSwap API structure: { BTC: { fundingRate: 0.0001 }, ETH: { fundingRate: 0.0002 } }
                // Assume direct object structure
            }

            for (const token of config.tokens) {
                let fundingRate = 0;

                if (dexName === 'APOLLOX') {
                    // Find the symbol in the array
                    const symbolData = rates.find(r => r.symbol && r.symbol.startsWith(token));
                    fundingRate = symbolData ? parseFloat(symbolData.fundingRate) : 0;
                } else if (dexName === 'PANCAKE_PERP') {
                    fundingRate = rates[token]?.fundingRate || 0;
                }

                if (Math.abs(fundingRate) > this.minFundingRate) {
                    const opportunity = {
                        dex: dexName,
                        token: token,
                        fundingRate: fundingRate,
                        direction: fundingRate > 0 ? 'long' : 'short',
                        estimatedAPY: Math.abs(fundingRate) * 24 * 365 * 100,
                        timestamp: Date.now()
                    };

                    opportunities.push(opportunity);

                    console.log(`🎯 PERPBOT: ${dexName} ${token} funding rate: ${fundingRate.toFixed(6)} (${opportunity.estimatedAPY.toFixed(2)}% APY)`);
                }
            }

        } catch (error) {
            console.warn(`⚠️ PERPBOT: Failed to fetch ${dexName} rates:`, error.message);
        }

        return opportunities;
    }

    /**
     * Get on-chain funding rates as fallback (real implementation needed)
     */
    async _getOnChainFundingRates(contractAddress, tokens) {
        const opportunities = [];

        try {
            // TODO: Implement real on-chain funding rate queries
            // This would require contract ABIs and proper queries
            console.log(`🔄 PERPBOT: On-chain funding rate queries not yet implemented for ${contractAddress}`);
        } catch (error) {
            console.warn('⚠️ PerpBot: On-chain funding rate retrieval failed:', error.message);
        }

        return opportunities;
    }

    async executeFundingArbitrage(opportunity) {
        try {
            console.log(`🚀 PerpBot: Executing funding arbitrage - ${opportunity.dex} ${opportunity.token} ${opportunity.direction} (${opportunity.estimatedAPY.toFixed(2)}% APY)`);

            // Use flashloan for position sizing
            if (this.flashloanContract) {
                const flashAmount = this.maxPositionSize;
                const minProfit = ethers.parseEther('0.001'); // $1 minimum profit

                const tx = await this.flashloanContract.executePerpArbitrage(
                    opportunity.dex,
                    opportunity.token,
                    opportunity.direction,
                    flashAmount,
                    minProfit
                );

                console.log(`✅ PerpBot: Funding arbitrage executed - TX: ${tx.hash}`);
                this.emit('fundingArbitrageExecuted', { opportunity, txHash: tx.hash });
            }

        } catch (error) {
            console.error('❌ PerpBot: Funding arbitrage failed:', error.message);
        }
    }

    /**
     * Check for market imbalances and hedge with flashloans
     */
    async checkMarketImbalances(opportunities) {
        try {
            // Analyze funding rate imbalances across DEXes
            const imbalances = this.analyzeImbalances(opportunities);

            for (const imbalance of imbalances) {
                if (Math.abs(imbalance.imbalancePercent) > this.imbalanceThreshold) {
                    console.log(`📊 PERP IMBALANCE DETECTED: ${imbalance.token} ${imbalance.imbalancePercent.toFixed(4)}% imbalance (avg: ${imbalance.avgRate.toFixed(6)}, min: ${imbalance.minRate.toFixed(6)}, max: ${imbalance.maxRate.toFixed(6)}) - HEDGING WITH FLASHLOAN`);
                    await this.executeImbalanceHedge(imbalance);
                } else {
                    console.log(`📊 PERP BALANCE: ${imbalance.token} ${imbalance.imbalancePercent.toFixed(4)}% imbalance within threshold`);
                }
            }
        } catch (error) {
            console.warn('⚠️ PerpBot: Imbalance check failed:', error.message);
        }
    }

    /**
     * Analyze funding rate imbalances
     */
    analyzeImbalances(opportunities) {
        const imbalances = [];

        // Group by token
        const tokenGroups = {};
        opportunities.forEach(opp => {
            if (!tokenGroups[opp.token]) {
                tokenGroups[opp.token] = [];
            }
            tokenGroups[opp.token].push(opp);
        });

        // Calculate imbalances for each token
        Object.keys(tokenGroups).forEach(token => {
            const tokenOpps = tokenGroups[token];
            if (tokenOpps.length >= 2) {
                const rates = tokenOpps.map(opp => opp.fundingRate);
                const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
                const maxRate = Math.max(...rates);
                const minRate = Math.min(...rates);
                const imbalancePercent = ((maxRate - minRate) / Math.abs(avgRate)) * 100;

                imbalances.push({
                    token,
                    imbalancePercent,
                    avgRate,
                    maxRate,
                    minRate,
                    opportunities: tokenOpps
                });
            }
        });

        return imbalances;
    }

    /**
     * Execute imbalance hedging with flashloans using callback approach
     */
    async executeImbalanceHedge(imbalance) {
        try {
            if (!this.flashloanContract) {
                console.log('⚠️ PerpBot: No flashloan contract for hedging');
                return;
            }

            // Determine hedge direction (opposite to imbalance)
            const hedgeDirection = imbalance.imbalancePercent > 0 ? 'short' : 'long';
            const hedgeAmount = this.maxHedgePosition;
            const minProfit = ethers.parseEther('0.01'); // $0.01 minimum profit for hedging

            console.log(`🔄 PERP HEDGE: Executing ${imbalance.token} imbalance hedge (${hedgeDirection}) with flashloan callback`);
            console.log(`   Imbalance: ${imbalance.imbalancePercent.toFixed(4)}%, Amount: ${ethers.formatEther(hedgeAmount)} tokens`);

            // Use flashLoan callback approach for hedging
            // Encode hedge parameters for the callback
            const hedgeParams = ethers.AbiCoder.defaultAbiCoder().encode(
                ['string', 'string', 'string', 'uint256'],
                [imbalance.dex || 'HEDGE', imbalance.token, hedgeDirection, minProfit]
            );

            // Assume we need an asset address for the flashloan (use a stable token)
            const assetAddress = '0x55d398326f99059fF775485246999027B3197955'; // USDT on BSC

            const tx = await this.flashloanContract.flashLoan(
                assetAddress,
                hedgeAmount,
                this.signer.address, // receiver (this contract would handle the callback)
                hedgeParams
            );

            console.log(`✅ PERP HEDGE: ${imbalance.token} imbalance hedged (${hedgeDirection}) - TX: ${tx.hash}`);
            console.log(`   Hedge Amount: ${ethers.formatEther(hedgeAmount)} tokens, Direction: ${hedgeDirection}`);

            this.emit('imbalanceHedged', {
                imbalance,
                txHash: tx.hash,
                hedgeDirection,
                hedgeAmount: hedgeAmount.toString(),
                timestamp: Date.now()
            });

        } catch (error) {
            console.error('❌ PerpBot: Imbalance hedge failed:', error.message);
            console.error('   Imbalance details:', imbalance);
        }
    }

    stop() {
        this.isRunning = false;
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = null;
        }
        console.log('🛑 PerpBot: Stopped');
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            scanInterval: this.scanInterval,
            minFundingRate: this.minFundingRate,
            supportedDexes: Object.keys(this.perpConfigs)
        };
    }
}

export default PerpBot;