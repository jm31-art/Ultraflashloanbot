const { ethers } = require('ethers');

class StakingCalculator {
    constructor(provider) {
        this.provider = provider;
        this.stakingPools = {
            'PancakeSwap': {
                cakePool: '0x45c54210128a065de780C4B0Df3d16664f7f859e',
                syrupPool: '0x73feaa1eE314F8c655E354234017bE2193C9E24E0'
            },
            'Venus': {
                controller: '0xfD36E2c2a6789Db23113685031d7F16329158384'
            }
        };
    }

    async calculateStakingYield(token, amount, poolType = 'liquidity') {
        try {
            const yieldData = {
                token: token,
                amount: amount,
                poolType: poolType,
                apy: 0,
                dailyReward: 0,
                monthlyReward: 0,
                yearlyReward: 0
            };

            if (poolType === 'liquidity') {
                yieldData.apy = await this.calculateLiquidityMiningYield(token, amount);
            } else if (poolType === 'lending') {
                yieldData.apy = await this.calculateLendingYield(token, amount);
            }

            // Calculate rewards based on APY
            const annualReward = (amount * yieldData.apy) / 100;
            yieldData.dailyReward = annualReward / 365;
            yieldData.monthlyReward = annualReward / 12;
            yieldData.yearlyReward = annualReward;

            return yieldData;
        } catch (error) {
            console.error(`Error calculating staking yield for ${token}:`, error);
            return null;
        }
    }

    async calculateLiquidityMiningYield(token, amount) {
        // Simplified APY calculation based on historical data
        const baseAPYs = {
            'CAKE': 25.5,  // PancakeSwap CAKE staking
            'BNB': 18.2,   // BNB staking
            'BTCB': 12.8,  // BTCB staking
            'ETH': 15.3,   // ETH staking
            'USDT': 8.5,   // USDT farming
            'BUSD': 8.2,   // BUSD farming
            'USDC': 7.8    // USDC farming
        };

        return baseAPYs[token] || 5.0; // Default 5% APY
    }

    async calculateLendingYield(token, amount) {
        // Venus lending APYs
        const lendingAPYs = {
            'BNB': 2.5,
            'BTCB': 1.8,
            'ETH': 2.2,
            'USDT': 8.5,
            'BUSD': 7.8,
            'USDC': 6.2
        };

        return lendingAPYs[token] || 3.0; // Default 3% APY
    }

    async findBestStakingOpportunity(tokens, amounts) {
        const opportunities = [];

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const amount = amounts[i];

            // Check liquidity mining yield
            const liquidityYield = await this.calculateStakingYield(token, amount, 'liquidity');

            // Check lending yield
            const lendingYield = await this.calculateStakingYield(token, amount, 'lending');

            if (liquidityYield && lendingYield) {
                const bestYield = liquidityYield.apy > lendingYield.apy ? liquidityYield : lendingYield;
                bestYield.type = liquidityYield.apy > lendingYield.apy ? 'liquidity_mining' : 'lending';

                opportunities.push(bestYield);
            }
        }

        // Sort by APY descending
        return opportunities.sort((a, b) => b.apy - a.apy);
    }

    async compareStakingVsArbitrage(arbitrageProfit, stakingYield, investmentPeriod = 30) {
        const stakingReward = (arbitrageProfit * stakingYield.apy * investmentPeriod) / (100 * 365);
        const netComparison = arbitrageProfit - stakingReward;

        return {
            arbitrageProfit: arbitrageProfit,
            stakingReward: stakingReward,
            netComparison: netComparison,
            recommendation: netComparison > 0 ? 'arbitrage' : 'staking',
            investmentPeriod: investmentPeriod
        };
    }

    async getArbitrageStakingRecommendation(arbitrageOpportunity, availableBalance) {
        // Compare potential arbitrage profit vs staking the same amount
        const arbitrageProfit = arbitrageOpportunity.profit;
        const token = arbitrageOpportunity.token;

        // Get staking yield for this token
        const stakingYield = await this.calculateStakingYield(token, availableBalance, 'liquidity');

        // Compare over different timeframes
        const comparisons = [];
        const timeframes = [1, 7, 30, 90]; // days

        for (const days of timeframes) {
            const comparison = await this.compareStakingVsArbitrage(arbitrageProfit, stakingYield, days);
            comparisons.push({
                timeframe: days,
                ...comparison
            });
        }

        // Calculate break-even point
        const breakEvenDays = arbitrageProfit > 0 ?
            (arbitrageProfit / stakingYield.apy * 36500) / arbitrageProfit : Infinity;

        return {
            token,
            arbitrageOpportunity,
            stakingYield,
            comparisons,
            breakEvenDays,
            overallRecommendation: this.getOverallRecommendation(comparisons, breakEvenDays)
        };
    }

    getOverallRecommendation(comparisons, breakEvenDays) {
        const shortTerm = comparisons.find(c => c.timeframe === 1);
        const longTerm = comparisons.find(c => c.timeframe === 90);

        if (shortTerm.recommendation === 'arbitrage' && breakEvenDays > 30) {
            return 'arbitrage_now_stake_later';
        } else if (longTerm.recommendation === 'staking') {
            return 'stake_long_term';
        } else {
            return 'arbitrage_immediate';
        }
    }

    async optimizePortfolioAllocation(arbitrageOpportunities, totalBalance) {
        const allocations = {
            arbitrage: 0,
            staking: 0,
            recommendations: []
        };

        // Allocate 70% to arbitrage (higher risk, higher reward)
        // Allocate 30% to staking (stable returns)
        allocations.arbitrage = totalBalance * 0.7;
        allocations.staking = totalBalance * 0.3;

        // Get specific recommendations for each opportunity
        for (const opp of arbitrageOpportunities) {
            const recommendation = await this.getArbitrageStakingRecommendation(opp, allocations.arbitrage);
            allocations.recommendations.push(recommendation);
        }

        return allocations;
    }
}

module.exports = StakingCalculator;
