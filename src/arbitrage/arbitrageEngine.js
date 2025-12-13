import { ROUTERS } from "../dex/routers.js";
import { simulateTriangular } from "./simulator.js";
import { calculateProfit } from "./profitCalculator.js";

export async function runArbitrage(paths, amountInWei, tokenPriceUsd) {
  for (const [routerName, router] of Object.entries(ROUTERS)) {
    for (const path of paths) {
      const sim = await simulateTriangular(router, path, amountInWei);
      if (!sim) continue;

      const gasEstimate =
        await router.getAmountsOut.estimateGas(
          amountInWei,
          [path[0], path[1]]
        );

      const profit = calculateProfit(
        amountInWei,
        sim.finalOut,
        gasEstimate,
        tokenPriceUsd
      );

      if (!profit || profit.profitUsd < 5) continue;

      console.log(`\n🔥 REAL ARBITRAGE FOUND
DEX: ${routerName}
Path: ${path.join(" → ")} → ${path[0]}
Input: 1 ${path[0]}
Output: ${sim.finalOut.toString()}
Profit: $${profit.profitUsd.toFixed(2)}
Gas: $${profit.gasUsd.toFixed(2)}
`);

      return { router, path, profit };
    }
  }
}