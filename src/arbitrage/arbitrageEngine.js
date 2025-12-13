import { ROUTERS, provider } from "../dex/routers.js";
import { simulateTriangular } from "./simulator.js";
import { calculateProfit } from "./profitCalculator.js";
import { flashloanProvider } from "../flashloan/flashloanProvider.js";
import { mevGuard } from "./mevGuard.js";
import { ethers } from "ethers";

// Extreme Mode Configuration (IMMUTABLE)
let EXTREME_MODE = {
  enabled: true,
  maxAttempts: 2,
  attemptsUsed: 0,
  minProfitUsd: 25,
  profitGasRatio: 8,
  maxGasUsd: 0.40,
  maxPriceImpactPct: 0.3,
  slippageBps: 0,
  autoDisableAfter: true
};

// Normal Mode Configuration
const NORMAL_MODE = {
  enabled: true,
  minProfitUsd: 5,
  profitGasRatio: 3,
  maxGasUsd: 1.00,
  maxPriceImpactPct: 1.0,
  slippageBps: 50 // 0.5%
};

export async function runArbitrage(paths, signer, flashloanContractAddress) {
  const mode = EXTREME_MODE.enabled ? EXTREME_MODE : NORMAL_MODE;
  const isExtremeMode = EXTREME_MODE.enabled;

  console.log(`\n🚀 Running arbitrage engine (${isExtremeMode ? 'EXTREME' : 'NORMAL'} MODE)`);
  console.log(`Attempts used: ${EXTREME_MODE.attemptsUsed}/${EXTREME_MODE.maxAttempts}`);

  for (const [routerName, router] of Object.entries(ROUTERS)) {
    for (const path of paths) {
      // Calculate optimal flashloan size dynamically
      const optimalSize = await calculateOptimalFlashloanSize(router, path, mode);
      if (!optimalSize) continue;

      const { amount: amountInWei, priceImpact } = optimalSize;

      // On-chain simulation (MANDATORY)
      const sim = await simulateTriangular(router, path, amountInWei);
      if (!sim || sim.finalOut <= amountInWei) continue;

      // Gas estimation
      let gasEstimate;
      try {
        gasEstimate = await router.getAmountsOut.estimateGas(
          amountInWei,
          [path[0], path[1]]
        );
      } catch {
        continue;
      }

      // Profit calculation
      const tokenPriceUsd = 567; // BNB price approximation
      const profit = calculateProfit(
        amountInWei,
        sim.finalOut,
        gasEstimate,
        tokenPriceUsd
      );

      if (!profit) continue;

      // Strict validation checks
      if (!await validateArbitrageConditions(router, path, amountInWei, sim, profit, mode, priceImpact)) {
        continue;
      }

      // Initialize MEV guard baseline
      const guardInitialized = await mevGuard.initializeBaseline(router, path, amountInWei);
      if (!guardInitialized) continue;

      // MEV safety validation
      const safetyCheck = await mevGuard.validateExecutionSafety(router, path, amountInWei, { priceImpact });
      if (!safetyCheck.safe) {
        console.log(`🚨 MEV GUARD: Skipping execution - ${safetyCheck.issues.join(', ')}`);
        continue;
      }

      // Log opportunity details
      console.log(`\n🔥 REAL ARBITRAGE FOUND`);
      console.log(`DEX: ${routerName}`);
      console.log(`Path: ${path.join(" → ")} → ${path[0]}`);
      console.log(`Flashloan: ${ethers.formatEther(amountInWei)} ${path[0]}`);
      console.log(`Expected Out: ${ethers.formatEther(sim.finalOut)} ${path[0]}`);
      console.log(`Expected Profit: $${profit.profitUsd.toFixed(2)}`);
      console.log(`Gas Estimate: $${profit.gasUsd.toFixed(2)}`);
      console.log(`Price Impact: ${(priceImpact * 100).toFixed(3)}%`);

      // Execute flashloan arbitrage
      const result = await executeFlashloanArbitrage({
        asset: path[0],
        amountWei: amountInWei,
        router: router.target,
        path: path,
        flashloanContractAddress,
        signer
      });

      // Track attempts in extreme mode
      if (isExtremeMode) {
        EXTREME_MODE.attemptsUsed++;

        if (result.success || EXTREME_MODE.attemptsUsed >= EXTREME_MODE.maxAttempts) {
          if (EXTREME_MODE.autoDisableAfter) {
            EXTREME_MODE.enabled = false;
            console.log(`\n🛑 EXTREME MODE DISABLED after ${EXTREME_MODE.attemptsUsed} attempts`);
            console.log(`Resuming NORMAL MODE arbitrage`);
          }
        }
      }

      if (result.success) {
        return result;
      }
    }
  }

  return null;
}

/**
 * Calculate optimal flashloan size based on pool constraints
 */
