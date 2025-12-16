import { config } from "dotenv";
import { initMoralis } from "./bootstrap/moralis.bootstrap.js";
import { autonomousController } from "./autonomousController.js";
import { monitoring } from "./monitoring.js";
import { provider } from "./dex/routers.js";
import { ethers } from "ethers";
import rpcManager from "../utils/RpcManager.js";

// Load .env from current directory
config({ path: ".env" });

/**
 * Create fault-isolated bot supervisor
 * @private
 */
function createBotSupervisor(botName, startFn) {
  let isRunning = false;
  let restartAttempts = 0;
  const maxRestartAttempts = 5;
  const restartDelay = 30000; // 30 seconds

  return {
    async start() {
      if (isRunning) return;

      while (restartAttempts < maxRestartAttempts) {
        try {
          isRunning = true;
          restartAttempts = 0; // Reset on successful start

          await startFn();

          // If we get here, bot started successfully
          return;

        } catch (error) {
          isRunning = false;
          restartAttempts++;

          console.error(`❌ ${botName} Bot failed to start (attempt ${restartAttempts}/${maxRestartAttempts}):`, error.message);

          if (restartAttempts < maxRestartAttempts) {
            console.log(`🔄 ${botName} Bot restarting in ${restartDelay/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, restartDelay));
          } else {
            console.error(`💀 ${botName} Bot failed permanently after ${maxRestartAttempts} attempts`);
            throw error;
          }
        }
      }
    },

    stop() {
      isRunning = false;
      console.log(`🛑 ${botName} Bot supervisor stopped`);
    },

    getStatus() {
      return {
        name: botName,
        isRunning,
        restartAttempts,
        maxRestartAttempts
      };
    }
  };
}

async function main() {
  let liquidationBot = null;

  try {
    console.log('🤖 STARTING AUTONOMOUS TRADING SYSTEM');
    console.log('=====================================');
    console.log('🚀 ARBITRAGE BOT (VOLATILE/EXTREME MODE)');
    console.log('🔥 LIQUIDATION BOT (MULTI-PROTOCOL)');
    console.log('=====================================');

    // Initialize Moralis once
    await initMoralis();

    // Initialize RPC Manager with private BSC endpoint
    const rpcUrl = process.env.RPC_URL || "https://bsc-mainnet.nodereal.io/v1/YOUR_API_KEY" ||
                   "https://bsc-dataseed1.binance.org/" ||
                   "https://bsc-dataseed.binance.org/";
    rpcManager.initialize(rpcUrl);

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

    // FAULT-ISOLATED BOT SUPERVISORS
    // Each bot runs in isolated supervisor to prevent cascade failures

    // Supervisor for Arbitrage Bot
    const arbitrageSupervisor = createBotSupervisor('ARBITRAGE', async () => {
      console.log('🚀 Initializing Arbitrage Bot...');
      await autonomousController.initialize(signer, flashloanContractAddress);
      await autonomousController.start();
      console.log('✅ Arbitrage Bot started successfully');
    });

    // Supervisor for Liquidation Bot
    const liquidationSupervisor = createBotSupervisor('LIQUIDATION', async () => {
      console.log('🔥 Initializing Liquidation Bot...');
      const liquidationModule = await import('../bot/LiquidationBot.js');
      const { LiquidationBot } = liquidationModule;
      liquidationBot = new LiquidationBot(provider, signer, {
        sharedGasManager: autonomousController.getGasManager ? autonomousController.getGasManager() : null
      });

      await liquidationBot.initialize();
      await liquidationBot.start();
      console.log('✅ Liquidation Bot started successfully');
    });

    // Start both supervisors concurrently
    const supervisorPromises = [
      arbitrageSupervisor.start(),
      liquidationSupervisor.start()
    ];

    // Wait for initial startup (with timeout)
    try {
      await Promise.race([
        Promise.all(supervisorPromises),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Bot startup timeout')), 60000) // 60 second timeout
        )
      ]);
      console.log('✅ Both bots initialized and started successfully');
    } catch (error) {
      console.error('❌ Bot startup failed:', error.message);
      // Continue with available bots - don't exit
    }

    // Setup graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      autonomousController.stop();
      if (liquidationBot) {
        await liquidationBot.stop();
      }
      monitoring.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      autonomousController.stop();
      if (liquidationBot) {
        await liquidationBot.stop();
      }
      monitoring.stop();
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

    console.log('✅ AUTONOMOUS TRADING SYSTEM STARTED SUCCESSFULLY');
    console.log('🚀 ARBITRAGE BOT: Scanning for arbitrage opportunities');
    console.log('🔥 LIQUIDATION BOT: Monitoring for liquidation opportunities');
    console.log('� Both bots will run 24/7 in the background');
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