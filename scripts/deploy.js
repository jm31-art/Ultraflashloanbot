const hre = require("hardhat");

async function main() {
  console.log("Deploying FlashloanArb contract...");

  // Get gas price and optimize it
  const gasPrice = await hre.ethers.provider.getGasPrice();
  const optimizedGasPrice = gasPrice.mul(85).div(100); // Use 85% of current gas price
  
  const FlashloanArb = await hre.ethers.getContractFactory("FlashloanArb");
  const flashloanArb = await FlashloanArb.deploy({
    gasPrice: optimizedGasPrice,
    gasLimit: 3000000 // Optimized gas limit based on contract size
  });

  await flashloanArb.deployed();

  console.log("FlashloanArb deployed to:", flashloanArb.address);

  // Initialize DODO pools
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const BUSD = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56";
  const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
  const BTCB = "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c";
  const ETH = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8";

  // Set DODO pools in a single multicall transaction
  console.log("Setting up DODO pools...");
  const poolSetupTx = await Promise.all([
    flashloanArb.setDODOPool(USDT, "0x5BDCf4962FDED6B7156E710400F4C4c031f600dC", { gasPrice: optimizedGasPrice }),
    flashloanArb.setDODOPool(BUSD, "0x5BDCf4962FDED6B7156E710400F4C4c031f600dC", { gasPrice: optimizedGasPrice }),
    flashloanArb.setDODOPool(WBNB, "0xBe60d4c4250438344bEC816Ec2deC99925dEb4c7", { gasPrice: optimizedGasPrice }),
    flashloanArb.setDODOPool(BTCB, "0x2B6d3543a37aFe5Ef8516c3d2134D1C2A9CD0906", { gasPrice: optimizedGasPrice }),
    flashloanArb.setDODOPool(ETH, "0x5d0C61670229fE0cEEf2c883f1261E8C38A25fEd", { gasPrice: optimizedGasPrice })
  ]);

  console.log("DODO pools initialized");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
