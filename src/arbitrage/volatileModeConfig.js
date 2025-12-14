/**
 * VOLATILE_MEV Mode Configuration
 * Professional MEV-grade arbitrage for volatile DEX environments
 */

// Hard slippage caps (non-negotiable)
export const MAX_SLIPPAGE_PER_HOP = 0.003;   // 0.3%
export const MAX_TOTAL_SLIPPAGE = 0.007;     // 0.7%

// Volatile mode settings
export const VOLATILE_MODE = {
  enabled: true,
  name: "VOLATILE_MEV",
  maxAttemptsPerSession: 2,
  profitThresholds: [5, 10, 15, 20], // USD - randomized per cycle
  flashloanSizeRange: [0.01, 0.03],  // 1-3% of smallest pool reserve
  eventTriggers: {
    largeSwapThreshold: 10000,      // $10K+ swaps
    liquidityChangeThreshold: 0.05, // 5%+ liquidity changes
    priceDeltaThreshold: 0.02       // 2%+ price changes
  }
};

/**
 * Get randomized profit threshold for current cycle
 */
export function getRandomProfitThreshold() {
  const thresholds = VOLATILE_MODE.profitThresholds;
  const randomIndex = Math.floor(Math.random() * thresholds.length);
  return thresholds[randomIndex];
}

/**
 * Check if private execution is available
 */
export async function isPrivateExecutionAvailable() {
  const privateRpc = process.env.BSC_PRIVATE_RPC || process.env.NODEREAL_RPC;
  if (!privateRpc) return false;

  try {
    const { ethers } = await import("ethers");
    const provider = new ethers.JsonRpcProvider(privateRpc);
    await provider.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}