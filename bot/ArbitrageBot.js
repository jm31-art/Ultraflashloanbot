// bot/ArbitrageBot.js
const ethers = require('ethers');

class ArbitrageBot {
  /**
   * config = {
   *   rpcUrls: ['https://rpc1', 'https://rpc2'],
   *   walletAddress: '0x..',
   *   privateKey: '0x..',
   *   dexModules: [{name, moduleInstance}, ...],
   *   minProfitUsd: 1.0
   * }
   */
  constructor(config = {}) {
    // ensure dotenv already loaded by run_live_trading.js, but fall back if not
    if (!process.env || !process.env.RPC_URL) {
      // not fatal here but try to read RPC_URLS
      // we won't throw here; instead rely on config or fallbacks below
    }

    this.rpcUrls = config.rpcUrls && config.rpcUrls.length ? config.rpcUrls : (process.env.RPC_URLS ? process.env.RPC_URLS.split(',') : [process.env.RPC_URL].filter(Boolean));
    this.walletAddress = config.walletAddress || process.env.WALLET_ADDRESS || process.env.WALLET;
    this.privateKey = config.privateKey || process.env.PRIVATE_KEY;
    this.dexModules = config.dexModules || []; // expects objects with getPrice/estimateGas/executeSwap
    this.minProfitUsd = config.minProfitUsd || Number(process.env.MIN_PROFIT_USD) || 0.5;

    if (!this.rpcUrls || this.rpcUrls.length === 0) {
      throw new Error('No RPC URLs provided (RPC_URL or RPC_URLS env required)');
    }

    if (!this.walletAddress) {
      console.warn('Warning: WALLET address not set. Profits may not be routed.');
    }

    // create initial provider wrapper
    this.providerWrapper = this._createRobustProvider(this.rpcUrls);
    // create a signer if privateKey present
    if (this.privateKey) {
      this.signer = new ethers.Wallet(this.privateKey, this.providerWrapper.provider);
    } else if (this.walletAddress) {
      // read-only mode: no signer
      this.signer = null;
    }

    // Defaults
    this.maxRpcRetries = 3;
    this.rpcRetryDelayMs = 700;
  }

  /**
   * Create a provider wrapper that:
   * - tries multiple RPCs in order
   * - returns { provider, call, getBlockNumber, sendTransaction } bound safely
   */
  _createRobustProvider(rpcUrls = []) {
    if (!Array.isArray(rpcUrls) || rpcUrls.length === 0) {
      throw new Error('_createRobustProvider requires an array of rpcUrls');
    }

    // keep the original provider object to allow re-binding on failures
    const createProvider = (url) => new ethers.providers.JsonRpcProvider(url);

    let provider = null;
    let activeUrl = rpcUrls[0];

    // try to create a provider synchronously from first available URL
    for (let url of rpcUrls) {
      try {
        const p = createProvider(url);
        // quick readiness check (non-blocking): we don't await here, but we can test presence
        if (p && typeof p.getBlockNumber === 'function') {
          provider = p;
          activeUrl = url;
          break;
        }
      } catch (err) {
        // continue to next rpc
        continue;
      }
    }

    if (!provider) {
      // fallback to first URL to let errors surface later but with clear message
      provider = createProvider(rpcUrls[0]);
      activeUrl = rpcUrls[0];
    }

    // Bind the methods we will use — but guard in case provider not fully formed
    const safeBind = (obj, fnName) => {
      if (!obj || typeof obj[fnName] !== 'function') {
        // return a safe function that throws with a friendly message
        return () => { throw new Error(`Provider method ${fnName} is not available on active RPC (${activeUrl})`); };
      }
      return obj[fnName].bind(obj);
    };

    return {
      provider,
      activeUrl,
      call: safeBind(provider, 'call'),
      getBlockNumber: safeBind(provider, 'getBlockNumber'),
      getGasPrice: safeBind(provider, 'getGasPrice'),
      fetchBalance: async (address) => {
        if (!provider) throw new Error('Provider not available');
        return provider.getBalance(address);
      },
      // helper to allow re-pointing provider at runtime
      switchProvider: async (newUrl) => {
        try {
          const newP = createProvider(newUrl);
          // simple test to detect obvious bad url
          if (!newP || typeof newP.getBlockNumber !== 'function') throw new Error('bad provider');
          provider = newP;
          activeUrl = newUrl;
          return { provider, activeUrl };
        } catch (err) {
          throw err;
        }
      }
    };
  }