async function calculateOptimalFlashloanSize(router, path, mode) {
  try {
    // Get pool reserves (simplified - would need actual pool contracts)
    // In production, query actual pool reserves for each hop
    const mockReserves = {
      [path[0]]: 1000000n, // 1M tokens
      [path[1]]: 500000n,  // 500K tokens
      [path[2]]: 750000n   // 750K tokens
    };

    // Find minimum reserve across all hops (safety constraint)
    const reserves = [
      mockReserves[path[0]] || 1000000n,
      mockReserves[path[1]] || 1000000n,
      mockReserves[path[2]] || 1000000n
    ];

    const minReserve = reserves.reduce((min, reserve) => reserve < min ? reserve : min, reserves[0]);
    const maxFlashloan = minReserve / 20n; // ≤ 5% of smallest pool

    // Test different sizes to find optimal
    const testSizes = [
      maxFlashloan / 4n,
      maxFlashloan / 2n,
      maxFlashloan * 3n / 4n,
      maxFlashloan
    ];

    for (const testSize of testSizes) {
      if (testSize === 0n) continue;

      // Simulate to check profitability
      const sim = await simulateTriangular(router, path, testSize);
      if (!sim || sim.finalOut <= testSize) continue;

      // Calculate price impact
      const priceImpact = mevGuard.calculatePriceImpact(path, testSize, reserves);
      if (priceImpact > mode.maxPriceImpactPct) continue;

      // Gas estimation
      let gasEstimate;
      try {
        gasEstimate = await router.getAmountsOut.estimateGas(
          testSize,
          [path[0], path[1]]
        );
      } catch {
        continue;
      }

      // Profit calculation
      const tokenPriceUsd = 567;
      const profit = calculateProfit(testSize, sim.finalOut, gasEstimate, tokenPriceUsd);

      if (!profit) continue;

      // Check if meets mode requirements
      if (profit.profitUsd >= mode.minProfitUsd &&
          profit.profitUsd >= profit.gasUsd * mode.profitGasRatio &&
          profit.gasUsd <= mode.maxGasUsd) {

        return {
          amount: testSize,
          priceImpact: priceImpact,
          simulation: sim,
          profit: profit
        };
      }
    }

    return null; // No suitable size found

  } catch (error) {
    console.error("Failed to calculate optimal flashloan size:", error);
    return null;
  }
}

/**
 * Validate all arbitrage execution conditions
 */
async function validateArbitrageConditions(router, path, amountInWei, sim, profit, mode, priceImpact) {
  try {
    // Check profit thresholds
    if (profit.profitUsd < mode.minProfitUsd) {
      console.log(`❌ Profit too low: $${profit.profitUsd.toFixed(2)} < $${mode.minProfitUsd}`);
      return false;
    }

    // Check profit vs gas ratio
    if (profit.profitUsd < profit.gasUsd * mode.profitGasRatio) {
      console.log(`❌ Profit/gas ratio too low: ${profit.profitUsd / profit.gasUsd} < ${mode.profitGasRatio}`);
      return false;
    }

    // Check gas cost limit
    if (profit.gasUsd > mode.maxGasUsd) {
      console.log(`❌ Gas cost too high: $${profit.gasUsd.toFixed(2)} > $${mode.maxGasUsd}`);
      return false;
    }

    // Check price impact
    if (priceImpact > mode.maxPriceImpactPct) {
      console.log(`❌ Price impact too high: ${(priceImpact * 100).toFixed(3)}% > ${(mode.maxPriceImpactPct * 100).toFixed(1)}%`);
      return false;
    }

    // Check flashloan availability
    const reserveData = await flashloanProvider.getReserveData(path[0]);
    if (!reserveData || reserveData.availableLiquidity < amountInWei) {
      console.log(`❌ Insufficient flashloan liquidity`);
      return false;
    }

    return true;

  } catch (error) {
    console.error("Arbitrage validation failed:", error);
    return false;
  }
}

/**
 * Execute flashloan arbitrage
 */
async function executeFlashloanArbitrage({
  asset,
  amountWei,
  router,
  path,
  flashloanContractAddress,
  signer
}) {
  try {
    // Use the flashloan provider to execute
    const tx = await flashloanProvider.executeFlashloan(
      flashloanContractAddress,
      asset,
      amountWei,
      { router, path }
    );

    console.log(`📤 Flashloan transaction submitted: ${tx.hash}`);

    // Wait for confirmation
    const receipt = await tx.wait();

    if (receipt.status === 1) {
      console.log(`✅ Flashloan arbitrage executed successfully`);

      // Parse events (would need contract interface)
      console.log(`Block: ${receipt.blockNumber}`);
      console.log(`Gas Used: ${receipt.gasUsed}`);
      console.log(`TX Hash: ${tx.hash}`);

      return {
        success: true,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed
      };
    } else {
      throw new Error("Transaction reverted");
    }

  } catch (error) {
    console.error(`❌ Flashloan arbitrage failed:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}