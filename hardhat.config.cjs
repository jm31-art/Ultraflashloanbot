require("@nomicfoundation/hardhat-ethers");
require('dotenv').config();

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200  // Optimize for deployment cost
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 1337
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 42161,
      gasPrice: "auto",  // Arbitrum uses dynamic gas
      // Arbitrum specific settings
      arbitrum: {
        // Enable Arbitrum compatibility mode
        enableCustomGasReporter: true
      }
    },
    arbitrumSepolia: {
      url: process.env.ARBITRUM_TESTNET_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 421614
    },
    arbitrumNova: {
      url: process.env.ARBITRUM_NOVA_RPC_URL || "https://nova.arbitrum.io/rpc",  // Public RPC (free)
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 42170,
      gasPrice: 10000000  // 0.01 gwei in wei
    }
  }
};
