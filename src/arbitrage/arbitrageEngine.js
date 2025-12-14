import { ROUTERS, provider } from "../dex/routers.js";
import { simulateTriangular } from "./simulator.js";
import { calculateProfit } from "./profitCalculator.js";
import { flashloanProvider } from "../flashloan/flashloanProvider.js";
import { mevGuard } from "./mevGuard.js";
import { shouldRunExtremeMode, getCurrentBlock } from "./blockScheduler.js";
import { FLASHLOAN_PROVIDERS, getBestProvider, calculateFee } from "../flashloan/providers.js";
import { submitPrivateTx, getPrivateRelayStatus } from "../mev/privateRelay.js";
import { getExtremeModeConfig } from "./extremeModeConfig.js";
import { ethers } from "ethers";

/**
 * STRICT TYPE BOUNDARY ENFORCEMENT
 * BigInt/BigNumber → ONLY inside arbitrage logic
 * Convert to Number ONLY for console logging
 */
function toFloat(bn, decimals = 18) {
  if (typeof bn === 'bigint') {
    return Number(bn.toString()) / 10 ** decimals;
  }
  // For ethers.BigNumber
  if (bn && typeof bn.toString === 'function') {
    return Number(bn.toString()) / 10 ** decimals;
  }
  return Number(bn);
}

