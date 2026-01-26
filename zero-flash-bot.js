import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Configuration
const CONFIG = {
    RPC_URL: process.env.RPC_URL || 'https://bsc-mainnet.nodereal.io/v1/d534b4de2d6243f19f43721c4f3dfd82',
    JS_BOT_PRIVATE_KEY: process.env.JS_BOT_PRIVATE_KEY,
    PRIVATE_KEY: process.env.JS_BOT_PRIVATE_KEY || process.env.PRIVATE_KEY, // Fallback for backward compatibility
    TREASURY_ADDRESS: process.env.TREASURY_ADDRESS || '0xd858c700e5b16f1fddbddd8fc02a71d5730e41ff', // owner
    FLASH_ARB_ADDRESS: process.env.FLASH_ARB_ADDRESS, // Existing deployment
    FLASH_ARB_ABI_PATH: './abi/FlashArb.json',
    DEPLOYMENT_FILE: './deployments.json' // Auto-saved deployments
};

// For backward compatibility
const RPC_URL = CONFIG.RPC_URL;
const PRIVATE_KEY = CONFIG.PRIVATE_KEY;
const TREASURY_ADDRESS = CONFIG.TREASURY_ADDRESS;

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

// Contract ABI and Bytecode will be loaded from files
let FLASH_CONTRACT_ABI = null;
let FLASH_CONTRACT_BYTECODE = null;

// Provider and Signer
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

async function getFlashArbContract() {
    /**
     * Get FlashArb contract - reuse existing or deploy new.
     * Prioritizes: env var > deployment file > new deployment
     */

    // Load ABI
    const artifact = JSON.parse(fs.readFileSync(CONFIG.FLASH_ARB_ABI_PATH, 'utf8'));
    const abi = artifact.abi;
    const bytecode = artifact.bytecode;

    // Option 1: Use address from environment variable
    if (CONFIG.FLASH_ARB_ADDRESS) {
        console.log(`🔍 Using FlashArb from env: ${CONFIG.FLASH_ARB_ADDRESS}`);
        const contract = new ethers.Contract(CONFIG.FLASH_ARB_ADDRESS, abi, signer);

        // Verify contract is valid
        try {
            const code = await provider.getCode(CONFIG.FLASH_ARB_ADDRESS);
            if (code === '0x') {
                throw new Error("No contract at address");
            }
            console.log("✅ Contract verified on-chain");
            return contract;
        } catch (e) {
            console.error(`❌ Contract at ${CONFIG.FLASH_ARB_ADDRESS} invalid: ${e.message}`);
            console.log("Falling back to deployment file...");
        }
    }

    // Option 2: Use address from deployment file
    if (fs.existsSync(CONFIG.DEPLOYMENT_FILE)) {
        const deployments = JSON.parse(fs.readFileSync(CONFIG.DEPLOYMENT_FILE, 'utf8'));
        const bscDeployment = deployments.find(d => d.network === 'bsc' && d.contract === 'FlashArb');

        if (bscDeployment) {
            console.log(`🔍 Using FlashArb from deployment file: ${bscDeployment.address}`);
            const contract = new ethers.Contract(bscDeployment.address, abi, signer);

            // Verify
            try {
                const code = await provider.getCode(bscDeployment.address);
                if (code !== '0x') {
                    console.log("✅ Contract verified on-chain");

                    // Save to env for next run
                    updateEnvFile('FLASH_ARB_ADDRESS', bscDeployment.address);

                    return contract;
                }
            } catch (e) {
                console.log("Deployment file address invalid, will deploy new...");
            }
        }
    }

    // Option 3: Deploy new contract
    console.log("🚀 No existing deployment found. Deploying new FlashArb...");

    if (!bytecode || bytecode === '') {
        throw new Error("No bytecode available for deployment. Please compile the contract first.");
    }

    const FlashArbFactory = new ethers.ContractFactory(abi, bytecode, signer);
    const flashArb = await FlashArbFactory.deploy();
    await flashArb.waitForDeployment();
    const deployedAddress = await flashArb.getAddress();

    console.log(`✅ FlashArb deployed to: ${deployedAddress}`);

    // Set treasury
    await flashArb.setTreasury(TREASURY_ADDRESS);

    // Save deployment
    const network = await provider.getNetwork();
    saveDeployment('bsc', 'FlashArb', deployedAddress, network.chainId);

    // Save to .env
    updateEnvFile('FLASH_ARB_ADDRESS', deployedAddress);

    return flashArb;
}

function saveDeployment(network, contract, address, chainId) {
    /** Save deployment info for reuse */
    let deployments = [];
    if (fs.existsSync(CONFIG.DEPLOYMENT_FILE)) {
        deployments = JSON.parse(fs.readFileSync(CONFIG.DEPLOYMENT_FILE, 'utf8'));
    }

    // Remove old deployment for this network/contract
    deployments = deployments.filter(d => !(d.network === network && d.contract === contract));

    // Add new deployment
    deployments.push({
        network,
        contract,
        address,
        chainId,
        timestamp: new Date().toISOString()
    });

    fs.writeFileSync(CONFIG.DEPLOYMENT_FILE, JSON.stringify(deployments, null, 2));
    console.log(`💾 Deployment saved to ${CONFIG.DEPLOYMENT_FILE}`);
}

function updateEnvFile(key, value) {
    /** Update .env file with new value */
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';

    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');

        // Update existing key or add new
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) {
            envContent = envContent.replace(regex, `${key}=${value}`);
        } else {
            envContent += `\n${key}=${value}`;
        }
    } else {
        envContent = `${key}=${value}`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log(`💾 Updated .env with ${key}=${value}`);
}

// Main flash arb function
async function executeFlashArb() {
  try {
    console.log('🚀 Starting Flashloan Arb...');

    // Get or deploy contract (REUSES EXISTING!)
    const contract = await getFlashArbContract();

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

    console.log(`🔄 Using FlashArb contract: ${await contract.getAddress()}`);

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