/**
 * AUTONOMOUS RUNTIME CONTROLLER
 * Daemon-like operation for VOLATILE/EXTREME MODE arbitrage bot
 * Runs 24/7 without user interaction, event-driven execution
 */

import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { provider } from './dex/routers.js';
import { generateTriangularPaths } from './arbitrage/pathGenerator.js';
import { runArbitrage } from './arbitrage/arbitrageEngine.js';
import { VOLATILE_MODE } from './arbitrage/volatileModeConfig.js';
import { monitoring } from './monitoring.js';

class AutonomousController extends EventEmitter {
  constructor() {
    super();

    // Runtime state
    this.isRunning = false;
    this.automationMode = true; // Always enabled for autonomous operation
    this.currentMode = 'EXTREME'; // Start in EXTREME mode
    this.lastExecutionBlock = 0;
    this.runOnceEveryNBlocks = 1; // Default, will be randomized

    // Attempt management (24h lifecycle)
    this.attemptsUsed24h = 0;
    this.maxAttemptsPer24h = 2;
    this.attemptResetTime = Date.now() + 24 * 60 * 60 * 1000; // 24 hours from now
    this.lastSuccessfulTrade = Date.now();

    // Event tracking
    this.eventListeners = new Map();
    this.idleTimeout = null;

    // Paths and contracts (initialized once)
    this.paths = null;
    this.signer = null;
    this.flashloanContractAddress = null;

    // Mode switching
    this.extremeModeStartTime = Date.now();
    this.extremeTradesExecuted = 0;
    this.extremeModeTimeout = 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Initialize the autonomous controller
   */
  async initialize(signer, flashloanContractAddress) {
    console.log('🤖 AUTONOMOUS CONTROLLER: Initializing...');

    this.signer = signer;
    this.flashloanContractAddress = flashloanContractAddress;

    // Generate paths once
    this.paths = generateTriangularPaths();
    console.log(`🤖 AUTONOMOUS CONTROLLER: Generated ${this.paths.length} triangular paths`);

    // Setup event listeners for blockchain events
    await this.setupEventListeners();

    // Check wallet safety
    await this.validateWalletSafety();

    // Start monitoring system
    monitoring.start();

    console.log('🤖 AUTONOMOUS CONTROLLER: Initialization complete');
    console.log('🤖 AUTONOMOUS CONTROLLER: Entering autonomous mode...');
  }

  /**
   * Start autonomous operation
   */
  async start() {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log('🚀 AUTONOMOUS CONTROLLER: Starting daemon mode');

    // Enter idle state initially
    this.enterIdleState();

    // Start the main event loop
    this.startEventLoop();
  }

  /**
   * Stop autonomous operation
   */
  stop() {
    console.log('🛑 AUTONOMOUS CONTROLLER: Stopping daemon mode');
    this.isRunning = false;

    // Clear all timeouts and listeners
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
    }

    this.removeAllListeners();
    this.clearEventListeners();
  }

  /**
   * Setup blockchain event listeners
   */
  async setupEventListeners() {
    try {
      // Listen for new blocks
      provider.on('block', (blockNumber) => {
        this.handleBlockEvent(blockNumber);
      });

      // Listen for pending transactions (large swaps)
      provider.on('pending', (tx) => {
        this.handlePendingTransaction(tx);
      });

      // Setup DEX pool monitoring for liquidity changes
      await this.setupPoolMonitoring();

      console.log('🤖 AUTONOMOUS CONTROLLER: Event listeners configured');
    } catch (error) {
      console.error('❌ Failed to setup event listeners:', error);
    }
  }

