const { ethers } = require("hardhat");
const FlashloanSimulator = require("../utils/FlashloanSimulator");
const ProfitCalculator = require("../utils/ProfitCalculator");

describe("DODO Finance Flashloan Simulation", function () {
    let simulator;
    let calculator;
    let provider;
    
    const DODO_PROVIDER = "0x8F8Dd7DB1bDA5eD3da8C9daf3bfa471c12d58486"; // DODO BSC Router
    
    const TOKENS = {
        WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        USDT: "0x55d398326f99059fF775485246999027B3197955",
        USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
        BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", // BTCB on BSC
        WETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
        CAKE: "0x0E09FaBb73Bd3Ade0a17ECC321fD13a19e81cE82",
        ALPACA: "0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F",
        ADA: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47"  // Cardano BEP20
    };

    const SIMULATION_RANGES = [
        { start: 100000, end: 500000, step: 100000 },
        { start: 500000, end: 2000000, step: 500000 }
    ];

    before(async function () {
        // Increase timeout for tests
        this.timeout(600000); // 10 minutes
        // Add retry for network stability
        this.retries(3);
        
        // Use hardhat's built-in provider
        provider = ethers.provider;
        
        // Connect to the first signer
        const [signer] = await ethers.getSigners();
        console.log("Testing with account:", signer.address);
        
        simulator = new FlashloanSimulator(provider);
        calculator = new ProfitCalculator(provider);
        
        // Verify we're on the right network
        const network = await provider.getNetwork();
        console.log("Connected to network:", {
            chainId: network.chainId,
            name: network.name
        });
        
        // Get block number to verify we're properly forked
        const blockNumber = await provider.getBlockNumber();
        console.log("Current block number:", blockNumber);
    });

    it("Should simulate flashloan costs across different amounts", async function () {
        console.log("\nDODO Flashloan Cost Analysis");
        console.log("============================");

        for (const range of SIMULATION_RANGES) {
            console.log(`\nSimulating range $${range.start.toLocaleString()} - $${range.end.toLocaleString()}`);
            await simulator.simulateRange(range.start, range.end, range.step);
        }
    });

    it("Should check liquidity across DEXs", async function () {
        console.log("\nDEX Liquidity Check");
        console.log("==================");

        for (const [symbol, tokenAddress] of Object.entries(TOKENS)) {
            try {
                console.log(`\nChecking ${symbol}...`);
                const liquidityInfo = await Promise.all([
                    simulator.dexLiquidity.getUniswapV3Liquidity(tokenAddress),
                    simulator.dexLiquidity.getPancakeV3Liquidity(tokenAddress),
                    simulator.dexLiquidity.getBalancerLiquidity(tokenAddress),
                    simulator.dexLiquidity.getCurveLiquidity(tokenAddress)
                ]);

                console.log(`${symbol} Liquidity:`);
                const dexes = ['UniswapV3', 'PancakeV3', 'Balancer', 'Curve'];
                liquidityInfo.forEach((liq, i) => {
                    if (liq && liq.available > 0) {
                        console.log(`${dexes[i]}: $${liq.available.toLocaleString()}`);
                    }
                });
            } catch (error) {
                console.log(`${symbol}: Error checking liquidity - ${error.message}`);
            }
        }
    });

    it("Should calculate profitability for sample opportunities", async function () {
        const sampleOpportunities = [
            // BNB Pairs (High Volume) - First trade prioritized for gas fee safety
            {
                buyDex: "UniswapV3",
                sellDex: "PancakeV3",
                tokenAddress: TOKENS.WBNB,
                token: "BNB/USDT",
                amount: 100000, // Reduced amount for initial safety
                buyPrice: 1094.18,
                sellPrice: 1124.82, // 2.80% spread
                useFlashSwap: true,
                retainBnb: true, // Flag to retain some BNB for gas fees
                gasFeeSafety: 0.1 // Retain 0.1 BNB for gas fees
            },
            {
                buyDex: "PancakeV3",
                sellDex: "UniswapV3",
                tokenAddress: TOKENS.WBNB,
                token: "BNB/USDC",
                amount: 500000,
                buyPrice: 1140.20,
                sellPrice: 1173.15, // 2.89% spread
                useFlashSwap: true
            },
            {
                buyDex: "UniswapV3",
                sellDex: "PancakeV3",
                tokenAddress: TOKENS.WBNB,
                token: "BNB/ETH",
                amount: 450000,
                buyPrice: 0.1315,
                sellPrice: 0.1355, // 3.04% spread
                useFlashSwap: true
            },
            // Stablecoin Pairs
            {
                buyDex: "UniswapV3",
                sellDex: "CurveFinance",
                tokenAddress: TOKENS.USDT,
                token: "USDT/USDC",
                amount: 1000000,
                buyPrice: 0.9992,
                sellPrice: 1.0245, // 2.53% spread
                useFlashSwap: true
            },
            {
                buyDex: "PancakeV3",
                sellDex: "UniswapV3",
                tokenAddress: TOKENS.BUSD,
                token: "BUSD/USDT",
                amount: 800000,
                buyPrice: 0.9992,
                sellPrice: 1.0212, // 2.20% spread
                useFlashSwap: true
            },
            // CAKE Pairs (High Volume Only)
            {
                buyDex: "PancakeV3",
                sellDex: "UniswapV3",
                tokenAddress: TOKENS.CAKE,
                token: "CAKE/USDT",
                amount: 300000,
                buyPrice: 2.87,
                sellPrice: 2.96, // 3.17% spread // 3.17% spread
                useFlashSwap: true
            },
            // Additional High Volume Pairs
            {
                buyDex: "UniswapV3",
                sellDex: "PancakeV3",
                tokenAddress: TOKENS.WBNB,
                token: "WBNB/DAI",
                amount: 400000,
                buyPrice: 214.45,
                sellPrice: 220.85, // 2.98% spread
                useFlashSwap: true
            },
            {
                buyDex: "PancakeV3",
                sellDex: "UniswapV3",
                tokenAddress: TOKENS.USDC,
                token: "USDC/DAI",
                amount: 1000000,
                buyPrice: 0.9992,
                sellPrice: 1.0245, // 2.53% spread
                useFlashSwap: true
            },
            // ETH Pairs
            {
                buyDex: "UniswapV3",
                sellDex: "PancakeV3",
                tokenAddress: TOKENS.WETH,
                token: "ETH/USDT",
                amount: 400000,
                buyPrice: 3887.13,
                sellPrice: 3983.53, // 2.48% spread // 2.48% spread
                useFlashSwap: true
            },
            {
                buyDex: "UniswapV3",
                sellDex: "PancakeV3",
                tokenAddress: TOKENS.WETH,
                token: "ETH/BTC",
                amount: 400000,
                buyPrice: 0.0648,
                sellPrice: 0.0668, // 3.10% spread
                useFlashSwap: true
            },
            // Additional Major Token Pairs
            {
                buyDex: "UniswapV3",
                sellDex: "PancakeV3",
                tokenAddress: TOKENS.WETH,
                token: "ETH/DAI",
                amount: 400000,
                buyPrice: 3182.50,
                sellPrice: 3271.40, // 2.79% spread
                useFlashSwap: true
            },
            {
                buyDex: "PancakeV3",
                sellDex: "UniswapV3",
                tokenAddress: TOKENS.BTCB,
                token: "BTC/DAI",
                amount: 500000,
                buyPrice: 108103.00,
                sellPrice: 111195.15, // 2.86% spread
                useFlashSwap: true
            },
            // BTC Pairs
            {
                buyDex: "CurveFinance",
                sellDex: "UniswapV3",
                tokenAddress: TOKENS.BTCB,
                token: "BTC/USDT",
                amount: 500000,
                buyPrice: 106778.00,
                sellPrice: 109287.28, // 2.35% spread // 2.35% spread
                useFlashSwap: true
            },
            {
                buyDex: "UniswapV3",
                sellDex: "PancakeV3",
                tokenAddress: TOKENS.BTCB,
                token: "BTC/USDC",
                amount: 500000,
                buyPrice: 108103.00,
                sellPrice: 111195.15, // 2.86% spread
                useFlashSwap: true
            }
        ];

        console.log("\nProfitability Analysis");
        console.log("=====================");

        for (const opportunity of sampleOpportunities) {
            const result = await calculator.calculateArbitrageProfitability(opportunity);
            
            console.log(`\nToken: ${opportunity.token}`);
            console.log(`Route: ${opportunity.buyDex} -> ${opportunity.sellDex}`);
            console.log(`Amount: $${opportunity.amount.toLocaleString()}`);
            console.log(`Buy Price: $${opportunity.buyPrice}`);
            console.log(`Sell Price: $${opportunity.sellPrice}`);
            if (result) {
                console.log(`Price Spread: ${result.details?.priceSpread?.toFixed?.(2) || 0}%`);
                console.log(`Raw Profit: $${result.rawProfit?.toFixed?.(2) || 0}`);
                console.log(`DODO Fee: $${result.costs?.flashLoanFee?.toFixed?.(2) || 0}`);
                console.log(`Gas Cost: $${Number(result.costs?.gasCost || 0).toFixed(2)}`);
                console.log(`Price Impact: ${((result.priceImpact || 0) * 100).toFixed(2)}%`);
                console.log(`Net Profit: $${result.adjustedProfit?.toFixed?.(2) || 0}`);
                console.log(`Profit Margin: ${result.profitMargin?.toFixed?.(2) || 0}%`);
                console.log(`Profitable: ${result.isProfitable ? 'Yes' : 'No'}`);
            } else {
                console.log('No result available for this opportunity');
            }
            console.log(`---------------------------------------------`);
        }
    });
});
