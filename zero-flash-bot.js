import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://bsc-mainnet.nodereal.io/v1/d534b4de2d6243f19f43721c4f3dfd82';
const JS_BOT_PRIVATE_KEY = process.env.JS_BOT_PRIVATE_KEY;
// Fallback to old PRIVATE_KEY for backward compatibility
const PRIVATE_KEY = JS_BOT_PRIVATE_KEY || process.env.PRIVATE_KEY;
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || '0xd858c700e5b16f1fddbddd8fc02a71d5730e41ff'; // owner

// Pancake V3 Pool Addresses (0.01% fee)
const USDT_USDC_POOL = '0x92b7807bF9b36D6c4C6eF79f6e06E3c6A8241631';

// Token Addresses
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';

// Pancake V3 Router
const PANCAKE_V3_ROUTER = '0x1b81D678ffb9C0263b24A97847620C99d213eB14';

// Constants
const FLASHLOAN_AMOUNT = ethers.parseUnits('3000000', 18); // 3M USDT
const DEV_FEE_PERCENT = 0.0005; // 0.05%
const SLIPPAGE = 0.015; // 1.5%
const GAS_LIMIT = 22000000;
const GAS_PRICE_CALM = ethers.parseUnits('3', 'gwei');
const GAS_PRICE_VOLATILE = ethers.parseUnits('8', 'gwei');
const MIN_PROFIT_MULTIPLIER = 3;

// Contract ABI and Bytecode (compiled FlashArb contract)
const FLASH_CONTRACT_ABI = [
  "function flashArb(address pool, uint256 amount) external",
  "function setTreasury(address) external",
  "function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external"
];

// Placeholder bytecode - in practice, compile the Solidity contract
const FLASH_CONTRACT_BYTECODE = `0x${'608060405234801561001057600080fd5b50d3801561001d57600080fd5b50d2801561002a57600080fd5b506101b58061003a6000396000f3fe608060405234801561001057600080fd5b50d3801561001d57600080fd5b50d2801561002a57600080fd5b50600436106100405760003560e01c80636b7f4e4b14610045575b600080fd5b61004d61006a565b60408051918252519081900360200190f35b60008060008060008060006100a06001866100a8565b915091506100ae82826100b2565b5090565b6000602082840312156100b957600080fd5b5051919050565b6000600182016100d5577f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b506001019056fe'}`; // This is dummy, need real bytecode

let FLASH_CONTRACT_ADDRESS = null;

// Provider and Signer
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

// Deploy contract if not set
async function deployContract() {
  if (FLASH_CONTRACT_ADDRESS) return FLASH_CONTRACT_ADDRESS;

  console.log('🚀 Deploying FlashArb contract...');
  const factory = new ethers.ContractFactory(FLASH_CONTRACT_ABI, FLASH_CONTRACT_BYTECODE, signer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  FLASH_CONTRACT_ADDRESS = await contract.getAddress();
  console.log(`✅ Contract deployed at: ${FLASH_CONTRACT_ADDRESS}`);

  // Set treasury
  await contract.setTreasury(TREASURY_ADDRESS);
  return FLASH_CONTRACT_ADDRESS;
}

// Main flash arb function
async function executeFlashArb() {
  try {
    console.log('🚀 Starting Flashloan Arb...');

    // Deploy contract if needed
    const contractAddress = await deployContract();
    const contract = new ethers.Contract(contractAddress, FLASH_CONTRACT_ABI, signer);

    // Get gas price
    const feeData = await provider.getFeeData();
    let gasPrice = feeData.gasPrice;
    if (gasPrice > GAS_PRICE_VOLATILE) {
      console.log('⏭️ Gas price too high, skipping');
      return;
    }
    gasPrice = gasPrice < GAS_PRICE_CALM ? GAS_PRICE_CALM : gasPrice;

    // Call contract's flashArb
    const tx = await contract.flashArb(USDT_USDC_POOL, FLASHLOAN_AMOUNT, { gasLimit: GAS_LIMIT, gasPrice });

    console.log(`📤 Flash TX submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ Flash TX confirmed: ${receipt.status === 1 ? 'Success' : 'Failed'}`);

    // Parse logs for profit
    // Assume contract emits events

  } catch (error) {
    console.error('❌ Flash Arb failed:', error.message);
    // Retry once if not already retrying
    if (!error.message.includes('retry')) {
      console.log('🔄 Retrying...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      await executeFlashArb();
    }
  }
}

// Note: The flash callback logic is implemented in the Solidity contract
// Contract performs: borrow USDT -> swap USDT->USDC -> swap USDC->USDT -> repay loan -> skim fee -> send profit

// Main loop
async function main() {
  console.log('🤖 Zero Flash Bot Started');
  console.log('📊 Monitoring for arb opportunities...');

  while (true) {
    try {
      await executeFlashArb();
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10s interval
    } catch (error) {
      console.error('❌ Main loop error:', error.message);
      console.log('🔄 Auto-restarting in 30s...');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

// Handle crashes
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  console.log('🔄 Auto-restarting...');
  main();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection:', reason);
  console.log('🔄 Auto-restarting...');
  main();
});

main();