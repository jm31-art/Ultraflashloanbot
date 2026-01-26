// scripts/deploy-ultra-cheap.js
const { ethers } = require("hardhat");
const fs = require('fs');

async function main() {
    const [deployer] = await ethers.getSigners();

    console.log("Deploying to Arbitrum Nova (ultra-cheap L2)...");
    console.log(`Deployer: ${deployer.address}`);

    const balance = await deployer.getBalance();
    console.log(`Balance: ${ethers.utils.formatEther(balance)} ETH`);

    // Check minimum balance (0.001 ETH = ~$2.50 on Arbitrum Nova)
    if (balance.lt(ethers.utils.parseEther("0.001"))) {
        throw new Error("Need at least 0.001 ETH for deployment on Arbitrum Nova");
    }

    // Deploy with optimized gas settings for Arbitrum Nova
    const FlashloanArbCheap = await ethers.getContractFactory("FlashloanArbCheap");

    // Use low gas price for Nova (0.01 gwei)
    const flashArb = await FlashloanArbCheap.deploy({
        gasPrice: ethers.utils.parseUnits("0.01", "gwei"),  // Nova minimum
        gasLimit: 2000000  // Optimized limit
    });

    await flashArb.deployed();

    const receipt = await flashArb.deployTransaction.wait();
    const deploymentCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);

    console.log(`\n✅ Deployed to: ${flashArb.address}`);
    console.log(`Gas used: ${receipt.gasUsed}`);
    console.log(`Cost: ${ethers.utils.formatEther(deploymentCost)} ETH`);
    console.log(`~$${(parseFloat(ethers.utils.formatEther(deploymentCost)) * 2500).toFixed(2)} USD`);

    // Save deployment
    const deployment = {
        network: "arbitrumNova",
        chainId: 42170,
        address: flashArb.address,
        costEth: ethers.utils.formatEther(deploymentCost),
        timestamp: new Date().toISOString()
    };

    fs.writeFileSync('deployments/nova-cheap.json', JSON.stringify(deployment, null, 2));

    return flashArb.address;
}

main().catch(console.error);