import { provider } from "../dex/routers.js";
import { flashloanProvider } from "../flashloan/flashloanProvider.js";

export class MEVGuard {
  constructor() {
    this.baselineGasPrice = null;
    this.baselineBlockNumber = null;
    this.baselinePoolReserves = new Map();
    this.baselineQuotes = new Map();
    this.baselineLiquidity = new Map();
    this.lastCheckTime = 0;
  }

  /**
   * Initialize baseline values for risk monitoring
   */
  async initializeBaseline(router, path, amount) {
    try {
      // Gas price baseline
      this.baselineGasPrice = await provider.getGasPrice();

      // Block number baseline
      this.baselineBlockNumber = await provider.getBlockNumber();

      // Pool reserves baseline (simplified - would need actual pool contracts)
      // This is a placeholder - in production you'd query actual pool reserves
      for (const token of path) {
        this.baselinePoolReserves.set(token, 1000000n); // Placeholder 1M tokens
      }

      // Router quotes baseline
      const quoteKey = `${router.target}-${path.join('-')}-${amount}`;
      const quote = await this.getRouterQuote(router, path, amount);
      this.baselineQuotes.set(quoteKey, quote);

      // Flashloan liquidity baseline
      const liquidity = await flashloanProvider.getReserveData(path[0]);
      this.baselineLiquidity.set(path[0], liquidity?.availableLiquidity || 0n);

      this.lastCheckTime = Date.now();

      return true;
    } catch (error) {
      console.error("Failed to initialize MEV guard baseline:", error);
      return false;
    }
  }

  /**
   * Check if execution conditions are still safe
   */
  async validateExecutionSafety(router, path, amount, simulationResult) {
    try {
      const issues = [];

      // Check 1: Gas price increase using BigInt math
      const currentGasPrice = await provider.getGasPrice();
      const gasPriceDiff = currentGasPrice - this.baselineGasPrice;
      const gasPriceIncrease = Number(gasPriceDiff * 100n / this.baselineGasPrice) / 100; // Convert to percentage
      if (gasPriceIncrease > 0.15) { // 15% increase
        issues.push(`Gas price increased ${gasPriceIncrease.toFixed(3)} > 15%`);
      }

      // Check 2: Block advancement
      const currentBlockNumber = await provider.getBlockNumber();
      if (currentBlockNumber > this.baselineBlockNumber) {
        issues.push(`Block advanced from ${this.baselineBlockNumber} to ${currentBlockNumber}`);
      }

      // Check 3: Router quote consistency
      const quoteKey = `${router.target}-${path.join('-')}-${amount}`;
      const currentQuote = await this.getRouterQuote(router, path, amount);
      const baselineQuote = this.baselineQuotes.get(quoteKey);

      if (baselineQuote && currentQuote.finalOut !== baselineQuote.finalOut) {
        issues.push(`Router quote changed: ${baselineQuote.finalOut} -> ${currentQuote.finalOut}`);
      }

      // Check 4: Flashloan liquidity using BigInt math
      const currentLiquidity = await flashloanProvider.getReserveData(path[0]);
      const baselineLiquidity = this.baselineLiquidity.get(path[0]);

      if (currentLiquidity && baselineLiquidity) {
        const liquidityDiff = currentLiquidity.availableLiquidity - baselineLiquidity;
        const liquidityChange = Number(liquidityDiff * 100n / baselineLiquidity) / 100; // Convert to percentage
        if (Math.abs(liquidityChange) > 0.05) { // 5% change
          issues.push(`Flashloan liquidity changed ${liquidityChange.toFixed(3)} > 5%`);
        }
      }

      // Check 5: Time elapsed (prevent stale baselines)
      const timeElapsed = Date.now() - this.lastCheckTime;
      if (timeElapsed > 30000) { // 30 seconds
        issues.push(`Baseline too old: ${timeElapsed}ms > 30000ms`);
      }

      // Check 6: Price impact validation
      if (simulationResult.priceImpact > 0.003) { // 0.3%
        issues.push(`Price impact too high: ${simulationResult.priceImpact.toFixed(4)} > 0.3%`);
      }

      return {
        safe: issues.length === 0,
        issues: issues
      };

    } catch (error) {
      console.error("MEV guard validation failed:", error);
      return {
        safe: false,
        issues: [`Validation error: ${error.message}`]
      };
    }
  }

  /**
   * Get router quote for comparison
   */
  async getRouterQuote(router, path, amount) {
    try {
      const a1 = await router.getAmountsOut(amount, [path[0], path[1]]);
      const a2 = await router.getAmountsOut(a1[1], [path[1], path[2]]);
      const a3 = await router.getAmountsOut(a2[1], [path[2], path[0]]);

      return {
        finalOut: a3[1],
        hops: [a1, a2, a3]
      };
    } catch {
      return null;
    }
  }

  /**
   * Calculate price impact for a trade using BigInt math only
   */
  calculatePriceImpact(path, amount, reserves) {
    // Find minimum reserve using BigInt comparison
    let minReserve = reserves[0];
    for (let i = 1; i < reserves.length; i++) {
      if (reserves[i] < minReserve) {
        minReserve = reserves[i];
      }
    }

    // Calculate price impact: amount / (amount + minReserve)
    // Using BigInt division with proper scaling
    const numerator = amount;
    const denominator = amount + minReserve;

    // Convert to percentage (multiply by 100 for percentage)
    const impact = (numerator * 100n) / denominator;

    // Return as float for logging only (not used in logic)
    return Number(impact) / 100;
  }

  /**
   * Reset guard state
   */
  reset() {
    this.baselineGasPrice = null;
    this.baselineBlockNumber = null;
    this.baselinePoolReserves.clear();
    this.baselineQuotes.clear();
    this.baselineLiquidity.clear();
    this.lastCheckTime = 0;
  }
}

// Export singleton instance
export const mevGuard = new MEVGuard();