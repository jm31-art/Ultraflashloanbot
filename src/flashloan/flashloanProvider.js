import { ethers } from "ethers";
import { provider } from "../dex/routers.js";

// PancakeSwap V2 Factory for flash swaps
const PANCAKE_FACTORY_ADDRESS = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
const PANCAKE_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

// PancakeSwap V2 Pair ABI for flash swaps
const PANCAKE_PAIR_ABI = [
  "function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
];

// Token addresses for high-liquidity pairs
const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const BTCB_ADDRESS = "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c";

export class FlashloanProvider {
  constructor(signer) {
    this.signer = signer;
    this.pancakeRouter = new ethers.Contract(PANCAKE_ROUTER_ADDRESS, PANCAKE_ROUTER_ABI, signer);
    // Always initialize flashloan contract with signer
    this.flashloanContract = new ethers.Contract(FLASHLOAN_CONTRACT_ADDRESS, FLASHLOAN_CONTRACT_ABI, signer);
    console.log('🔥 FLASHLOAN: Contract initialized at', FLASHLOAN_CONTRACT_ADDRESS);
    console.log('FLASHLOAN ENABLED - Signer attached');
  }

  /**
   * Borrow flashloan amount
   */
  async borrowFlashloan(asset, amount) {
    try {
      console.log(`FLASHLOAN: Borrowed ${ethers.formatEther(amount)} ${asset} for trade`);
      const tx = await this.flashloanContract.borrow(asset, amount);
      return tx;
    } catch (error) {
      console.error('❌ Flashloan borrow failed:', error.message);
      throw error;
    }
  }

  /**
   * Repay flashloan amount
   */
  async repayFlashloan(asset, amount) {
    try {
      console.log(`FLASHLOAN: Repaying ${ethers.formatEther(amount)} ${asset}`);
      const tx = await this.flashloanContract.repay(asset, amount);
      return tx;
    } catch (error) {
      console.error('❌ Flashloan repay failed:', error.message);
      throw error;
    }
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
      // Try Aave V3 BSC flashloan first (primary provider)
      console.log(`🏦 EXECUTING FLASHLOAN: ${ethers.formatEther(amount)} ${asset} via Aave V3 BSC`);
      try {
        const aavePool = new ethers.Contract(AAVE_V3_POOL_ADDRESS, AAVE_V3_POOL_ABI, signer);

        // Encode parameters for the arbitrage execution
        const params = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address[]", "uint256"],
          [arbitrageParams.router, arbitrageParams.path, arbitrageParams.minProfit || 0]
        );

        // Execute Aave V3 flashloan
        const tx = await aavePool.flashLoanSimple(
          signer.address, // receiver (will execute arbitrage)
          asset,
          amount,
          params,
          0 // referral code
        );

        return tx;
      } catch (aaveError) {
        console.warn(`⚠️ Aave V3 BSC failed, trying alternative address:`, aaveError.message);
        // Try alternative Aave V3 address
        try {
          const aavePoolAlt = new ethers.Contract(AAVE_V3_POOL_ADDRESS_ALT, AAVE_V3_POOL_ABI, signer);
          const params = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address[]", "uint256"],
            [arbitrageParams.router, arbitrageParams.path, arbitrageParams.minProfit || 0]
          );

          const tx = await aavePoolAlt.flashLoanSimple(
            signer.address,
            asset,
            amount,
            params,
            0
          );

          return tx;
        } catch (altError) {
          console.warn(`⚠️ Alternative Aave V3 also failed:`, altError.message);
        }
      }

      // Fallback to custom flashloan contract
      if (this.flashloanContract && FLASHLOAN_CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000') {
        console.log(`🔥 EXECUTING FLASHLOAN: ${ethers.formatEther(amount)} ${asset} via custom contract`);
        const tx = await this.flashloanContract.executeFlashloanArbitrage(
          asset,
          amount,
          arbitrageParams.path,
          arbitrageParams.router,
          arbitrageParams.minProfit || 0
        );
        return tx;
      }

      // Ultimate fallback: direct router swap (no flashloan benefit)
      console.log(`⚠️ All flashloan providers failed - falling back to direct swap`);
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

    } catch (error) {
      console.error("All flashloan execution methods failed - continuing without flashloan:", error.message);
      // Return null to indicate failure but allow bot to continue
      return null;
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
   * Execute perp arbitrage via flashloan with multicall
   */
  async executePerpArbitrage(dex, token, direction, amount, minProfit) {
    try {
      console.log(`🔄 EXECUTING PERP ARBITRAGE: ${dex} ${token} ${direction} ${ethers.formatEther(amount)}`);

      // Use multicall for atomic execution
      const multicallData = [
        // Borrow flashloan
        this.flashloanContract.interface.encodeFunctionData("borrow", [token, amount]),
        // Execute perp arbitrage
        this.flashloanContract.interface.encodeFunctionData("executePerpArbitrage", [dex, token, direction, amount, minProfit]),
        // Repay flashloan
        this.flashloanContract.interface.encodeFunctionData("repay", [token, amount])
      ];

      const tx = await this.flashloanContract.multicall(multicallData);
      return tx;
    } catch (error) {
      console.error('❌ Perp arbitrage execution failed:', error.message);
      throw error;
    }
  }

  /**
   * Execute aggressive flashloan arbitrage with multicall
   */
  async executeAggressiveFlashloanArbitrage(path, amount, router, minProfit) {
    try {
      console.log(`🔥 EXECUTING AGGRESSIVE FLASHLOAN ARBITRAGE: ${path.join('->')} ${ethers.formatEther(amount)}`);

      // Use multicall for atomic execution
      const multicallData = [
        // Borrow flashloan
        this.flashloanContract.interface.encodeFunctionData("borrow", [path[0], amount]),
        // Execute aggressive arbitrage
        this.flashloanContract.interface.encodeFunctionData("executeAggressiveFlashloanArbitrage", [path, amount, router, minProfit]),
        // Repay flashloan
        this.flashloanContract.interface.encodeFunctionData("repay", [path[0], amount])
      ];

      const tx = await this.flashloanContract.multicall(multicallData);
      return tx;
    } catch (error) {
      console.error('❌ Aggressive flashloan arbitrage failed:', error.message);
      throw error;
    }
  }

  /**
   * Get real-time price from Coingecko API
   */
  async getCoingeckoPrice(tokenSymbol) {
    try {
      const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${tokenSymbol.toLowerCase()}&vs_currencies=usd`);
      const data = await response.json();
      return data[tokenSymbol.toLowerCase()]?.usd || null;
    } catch (error) {
      console.error('❌ Coingecko price fetch failed:', error.message);
      return null;
    }
  }

  /**
   * Get token balance via ethers call
   */
  async getTokenBalance(tokenAddress, walletAddress, provider) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ["function balanceOf(address) view returns (uint256)"], provider);
      const balance = await tokenContract.balanceOf(walletAddress);
      return balance;
    } catch (error) {
      console.error('❌ Token balance fetch failed:', error.message);
      return ethers.parseEther('0');
    }
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

// Export singleton instance - disabled, use constructor with signer
// export const flashloanProvider = new FlashloanProvider();