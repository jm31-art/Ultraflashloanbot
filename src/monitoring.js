/**
 * MONITORING & ALERTING SYSTEM
 * Real-time notifications and safety logging for autonomous arbitrage bot
 */

import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

class MonitoringSystem {
  constructor() {
    this.heartbeatInterval = 30 * 1000; // 30 seconds
    this.heartbeatTimer = null;
    this.dailyStats = {
      profitableTrades: 0,
      totalProfit: 0,
      heartbeats: 0,
      skippedPaths: 0,
      lastReset: Date.now()
    };

    // Telegram configuration
    this.telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    this.telegramChatId = process.env.TELEGRAM_CHAT_ID;
    this.telegramEnabled = !!(this.telegramToken && this.telegramChatId);

    // Log files
    this.logDir = path.join(process.cwd(), 'logs');
    this.ensureLogDirectory();

    // Safety tracking
    this.safetyViolations = new Map();
    this.lastHeartbeat = Date.now();

    // LOGGING SANITY: Per-block deduplication and throttling
    this.logCache = new Map(); // message -> last logged timestamp
    this.LOG_TTL_MS = 12000; // ~3 blocks TTL for deduplication
    this.blockLogCache = new Map(); // blockNumber -> Set of logged messages
    this.currentBlockNumber = 0;
    this.skipSummaryCache = new Map(); // skipReason -> count this block
    this.logCooldownMs = 30000; // 30 seconds between identical logs
    this.rateLimitCache = new Map(); // message type -> count in window
    this.rateLimitWindowMs = 60000; // 1 minute window
    this.rateLimitMaxPerWindow = 5; // Max 5 identical logs per minute
    this.lastRateLimitReset = Date.now();
    this.debugMode = process.env.DEBUG === 'true';
  }

