import { ethers } from "ethers";
import { provider } from "../dex/routers.js";

// BSC Aave v3 Pool contract
const AAVE_POOL_ADDRESS = "0x6807dc923806fE8Fd134338EABCA509979a7e2205";

// Flashloan contract ABI (minimal interface)
const FLASHLOAN_ABI = [
  "function executeFlashloanArbitrage(address asset, uint256 amount, address router, address[] path) external",
  "function getBalance(address token) external view returns (uint256)",
  "event ArbitrageExecuted(address indexed asset, uint256 amount, uint256 profit, address router, address[] path)"
];

export async function executeFlashloanArbitrage({
  asset,
  amountWei,
  router,
  path,
  flashloanContractAddress,
  signer
}) {
  try {
    console.log(`\n⚡ INITIATING FLASHLOAN ARBITRAGE`);
    console.log(`Asset: ${asset}`);
    console.log(`Amount: ${ethers.formatEther(amountWei)}`);
    console.log(`Router: ${router}`);
    console.log(`Path: ${path.join(" → ")}`);

    // Create contract instance
    const flashloanContract = new ethers.Contract(
      flashloanContractAddress,
      FLASHLOAN_ABI,
      signer
    );

    // Execute flashloan arbitrage
    const tx = await flashloanContract.executeFlashloanArbitrage(
      asset,
      amountWei,
      router,
      path
    );

    console.log(`📤 Flashloan transaction submitted: ${tx.hash}`);

    // Wait for confirmation
    const receipt = await tx.wait();

    if (receipt.status === 1) {
      console.log(`✅ Flashloan arbitrage executed successfully`);

      // Parse events to get profit details
      const arbitrageEvent = receipt.logs.find(log => {
        try {
          const parsed = flashloanContract.interface.parseLog(log);
          return parsed.name === "ArbitrageExecuted";
        } catch {
          return false;
        }
      });

      if (arbitrageEvent) {
        const { asset: eventAsset, amount: eventAmount, profit } =
          flashloanContract.interface.parseLog(arbitrageEvent).args;

        console.log(`\n🔥 REAL FLASHLOAN ARBITRAGE EXECUTED`);
        console.log(`Block: ${receipt.blockNumber}`);
        console.log(`DEX: ${router}`);
        console.log(`Flashloan: ${ethers.formatEther(eventAmount)} ${eventAsset}`);
        console.log(`Path: ${path.join(" → ")}`);
        console.log(`Net Profit: $${ethers.formatEther(profit)}`);
        console.log(`TX Hash: ${tx.hash}`);

        return {
          success: true,
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
          profit: profit,
          gasUsed: receipt.gasUsed
        };
      }

      return {
        success: true,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed
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

/**
 * Check if flashloan is available for an asset and amount
 */
export async function checkFlashloanAvailability(asset, amount) {
  try {
    // Get Aave pool contract
    const poolAbi = [
      "function getReserveData(address asset) external view returns (tuple(uint256, uint40, uint16, uint128, uint128, uint128, uint40, address, address, address, address, uint8))"
    ];

    const poolContract = new ethers.Contract(
      AAVE_POOL_ADDRESS,
      poolAbi,
      provider
    );

    // This is a simplified check - in production you'd check actual liquidity
    // For now, assume flashloans are available for major tokens
    const majorTokens = [
      "0x55d398326f99059fF775485246999027B3197955", // USDT
      "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", // BUSD
      "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
      "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"  // USDC
    ];

    const isSupported = majorTokens.includes(asset.toLowerCase());

    return {
      available: isSupported,
      maxAmount: isSupported ? ethers.parseEther("1000000") : 0n // 1M tokens max
    };

  } catch (error) {
    console.error("Error checking flashloan availability:", error);
    return { available: false, maxAmount: 0n };
  }
}

/**
 * Get flashloan fee for an asset
 */
export async function getFlashloanFee(asset) {
  try {
    // Aave v3 flashloan fee is 0.05% (5 basis points)
    return 5; // basis points
  } catch (error) {
    console.error("Error getting flashloan fee:", error);
    return 5; // default 0.05%
  }
}