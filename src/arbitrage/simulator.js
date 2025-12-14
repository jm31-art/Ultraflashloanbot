import { MAX_SLIPPAGE_PER_HOP, MAX_TOTAL_SLIPPAGE } from "./volatileModeConfig.js";

/**
 * Enhanced triangular arbitrage simulation with hard slippage caps
 */
export async function simulateTriangular(router, path, amountIn, checkSlippage = false) {
  try {
    const a1 = await router.getAmountsOut(amountIn, [path[0], path[1]]);
    const a2 = await router.getAmountsOut(a1[1], [path[1], path[2]]);
    const a3 = await router.getAmountsOut(a2[1], [path[2], path[0]]);

    const result = {
      finalOut: a3[1],
      hops: [a1, a2, a3],
      slippageCheck: null
    };

    // VOLATILE_MEV: Enforce hard slippage caps
    if (checkSlippage) {
      const slippageCheck = checkTriangularSlippage(amountIn, [a1, a2, a3]);
      result.slippageCheck = slippageCheck;

      if (!slippageCheck.passes) {
        return {
          ...result,
          finalOut: 0n // Mark as failed
        };
      }
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Check triangular arbitrage slippage against hard caps
 */
function checkTriangularSlippage(amountIn, hops) {
  let totalSlippage = 0;

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    const inputAmount = i === 0 ? amountIn : hops[i-1][1];
    const outputAmount = hop[1];

    // Calculate slippage for this hop
    const expectedOutput = hop[0]; // getAmountsOut returns [input, output]
    const actualSlippage = Number(inputAmount - expectedOutput) / Number(inputAmount);

    // Check per-hop limit
    if (actualSlippage > MAX_SLIPPAGE_PER_HOP) {
      return {
        passes: false,
        reason: `hop ${i + 1} slippage ${actualSlippage.toFixed(4)} > ${MAX_SLIPPAGE_PER_HOP}`,
        perHopSlippage: actualSlippage,
        totalSlippage: null
      };
    }

    totalSlippage += actualSlippage;
  }

  // Check total slippage limit
  if (totalSlippage > MAX_TOTAL_SLIPPAGE) {
    return {
      passes: false,
      reason: `total slippage ${totalSlippage.toFixed(4)} > ${MAX_TOTAL_SLIPPAGE}`,
      perHopSlippage: null,
      totalSlippage: totalSlippage
    };
  }

  return {
    passes: true,
    reason: null,
    perHopSlippage: null,
    totalSlippage: totalSlippage
  };
}