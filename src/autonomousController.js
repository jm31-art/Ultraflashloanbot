/**
 * AUTONOMOUS RUNTIME CONTROLLER
 * Daemon-like operation for VOLATILE/EXTREME MODE arbitrage bot
 * Runs 24/7 without user interaction, event-driven execution
 */

import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { provider } from './dex/routers.js';

// Get the actual provider instance
const getProvider = () => provider();
import { generateTriangularPaths } from './arbitrage/pathGenerator.js';
import { runArbitrage } from './arbitrage/arbitrageEngine.js';
import { VOLATILE_MODE } from './arbitrage/volatileModeConfig.js';
import { monitoring } from './monitoring.js';
import privateExecutionProvider from '../utils/PrivateExecutionProvider.js';
import bundleBuilder from '../utils/BundleBuilder.js';
import mevOpportunityComposer from '../utils/MEVOpportunityComposer.js';
import privateGasStrategy from '../utils/PrivateGasStrategy.js';

class AutonomousController extends EventEmitter {
  constructor() {
    super();

    // Runtime state
    this.isRunning = false;
    this.automationMode = true; // Always enabled for autonomous operation
    this.currentMode = 'EXTREME'; // Start in EXTREME mode for bootstrapping
    this.lastExecutionBlock = 0;
    this.runOnceEveryNBlocks = 1; // Default, will be randomized

    // Bootstrapping configuration for low-balance operation - FORCE EXTREME MODE
    this.bootstrapMode = true;
    this.bootstrapTradesCompleted = 0;
    this.bootstrapTargetTrades = 2;
    this.forceExtremeMode = true; // Force extreme mode until bootstrap complete
    console.log('🔥 AUTONOMOUS CONTROLLER: FORCE STARTING IN EXTREME MODE (bootstrap)');
    console.log('🎯 Target: Execute 2 micro-arb trades ($0.50+ profit) to recoup gas');
    console.log('🚀 Will use flashloans for amplified profits when available');

    // Attempt management (24h lifecycle)
    this.attemptsUsed24h = 0;
    this.maxAttemptsPer24h = 2;
    this.attemptResetTime = Date.now() + 24 * 60 * 60 * 1000; // 24 hours from now
    this.lastSuccessfulTrade = Date.now();

    // Event tracking
    this.eventListeners = new Map();
    this.idleTimeout = null;

    // EXECUTION LOCK OPTIMIZATION: Replace boolean with state enum
    this.executionState = 'IDLE'; // IDLE | SIMULATING | EXECUTING
    this.pendingTriggers = []; // Queue for coalescing triggers during simulation

    // Event debouncing and throttling
    this.lastBlockProcessed = 0;
    this.minBlocksBetweenScans = 1; // Minimum 1 block between scans
    this.eventCooldownMs = 5000; // 5 second cooldown between events
    this.lastEventTime = 0;
    this.pendingExecution = false;

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
      getProvider().on('block', (blockNumber) => {
        this.handleBlockEvent(blockNumber);
      });

      // Listen for pending transactions (large swaps)
      getProvider().on('pending', (tx) => {
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
      getProvider().removeAllListeners('block');
      getProvider().removeAllListeners('pending');
    } catch (error) {
      console.error('❌ Error clearing event listeners:', error);
    }
  }

  /**
   * Handle new block events with debouncing
   */
  async handleBlockEvent(blockNumber) {
    // Block throttling: ensure minimum blocks between scans
    if (blockNumber - this.lastBlockProcessed < this.minBlocksBetweenScans) {
      return;
    }

    // Event debouncing: prevent rapid-fire triggers
    const now = Date.now();
    if (now - this.lastEventTime < this.eventCooldownMs) {
      return;
    }

    // Check if we should run based on block interval
    if (blockNumber - this.lastExecutionBlock >= this.runOnceEveryNBlocks) {
      this.triggerExecution('block', blockNumber);
    }
  }

  /**
   * Handle pending transactions (look for large swaps)
   */
  async handlePendingTransaction(txHash) {
    try {
      const tx = await getProvider().getTransaction(txHash);
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
   * Trigger execution based on event with state-based locking
   */
  triggerExecution(reason, blockNumber = null) {
    if (!this.isRunning) return;

    // EXECUTION LOCK OPTIMIZATION: State-based locking
    if (this.executionState === 'EXECUTING') {
      console.log(`⚠️ AUTONOMOUS CONTROLLER: Execution in progress, skipping ${reason} trigger`);
      return;
    }

    // Update block tracking
    if (blockNumber) {
      this.lastBlockProcessed = blockNumber;
    }

    // Clear idle timeout
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }

    // Update event timing
    this.lastEventTime = Date.now();

    // Randomize block interval for next run
    this.runOnceEveryNBlocks = Math.floor(Math.random() * 3) + 1; // 1-3 blocks

    console.log(`🎯 AUTONOMOUS CONTROLLER: Triggered by ${reason} event`);

    // EXECUTION LOCK OPTIMIZATION: Allow coalescing during simulation
    if (this.executionState === 'SIMULATING') {
      // Queue trigger for after current simulation completes
      this.pendingTriggers.push({ reason, blockNumber });
      console.log(`📋 AUTONOMOUS CONTROLLER: Queued ${reason} trigger (simulation in progress)`);
      return;
    }

    // Execute immediately
    this._executeWithStateLock(reason);
  }

  /**
   * Execute with state-based locking
   * @private
   */
  async _executeWithStateLock(reason) {
    try {
      this.executionState = 'SIMULATING';
      await this.executeArbitrageScan();
    } finally {
      this.executionState = 'IDLE';

      // Process any queued triggers
      if (this.pendingTriggers.length > 0) {
        const nextTrigger = this.pendingTriggers.shift();
        console.log(`🔄 AUTONOMOUS CONTROLLER: Processing queued trigger: ${nextTrigger.reason}`);
        setImmediate(() => this.triggerExecution(nextTrigger.reason, nextTrigger.blockNumber));
      }
    }
  }

  /**
   * Execute arbitrage scan with MEV routing logic
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
      this.lastExecutionBlock = await getProvider().getBlockNumber();

      // Get arbitrage opportunities
      const arbOpportunities = await this._scanForArbitrageOpportunities();

      // Get liquidation opportunities
      const liqOpportunities = await this._scanForLiquidationOpportunities();

      // Evaluate combined MEV opportunities
      const mevResult = await this._evaluateAndExecuteMEV(arbOpportunities, liqOpportunities);

      if (mevResult) {
        // MEV execution successful
        this.attemptsUsed24h++;
        this.lastSuccessfulTrade = Date.now();
        this.checkModeSwitching();
        console.log('✅ AUTONOMOUS CONTROLLER: MEV executed successfully');
      } else {
        // Fallback to individual arbitrage execution
        const result = await runArbitrage(this.paths, this.signer, this.flashloanContractAddress, true);

        if (result) {
          this.attemptsUsed24h++;
          this.lastSuccessfulTrade = Date.now();
          this.checkModeSwitching();
          console.log('✅ AUTONOMOUS CONTROLLER: Arbitrage executed successfully');
        } else {
          console.log('🟡 AUTONOMOUS CONTROLLER: No opportunities found');
        }
      }

    } catch (error) {
      await monitoring.logCriticalError(error, 'arbitrage_scan');
    }

    // Return to idle state
    this.enterIdleState();
  }

  /**
   * Scan for arbitrage opportunities
   * @private
   */
  async _scanForArbitrageOpportunities() {
    try {
      // This would integrate with the arbitrage engine to get opportunities
      // For now, return empty array - will be implemented when arbitrage engine is updated
      return [];
    } catch (error) {
      console.warn('⚠️ Arbitrage opportunity scan failed:', error.message);
      return [];
    }
  }

  /**
   * Scan for liquidation opportunities
   * @private
   */
  async _scanForLiquidationOpportunities() {
    try {
      // This would integrate with the liquidation bot to get opportunities
      // For now, return empty array - will be implemented when liquidation bot is updated
      return [];
    } catch (error) {
      console.warn('⚠️ Liquidation opportunity scan failed:', error.message);
      return [];
    }
  }

  /**
   * Evaluate and execute MEV opportunities
   * @private
   */
  async _evaluateAndExecuteMEV(arbOpportunities, liqOpportunities) {
    try {
      // Find best arbitrage opportunity
      const bestArb = arbOpportunities.length > 0 ? arbOpportunities[0] : null;

      // Find best liquidation opportunity
      const bestLiq = liqOpportunities.length > 0 ? liqOpportunities[0] : null;

      if (!bestArb && !bestLiq) {
        return null; // No opportunities
      }

      // Evaluate combined opportunity
      const composition = await mevOpportunityComposer.evaluateCombinedOpportunity(bestArb, bestLiq, privateGasStrategy);

      if (!composition.shouldCompose) {
        monitoring.logSkippedPath('mev_not_profitable', {
          reason: composition.reason,
          arbProfit: bestArb?.expectedProfitUSD || 0,
          liqProfit: bestLiq?.expectedProfitUSD || 0
        });
        return null;
      }

      console.log(`🎯 ATOMIC MEV OPPORTUNITY: Combined profit $${composition.combinedProfit.toFixed(2)}`);

      // Create execution plan
      const executionPlan = mevOpportunityComposer.createExecutionPlan(composition);
      if (!executionPlan) {
        return null;
      }

      // Calculate gas parameters
      const gasParams = await privateGasStrategy.calculateGasParameters({
        bundleValueUSD: composition.combinedProfit,
        profitMarginUSD: composition.combinedProfit,
        isHighPriority: true
      });

      // Create and execute bundle
      const bundleResult = await bundleBuilder.buildAndSubmitBundle({
        transactions: [], // Will be populated by bundle builder
        flashloanContract: this.flashloanContractAddress,
        signer: this.signer,
        opportunity: {
          type: 'mev_bundle',
          expectedProfit: composition.combinedProfit,
          path: bestArb?.path || 'MEV_COMBO',
          id: `mev_${Date.now()}`
        }
      });

      return bundleResult;

    } catch (error) {
      console.error('❌ MEV evaluation failed:', error.message);
      monitoring.logCriticalError(error, 'mev_evaluation');
      return null;
    }
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
      await getProvider().getBlockNumber();

      // Check wallet balance
      const balance = await getProvider().getBalance(this.signer.address);
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
      this.lastExecutionBlock = await getProvider().getBlockNumber();

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
    const balance = await getProvider().getBalance(this.signer.address);
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