#!/usr/bin/env node

/**
 * TRIANGULAR ARBITRAGE EXECUTOR
 * Executes profitable triangular arbitrage opportunities found by the scanner
 */

const { ethers } = require('ethers');
const { TOKENS, DEX_CONFIGS } = require('./config/dex');
require('dotenv').config();

// Configuration
const CONFIG = {
    minProfitUSD: 10, // Minimum $10 profit to execute
    maxGasPrice: 20, // Maximum 20 gwei
    flashloanContract: process.env.FLASHLOAN_ARB_CONTRACT || '0xf682bd44ca1Fb8184e359A8aF9E1732afD29BBE1',
    rpcUrl: process.env.RPC_URL || 'https://bsc-dataseed.binance.org/',
    privateKey: process.env.PRIVATE_KEY
};

// Flashloan contract ABI (simplified)
const FLASHLOAN_ABI = [
    "function executeTriArb(address tokenA, address tokenB, address tokenC, uint256 amountIn, string memory router1Name, string memory router2Name, string memory router3Name, uint256 minReturnA, uint256 deadline) external onlyOwner returns (uint256 finalAmountA, uint256 profit)"
];

// Router ABI for triangular arbitrage
const ROUTER_ABI = [
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

class TriangularArbitrageExecutor {
    constructor() {
        if (!CONFIG.privateKey) {
            throw new Error('PRIVATE_KEY not found in environment');
        }

        this.provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
        this.signer = new ethers.Wallet(CONFIG.privateKey, this.provider);
        this.flashloanContract = new ethers.Contract(CONFIG.flashloanContract, FLASHLOAN_ABI, this.signer);

        // Initialize routers
        this.routers = {};
        for (const [name, config] of Object.entries(DEX_CONFIGS)) {
            this.routers[name] = new ethers.Contract(config.router, ROUTER_ABI, this.signer);
        }

        console.log('🔄 Triangular Arbitrage Executor initialized');
        console.log(`📍 Contract: ${CONFIG.flashloanContract}`);
        console.log(`👤 Signer: ${this.signer.address}`);
    }

    async executeTriangularArbitrage(tokenA, tokenB, tokenC, expectedProfitUSD) {
        try {
            console.log(`\n🎯 EXECUTING TRIANGULAR ARBITRAGE:`);
            console.log(`   Path: ${tokenA.symbol} → ${tokenB.symbol} → ${tokenC.symbol} → ${tokenA.symbol}`);
            console.log(`   Expected Profit: $${expectedProfitUSD.toFixed(2)}`);

            // Validate profit threshold
            if (expectedProfitUSD < CONFIG.minProfitUSD) {
                console.log(`❌ Profit too low: $${expectedProfitUSD.toFixed(2)} < $${CONFIG.minProfitUSD} minimum`);
                return null;
            }

            // Check gas price
            const gasPrice = await this.provider.getGasPrice();
            const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));

            if (gasPriceGwei > CONFIG.maxGasPrice) {
                console.log(`❌ Gas price too high: ${gasPriceGwei.toFixed(2)} gwei > ${CONFIG.maxGasPrice} gwei max`);
                return null;
            }

            // Calculate optimal trade size
            const tradeSize = this.calculateOptimalTradeSize(expectedProfitUSD);
            console.log(`💰 Trade size: ${ethers.utils.formatEther(tradeSize)} ${tokenA.symbol} ($${tradeSize.mul(500).div(ethers.utils.parseEther('1')).toNumber()})`);

            // Find best router combination for triangular arbitrage
            const routerCombo = await this.findBestRouterCombination(tokenA, tokenB, tokenC, tradeSize);

            if (!routerCombo) {
                console.log('❌ No suitable router combination found');
                return null;
            }

            console.log(`🏦 Using routers: ${routerCombo.router1} → ${routerCombo.router2} → ${routerCombo.router3}`);

            // Calculate minimum return (with slippage protection)
            const minReturnA = tradeSize.mul(995).div(1000); // 0.5% slippage protection
            const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

            // Execute the triangular arbitrage via flashloan contract
            console.log('⚡ Executing flashloan triangular arbitrage...');

            const tx = await this.flashloanContract.executeTriArb(
                tokenA.address,
                tokenB.address,
                tokenC.address,
                tradeSize,
                routerCombo.router1,
                routerCombo.router2,
                routerCombo.router3,
                minReturnA,
                deadline,
                {
                    gasLimit: 3000000, // High gas limit for complex arbitrage
                    gasPrice: gasPrice
                }
            );

            console.log(`✅ Triangular arbitrage executed: ${tx.hash}`);

            // Wait for confirmation
            const receipt = await tx.wait();
            console.log(`📊 Transaction confirmed in block ${receipt.blockNumber}`);
            console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);

            // Extract profit from transaction logs (if available)
            const profit = this.extractProfitFromReceipt(receipt);
            if (profit) {
                console.log(`💰 Profit realized: $${profit.toFixed(2)}`);
            }

            return {
                txHash: tx.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed,
                profit: profit
            };

        } catch (error) {
            console.error('❌ Triangular arbitrage execution failed:', error.message);
            return null;
        }
    }

    calculateOptimalTradeSize(expectedProfitUSD) {
        // Scale trade size based on profit potential
        // Higher profit potential = larger trade size
        const baseSize = ethers.utils.parseEther('1'); // 1 WBNB base

        if (expectedProfitUSD > 100) {
            return baseSize.mul(5); // 5x for very profitable opportunities
        } else if (expectedProfitUSD > 50) {
            return baseSize.mul(3); // 3x for good opportunities
        } else if (expectedProfitUSD > 25) {
            return baseSize.mul(2); // 2x for moderate opportunities
        }

        return baseSize; // 1x for minimum profitable opportunities
    }

    async findBestRouterCombination(tokenA, tokenB, tokenC, amountIn) {
        // Test different router combinations to find the most profitable path
        const routerNames = Object.keys(this.routers);
        let bestCombo = null;
        let bestOutput = ethers.constants.Zero;

        for (let i = 0; i < routerNames.length; i++) {
            for (let j = 0; j < routerNames.length; j++) {
                for (let k = 0; k < routerNames.length; k++) {
                    try {
                        const router1 = routerNames[i];
                        const router2 = routerNames[j];
                        const router3 = routerNames[k];

                        // Calculate A → B → C → A output
                        const amountsAB = await this.routers[router1].getAmountsOut(amountIn, [tokenA.address, tokenB.address]);
                        const amountsBC = await this.routers[router2].getAmountsOut(amountsAB[1], [tokenB.address, tokenC.address]);
                        const amountsCA = await this.routers[router3].getAmountsOut(amountsBC[1], [tokenC.address, tokenA.address]);

                        const finalOutput = amountsCA[1];

                        if (finalOutput.gt(bestOutput)) {
                            bestOutput = finalOutput;
                            bestCombo = {
                                router1,
                                router2,
                                router3,
                                expectedOutput: finalOutput
                            };
                        }
                    } catch (error) {
                        // Skip invalid combinations
                        continue;
                    }
                }
            }
        }

        return bestCombo;
    }

    extractProfitFromReceipt(receipt) {
        // Extract profit from transaction logs (simplified)
        // In a real implementation, you'd parse the contract events
        try {
            // Look for TriArbExecuted event or similar
            for (const log of receipt.logs) {
                // Parse profit from event logs if available
                // This is a placeholder - actual implementation would decode events
            }

            // Fallback: estimate profit based on gas costs vs expected profit
            // This is not accurate but provides a basic estimate
            return null; // Return null if can't determine exact profit
        } catch (error) {
            return null;
        }
    }

    async monitorAndExecute() {
        console.log('👀 Starting triangular arbitrage monitor...');

        // This would integrate with the Python scanner
        // For now, it's a placeholder that could be called when opportunities are found

        while (true) {
            try {
                // Wait for opportunities from the scanner
                // In production, this would listen for events or API calls from the scanner

                await new Promise(resolve => setTimeout(resolve, 1000)); // Check every second

            } catch (error) {
                console.error('Monitor error:', error.message);
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds on error
            }
        }
    }
}