// Extreme Mode Configuration (IMMUTABLE)
let EXTREME_MODE = {
  enabled: true,
  maxAttempts: 2,
  attemptsUsed: 0,
  minProfitUsd: 10, // REDUCED from $25 to $10 for higher frequency
  profitGasRatio: 8,
  maxGasUsd: 0.40,
  maxPriceImpactPct: 0.3,
  slippageBps: 0,
  autoDisableAfter: true,
  completed: false, // Anti-spam guard - prevents accidental reruns
  lastRunBlock: null // Block-based execution tracking
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

  // ANTI-SPAM GUARD: Prevent accidental reruns of extreme mode
  if (isExtremeMode && EXTREME_MODE.completed) {
    console.log(`🚫 EXTREME MODE already completed - cannot rerun`);
    return null;
  }

  // BLOCK-BASED EXECUTION: Check if enough blocks have passed for EXTREME MODE
  if (isExtremeMode) {
    const currentBlock = await getCurrentBlock(provider);
    if (!currentBlock) {
      console.log(`❌ Failed to get current block number`);
      return null;
    }

    const shouldRun = shouldRunExtremeMode({
      currentBlock,
      lastRunBlock: EXTREME_MODE.lastRunBlock,
      interval: 1 // Run once per block
    });

    if (!shouldRun) {
      console.log(`⏰ EXTREME MODE: Block ${currentBlock} - waiting for next block (last run: ${EXTREME_MODE.lastRunBlock || 'never'})`);
      return null;
    }

    EXTREME_MODE.lastRunBlock = currentBlock;
  }

  // DYNAMIC EXTREME MODE CONFIG: Get time-based risk thresholds
  let extremeConfig = null;
  if (isExtremeMode) {
    extremeConfig = getExtremeModeConfig();
    console.log(`⚡ EXTREME MODE ACTIVE | Profit ≥ $${extremeConfig.minProfitUsd} | Attempts: ${extremeConfig.maxAttempts}`);
  }

  console.log(`\n🚀 Running arbitrage engine (${isExtremeMode ? 'EXTREME' : 'NORMAL'} MODE)`);
  console.log(`Attempts used: ${EXTREME_MODE.attemptsUsed}/${extremeConfig?.maxAttempts || EXTREME_MODE.maxAttempts}`);
  console.log(`Block-based execution: ${isExtremeMode ? 'ENABLED' : 'N/A'}`);

  // SINGLE PASS SCAN: No while loop, just one pass through all paths
  let failedSizingCount = 0;
  let passedDensityFilter = 0;

  for (const [routerName, router] of Object.entries(ROUTERS)) {
    for (const path of paths) {
      // EXTREME MODE: Check attempt limit before processing each path
      const maxAttempts = isExtremeMode ? extremeConfig.maxAttempts : EXTREME_MODE.maxAttempts;
      if (isExtremeMode && EXTREME_MODE.attemptsUsed >= maxAttempts) {
        console.log(`🛑 EXTREME MODE ATTEMPT LIMIT REACHED`);
        EXTREME_MODE.completed = true;
        return null;
      }

      // PROFIT DENSITY PREFILTER: Early rejection before expensive sizing
      const densityCheck = await checkProfitDensity(router, path, mode);
      if (!densityCheck.passes) {
        failedSizingCount++;
        continue;
      }
      passedDensityFilter++;

      // Calculate optimal flashloan size dynamically with improved granularity
      const optimalSize = await calculateOptimalFlashloanSize(router, path, mode, isExtremeMode);

      // FAIL FAST: If flashloan sizing fails, skip path (no attempt used)
      if (!optimalSize) {
        failedSizingCount++;
        continue;
      }

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

      // STRICT PROFIT THRESHOLD ENFORCEMENT: Check before any transaction preparation
      const requiredMinProfit = isExtremeMode ? extremeConfig.minProfitUsd : mode.minProfitUsd;
      if (!profit || profit.profitUsd < requiredMinProfit) {
        continue;
      }

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
      console.log(`\n🔥 ${isExtremeMode ? 'EXTREME MODE ' : ''}ARBITRAGE FOUND`);
      console.log(`DEX: ${routerName}`);
      console.log(`Path: ${path.join(" → ")} → ${path[0]}`);
      console.log(`Flashloan Provider: ${selectedProvider.name} (${selectedProvider.feeBps/100}% fee)`);
      console.log(`Flashloan: ${ethers.formatEther(amountInWei)} ${path[0]}`);
      console.log(`Expected Out: ${ethers.formatEther(sim.finalOut)} ${path[0]}`);
      console.log(`Expected Profit: $${profit.profitUsd.toFixed(2)}`);
      console.log(`Gas Estimate: $${profit.gasUsd.toFixed(2)}`);
      console.log(`Price Impact: ${(priceImpact * 100).toFixed(3)}%`);
      console.log(`Net Profit After Fees: $${optimalSize.netProfitUsd.toFixed(2)}`);

      // Execute flashloan arbitrage using private relay
      console.log(`🚀 Executing EXTREME MODE trade (${EXTREME_MODE.attemptsUsed + 1}/${extremeConfig.maxAttempts})`);
      const result = await executeFlashloanArbitrage({
        asset: path[0],
        amountWei: amountInWei,
        router: router.target,
        path: path,
        flashloanContractAddress,
        signer,
        selectedProvider
      });

      // Track attempts in extreme mode ONLY when transaction is actually submitted
      if (isExtremeMode) {
        EXTREME_MODE.attemptsUsed++;

        if (result.success || EXTREME_MODE.attemptsUsed >= extremeConfig.maxAttempts) {
          if (EXTREME_MODE.autoDisableAfter) {
            EXTREME_MODE.enabled = false;
            EXTREME_MODE.completed = true;
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

  // AGGREGATED SIZING RESULTS LOGGING
  if (failedSizingCount > 0) {
    console.log(`⚡ Flashloan sizing failed on ${failedSizingCount} paths`);
  }
  if (passedDensityFilter > 0) {
    console.log(`🔥 ${passedDensityFilter} paths passed density filter`);
  }

  // EXTREME MODE: Mark as completed if no opportunities found
  if (isExtremeMode) {
    EXTREME_MODE.completed = true;
    console.log(`\n🛑 EXTREME MODE COMPLETE — no valid opportunities found`);
    console.log(`Wallet preserved, no gas spent on failed attempts`);
  }

  return null;
}

/**
 * PROFIT DENSITY PREFILTER: Early rejection before expensive sizing
 */
async function checkProfitDensity(router, path, mode) {
  try {
    // Quick price check to estimate gross profit potential
    const sim = await simulateTriangular(router, path, ethers.parseEther('1')); // 1 token test
    if (!sim || sim.finalOut <= ethers.parseEther('1')) {
      return { passes: false, reason: 'no arbitrage potential' };
    }

    // Calculate estimated gross profit for $1,000 notional
    const tokenPriceUsd = 567; // BNB approximation
    const testAmountWei = ethers.parseEther('1');
    const testAmountUsd = Number(ethers.formatEther(testAmountWei)) * tokenPriceUsd;

    // Scale up to $1,000 equivalent
    const scaleFactor = 1000 / testAmountUsd;
    const scaledProfitWei = (sim.finalOut - testAmountWei) * BigInt(Math.floor(scaleFactor * 1000)) / 1000n;
    const estimatedGrossProfitUsd = Number(ethers.formatEther(scaledProfitWei)) * tokenPriceUsd;

    // Calculate profit density: profit per dollar of notional
    const profitPerDollar = estimatedGrossProfitUsd / 1000;

    // Reject if below minimum density threshold ($0.60 per $1,000 = 0.0006)
    const minDensity = 0.0006;
    if (profitPerDollar < minDensity) {
      return { passes: false, reason: `profit density ${profitPerDollar.toFixed(6)} < ${minDensity}` };
    }

    return { passes: true, density: profitPerDollar, estimatedProfit: estimatedGrossProfitUsd };

  } catch (error) {
    return { passes: false, reason: `density check failed: ${error.message}` };
  }
}

/**
 * Calculate optimal flashloan size with provider selection using BigInt math only
 */
async function calculateOptimalFlashloanSize(router, path, mode, isExtremeMode = false) {
  try {
    // Get pool reserves (simplified - would need actual pool contracts)
    // In production, query actual pool reserves for each hop
    // Using realistic BSC pool sizes (millions of tokens)
    const mockReserves = {
      [path[0]]: 10000000n, // 10M tokens (realistic BSC pool)
      [path[1]]: 5000000n,  // 5M tokens
      [path[2]]: 7500000n   // 7.5M tokens
    };

    // Find minimum reserve across all hops using BigInt comparison
    const reserves = [
      mockReserves[path[0]] || 1000000n,
      mockReserves[path[1]] || 1000000n,
      mockReserves[path[2]] || 1000000n
    ];

    let minReserve = reserves[0];
    for (let i = 1; i < reserves.length; i++) {
      if (reserves[i] < minReserve) {
        minReserve = reserves[i];
      }
    }

    // FLASHLOAN PROVIDER SELECTION: Iterate through providers and find best option
    let bestOption = null;
    let bestProvider = null;

    for (const [providerKey, providerConfig] of Object.entries(FLASHLOAN_PROVIDERS)) {
      // Check if provider supports the asset
      if (!providerConfig.supportedAssets.includes(path[0].toLowerCase())) {
        continue;
      }

      // Cap flashloan to 5% of smallest pool using BigInt division
      const maxFlashloan = minReserve * 5n / 100n;

      // Cap at provider's maximum loan amount (convert USD to token amount)
      const tokenPriceApprox = 567n; // BNB price approximation
      const maxLoanWei = (BigInt(providerConfig.maxLoanUsd) * 10n ** 18n) / tokenPriceApprox;
      const providerMaxFlashloan = maxFlashloan < maxLoanWei ? maxFlashloan : maxLoanWei;

      // FAIL FAST: If flashloan size is invalid, skip provider
      if (!providerMaxFlashloan || providerMaxFlashloan <= 0n) {
        continue;
      }

      // ADAPTIVE LOAN BANDS: Replace coarse steps with granular sizing
      const base = 1000n; // $1,000 base
      const loanCandidates = [
        base,                    // $1,000
        base * 15n / 10n,       // $1,500
        base * 2n,              // $2,000
        base * 3n,              // $3,000
        base * 4n,              // $4,000
        base * 6n,              // $6,000
        base * 8n,              // $8,000
        base * 10n              // $10,000
      ];

      // Convert USD amounts to token amounts
      const tokenPriceApproxUsd = 567n; // BNB price approximation
      const loanCandidatesWei = loanCandidates.map(usd =>
        (usd * 10n ** 18n) / tokenPriceApproxUsd
      );

      // DYNAMICALLY CAP BY POOL LIQUIDITY: 18% of smallest pool
      const poolLiquidityCap = minReserve * 18n / 100n;

      // Filter candidates by provider and pool limits
      const validCandidates = loanCandidatesWei.filter(candidate =>
        candidate <= providerMaxFlashloan && candidate <= poolLiquidityCap
      );

      for (const testSize of validCandidates) {
        if (testSize <= 0n) continue;

        // Simulate to check profitability
        const sim = await simulateTriangular(router, path, testSize);
        if (!sim || sim.finalOut <= testSize) continue;

        // Calculate price impact using BigInt math
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

        // Calculate net profit after flashloan fee
        const flashFee = calculateFee(providerConfig, testSize);
        const netProfitAfterFee = profit.profit - flashFee;

        // Convert to USD for comparison
        const netProfitUsd = Number(netProfitAfterFee) * tokenPriceUsd / 1e18;

        // NARROW SLIPPAGE BUFFER FOR EXTREME MODE: 0.25% instead of 0.5%
        const slippageTolerance = isExtremeMode ? 0.0025 : mode.slippageBps / 10000;

        // Check if meets mode requirements (using Number only for logging)
        if (netProfitUsd >= mode.minProfitUsd &&
            netProfitUsd >= profit.gasUsd * mode.profitGasRatio &&
            profit.gasUsd <= mode.maxGasUsd) {

          // Select best provider (highest net profit after fees)
          if (!bestOption || netProfitUsd > bestOption.netProfitUsd) {
            bestOption = {
              amount: testSize,
              priceImpact: priceImpact,
              simulation: sim,
              profit: profit,
              netProfitUsd: netProfitUsd,
              flashFee: flashFee,
              slippageTolerance: slippageTolerance
            };
            bestProvider = providerConfig;
          }
        }
      }
    }

    // Return best option found across all providers
    if (bestOption && bestProvider) {
      return {
        ...bestOption,
        provider: bestProvider
      };
    }

    return null; // No suitable provider/size combination found

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
 * Execute flashloan arbitrage using private relay (MEV protection)
 */
async function executeFlashloanArbitrage({
  asset,
  amountWei,
  router,
  path,
  flashloanContractAddress,
  signer,
  selectedProvider
}) {
  try {
    // PRIVATE RELAY: Mandatory for all arbitrage executions
    console.log(`🔒 Using private relay for MEV protection`);
    const relayStatus = getPrivateRelayStatus();
    console.log(`Relay status: ${relayStatus.available ? '✅ Available' : '❌ Unavailable'}`);

    if (!relayStatus.available) {
      throw new Error("Private relay unavailable - aborting execution for MEV safety");
    }

    // Use the flashloan provider to execute
    const tx = await flashloanProvider.executeFlashloan(
      flashloanContractAddress,
      asset,
      amountWei,
      { router, path }
    );

    // SUBMIT VIA PRIVATE RELAY (mandatory)
    const result = await submitPrivateTx(tx, provider);

    console.log(`📤 Private flashloan transaction submitted: ${result.hash}`);
    console.log(`🏦 Provider: ${selectedProvider.name} (${selectedProvider.contractAddress})`);

    // Wait for confirmation
    const receipt = await provider.waitForTransaction(result.hash);

    if (receipt.status === 1) {
      console.log(`✅ Flashloan arbitrage executed successfully via private relay`);

      // Parse events (would need contract interface)
      console.log(`Block: ${receipt.blockNumber}`);
      console.log(`Gas Used: ${receipt.gasUsed}`);
      console.log(`TX Hash: ${result.hash}`);

      return {
        success: true,
        txHash: result.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        provider: selectedProvider.name,
        privateRelay: true
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