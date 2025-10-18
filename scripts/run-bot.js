const hre = require("hardhat");
const { ethers } = require("hardhat");

async function findArbitragePaths(contract, tokens, exchanges) {
  for (let i = 0; i < tokens.length; i++) {
    for (let j = 0; j < tokens.length; j++) {
      if (i !== j) {
        const path = [tokens[i], tokens[j], tokens[i]]; // Complete the cycle
        const exchangeList = ["PancakeSwap", "ApeSwap", "BiSwap"]; // Example path through exchanges
        
        try {
          // Get current balance
          const token = await ethers.getContractAt("IERC20", tokens[i]);
          const balance = await token.balanceOf(contract.address);
          
          // Only attempt if we have balance or it's WBNB (which we can get via flashloan)
          if (balance.gt(0) || tokens[i] === "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c") {
            const amount = ethers.utils.parseUnits("1", "18"); // 1 token
            
            console.log(`Trying arbitrage path: ${path.join(" -> ")}`);
            console.log(`Via exchanges: ${exchangeList.join(" -> ")}`);
            
            // Execute arbitrage
            const tx = await contract.executeArbitrage(
              path,
              exchangeList,
              amount,
              { gasLimit: 5000000 }
            );
            
            await tx.wait();
            console.log("Arbitrage executed successfully!");
          }
        } catch (error) {
          console.log(`Failed path: ${path.join(" -> ")}`);
          console.log(`Error: ${error.message}\n`);
        }
      }
    }
  }
}

async function main() {
  // Get the deployed contract
  const FlashloanArb = await ethers.getContractFactory("FlashloanArb");
  const [deployer] = await ethers.getSigners();
  
  console.log("Running bot with account:", deployer.address);
  
  // Get the deployed contract address from your deployment
  const CONTRACT_ADDRESS = "YOUR_DEPLOYED_CONTRACT_ADDRESS"; // Replace after deployment
  const flashloanArb = FlashloanArb.attach(CONTRACT_ADDRESS);
  
  // List of tokens to try arbitrage between
  const tokens = [
    "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
    "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", // BTCB
    "0x55d398326f99059fF775485246999027B3197955", // USDT
    "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", // BUSD
    "0x2170Ed0880ac9A755fd29B2688956BD959F933F8"  // ETH
  ];
  
  const exchanges = ["PancakeSwap", "ApeSwap", "BiSwap", "MDEX", "BabySwap"];
  
  // Start monitoring for opportunities
  while (true) {
    try {
      console.log("\nSearching for arbitrage opportunities...");
      await findArbitragePaths(flashloanArb, tokens, exchanges);
    } catch (error) {
      console.error("Error in main loop:", error);
    }
    
    // Wait before next iteration
    await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second delay
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