  /**
   * Ensure log directory exists
   */
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Start monitoring system
   */
  start() {
    console.log('📊 MONITORING SYSTEM: Starting...');

    // Start heartbeat
    this.startHeartbeat();

    // Setup daily reset
    this.setupDailyReset();

    console.log('📊 MONITORING SYSTEM: Active');
    console.log(`📊 Telegram notifications: ${this.telegramEnabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Stop monitoring system
   */
  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    console.log('📊 MONITORING SYSTEM: Stopped');
  }

  /**
   * Start heartbeat monitoring with deduplication
   */
  startHeartbeat() {
    this.heartbeatTimer = setInterval(async () => {
      try {
        const currentBlock = await this.getCurrentBlock();
        const nextBlock = currentBlock + 3; // Next check in 3 blocks
        const timestamp = new Date().toISOString();

        const heartbeatMsg = `⏱ VOLATILE MODE: Alive | Last check: ${timestamp} | Next scan: block #${nextBlock}`;

        // Check deduplication for heartbeat (allow more frequent than other logs)
        if (!this._shouldDeduplicateLog(heartbeatMsg, 'heartbeat')) {
          // Log to terminal
          console.log(heartbeatMsg);

          // Send to Telegram (optional, low priority)
          if (this.telegramEnabled && Math.random() < 0.1) { // 10% chance to avoid spam
            await this.sendTelegramMessage(`🤖 ${heartbeatMsg}`);
          }
        }

        // Always append to heartbeat log (for historical tracking)
        this.appendToLog('heartbeat.log', `${timestamp}: ${heartbeatMsg}\n`);

        this.dailyStats.heartbeats++;
        this.lastHeartbeat = Date.now();

      } catch (error) {
        // Deduplicate error logs too
        const errorMsg = `❌ Heartbeat failed: ${error.message}`;
        if (!this._shouldDeduplicateLog(errorMsg, 'heartbeat_error')) {
          console.error(errorMsg);
        }
      }
    }, this.heartbeatInterval);
  }

  /**
   * Log profitable trade found
   */
  async logTradeFound(details) {
    const { path, flashloanSize, estimatedProfit, mode } = details;

    const tradeMsg = `
🔥 VOLATILE ARBITRAGE FOUND
Mode: ${mode}
Path: ${path.join(' → ')}
Flashloan: $${flashloanSize}
Estimated Profit: $${estimatedProfit}
`.trim();

    console.log(tradeMsg);

    // Send critical alert to Telegram
    if (this.telegramEnabled) {
      await this.sendTelegramMessage(tradeMsg);
    }

    // Log to trades file
    const timestamp = new Date().toISOString();
    this.appendToLog('trades.log', `${timestamp}: ${tradeMsg.replace(/\n/g, ' | ')}\n`);
  }

  /**
   * Log trade executed successfully
   */
  async logTradeExecuted(details) {
    const { txHash, netProfit, mode } = details;

    const executedMsg = `
✅ ${mode === 'MEV_BUNDLE' ? 'MEV BUNDLE' : 'VOLATILE ARBITRAGE'} EXECUTED
Mode: ${mode}
Net Profit: $${netProfit}
TX Hash: ${txHash}
`.trim();

    console.log(executedMsg);

    // Send success alert to Telegram
    if (this.telegramEnabled) {
      await this.sendTelegramMessage(executedMsg);
    }

    // Update daily stats
    this.dailyStats.profitableTrades++;
    this.dailyStats.totalProfit += parseFloat(netProfit);

    // Log to trades file
    const timestamp = new Date().toISOString();
    this.appendToLog('trades.log', `${timestamp}: EXECUTED - ${executedMsg.replace(/\n/g, ' | ')}\n`);

    // MEV-specific logging
    if (mode === 'MEV_BUNDLE') {
      this.appendToLog('mev_bundles.log', `${timestamp}: BUNDLE_EXECUTED - Hash: ${txHash} - Profit: $${netProfit}\n`);
    }
  }

  /**
   * Check if log should be deduplicated (per-block suppression)
   * @private
   */
  async _shouldDeduplicateLog(message, messageType = 'general') {
    const now = Date.now();

    // Get current block number
    try {
      const currentBlock = await this.getCurrentBlock();
      if (currentBlock !== this.currentBlockNumber) {
        // New block - reset caches and log summaries
        this._logBlockSummaries();
        this.blockLogCache.clear();
        this.skipSummaryCache.clear();
        this.currentBlockNumber = currentBlock;
      }
    } catch (error) {
      // Fallback to time-based if block check fails
    }

    // Reset rate limit window if needed
    if (now - this.lastRateLimitReset > this.rateLimitWindowMs) {
      this.rateLimitCache.clear();
      this.lastRateLimitReset = now;
    }

    // Check rate limit for message type
    const currentCount = this.rateLimitCache.get(messageType) || 0;
    if (currentCount >= this.rateLimitMaxPerWindow) {
      return true; // Rate limited
    }

    // Check per-block deduplication
    const blockMessages = this.blockLogCache.get(this.currentBlockNumber) || new Set();
    if (blockMessages.has(message)) {
      // Count skips for summary
      if (messageType === 'skip') {
        const skipCount = this.skipSummaryCache.get(message) || 0;
        this.skipSummaryCache.set(message, skipCount + 1);
      }
      return true; // Already logged this block
    }

    // Check global deduplication cooldown with TTL (for non-skip messages)
    if (messageType !== 'skip') {
      const lastLogged = this.logCache.get(message);
      if (lastLogged) {
        const timeSinceLastLog = now - lastLogged;
        if (timeSinceLastLog < this.logCooldownMs) {
          return true; // Deduplicated - within cooldown
        }
        // TTL expired, allow logging again
        if (timeSinceLastLog > this.LOG_TTL_MS) {
          this.logCache.delete(message); // Clean up expired entries
        }
      }
      this.logCache.set(message, now);
    }

    // Update counters
    this.rateLimitCache.set(messageType, currentCount + 1);
    blockMessages.add(message);
    this.blockLogCache.set(this.currentBlockNumber, blockMessages);

    return false; // Allow log
  }

  /**
   * Log block summaries for skipped paths
   * @private
   */
  _logBlockSummaries() {
    if (this.skipSummaryCache.size === 0) return;

    const summaries = [];
    for (const [reason, count] of this.skipSummaryCache) {
      if (count > 1) {
        summaries.push(`⏭ Skipped ${count} paths this block (${reason})`);
      }
    }

    if (summaries.length > 0) {
      console.log(`📊 Block ${this.currentBlockNumber} Summary:`);
      summaries.forEach(summary => console.log(`   ${summary}`));
    }
  }

  /**
   * Log skipped path with safety reason (per-block deduplication)
   */
  async logSkippedPath(reason, details = {}) {
    const { maxSlippage, flashloanSize, profit } = details;

    const skipMsg = `⚠️ Path skipped: reason=${reason} | MaxSlippage=${maxSlippage || 'N/A'} | FlashloanSize=$${flashloanSize || 'N/A'} | Profit=$${profit || 'N/A'}`;

    // Check per-block deduplication for skipped paths
    if (await this._shouldDeduplicateLog(skipMsg, 'skip')) {
      // Still track in daily stats even if not logged
      this.dailyStats.skippedPaths++;
      return;
    }

    // PRE-AGGREGATION SUPPRESSION: Never log individual skip messages to terminal
    // Only block summaries are shown (enforced in _logBlockSummaries)
    // Individual logs go to file only for analysis

    // Always log to file for analysis
    const timestamp = new Date().toISOString();
    this.appendToLog('skippedPaths.log', `${timestamp}: ${skipMsg}\n`);

    // Track safety violations for monitoring
    const violationCount = this.safetyViolations.get(reason) || 0;
    this.safetyViolations.set(reason, violationCount + 1);

    this.dailyStats.skippedPaths++;
  }

  /**
   * Log real opportunity found (structured reporting)
   */
  async logOpportunityFound(opportunity) {
    const {
      type, // 'arbitrage' | 'liquidation' | 'mev_bundle'
      path, // Token path or position details
      flashloanSize, // Flashloan amount in USD
      expectedProfit, // Expected profit in USD
      executionMode, // 'private' | 'public'
      additionalData = {}
    } = opportunity;

    const opportunityMsg = `
💰 OPPORTUNITY FOUND
Type: ${type.toUpperCase()}
Path/Position: ${Array.isArray(path) ? path.join(' → ') : path}
Flashloan: $${flashloanSize?.toFixed(2) || 'N/A'}
Expected Profit: $${expectedProfit?.toFixed(2) || 'N/A'} (after gas & fees)
Execution: ${executionMode?.toUpperCase() || 'UNKNOWN'}
${Object.entries(additionalData).map(([key, value]) => `${key}: ${value}`).join('\n')}
`.trim();

    // Always log real opportunities to terminal (high priority)
    console.log(opportunityMsg);

    // Send to Telegram if enabled
    if (this.telegramEnabled) {
      await this.sendTelegramMessage(`💰 ${type.toUpperCase()} OPPORTUNITY: $${expectedProfit?.toFixed(2)} profit`);
    }

    // Log to opportunities file
    const timestamp = new Date().toISOString();
    this.appendToLog('opportunities.log', `${timestamp}: ${opportunityMsg.replace(/\n/g, ' | ')}\n`);

    // Track opportunity metrics
    this.dailyStats.opportunitiesFound++;
    if (type === 'arbitrage') {
      this.dailyStats.arbitrageOpportunities++;
    } else if (type === 'liquidation') {
      this.dailyStats.liquidationOpportunities++;
    } else if (type === 'mev_bundle') {
      this.dailyStats.mevOpportunities++;
    }
  }

  /**
   * Log mode transition
   */
  async logModeTransition(fromMode, toMode, reason) {
    const transitionMsg = `🔄 Mode switch: ${fromMode} → ${toMode} | Reason: ${reason} | Timestamp: ${new Date().toISOString()}`;

    console.log(transitionMsg);

    // Send mode change alert to Telegram
    if (this.telegramEnabled) {
      await this.sendTelegramMessage(`🔄 ${transitionMsg}`);
    }

    // Log to mode changes file
    this.appendToLog('modeChanges.log', `${new Date().toISOString()}: ${transitionMsg}\n`);
  }

  /**
   * Log MEV bundle simulation
   */
  logMEVBundleSimulated(details) {
    const { bundleId, simulationTime, success, profitEstimate } = details;

    const simMsg = `🔬 MEV BUNDLE SIMULATED: ${bundleId} | Success: ${success} | Profit: $${profitEstimate} | Time: ${simulationTime}ms`;

    if (!this._shouldDeduplicateLog(simMsg, 'mev_simulation')) {
      console.log(simMsg);
    }

    this.appendToLog('mev_simulation.log', `${new Date().toISOString()}: ${simMsg}\n`);
  }

  /**
   * Log MEV bundle submitted
   */
  async logMEVBundleSubmitted(details) {
    const { bundleId, bundleHash, relay, profitEstimate } = details;

    const submitMsg = `📤 MEV BUNDLE SUBMITTED: ${bundleId} | Hash: ${bundleHash} | Relay: ${relay} | Profit: $${profitEstimate}`;

    console.log(submitMsg);

    if (this.telegramEnabled) {
      await this.sendTelegramMessage(`📤 ${submitMsg}`);
    }

    this.appendToLog('mev_submissions.log', `${new Date().toISOString()}: ${submitMsg}\n`);
  }

  /**
   * Log MEV bundle included in block
   */
  async logMEVBundleIncluded(details) {
    const { bundleId, bundleHash, blockNumber, profitActual, executionTime } = details;

    const includeMsg = `✅ MEV BUNDLE INCLUDED: ${bundleId} | Hash: ${bundleHash} | Block: ${blockNumber} | Profit: $${profitActual} | Time: ${executionTime}ms`;

    console.log(includeMsg);

    if (this.telegramEnabled) {
      await this.sendTelegramMessage(`✅ ${includeMsg}`);
    }

    this.appendToLog('mev_inclusions.log', `${new Date().toISOString()}: ${includeMsg}\n`);
  }

  /**
   * Log MEV bundle rejected
   */
  logMEVBundleRejected(details) {
    const { bundleId, reason, relay } = details;

    const rejectMsg = `❌ MEV BUNDLE REJECTED: ${bundleId} | Reason: ${reason} | Relay: ${relay}`;

    console.log(rejectMsg);

    this.appendToLog('mev_rejections.log', `${new Date().toISOString()}: ${rejectMsg}\n`);
  }

  /**
   * Log atomic MEV executed
   */
  async logAtomicMEVExecuted(details) {
    const { arbitrageProfit, liquidationProfit, totalProfit, executionTime } = details;

    const atomicMsg = `🎯 ATOMIC MEV EXECUTED: Arb: $${arbitrageProfit} | Liq: $${liquidationProfit} | Total: $${totalProfit} | Time: ${executionTime}ms`;

    console.log(atomicMsg);

    if (this.telegramEnabled) {
      await this.sendTelegramMessage(`🎯 ${atomicMsg}`);
    }

    this.appendToLog('atomic_mev.log', `${new Date().toISOString()}: ${atomicMsg}\n`);
  }

  /**
   * Log atomic MEV skipped
   */
  logAtomicMEVSkipped(details) {
    const { reason, individualProfit, combinedProfit } = details;

    const skipMsg = `⚠️ ATOMIC MEV SKIPPED: ${reason} | Individual: $${individualProfit} | Combined: $${combinedProfit}`;

    if (!this._shouldDeduplicateLog(skipMsg, 'atomic_skip')) {
      console.log(skipMsg);
    }

    this.appendToLog('atomic_mev_skips.log', `${new Date().toISOString()}: ${skipMsg}\n`);
  }

  /**
   * Log critical error
   */
  async logCriticalError(error, context = '') {
    const errorMsg = `🚨 CRITICAL ERROR: ${error.message} ${context ? `| Context: ${context}` : ''}`;

    console.error(errorMsg);

    // Send critical error alert to Telegram
    if (this.telegramEnabled) {
      await this.sendTelegramMessage(`🚨 ${errorMsg}`);
    }

    // Log to errors file
    const timestamp = new Date().toISOString();
    this.appendToLog('errors.log', `${timestamp}: ${errorMsg} | Stack: ${error.stack}\n`);
  }

  /**
   * Send Telegram message
   */
  async sendTelegramMessage(message) {
    if (!this.telegramEnabled) return;

    try {
      const url = `https://api.telegram.org/bot${this.telegramToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: this.telegramChatId,
          text: message,
          parse_mode: 'Markdown'
        })
      });

      if (!response.ok) {
        console.warn('⚠️ Telegram message failed:', response.status);
      }
    } catch (error) {
      console.warn('⚠️ Telegram send failed:', error.message);
    }
  }

  /**
   * Setup daily reset at UTC midnight
   */
  setupDailyReset() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0); // Next UTC midnight

    const timeUntilMidnight = midnight.getTime() - now.getTime();

    setTimeout(() => {
      this.performDailyReset();
      // Repeat every 24 hours
      setInterval(this.performDailyReset.bind(this), 24 * 60 * 60 * 1000);
    }, timeUntilMidnight);
  }

  /**
   * Perform daily statistics reset and summary
   */
  async performDailyReset() {
    const summaryMsg = `
📝 DAILY SUMMARY
Total profitable trades: ${this.dailyStats.profitableTrades}
Total profit: $${this.dailyStats.totalProfit.toFixed(2)}
Heartbeats: ${this.dailyStats.heartbeats}
Skipped paths: ${this.dailyStats.skippedPaths}
Safety violations: ${JSON.stringify(Object.fromEntries(this.safetyViolations))}
    `.trim();

    console.log(summaryMsg);

    // Send daily summary to Telegram
    if (this.telegramEnabled) {
      await this.sendTelegramMessage(summaryMsg);
    }

    // Log to daily summary file
    const date = new Date().toISOString().split('T')[0];
    this.appendToLog(`daily_${date}.log`, `${new Date().toISOString()}: ${summaryMsg.replace(/\n/g, ' | ')}\n`);

    // Reset daily stats
    this.dailyStats = {
      profitableTrades: 0,
      totalProfit: 0,
      heartbeats: 0,
      skippedPaths: 0,
      lastReset: Date.now()
    };

    this.safetyViolations.clear();
  }

  /**
   * Append to log file
   */
  appendToLog(filename, content) {
    try {
      const logPath = path.join(this.logDir, filename);
      fs.appendFileSync(logPath, content);
    } catch (error) {
      console.error(`❌ Failed to write to ${filename}:`, error.message);
    }
  }

  /**
   * Get current block number
   */
  async getCurrentBlock() {
    try {
      // Import provider dynamically to avoid circular dependency
      const { provider } = await import('./dex/routers.js');
      return await provider.getBlockNumber();
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    return {
      telegramEnabled: this.telegramEnabled,
      lastHeartbeat: new Date(this.lastHeartbeat).toISOString(),
      dailyStats: this.dailyStats,
      safetyViolations: Object.fromEntries(this.safetyViolations)
    };
  }
}

// Export singleton instance
export const monitoring = new MonitoringSystem();