  /**
   * Setup DEX pool monitoring for liquidity and imbalance events
   */
  async setupPoolMonitoring() {
    // Monitor major DEX pools for significant changes
    const majorPools = [
      // PancakeSwap WBNB/USDT
      '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE2',
      // PancakeSwap WBNB/USDC
      '0xd99c7F6C65857AC913a8A4f0B6819082e1e3e2f0',
      // PancakeSwap USDT/USDC
      '0x7EFaEf62fDdCCa950418312c6C91Aef321375A00'
    ];

    // Store baseline reserves for comparison
    this.poolBaselines = new Map();

    // Initialize baselines
    for (const poolAddress of majorPools) {
      try {
        const baseline = await this.getPoolReserves(poolAddress);
        if (baseline) {
          this.poolBaselines.set(poolAddress, baseline);
        }
      } catch (error) {
        // Silent error
      }
    }

    // Periodic pool checking (every 30 seconds)
    setInterval(async () => {
      if (!this.isRunning) return;

      for (const [poolAddress, baseline] of this.poolBaselines) {
        try {
          const current = await this.getPoolReserves(poolAddress);
          if (current && this.detectPoolImbalance(baseline, current)) {
            this.triggerExecution('pool_imbalance');
            break; // Only trigger once per check
          }
        } catch (error) {
          // Silent error
        }
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Get pool reserves
   */
  async getPoolReserves(poolAddress) {
    try {
      const poolContract = new ethers.Contract(poolAddress, [
        'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'
      ], provider);

      const [reserve0, reserve1] = await poolContract.getReserves();
      return {
        reserve0: Number(reserve0),
        reserve1: Number(reserve1),
        timestamp: Date.now()
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Detect significant pool imbalance
   */
  detectPoolImbalance(baseline, current) {
    const threshold = 0.05; // 5% change threshold

    const change0 = Math.abs(current.reserve0 - baseline.reserve0) / baseline.reserve0;
    const change1 = Math.abs(current.reserve1 - baseline.reserve1) / baseline.reserve1;

    return change0 > threshold || change1 > threshold;
  }

  /**
   * Clear event listeners
   */
  clearEventListeners() {
    try {
      provider.removeAllListeners('block');
      provider.removeAllListeners('pending');
    } catch (error) {
      console.error('❌ Error clearing event listeners:', error);
    }
  }

  /**
   * Handle new block events
   */
  async handleBlockEvent(blockNumber) {
    // Check if we should run based on block interval
    if (blockNumber - this.lastExecutionBlock >= this.runOnceEveryNBlocks) {
      this.triggerExecution('block');
    }
  }

  /**
   * Handle pending transactions (look for large swaps)
   */
  async handlePendingTransaction(txHash) {
    try {
      const tx = await provider.getTransaction(txHash);
      if (!tx) return;

      // Check for large swaps (> $10K equivalent)
      const value = Number(ethers.formatEther(tx.value || 0));
      if (value > 10) { // Assuming BNB, ~$5K+ at current prices
        this.triggerExecution('large_swap');
      }
    } catch (error) {
      // Silent error handling
    }
  }

  /**
   * Trigger execution based on event
   */
  triggerExecution(reason) {
    if (!this.isRunning) return;

    // Clear idle timeout
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }

    // Randomize block interval for next run
    this.runOnceEveryNBlocks = Math.floor(Math.random() * 3) + 1; // 1-3 blocks

    console.log(`🎯 AUTONOMOUS CONTROLLER: Triggered by ${reason} event`);

    // Execute arbitrage scan
    this.executeArbitrageScan();
  }

  /**
   * Execute arbitrage scan
   */
  async executeArbitrageScan() {
    try {
      // Check attempt limits
      if (!this.canExecuteAttempt()) {
        console.log('🔒 AUTONOMOUS CONTROLLER: Attempt limit reached — sleeping until reset');
        this.enterIdleState();
        return;
      }

      // Update execution block
      this.lastExecutionBlock = await provider.getBlockNumber();

      // Run arbitrage engine in autonomous mode
      const result = await runArbitrage(this.paths, this.signer, this.flashloanContractAddress, true);

      if (result) {
        // Successful execution
        this.attemptsUsed24h++;
        this.lastSuccessfulTrade = Date.now();

        // Check for mode switching
        this.checkModeSwitching();

        console.log('✅ AUTONOMOUS CONTROLLER: Arbitrage executed successfully');
      } else {
        console.log('🟡 AUTONOMOUS CONTROLLER: No opportunities found');
      }

    } catch (error) {
      await monitoring.logCriticalError(error, 'arbitrage_scan');
    }

    // Return to idle state
    this.enterIdleState();
  }

  /**
   * Check if we can execute another attempt
   */
  canExecuteAttempt() {
    // Reset attempts if 24h passed
    if (Date.now() > this.attemptResetTime) {
      this.attemptsUsed24h = 0;
      this.attemptResetTime = Date.now() + 24 * 60 * 60 * 1000;
      console.log('🔄 AUTONOMOUS CONTROLLER: Attempt counter reset (24h)');
    }

    return this.attemptsUsed24h < this.maxAttemptsPer24h;
  }

  /**
   * Check for automatic mode switching
   */
  checkModeSwitching() {
    const now = Date.now();

    // Switch to NORMAL mode after 2 successful EXTREME trades
    if (this.currentMode === 'EXTREME' && this.extremeTradesExecuted >= 2) {
      this.switchToNormalMode('2 successful EXTREME trades executed');
      return;
    }

    // Switch to NORMAL mode after 24h with no extreme opportunities
    if (this.currentMode === 'EXTREME' && (now - this.extremeModeStartTime) > this.extremeModeTimeout) {
      this.switchToNormalMode('24h timeout with no EXTREME opportunities');
      return;
    }
  }

  /**
   * Switch to NORMAL mode
   */
  async switchToNormalMode(reason) {
    const fromMode = this.currentMode;
    this.currentMode = 'NORMAL';

    // Reset EXTREME mode counters
    this.extremeTradesExecuted = 0;
    this.extremeModeStartTime = Date.now();

    // Log mode transition
    await monitoring.logModeTransition(fromMode, 'NORMAL', reason);

    // In NORMAL mode, the bot still uses flashloans but with more conservative settings
    // The arbitrage engine will handle the mode-specific logic
  }

  /**
   * Enter idle state
   */
  enterIdleState() {
    if (!this.isRunning) return;

    console.log('🟡 AUTONOMOUS CONTROLLER: Entering idle state — waiting for on-chain trigger');

    // Set idle timeout (optional safety)
    this.idleTimeout = setTimeout(() => {
      console.log('⏰ AUTONOMOUS CONTROLLER: Idle timeout — checking for opportunities');
      this.triggerExecution('idle_timeout');
    }, 30 * 60 * 1000); // 30 minutes
  }

  /**
   * Start the main event loop
   */
  startEventLoop() {
    // The event loop is handled by blockchain event listeners
    // This method ensures the process stays alive
    setInterval(() => {
      // Keep-alive check
      if (!this.isRunning) return;

      // Periodic health check
      this.healthCheck();
    }, 60 * 1000); // Every minute
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      // Check provider connection
      await provider.getBlockNumber();

      // Check wallet balance
      const balance = await provider.getBalance(this.signer.address);
      const balanceEth = Number(ethers.formatEther(balance));

      if (balanceEth < 0.001) { // Less than 0.001 BNB
        console.warn('⚠️ AUTONOMOUS CONTROLLER: Low wallet balance detected');
      }

    } catch (error) {
      console.error('❌ AUTONOMOUS CONTROLLER: Health check failed:', error.message);
      // Attempt self-healing
      this.attemptSelfHealing();
    }
  }

  /**
   * Attempt self-healing after errors
   */
  async attemptSelfHealing() {
    console.log('🔧 AUTONOMOUS CONTROLLER: Attempting self-healing...');

    try {
      // Reinitialize event listeners
      this.clearEventListeners();
      await this.setupEventListeners();

      // Reset state
      this.lastExecutionBlock = await provider.getBlockNumber();

      console.log('✅ AUTONOMOUS CONTROLLER: Self-healing successful');
    } catch (error) {
      console.error('❌ AUTONOMOUS CONTROLLER: Self-healing failed:', error.message);
      // Continue running despite healing failure
    }
  }

  /**
   * Validate wallet safety invariants
   */
  async validateWalletSafety() {
    const balance = await provider.getBalance(this.signer.address);
    const balanceEth = Number(ethers.formatEther(balance));

    if (balanceEth < 0.001) { // Less than 0.001 BNB (~$0.57) - minimum for gas
      throw new Error('Wallet balance too low for safe operation');
    }

    console.log('✅ AUTONOMOUS CONTROLLER: Wallet safety validated');
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      currentMode: this.currentMode,
      attemptsUsed24h: this.attemptsUsed24h,
      maxAttemptsPer24h: this.maxAttemptsPer24h,
      lastExecutionBlock: this.lastExecutionBlock,
      runOnceEveryNBlocks: this.runOnceEveryNBlocks,
      automationMode: this.automationMode,
      lastSuccessfulTrade: new Date(this.lastSuccessfulTrade).toISOString(),
      attemptResetTime: new Date(this.attemptResetTime).toISOString()
    };
  }
}

// Export singleton instance
export const autonomousController = new AutonomousController();