import { ethers } from "ethers";
import { provider } from "../dex/routers.js";

// PancakeSwap Router for flash swaps (BSC mainnet)
const PANCAKE_ROUTER_ADDRESS = "0x10ED43C718714eb63d5aA57B78B54704E256024E";

// PancakeSwap Router ABI for flash swaps
const PANCAKE_ROUTER_ABI = [
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] memory path) external view returns (uint[] memory amounts)",
  "function getAmountsIn(uint amountOut, address[] memory path) external view returns (uint[] memory amounts)"
];

// Custom flashloan contract (if available)
const FLASHLOAN_CONTRACT_ADDRESS = process.env.FLASHLOAN_ARB_CONTRACT || null;
const FLASHLOAN_CONTRACT_ABI = [
  "function executeFlashloanArbitrage(address asset, uint256 amount, address[] calldata path, address router, uint256 minProfit) external",
  "function executeAtomicLiquidation(address lendingProtocol, address borrower, address debtAsset, address collateralAsset, uint256 debtToCover, uint256 minProfit, bytes calldata arbitrageData) external"
];

export class FlashloanProvider {
  constructor() {
    this.pancakeRouter = new ethers.Contract(PANCAKE_ROUTER_ADDRESS, PANCAKE_ROUTER_ABI, provider);
    this.flashloanContract = FLASHLOAN_CONTRACT_ADDRESS ?
      new ethers.Contract(FLASHLOAN_CONTRACT_ADDRESS, FLASHLOAN_CONTRACT_ABI, provider) : null;
  }

  /**
   * Execute flashloan with arbitrage parameters (PancakeSwap atomic swaps)
   */
  async executeFlashloan(
    signer,
    asset,
    amount,
    arbitrageParams
  ) {
    try {
      // For BSC/PancakeSwap, we use atomic swaps instead of traditional flash loans
      // This requires the arbitrage contract to handle the flash swap logic

      if (this.flashloanContract) {
        // Use custom flashloan contract if available
        console.log(`🔥 EXECUTING FLASHLOAN: ${ethers.formatEther(amount)} ${asset} via custom contract`);
        const tx = await this.flashloanContract.executeFlashloanArbitrage(
          asset,
          amount,
          arbitrageParams.path,
          arbitrageParams.router,
          arbitrageParams.minProfit
        );
        return tx;
      } else {
        // Fallback to direct router swap (not atomic flashloan)
        console.log(`⚠️ No flashloan contract - using direct swap`);
        const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

        const routerContract = new ethers.Contract(
          arbitrageParams.router,
          PANCAKE_ROUTER_ABI,
          signer
        );

        const tx = await routerContract.swapExactTokensForTokens(
          amount,
          arbitrageParams.amountOutMin,
          arbitrageParams.path,
          signer.address,
          deadline
        );

        return tx;
      }
    } catch (error) {
      console.error("Flashloan execution failed:", error);
      throw error;
    }
  }

  /**
   * Check flashloan availability for asset
   */
  async getReserveData(asset) {
    try {
      const reserveData = await this.pool.getReserveData(asset);
      return {
        availableLiquidity: reserveData[1], // availableLiquidity
        totalStableDebt: reserveData[2], // totalStableDebt
        totalVariableDebt: reserveData[3], // totalVariableDebt
        liquidityRate: reserveData[4], // liquidityRate
        variableBorrowRate: reserveData[5], // variableBorrowRate
        stableBorrowRate: reserveData[6], // stableBorrowRate
        lastUpdateTimestamp: reserveData[7], // lastUpdateTimestamp
        aTokenAddress: reserveData[8], // aTokenAddress
        stableDebtTokenAddress: reserveData[9], // stableDebtTokenAddress
        variableDebtTokenAddress: reserveData[10], // variableDebtTokenAddress
        interestRateStrategyAddress: reserveData[11], // interestRateStrategyAddress
        id: reserveData[12] // id
      };
    } catch (error) {
      console.error("Failed to get reserve data:", error);
      return null;
    }
  }

  /**
   * Calculate flashloan fee (0.05% for Aave v3)
   */
  getFlashloanFee(amount) {
    // Aave v3 flashloan fee is 0.05% (5 basis points)
    return (amount * 5n) / 10000n;
  }

  /**
   * Check if asset is supported for flashloans
   */
  isAssetSupported(asset) {
    const supportedAssets = [
      "0x55d398326f99059fF775485246999027B3197955", // USDT
      "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", // BUSD
      "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
      "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC
      "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c"  // BTCB
    ];

    return supportedAssets.includes(asset.toLowerCase());
  }
}

// Export singleton instance
export const flashloanProvider = new FlashloanProvider();