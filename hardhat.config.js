require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-waffle");
require('dotenv').config();

const RPC_ENDPOINTS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.binance.org",
  "https://bsc-dataseed2.binance.org",
  "https://bsc-dataseed3.binance.org",
  "https://bsc-dataseed4.binance.org"
];

const selectedRPC = RPC_ENDPOINTS[Math.floor(Math.random() * RPC_ENDPOINTS.length)];

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000, // Increased optimizer runs for better gas efficiency
        details: {
          yul: true,
          yulDetails: {
            stackAllocation: true,
            optimizerSteps: "dhfoDgvulfnTUtnIf" // Custom optimization sequence
          }
        }
      },
      viaIR: true // Enable new IR-based compiler pipeline
    }
  },
  networks: {
    hardhat: {
      chainId: 56,
      forking: {
        url: selectedRPC,
        enabled: true
      },
      gas: 8000000,
      gasPrice: 5000000000,
      accounts: {
        accountsBalance: "10000000000000000000000" // 10000 BNB
      }
    },
    bsc: {
      url: selectedRPC,
      chainId: 56,
      accounts: [process.env.PRIVATE_KEY || "0000000000000000000000000000000000000000000000000000000000000000"],
      gasPrice: 5000000000, // 5 gwei
      timeout: 120000
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 120000 // Set timeout to 2 minutes to handle slower network responses
  }
};
