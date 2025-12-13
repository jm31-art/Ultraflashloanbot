import { ethers } from "ethers";
import { provider } from "../dex/routers.js";

// Aave v3 BSC Pool contract
const AAVE_POOL_ADDRESS = "0x6807dc923806fE8Fd134338EABCA509979a7e2205";
const AAVE_POOL_ADDRESSES_PROVIDER = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e";

// Pool contract ABI (minimal)
const POOL_ABI = [
  "function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode) external",
  "function getReserveData(address asset) external view returns (tuple(uint256, uint40, uint16, uint128, uint128, uint128, uint40, address, address, address, address, uint8))"
];

export class FlashloanProvider {
  constructor() {
    this.pool = new ethers.Contract(AAVE_POOL_ADDRESS, POOL_ABI, provider);
  }

  /**
   * Execute flashloan with arbitrage parameters
   */
  async executeFlashloan(
    receiverAddress,
    asset,
    amount,
    arbitrageParams
  ) {
    try {
      // Encode parameters for the receiver contract
      const params = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address[]"],
        [arbitrageParams.router, arbitrageParams.path]
      );

      // Execute flashloan
      const tx = await this.pool.flashLoanSimple(
        receiverAddress,
        asset,
        amount,
        params,
        0 // referral code
      );

      return tx;
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