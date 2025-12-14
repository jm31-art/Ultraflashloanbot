import { config } from "dotenv";
import { initMoralis } from "./bootstrap/moralis.bootstrap.js";
import { autonomousController } from "./autonomousController.js";
import { provider } from "./dex/routers.js";
import { ethers } from "ethers";

// Load .env from parent directory
config({ path: "../.env" });

async function main() {
  try {
    console.log('🤖 STARTING AUTONOMOUS ARBITRAGE BOT (VOLATILE/EXTREME MODE)');
    console.log('==================================================');

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

    // Flashloan contract address
    const flashloanContractAddress = process.env.FLASHLOAN_ARB_CONTRACT;

    if (!flashloanContractAddress) {
      console.log("❌ FLASHLOAN_ARB_CONTRACT not set in .env");
      console.log("Please deploy FlashloanExecutor.sol and add address to .env");
      return;
    }

    console.log(`Flashloan contract: ${flashloanContractAddress}`);

    // Initialize autonomous controller
    await autonomousController.initialize(signer, flashloanContractAddress);

    // Start autonomous operation
    await autonomousController.start();

    // Setup graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      autonomousController.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      autonomousController.stop();
      process.exit(0);
    });

    // Handle uncaught exceptions (self-healing)
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught exception:', error);
      console.log('🔧 Attempting self-healing...');
      // Don't exit - let the autonomous controller handle recovery
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
      console.log('🔧 Attempting self-healing...');
      // Don't exit - let the autonomous controller handle recovery
    });

    console.log('✅ AUTONOMOUS BOT STARTED SUCCESSFULLY');
    console.log('💡 Bot will run 24/7 in the background');
    console.log('💡 Check logs for execution updates');
    console.log('💡 Press Ctrl+C to stop gracefully');

    // Keep the process alive
    setInterval(() => {
      // Periodic status check
      const status = autonomousController.getStatus();
      if (status.isRunning) {
        // Silent operation - no spam
      }
    }, 300000); // Every 5 minutes

  } catch (error) {
    console.error("❌ FATAL ERROR - BOT SHUTDOWN:", error);
    autonomousController.stop();
    process.exit(1);
  }
}

main();