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

    // Test amount (1 WBNB)
    const amountInWei = ethers.parseEther("1");
    const tokenPriceUsd = 567; // Approximate BNB price

    // Flashloan contract address (deploy this first)
    const flashloanContractAddress = process.env.FLASHLOAN_ARB_CONTRACT;

    if (!flashloanContractAddress) {
      console.log("⚠️ FLASHLOAN_CONTRACT_ADDRESS not set - running in dry-run mode");
    }

    // Run arbitrage detection
    const result = await runArbitrage(paths, amountInWei, tokenPriceUsd, signer, flashloanContractAddress);

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