import { ethers } from "ethers";
import { provider } from "../dex/routers.js";

// Aave V3 BSC Pool contract (primary flashloan provider)
const AAVE_V3_POOL_ADDRESS = "0x6807dc923806fE8Fd134338EABCA509979a7e2205";
const AAVE_V3_POOL_ABI = [
  "function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode) external",
  "function getReserveData(address asset) external view returns (tuple(uint256, uint40, uint16, uint128, uint128, uint128, uint40, address, address, address, address, uint8))"
];

// PancakeSwap Router for flash swaps (fallback)
const PANCAKE_ROUTER_ADDRESS = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const PANCAKE_ROUTER_ABI = [
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] memory path) external view returns (uint[] memory amounts)",
  "function getAmountsIn(uint amountOut, address[] memory path) external view returns (uint[] memory amounts)"
];

// Custom flashloan contract (if available)
const FLASHLOAN_CONTRACT_ADDRESS = process.env.FLASHLOAN_ARB_CONTRACT || '0xf682bd44ca1Fb8184e359A8aF9E1732afD29BBE1';
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
   * Execute flashloan with arbitrage parameters (Aave V3 BSC primary, custom contract fallback)
   */
  async executeFlashloan(
    signer,
    asset,
    amount,
    arbitrageParams
  ) {
    try {
      // Use custom flashloan contract if available (preferred for bootstrap)
      if (this.flashloanContract && FLASHLOAN_CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000') {
        console.log(`🔥 EXECUTING FLASHLOAN: ${ethers.formatEther(amount)} ${asset} via custom contract`);
        const tx = await this.flashloanContract.executeFlashloanArbitrage(
          asset,
          amount,
          arbitrageParams.path,
          arbitrageParams.router,
          arbitrageParams.minProfit
        );
        return tx;
      }

      // Fallback to Aave V3 BSC flashloan
      console.log(`🏦 EXECUTING FLASHLOAN: ${ethers.formatEther(amount)} ${asset} via Aave V3 BSC`);
      const aavePool = new ethers.Contract(AAVE_V3_POOL_ADDRESS, AAVE_V3_POOL_ABI, signer);

      // Encode parameters for the receiver contract
      const params = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address[]"],
        [arbitrageParams.router, arbitrageParams.path]
      );

      // Execute Aave V3 flashloan
      const tx = await aavePool.flashLoanSimple(
        signer.address, // receiver (will be the arbitrage contract)
        asset,
        amount,
        params,
        0 // referral code
      );

      return tx;

    } catch (error) {
      console.error("Flashloan execution failed:", error);

      // Ultimate fallback: direct router swap (no flashloan benefit)
      console.log(`⚠️ Flashloan failed - falling back to direct swap`);
      try {
        const deadline = Math.floor(Date.now() / 1000) + 300;
        const routerContract = new ethers.Contract(
          arbitrageParams.router,
          PANCAKE_ROUTER_ABI,
          signer
        );

        const tx = await routerContract.swapExactTokensForTokens(
          amount,
          arbitrageParams.amountOutMin || 0,
          arbitrageParams.path,
          signer.address,
          deadline
        );

        return tx;
      } catch (fallbackError) {
        console.error("Direct swap fallback also failed:", fallbackError);
        throw error; // Throw original error
      }
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