// bot/UnifiedStrategyManager.js
const ArbitrageBot = require('./ArbitrageBot');

class UnifiedStrategyManager {
  constructor(options = {}) {
    this.rpcUrls = options.rpcUrls || (process.env.RPC_URLS ? process.env.RPC_URLS.split(',') : [process.env.RPC_URL].filter(Boolean));
    this.walletAddress = options.walletAddress || process.env.WALLET_ADDRESS;
    this.privateKey = options.privateKey || process.env.PRIVATE_KEY;
    this.strategies = []; // will hold strategy instances
  }

  async initialize() {
    try {
      // Build strategy instances from config or hard-coded list
      // Example: Load strategy configs from a config file if exists
      const strategyConfigs = require('../config/strategies').list || []; // adjust to your structure
      for (const sConf of strategyConfigs) {
        try {
          const bot = new ArbitrageBot({
            rpcUrls: this.rpcUrls,
            walletAddress: this.walletAddress,
            privateKey: this.privateKey,
            dexModules: sConf.dexModules,
            minProfitUsd: sConf.minProfitUsd
          });
          this.strategies.push({ config: sConf, bot });
        } catch (err) {
          console.error(`Failed to initialize strategy ${sConf.name || sConf.id}:`, err.message || err);
          // continue with other strategies
        }
      }

      // If no strategies loaded, throw to indicate misconfiguration
      if (this.strategies.length === 0) {
        throw new Error('No strategies initialized. Check config/strategies and RPC/WALLET env.');
      }

      console.log(`Initialized ${this.strategies.length} strategies.`);
      return true;
    } catch (err) {
      console.error('UnifiedStrategyManager initialize error:', err);
      throw err;
    }
  }

  async startAll() {
    // Start scanning loops for each strategy
    // Each strategy runs independently to avoid one crashing all
    for (const s of this.strategies) {
      this._startStrategyLoop(s).catch(err => {
        console.error(`Strategy ${s.config.name} loop error:`, err);
      });
    }
  }

  async _startStrategyLoop({ config, bot }) {
    const pair = config.pair;
    const pollIntervalMs = config.pollIntervalMs || 1000;
    while (true) {
      try {
        const scanResults = await bot.scanDexes(pair);
        // apply your opportunity detection logic here; simplified check:
        const opportunities = detectOpportunities(scanResults, config);
        for (const opp of opportunities) {
          // translate opportunity into execution path expected by bot.attemptArbitrageExecution
          await bot.attemptArbitrageExecution(opp.path);
        }
      } catch (err) {
        console.error(`Error in strategy loop ${config.name}:`, err);
        // On error, continue loop after a short backoff
        await new Promise(res => setTimeout(res, 1000));
      }
      await new Promise(res => setTimeout(res, pollIntervalMs));
    }
  }
}

/**
 * Very small example detector. Replace with your logic.
 */
function detectOpportunities(scanResults, config) {
  // YOUR logic: compare prices across scanResults to find price diverge > threshold
  // Return objects like { path: { estimatedProfitNative: X, ... } }
  // Placeholder: return empty
  return [];
}

module.exports = UnifiedStrategyManager;