  /**
   * Parallel DEX scanning for pair quotes.
   * dexModules is array of { name, getPrice(...), other helpers }
   * Returns array of results with { dexName, price, liquidity, extra }
   */
  async scanDexes(pair) {
    // Kick off parallel price fetches
    const calls = this.dexModules.map(async (d) => {
      try {
        const result = await d.getPrice(pair);
        return { dex: d.name || d.id || 'unknown', ok: true, result };
      } catch (err) {
        return { dex: d.name || d.id || 'unknown', ok: false, error: err.message || String(err) };
      }
    });

    const results = await Promise.all(calls);
    return results;
  }

  /**
   * Attempt to execute arbitrage.
   * Must check:
   *  - gas estimate (estimateGas)
   *  - current gas price
   *  - profit after fees
   *  - slippage tolerances
   */
  async attemptArbitrageExecution(path) {
    // path should contain steps like [{dex, route, amountIn, expectedOut}, ...]
    // Simplified: calculate estimated profit, get gas estimate, compare
    try {
      const estimates = await Promise.all(path.map(async step => {
        const dex = this._findDexByName(step.dex);
        if (!dex || !dex.estimateGas) throw new Error(`Missing dex or estimateGas for ${step.dex}`);
        const gasEst = await dex.estimateGas(step);
        return { dex: step.dex, gas: gasEst };
      }));

      // total gas units
      const totalGasUnits = estimates.reduce((s, e) => s + (Number(e.gas) || 0), 0);
      const gasPrice = await this.providerWrapper.provider.getGasPrice();
      const gasCostNative = gasPrice.mul(ethers.BigNumber.from(Math.max(1, Math.floor(totalGasUnits)))); // BigNumber * units
      // convert gasCostNative to a decimal string in native units
      const gasCostEth = Number(ethers.utils.formatEther(gasCostNative));

      // expected profit in native token (simplified — expects path.estimatedProfitNative to exist)
      const expectedProfitNative = path.estimatedProfitNative || 0;
      // convert to USD or compare to threshold: for now, compare to minProfitUsd using a price oracle if available
      // naive: if expectedProfitNative (in ETH) isn't convertible here, require a minimum absolute native profit
      const expectedProfitFloat = Number(expectedProfitNative);

      console.log(`Estimated gas cost (native): ${gasCostEth}, expected profit (native): ${expectedProfitFloat}`);

      if (expectedProfitFloat <= 0) {
        console.log('Not profitable in expected output.');
        return false;
      }

      // crude check: ensure expected profit > gasCost * safety factor
      const safetyFactor = 1.2;
      if (expectedProfitFloat <= gasCostEth * safetyFactor) {
        console.log('Profit would not survive gas cost + safety factor; skipping.');
        return false;
      }

      // Prepare transactions (with dynamic slippage)
      for (let step of path) {
        const dex = this._findDexByName(step.dex);
        const slippage = step.slippage ?? 0.5; // default to 0.5% slippage
        // Build tx
        step.tx = await dex.buildSwapTx({
          amountIn: step.amountIn,
          minOutPct: 1 - (slippage / 100),
          route: step.route,
          from: this.walletAddress
        });
      }

      // execute step(s) — attempt to bundle or sequentially send with signer
      if (!this.signer) throw new Error('No signer configured; cannot execute trades in live mode.');

      // optional: send as single (atomic) flashloan contract call if available, here simplified sequential
      for (let step of path) {
        console.log(`Executing swap on ${step.dex} with tx:`, step.tx);
        const txResp = await this.signer.sendTransaction(step.tx);
        const receipt = await txResp.wait(1);
        console.log(`Swap on ${step.dex} confirmed in tx ${receipt.transactionHash}`);
      }

      // After successful exec, optionally send profits to main wallet (if using smart contract, this will differ)
      if (this.walletAddress && this.signer && this.signer.address && this.signer.address.toLowerCase() !== this.walletAddress.toLowerCase()) {
        // if signer is not main wallet, send native balance residual to main wallet
        const balance = await this.providerWrapper.fetchBalance(this.signer.address);
        const balanceFloat = Number(ethers.utils.formatEther(balance));
        if (balanceFloat > 0.001) { // avoid dust transfers
          const tx = {
            to: this.walletAddress,
            value: balance.sub(ethers.utils.parseEther('0.0005')) // keep tiny buffer for gas
          };
          const txResp = await this.signer.sendTransaction(tx);
          await txResp.wait(1);
          console.log('Profit sent to wallet:', this.walletAddress);
        }
      }

      return true;

    } catch (err) {
      console.error('Error attempting arbitrage execution:', err);
      return false;
    }
  }

  _findDexByName(name) {
    return this.dexModules.find(d => (d.name || d.id || '').toLowerCase() === (name || '').toLowerCase());
  }
}

module.exports = ArbitrageBot;
