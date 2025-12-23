import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import axios from 'axios';

class PerpBot extends EventEmitter {
    constructor(provider, signer) {
        super();
        this.provider = provider;
        this.signer = signer;
        this.isRunning = false;
        this.scanInterval = 5 * 60 * 1000; // 5 minutes
        this.minFundingRate = 0.0001; // 0.01% minimum
        this.maxPositionSize = ethers.parseEther('0.1'); // 0.1 BTC/ETH max
        this.flashloanContract = null;

        // Perp DEX configs
        this.perpConfigs = {
            THENA: {
                endpoint: 'https://api.thena.fi/v1/funding-rates',
                contract: '0x0x...', // Thena perp contract
                tokens: ['BTC', 'ETH']
            },
            APOLLOX: {
                endpoint: 'https://api.apollox.com/v1/funding-rates',
                contract: '0x0x...', // ApolloX perp contract
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
        console.log('🚀 PerpBot: Starting funding rate arbitrage');

        // Initial scan
        await this.scanFundingRates();

        // Set up periodic scanning
        setInterval(async () => {
            if (this.isRunning) {
                await this.scanFundingRates();
            }
        }, this.scanInterval);
    }

    async scanFundingRates() {
        try {
            const opportunities = [];

            for (const [dexName, config] of Object.entries(this.perpConfigs)) {
                try {
                    const response = await axios.get(config.endpoint, { timeout: 5000 });
                    const rates = response.data;

                    for (const token of config.tokens) {
                        const fundingRate = rates[token]?.fundingRate || 0;

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

                            console.log(`🎯 PerpBot: ${dexName} ${token} funding rate: ${fundingRate.toFixed(6)} (${opportunity.estimatedAPY.toFixed(2)}% APY)`);
                        }
                    }
                } catch (error) {
                    // Silent error for API failures
                }
            }

            // Execute profitable opportunities
            for (const opp of opportunities) {
                if (opp.estimatedAPY > 5) { // 5% minimum APY
                    await this.executeFundingArbitrage(opp);
                }
            }

        } catch (error) {
            console.warn('⚠️ PerpBot: Funding rate scan failed:', error.message);
        }
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

    stop() {
        this.isRunning = false;
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