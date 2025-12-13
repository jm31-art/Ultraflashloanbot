import { config } from "dotenv";
import { initMoralis } from "./bootstrap/moralis.bootstrap.js";
import { generateTriangularPaths } from "./arbitrage/pathGenerator.js";
import { runArbitrage } from "./arbitrage/arbitrageEngine.js";
import { provider } from "./dex/routers.js";
import { ethers } from "ethers";

// Load .env from parent directory
config({ path: "../.env" });

async function main() {
  try {
    // Initialize Moralis once
    await initMoralis();

    // Setup signer (use private key from env)
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("PRIVATE_KEY not found in .env");
    }

    const signer = new ethers.Wallet(privateKey, provider);

    console.log(`Signer address: ${signer.address}`);

    // Check wallet balance
    const balance = await provider.getBalance(signer.address);
    const balanceUsd = Number(ethers.formatEther(balance)) * 567;
    console.log(`Wallet balance: ${ethers.formatEther(balance)} BNB ($${balanceUsd.toFixed(2)})`);

    // Generate all triangular paths
    const paths = generateTriangularPaths();
    console.log(`Generated ${paths.length} triangular arbitrage paths`);

    // Flashloan contract address
    const flashloanContractAddress = process.env.FLASHLOAN_ARB_CONTRACT;

    if (!flashloanContractAddress) {
      console.log("❌ FLASHLOAN_ARB_CONTRACT not set in .env");
      console.log("Please deploy FlashloanExecutor.sol and add address to .env");
      return;
    }

    console.log(`Flashloan contract: ${flashloanContractAddress}`);

    // Run arbitrage engine (dynamic sizing, MEV protection, extreme mode)
    const result = await runArbitrage(paths, signer, flashloanContractAddress);

    if (result) {
      if (result.dryRun) {
        console.log("Arbitrage opportunity found (dry run)!");
      } else {
        console.log("Arbitrage executed successfully!");
      }
    } else {
      console.log("No arbitrage opportunities found.");
    }

  } catch (error) {
    console.error("Error:", error);
  }
}

main();