// Export for use in other modules
module.exports = TriangularArbitrageExecutor;

// CLI execution
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Triangular Arbitrage Executor');
        console.log('Usage: node execute_triangular_arb.js <tokenA> <tokenB> <tokenC> <expectedProfitUSD>');
        console.log('Example: node execute_triangular_arb.js WBNB CAKE BTCB 25.50');
        process.exit(1);
    }

    if (args[0] === '--monitor') {
        // Start monitoring mode
        const executor = new TriangularArbitrageExecutor();
        executor.monitorAndExecute().catch(console.error);
    } else if (args.length >= 4) {
        // Execute specific arbitrage
        const [tokenASymbol, tokenBSymbol, tokenCSymbol, profitStr] = args;
        const expectedProfit = parseFloat(profitStr);

        const executor = new TriangularArbitrageExecutor();

        // Get token objects
        const tokenA = TOKENS[tokenASymbol.toUpperCase()];
        const tokenB = TOKENS[tokenBSymbol.toUpperCase()];
        const tokenC = TOKENS[tokenCSymbol.toUpperCase()];

        if (!tokenA || !tokenB || !tokenC) {
            console.error('Invalid token symbols. Available:', Object.keys(TOKENS).join(', '));
            process.exit(1);
        }

        executor.executeTriangularArbitrage(tokenA, tokenB, tokenC, expectedProfit)
            .then(result => {
                if (result) {
                    console.log('✅ Arbitrage executed successfully!');
                    console.log(`   Tx Hash: ${result.txHash}`);
                    process.exit(0);
                } else {
                    console.log('❌ Arbitrage execution failed or not profitable');
                    process.exit(1);
                }
            })
            .catch(error => {
                console.error('Execution error:', error);
                process.exit(1);
            });
    } else {
        console.log('Invalid arguments. Use --help for usage information.');
        process.exit(1);
    }
}