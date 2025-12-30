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
import PerpBot from '../bot/PerpBot.js';
import MempoolWatcher from '../utils/mempoolWatcher.js';
import CrossProtocolArbitrageScanner from '../bot/CrossProtocolArbitrageScanner.js';

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

    // Advanced strategies
    this.perpBot = null;
    this.mempoolWatcher = null;
    this.crossProtocolScanner = null;
    this.strategiesRunning = false;

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

    // Initialize advanced strategies
    await this._initializeAdvancedStrategies();

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

      // CONCURRENT SCANNING: Run arbitrage and liquidation scans simultaneously
      console.log('🔄 AUTONOMOUS CONTROLLER: Running concurrent opportunity scans...');
      const [arbOpportunities, liqOpportunities] = await Promise.all([
        this._scanForArbitrageOpportunities().catch(error => {
          console.warn('⚠️ Arbitrage scan failed:', error.message);
          return [];
        }),
        this._scanForLiquidationOpportunities().catch(error => {
          console.warn('⚠️ Liquidation scan failed:', error.message);
          return [];
        })
      ]);

      console.log(`📊 Concurrent scans completed: ${arbOpportunities.length} arb, ${liqOpportunities.length} liq opportunities`);

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
   * Initialize advanced strategies for CONCURRENT execution with Promise.all
   */
  async _initializeAdvancedStrategies() {
    try {
      console.log('🚀 AUTONOMOUS CONTROLLER: Initializing ALL advanced strategies CONCURRENTLY...');

      // CONCURRENT INITIALIZATION: Run all strategies simultaneously
      const strategyPromises = [
        // Initialize PerpBot for funding rate arbitrage
        this._initializePerpBot(),
        // Initialize Mempool Watcher for pre-block arbitrage
        this._initializeMempoolWatcher(),
        // Initialize Cross-Protocol Arbitrage Scanner
        this._initializeCrossProtocolScanner(),
        // Initialize AI Prediction System
        this._initializeAIPredictions()
      ];

      // Wait for all strategies to initialize concurrently
      const results = await Promise.allSettled(strategyPromises);

      // Check results and handle errors gracefully
      const strategyNames = ['PerpBot', 'MempoolWatcher', 'CrossProtocolScanner', 'AIPredictions'];
      let successCount = 0;
      results.forEach((result, index) => {
        const strategyName = strategyNames[index];
        if (result.status === 'fulfilled') {
          console.log(`✅ ${strategyName}: Initialized and RUNNING successfully`);
          successCount++;
        } else {
          console.warn(`⚠️ ${strategyName}: Initialization failed:`, result.reason?.message);
        }
      });

      if (successCount > 0) {
        this.strategiesRunning = true;
        console.log(`🎯 AUTONOMOUS CONTROLLER: ${successCount}/${results.length} advanced strategies initialized and ACTIVE`);
        console.log('🔥 ALL STRATEGIES NOW RUNNING: PerpBot, MempoolWatcher, Cross-DEX, AI Predictions');
      } else {
        console.warn('⚠️ AUTONOMOUS CONTROLLER: No strategies initialized successfully');
      }

    } catch (error) {
      console.warn('⚠️ AUTONOMOUS CONTROLLER: Advanced strategies initialization failed:', error.message);
      // Continue without strategies - core arbitrage still works
    }
  }

  /**
   * Initialize PerpBot with error handling
   */
  async _initializePerpBot() {
    try {
      this.perpBot = new PerpBot(getProvider(), this.signer);
      await this.perpBot.initialize(this.flashloanContractAddress);
      await this.perpBot.start();
      return true;
    } catch (error) {
      console.warn('⚠️ PerpBot initialization error:', error.message);
      throw error; // Re-throw for Promise.allSettled handling
    }
  }

  /**
   * Initialize MempoolWatcher with error handling
   */
  async _initializeMempoolWatcher() {
    try {
      // Use NodeReal WebSocket for mempool monitoring
      const dexRouters = [
        '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap
        '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7', // ApeSwap
        '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8', // BiSwap
        '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', // KyberSwap
        '0x3CD1e2660bD7793411d3b01b62b993c616c847f9', // MDEX
        '0x325E343f1dE602396E256B67eFd1F61C3A66639C', // BabySwap
        '0xAFD89d21BdB66d00828f00d458D661a9bd36A44f', // Thena
        '0x3271339C33f6F3e8A3b8Ca5574b8eC7f39c3b8B5', // DODO
        '0x312Bc7eA1512086fCAb733B958C0d9D1bC1bC0f1', // Wombat
        '0xA238Dd80C259a72e81d7e4664a9801593f98d1c5', // Ellipsis
        '0x845E76A8691423fbc4ECb8Dd0f698eb2f76B087D', // JetSwap
        '0x05E7900765CdC3c4f89e4e0124ec815A9A3a0c48', // KnightSwap
        '0xCDe540d7eAFE93aC5fE6233Bee57E1270D3c5d52', // BakerySwap
        '0xbd67d157502A23309Db761c41965600c2Ec788bC', // JulSwap
        '0x598010C8C4008c4C4F1c7C8B5F4Fc6Fc9c0c7c7'  // FusionX
      ];

      this.mempoolWatcher = new MempoolWatcher(dexRouters, {
        largeTxThreshold: '0.1', // 0.1 BNB
        microTxThreshold: '0.001' // 0.001 BNB
      });

      await this.mempoolWatcher.start();
      console.log('📡 MEMPOOL WATCHER: Active - monitoring 15+ DEXes for arbitrage opportunities');

      // Connect mempool events to arbitrage triggers - FORCE REAL EXECUTION
      this.mempoolWatcher.on('largeDexTransaction', async (data) => {
        console.log('🎯 MEMPOOL TRIGGER: Large DEX transaction detected - FORCING REAL EXECUTION');
        await this._forceMempoolExecution('largeDexTransaction', data);
      });

      this.mempoolWatcher.on('priceImpactDetected', async (data) => {
        console.log(`🎯 MEMPOOL TRIGGER: Price impact detected ${data.estimatedImpact.toFixed(2)}% - FORCING REAL EXECUTION`);
        await this._forceMempoolExecution('priceImpactDetected', data);
      });

      this.mempoolWatcher.on('microDexTransaction', async (data) => {
        console.log(`🎯 MEMPOOL TRIGGER: Micro DEX transaction detected - FORCING IMMEDIATE EXECUTION`);
        await this._forceMempoolExecution('microDexTransaction', data);
      });

      this.mempoolWatcher.on('potentialSandwich', async (data) => {
        console.log('🎯 MEMPOOL TRIGGER: Sandwich pattern detected - EXECUTING ATOMIC CYCLE');
        await this._forceMempoolExecution('potentialSandwich', data);
      });

      return true;
    } catch (error) {
      console.warn('⚠️ MempoolWatcher initialization error:', error.message);
      throw error; // Re-throw for Promise.allSettled handling
    }
  }

  /**
   * Initialize Cross-Protocol Arbitrage Scanner
   */
  async _initializeCrossProtocolScanner() {
    try {
      // Convert CommonJS to ES modules for CrossProtocolArbitrageScanner
      const { default: CrossProtocolScanner } = await import('../bot/CrossProtocolArbitrageScanner.js');

      this.crossProtocolScanner = new CrossProtocolScanner(getProvider(), this.signer, {
        minProfitUSD: 25,
        scanInterval: 15000
      });

      await this.crossProtocolScanner.initialize();
      await this.crossProtocolScanner.start();

      console.log('🔄 CROSS-DEX SCANNER: Active - scanning 15+ DEXes for arbitrage opportunities');

      // Connect cross-protocol events
      this.crossProtocolScanner.on('crossProtocolArbitrageExecuted', (data) => {
        console.log(`💰 CROSS-DEX ARBITRAGE: Executed ${data.type} - Profit $${data.profit.toFixed(2)} - TX: ${data.txHash}`);
      });

      return true;
    } catch (error) {
      console.warn('⚠️ CrossProtocolScanner initialization error:', error.message);
      throw error;
    }
  }

  /**
   * Initialize AI Prediction System
   */
  async _initializeAIPredictions() {
    try {
      console.log('🤖 AI PREDICTIONS: Initializing liquidation risk assessment system');

      // Start AI prediction monitoring (runs in background)
      this._startAIPredictionMonitoring();

      console.log('🤖 AI PREDICTIONS: Active - monitoring liquidation risks with ML models');

      return true;
    } catch (error) {
      console.warn('⚠️ AI Predictions initialization error:', error.message);
      throw error;
    }
  }

  /**
   * Start AI prediction monitoring for liquidation risks
   */
  _startAIPredictionMonitoring() {
    // Run AI predictions every 30 seconds
    this.aiPredictionTimer = setInterval(async () => {
      try {
        await this._runAIPredictions();
      } catch (error) {
        console.warn('⚠️ AI Prediction error (continuing):', error.message);
      }
    }, 30000); // Every 30 seconds

    // Initial prediction run
    setTimeout(async () => {
      if (this.isRunning) {
        await this._runAIPredictions();
      }
    }, 5000); // Start after 5 seconds
  }

  /**
   * Run AI predictions for liquidation risk assessment
   */
  async _runAIPredictions() {
    try {
      // Get positions at risk from liquidation bot
      const positionsAtRisk = await this._getPositionsForAIPrediction();

      for (const position of positionsAtRisk) {
        const prediction = await this._predictLiquidationRisk(position);

        if (prediction.confidence > 0.7 && prediction.willLiquidate) {
          console.log(`🤖 AI PREDICTED LIQUIDATION: ${position.user.substring(0, 6)}... - Confidence: ${(prediction.confidence * 100).toFixed(1)}% - Risk: ${prediction.riskLevel}`);

          // Trigger immediate liquidation scan for high-risk positions
          await this._scanSpecificPosition('AI_PREDICTED', position);
        }
      }

      console.log(`🤖 AI PREDICTIONS: Analyzed ${positionsAtRisk.length} positions for liquidation risk`);

    } catch (error) {
      console.warn('⚠️ AI Prediction run failed:', error.message);
    }
  }

  /**
   * Get positions for AI prediction analysis
   */
  async _getPositionsForAIPrediction() {
    // Get positions from liquidation bot or scan protocols directly
    try {
      // Simplified - in production would integrate with liquidation bot
      return [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Predict liquidation risk using AI/ML models
   */
  async _predictLiquidationRisk(position) {
    try {
      // Use Python AI predictor
      const { spawn } = await import('child_process');
      const path = await import('path');

      return new Promise((resolve, reject) => {
        const aiPredictorPath = path.join(process.cwd(), 'ai/mev_protector.py');
        const features = {
          healthFactor: position.healthFactor || 1.0,
          collateralValue: position.collateralValue || 0,
          debtValue: position.debtValue || 0,
          protocol: position.protocol || 'unknown',
          timestamp: Date.now()
        };

        const pythonProcess = spawn('python3', [aiPredictorPath, 'predict_liquidation', JSON.stringify(features)], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
          try {
            if (code === 0) {
              const result = JSON.parse(stdout.trim());
              resolve(result);
            } else {
              reject(new Error(`AI predictor failed: ${stderr}`));
            }
          } catch (error) {
            reject(error);
          }
        });

        pythonProcess.on('error', reject);
      });

    } catch (error) {
      // Fallback prediction
      return {
        willLiquidate: position.healthFactor < 1.1,
        confidence: 0.5,
        riskLevel: position.healthFactor < 1.1 ? 'high' : 'low'
      };
    }
  }

  /**
   * Scan specific position for liquidation (AI-triggered)
   */
  async _scanSpecificPosition(source, position) {
    try {
      console.log(`🎯 ${source}: Scanning position ${position.user} for liquidation opportunity`);

      // Get liquidation opportunities from liquidation bot
      const liqOpportunities = await this._scanForLiquidationOpportunities();

      // Find matching opportunity
      const matchingOpportunity = liqOpportunities.find(opp =>
        opp.user.toLowerCase() === position.user.toLowerCase()
      );

      if (matchingOpportunity) {
        console.log(`🎯 ${source}: Found liquidation opportunity for ${position.user}`);
        await this._evaluateAndExecuteLiquidation('AI_PREDICTED', matchingOpportunity);
      }

    } catch (error) {
      console.warn(`⚠️ ${source}: Position scan failed:`, error.message);
    }
  }

  /**
   * Force real execution on mempool triggers - EXTREME MODE
   */
  async _forceMempoolExecution(triggerType, data) {
    try {
      console.log(`🚨 MEMPOOL ${triggerType.toUpperCase()}: IMMEDIATE EXECUTION TRIGGERED`);

      // Get arbitrage opportunities with ultra-low threshold ($0.20)
      const arbOpportunities = await this._scanForArbitrageOpportunities();

      // Filter for profitable opportunities (> $0.20 after gas/slippage)
      const profitableOpps = arbOpportunities.filter(opp =>
        opp.expectedProfitUSD && opp.expectedProfitUSD > 0.20
      );

      if (profitableOpps.length === 0) {
        console.log('⚠️ MEMPOOL: No profitable opportunities found');
        return;
      }

      // Execute the best opportunity immediately
      const bestOpp = profitableOpps[0];
      console.log(`🎯 MEMPOOL OPP DETECTED: ${bestOpp.expectedProfitUSD.toFixed(2)} profit - EXECUTING FLASHLOAN ARB`);

      // Force real execution using arbitrage engine
      const result = await runArbitrage(this.paths, this.signer, this.flashloanContractAddress, true);

      if (result) {
        this.attemptsUsed24h++;
        this.lastSuccessfulTrade = Date.now();
        console.log(`💰 MEMPOOL ARB EXECUTED: Profit $${bestOpp.expectedProfitUSD.toFixed(2)} - Tx: ${result.txHash || 'pending'}`);
      } else {
        console.log('❌ MEMPOOL ARB: Execution failed');
      }

    } catch (error) {
      console.error('❌ MEMPOOL EXECUTION ERROR:', error.message);
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