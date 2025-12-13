import { initMoralis } from "./bootstrap/moralis.bootstrap.js";
import { generateTriangularPaths } from "./arbitrage/pathGenerator.js";
import { runArbitrage } from "./arbitrage/arbitrageEngine.js";
import { ethers } from "ethers";

async function main() {
  try {
    // Initialize Moralis once
    await initMoralis();

    // Generate all triangular paths
    const paths = generateTriangularPaths();
    console.log(`Generated ${paths.length} triangular arbitrage paths`);

    // Test amount (1 WBNB)
    const amountInWei = ethers.parseEther("1");
    const tokenPriceUsd = 567; // Approximate BNB price

    // Run arbitrage detection
    const result = await runArbitrage(paths, amountInWei, tokenPriceUsd);

    if (result) {
      console.log("Arbitrage opportunity found and validated!");
    } else {
      console.log("No arbitrage opportunities found.");
    }

  } catch (error) {
    console.error("Error:", error);
  }
}

main();