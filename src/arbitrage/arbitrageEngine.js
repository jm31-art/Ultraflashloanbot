import { ROUTERS, provider } from "../dex/routers.js";
import { simulateTriangular } from "./simulator.js";
import { calculateProfit } from "./profitCalculator.js";
import { executeFlashloanArbitrage, checkFlashloanAvailability } from "../flashloan/flashloanExecutor.js";
import { ethers } from "ethers";

// Extreme Mode Configuration
const EXTREME_MODE = {
  enabled: true,
  minProfitUsd: 5,
  minProfitGasMultiplier: 2.5,
  maxFlashloanUsd: 50000,
  gasBalanceRequiredUsd: 1.0,
  executeOnlyIf: {
    onChainSimulation: true,
    finalOutGreaterThanInput: true,
    profitAfterGasPositive: true
  }
};

export async function runArbitrage(paths, amountInWei, tokenPriceUsd, signer, flashloanContractAddress) {
  for (const [routerName, router] of Object.entries(ROUTERS)) {
    for (const path of paths) {
      // Step 1: On-chain simulation (MANDATORY)
      const sim = await simulateTriangular(router, path, amountInWei);
      if (!sim) continue;

      // Step 2: Validate final output > input
      if (sim.finalOut <= amountInWei) continue;

      // Step 3: Gas estimation
      let gasEstimate;
      try {
        gasEstimate = await router.getAmountsOut.estimateGas(
          amountInWei,
          [path[0], path[1]]
        );
      } catch {
        continue; // Skip if gas estimation fails
      }

      // Step 4: Profit calculation with gas costs
      const profit = calculateProfit(
        amountInWei,
        sim.finalOut,
        gasEstimate,
        tokenPriceUsd
      );

      if (!profit) continue;

      // Step 5: Extreme Mode validation
      if (EXTREME_MODE.enabled) {
        // Check minimum profit threshold
        if (profit.profitUsd < EXTREME_MODE.minProfitUsd) continue;

        // Check profit vs gas ratio
        if (profit.profitUsd < profit.gasUsd * EXTREME_MODE.minProfitGasMultiplier) continue;

        // Check wallet gas balance
        const walletBalance = await provider.getBalance(signer.address);
        const walletBalanceUsd = Number(ethers.formatEther(walletBalance)) * tokenPriceUsd;
        if (walletBalanceUsd < EXTREME_MODE.gasBalanceRequiredUsd) continue;

        // Check flashloan availability
        const flashloanCheck = await checkFlashloanAvailability(path[0], amountInWei);
        if (!flashloanCheck.available) continue;

        // Limit flashloan size
        const maxFlashloanWei = ethers.parseEther((EXTREME_MODE.maxFlashloanUsd / tokenPriceUsd).toString());
        if (amountInWei > maxFlashloanWei) continue;

        // Execute flashloan arbitrage
        console.log(`\n🔥 REAL ARBITRAGE FOUND - EXECUTING FLASHLOAN`);
        console.log(`DEX: ${routerName}`);
        console.log(`Path: ${path.join(" → ")} → ${path[0]}`);
        console.log(`Input: ${ethers.formatEther(amountInWei)} ${path[0]}`);
        console.log(`Expected Output: ${ethers.formatEther(sim.finalOut)} ${path[0]}`);
        console.log(`Expected Profit: $${profit.profitUsd.toFixed(2)}`);
        console.log(`Gas Cost: $${profit.gasUsd.toFixed(2)}`);
        console.log(`Wallet Gas Balance: $${walletBalanceUsd.toFixed(2)}`);

        const result = await executeFlashloanArbitrage({
          asset: path[0],
          amountWei: amountInWei,
          router: router.target,
          path: path,
          flashloanContractAddress,
          signer
        });

        if (result.success) {
          return result;
        } else {
          console.log(`❌ Flashloan execution failed, continuing scan...`);
          continue;
        }

      } else {
        // Dry-run mode (no execution)
        console.log(`\n🔥 REAL ARBITRAGE FOUND (DRY RUN)`);
        console.log(`DEX: ${routerName}`);
        console.log(`Path: ${path.join(" → ")} → ${path[0]}`);
        console.log(`Input: 1 ${path[0]}`);
        console.log(`Output: ${sim.finalOut.toString()}`);
        console.log(`Profit: $${profit.profitUsd.toFixed(2)}`);
        console.log(`Gas: $${profit.gasUsd.toFixed(2)}`);

        return { router, path, profit, dryRun: true };
      }
    }
  }

  return null;
}