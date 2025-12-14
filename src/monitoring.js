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
   * Start heartbeat monitoring
   */
  startHeartbeat() {
    this.heartbeatTimer = setInterval(async () => {
      try {
        const currentBlock = await this.getCurrentBlock();
        const nextBlock = currentBlock + 3; // Next check in 3 blocks
        const timestamp = new Date().toISOString();

        const heartbeatMsg = `⏱ VOLATILE MODE: Alive | Last check: ${timestamp} | Next scan: block #${nextBlock}`;

        // Log to terminal
        console.log(heartbeatMsg);

        // Append to heartbeat log
        this.appendToLog('heartbeat.log', `${timestamp}: ${heartbeatMsg}\n`);

        // Send to Telegram (optional, low priority)
        if (this.telegramEnabled && Math.random() < 0.1) { // 10% chance to avoid spam
          await this.sendTelegramMessage(`🤖 ${heartbeatMsg}`);
        }

        this.dailyStats.heartbeats++;
        this.lastHeartbeat = Date.now();

      } catch (error) {
        console.error('❌ Heartbeat failed:', error.message);
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
✅ VOLATILE ARBITRAGE EXECUTED
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
  }

  /**
   * Log skipped path with safety reason
   */
  logSkippedPath(reason, details = {}) {
    const { maxSlippage, flashloanSize, profit } = details;

    const skipMsg = `⚠️ Path skipped: reason=${reason} | MaxSlippage=${maxSlippage || 'N/A'} | FlashloanSize=$${flashloanSize || 'N/A'} | Profit=$${profit || 'N/A'}`;

    // Only log to file, not terminal (to avoid spam)
    const timestamp = new Date().toISOString();
    this.appendToLog('skippedPaths.log', `${timestamp}: ${skipMsg}\n`);

    // Track safety violations for monitoring
    const violationCount = this.safetyViolations.get(reason) || 0;
    this.safetyViolations.set(reason, violationCount + 1);

    this.dailyStats.skippedPaths++;
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