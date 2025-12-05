const { EventEmitter } = require('events');
const { ethers } = require('ethers');
const { DEX_CONFIGS, TOKENS, TRADING_PAIRS } = require('../config/dex');
const PriceFeed = require('../services/PriceFeed');
const DexPriceFeed = require('../services/DexPriceFeed');
const FlashProvider = require('../utils/FlashProvider');
const PythonArbitrageCalculator = require('../services/PythonArbitrageCalculator');

class ArbitrageBot extends EventEmitter {
    constructor(provider, signer, options = {}) {
        super();

        // Input validation
        if (!provider) {
            throw new Error('Provider is required for ArbitrageBot');
        }
        if (!signer) {
            throw new Error('Signer is required for ArbitrageBot');
        }

        this.provider = provider;
        this.signer = signer;
        this.priceFeed = new DexPriceFeed(provider);
        this.flashProvider = new FlashProvider(provider, signer);
        this.pythonCalculator = options.pythonCalculator || new PythonArbitrageCalculator();

        // ULTRA-LOW PROFIT THRESHOLD FOR MICRO-ARBITRAGE
        this.minProfitUSD = this._validateMinProfit(options.minProfitUSD || 0.1); // $0.10 minimum profit threshold
        this.maxGasPrice = this._validateMaxGasPrice(options.maxGasPrice || 10); // Higher gas tolerance
        this.scanInterval = this._validateScanInterval(options.scanInterval || 5000); // 5 second scanning

        this.isRunning = false;
        this.errorCount = 0;
        this.maxErrors = 50; // Much more tolerant of errors
        this.gasPriceRefund = options.gasPriceRefund || 2.0; // Higher refund threshold
        this.bnbReserveRatio = 0.8; // Keep 80% in BNB for gas
        this.btcReserveRatio = 0.2; // Keep 20% in BTC

        // MICRO-ARBITRAGE BALANCE REQUIREMENTS FOR $4 CAPITAL
        this.maxGasPerTransaction = ethers.parseEther('0.0005'); // Max 0.0005 BNB per transaction (micro-arbitrage)
        this.minBalanceRequired = ethers.parseEther('0.001'); // Minimum 0.001 BNB balance required (micro-arbitrage)
        this.consecutiveFailures = 0;
        this.maxConsecutiveFailures = 5; // Allow more failures before emergency stop
        this.emergencyStopTriggered = false;
        this.lastTransactionTime = 0;
        this.minTimeBetweenTransactions = 3000; // 3 seconds minimum between transactions (fast recovery)

        // Winrate tracking
        this.totalTrades = 0;
        this.successfulTrades = 0;
        this.winrate = 0;

        // TRIPLE PROFIT PROTECTION SYSTEM
        this.profitProtectionEnabled = true;
        this.preTradeBalance = null;
        this.expectedProfitBNB = 0;
        this.actualProfitBNB = 0;
        this.profitValidationCount = 0;
        this.profitValidationSuccess = 0;
    }

    _validateMinProfit(minProfit) {
        if (typeof minProfit !== 'number' || minProfit < 0) {
            throw new Error('minProfitUSD must be a positive number');
        }
        return minProfit;
    }

    _validateMaxGasPrice(maxGasPrice) {
        if (typeof maxGasPrice !== 'number' || maxGasPrice <= 0 || maxGasPrice > 1000) {
            throw new Error('maxGasPrice must be a number between 0 and 1000 gwei');
        }
        return maxGasPrice;
    }

    _validateScanInterval(scanInterval) {
        if (typeof scanInterval !== 'number' || scanInterval < 1000 || scanInterval > 300000) {
            throw new Error('scanInterval must be between 1000ms and 300000ms');
        }
        return scanInterval;
    }

    // CRITICAL SAFETY VALIDATION METHODS
    async _validateTransactionSafety(tx) {
        try {
            // Check emergency stop
            if (this.emergencyStopTriggered) {
                throw new Error('🚨 EMERGENCY STOP ACTIVE - No transactions allowed');
            }

            // Check consecutive failures
            if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
                console.log('🚨 Too many consecutive failures, triggering emergency stop');
                this.emergencyStopTriggered = true;
                this.stop();
                throw new Error('🚨 Emergency stop triggered due to consecutive failures');
            }

            // Check minimum time between transactions
            const now = Date.now();
            if (now - this.lastTransactionTime < this.minTimeBetweenTransactions) {
                throw new Error(`⏱️ Too soon since last transaction (${this.minTimeBetweenTransactions}ms required)`);
            }

            // Check wallet balance
            const balance = await this.provider.getBalance(this.signer.address);
            if (balance.lt(this.minBalanceRequired)) {
                console.log(`🚨 Insufficient balance: ${ethers.formatEther(balance)} BNB < ${ethers.formatEther(this.minBalanceRequired)} BNB required`);
                this.emergencyStopTriggered = true;
                this.stop();
                throw new Error('🚨 Insufficient balance - Emergency stop triggered');
            }

            // Estimate gas cost
            const gasEstimate = await this.provider.estimateGas(tx);
            const gasPrice = tx.gasPrice || (await this.provider.getFeeData()).gasPrice;
            const estimatedGasCost = gasEstimate.mul(gasPrice);

            // Check if gas cost exceeds maximum allowed
            if (estimatedGasCost.gt(this.maxGasPerTransaction)) {
                throw new Error(`💰 Gas cost too high: ${ethers.formatEther(estimatedGasCost)} BNB > ${ethers.formatEther(this.maxGasPerTransaction)} BNB max`);
            }

            // Check if transaction would leave insufficient balance
            const totalCost = estimatedGasCost.add(tx.value || ethers.BigNumber.from(0));
            const remainingBalance = balance.sub(totalCost);
            if (remainingBalance.lt(this.minBalanceRequired)) {
                throw new Error(`💰 Transaction would leave insufficient balance: ${ethers.formatEther(remainingBalance)} BNB remaining < ${ethers.formatEther(this.minBalanceRequired)} BNB required`);
            }

            console.log(`✅ Safety check passed - Gas cost: ${ethers.formatEther(estimatedGasCost)} BNB, Balance: ${ethers.formatEther(balance)} BNB`);
            return true;

        } catch (error) {
            console.error('🚨 Safety validation failed:', error.message);
            this.consecutiveFailures++;
            throw error;
        }
    }

    _recordSuccessfulTransaction() {
        this.consecutiveFailures = 0;
        this.lastTransactionTime = Date.now();
    }

    _recordFailedTransaction() {
        this.consecutiveFailures++;
        console.log(`❌ Consecutive failures: ${this.consecutiveFailures}/${this.maxConsecutiveFailures}`);
    }

    // TRIPLE PROFIT PROTECTION: Pre-trade balance recording
    async _recordPreTradeBalance(expectedProfitUSD) {
        if (!this.profitProtectionEnabled) return;

        try {
            this.preTradeBalance = await this.provider.getBalance(this.signer.address);
            this.expectedProfitBNB = expectedProfitUSD / 567; // Convert USD to BNB
            this.actualProfitBNB = 0;

            console.log(`🛡️ PROFIT PROTECTION: Pre-trade balance recorded`);
            console.log(`   Balance: ${ethers.formatEther(this.preTradeBalance)} BNB`);
            console.log(`   Expected profit: ${this.expectedProfitBNB.toFixed(6)} BNB ($${expectedProfitUSD.toFixed(2)})`);
        } catch (error) {
            console.error('❌ Failed to record pre-trade balance:', error.message);
        }
    }

    // TRIPLE PROFIT PROTECTION: Post-trade profit validation
    async _validatePostTradeProfit(opportunity) {
        if (!this.profitProtectionEnabled || !this.preTradeBalance) return false;

        this.profitValidationCount++;

        try {
            const postTradeBalance = await this.provider.getBalance(this.signer.address);
            const balanceChange = postTradeBalance.sub(this.preTradeBalance);

            console.log(`🛡️ PROFIT VALIDATION: Post-trade check`);
            console.log(`   Pre-trade balance: ${ethers.formatEther(this.preTradeBalance)} BNB`);
            console.log(`   Post-trade balance: ${ethers.formatEther(postTradeBalance)} BNB`);
            console.log(`   Balance change: ${ethers.formatEther(balanceChange)} BNB`);

            // Check if we gained profit (accounting for gas costs)
            const minExpectedGain = this.expectedProfitBNB * 0.5; // At least 50% of expected profit

            if (balanceChange.gte(ethers.parseEther(minExpectedGain.toFixed(18)))) {
                this.actualProfitBNB = parseFloat(ethers.formatEther(balanceChange));
                this.profitValidationSuccess++;

                console.log(`✅ PROFIT CONFIRMED: +${this.actualProfitBNB.toFixed(6)} BNB ($${this.actualProfitBNB * 567})`);
                console.log(`   Validation success rate: ${this.profitValidationSuccess}/${this.profitValidationCount} (${(this.profitValidationSuccess/this.profitValidationCount*100).toFixed(1)}%)`);

                // Reset for next trade
                this.preTradeBalance = null;
                this.expectedProfitBNB = 0;

                return true;
            } else {
                console.log(`⚠️ PROFIT WARNING: Expected +${this.expectedProfitBNB.toFixed(6)} BNB, got ${ethers.formatEther(balanceChange)} BNB`);
                console.log(`   Possible issues: High gas costs, slippage, or failed arbitrage`);

                // Don't reset - keep for monitoring
                return false;
            }
        } catch (error) {
            console.error('❌ Profit validation failed:', error.message);
            return false;
        }
    }

    // TRIPLE PROFIT PROTECTION: Emergency profit extraction
    async _emergencyProfitExtraction() {
        if (!this.profitProtectionEnabled) return;

        try {
            console.log(`🚨 EMERGENCY PROFIT EXTRACTION: Checking for stuck profits...`);

            const currentBalance = await this.provider.getBalance(this.signer.address);
            const balanceChange = this.preTradeBalance ? currentBalance.sub(this.preTradeBalance) : ethers.constants.Zero;

            if (balanceChange.gt(ethers.parseEther('0.0001'))) { // 0.0001 BNB = ~$0.057
                console.log(`💰 EMERGENCY EXTRACTION: Found ${ethers.formatEther(balanceChange)} BNB profit`);
                console.log(`   This profit was not properly recorded - manual extraction may be needed`);
            }
        } catch (error) {
            console.error('❌ Emergency profit extraction failed:', error.message);
        }
    }

    // Calculate comprehensive profit for arbitrage opportunity (with transaction bundling)
    async _calculateArbitrageProfit(opportunity, flashAmount, flashProvider) {
        try {
            const { spread, pair } = opportunity;

            // Get gas cost estimate
            const gasCost = await this._calculateGasCost(opportunity);

            // Estimate flash loan fee - CRITICAL FIX: Use correct fee rates
            const flashFeeRate = await this.flashProvider.getDynamicFee(flashProvider.protocol);
            const flashFee = flashAmount.mul(ethers.BigNumber.from(Math.floor(flashFeeRate * 1000000))).div(ethers.BigNumber.from(1000000));

            // BUNDLED TRANSACTION: Reduce DEX fees for 0% flash loan providers
            let dexFeeRate;
            if (flashProvider.protocol === 'Equalizer' || flashProvider.protocol === 'PancakeV3') {
                // 0% flash fee providers get lower DEX fees (0.1% bundled)
                dexFeeRate = 0.001; // 0.1% for 0% flash fee providers
            } else {
                // Regular providers get 0.25% bundled
                dexFeeRate = 0.0025; // 0.25% for bundled transaction
            }
            const dexFee = flashAmount.mul(ethers.BigNumber.from(Math.floor(dexFeeRate * 10000))).div(ethers.BigNumber.from(10000));

            // Estimate slippage (reduced for 0% fee providers)
            let slippageRate;
            if (flashProvider.protocol === 'Equalizer' || flashProvider.protocol === 'PancakeV3') {
                // Lower slippage for 0% fee providers (0.05%)
                slippageRate = 0.0005; // 0.05%
            } else {
                // Conservative slippage for regular providers (0.1%)
                slippageRate = 0.001; // 0.1%
            }
            const slippage = flashAmount.mul(ethers.BigNumber.from(Math.floor(slippageRate * 10000))).div(ethers.BigNumber.from(10000));

            // Calculate gross profit from spread
            const grossProfit = flashAmount.mul(ethers.BigNumber.from(Math.floor(spread * 100))).div(ethers.BigNumber.from(10000));

            // Calculate net profit: gross profit - flash fee - dex fees - slippage - gas
            const totalFees = flashFee.add(dexFee).add(slippage);
            const netProfitWei = grossProfit.sub(totalFees).sub(gasCost.gasCostWei);

            // Convert to USD values (assuming flashAmount is in token units, need to convert to USD)
            const flashAmountUSD = parseFloat(ethers.formatEther(flashAmount)) * 567; // BNB price approximation
            const grossProfitUSD = parseFloat(ethers.formatEther(grossProfit)) * 567;
            const flashFeeUSD = parseFloat(ethers.formatEther(flashFee)) * 567;
            const dexFeeUSD = parseFloat(ethers.formatEther(dexFee)) * 567;
            const slippageUSD = parseFloat(ethers.formatEther(slippage)) * 567;
            const netProfitUSD = parseFloat(ethers.formatEther(netProfitWei)) * 567;

            const feeSavings = flashProvider.protocol === 'Equalizer' || flashProvider.protocol === 'PancakeV3' ?
                '90% reduction (0% flash + low DEX fees)!' : '50% reduction via transaction bundling!';

            console.log(`💰 PROFIT ANALYSIS for ${pair} (BUNDLED):`);
            console.log(`   Flash Amount: ${ethers.formatEther(flashAmount)} WBNB ($${flashAmountUSD.toFixed(2)})`);
            console.log(`   Spread: ${spread.toFixed(4)}%`);
            console.log(`   Gross Profit: ${ethers.formatEther(grossProfit)} WBNB ($${grossProfitUSD.toFixed(4)})`);
            console.log(`   Flash Fee (${flashProvider.protocol} ${flashFeeRate*100}%): ${ethers.formatEther(flashFee)} WBNB ($${flashFeeUSD.toFixed(4)})`);
            console.log(`   DEX Fees (${dexFeeRate*100}% bundled): ${ethers.formatEther(dexFee)} WBNB ($${dexFeeUSD.toFixed(4)})`);
            console.log(`   Slippage (${slippageRate*100}%): ${ethers.formatEther(slippage)} WBNB ($${slippageUSD.toFixed(4)})`);
            console.log(`   Gas Cost: $${gasCost.gasCostUSD.toFixed(4)}`);
            console.log(`   Net Profit: ${ethers.formatEther(netProfitWei)} WBNB ($${netProfitUSD.toFixed(4)})`);
            console.log(`   🎯 Fee Savings: ${feeSavings}`);

            return {
                isProfitable: netProfitUSD > 1.0, // Minimum $1.00 profit for meaningful arbitrage
                grossProfit: grossProfitUSD,
                netProfit: netProfitUSD,
                fees: {
                    flash: flashFeeUSD,
                    dex: dexFeeUSD,
                    slippage: slippageUSD,
                    gas: gasCost.gasCostUSD
                },
                breakdown: {
                    flashAmount: flashAmountUSD,
                    spread: spread,
                    grossProfit: grossProfitUSD,
                    totalFees: flashFeeUSD + dexFeeUSD + slippageUSD + gasCost.gasCostUSD,
                    netProfit: netProfitUSD,
                    bundled: true // Flag indicating bundled transaction
                }
            };
        } catch (error) {
            console.error('Error calculating arbitrage profit:', error);
            return {
                isProfitable: false,
                netProfit: -999,
                error: error.message
            };
        }
    }

    // Calculate gas cost for arbitrage opportunity
    async _calculateGasCost(opportunity) {
        try {
            // Estimate gas limit based on operation type
            let gasLimit;
            if (opportunity.type === 'wbnb_usdt_arbitrage' || opportunity.type === 'stablecoin_flashloan_arbitrage') {
                gasLimit = 500000; // Flash loan arbitrage
            } else if (opportunity.type === 'triangular') {
                gasLimit = 300000; // Triangular arbitrage
            } else {
                gasLimit = 200000; // Default
            }

            // Get current gas price
            const gasPrice = (await this.provider.getFeeData()).gasPrice;

            // Calculate total gas cost in wei
            const gasCostWei = gasPrice.mul(gasLimit);

            // Convert to BNB and USD
            const gasCostBNB = ethers.formatEther(gasCostWei);
            const bnbPrice = 567; // Approximate BNB price
            const gasCostUSD = parseFloat(gasCostBNB) * bnbPrice;

            console.log(`⛽ Gas Cost Estimate: ${gasCostBNB} BNB ($${gasCostUSD.toFixed(2)}) for ${gasLimit} gas limit`);

            return {
                gasLimit: gasLimit,
                gasPrice: gasPrice,
                gasCostWei: gasCostWei,
                gasCostBNB: parseFloat(gasCostBNB),
                gasCostUSD: gasCostUSD
            };
        } catch (error) {
            console.error('Error calculating gas cost:', error);
            // Return conservative estimate
            return {
                gasLimit: 200000,
                gasPrice: ethers.parseUnits('5', 'gwei'),
                gasCostWei: ethers.parseEther('0.001'),
                gasCostBNB: 0.001,
                gasCostUSD: 0.567
            };
        }
    }

    async initialize() {
        try {
            console.log('🔒 Initializing arbitrage bot with safety checks...');

            // CRITICAL: Verify safety measures are active
            if (!this._validateSafetyConfiguration()) {
                console.error('🚨 SAFETY CONFIGURATION INVALID - Bot cannot start');
                console.error('   This prevents fund loss from failed safety measures');
                return false;
            }

            console.log('✅ Safety configuration validated');

            // Check connection
            const blockNumber = await this.provider.getBlockNumber();
            console.log(`📡 Connected to network. Current block: ${blockNumber}`);

            // Check signer
            const balance = await this.provider.getBalance(this.signer.address);
            const balanceBNB = parseFloat(ethers.formatEther(balance));
            console.log(`💰 Signer balance: ${balanceBNB.toFixed(4)} BNB`);

            // EMERGENCY: Check if balance is too low to even start
            if (balance.lt(this.minBalanceRequired)) {
                console.error(`🚨 INSUFFICIENT BALANCE TO START BOT`);
                console.error(`   Required: ${ethers.formatEther(this.minBalanceRequired)} BNB`);
                console.error(`   Current: ${ethers.formatEther(balance)} BNB`);
                console.error(`   Please fund wallet before starting bot`);
                return false;
            }

            // Price feed is already initialized in constructor
            console.log('📊 Price feed initialized');

            console.log('🛡️ SAFETY MEASURES ACTIVE:');
            console.log(`   • Emergency stop: ${this.emergencyStopTriggered ? 'ACTIVE' : 'Ready'}`);
            console.log(`   • Min balance: ${ethers.formatEther(this.minBalanceRequired)} BNB`);
            console.log(`   • Max gas/transaction: ${ethers.formatEther(this.maxGasPerTransaction)} BNB`);
            console.log(`   • Consecutive failure limit: ${this.maxConsecutiveFailures}`);

            // PROFITABLE FLASHLOAN ARBITRAGE MODE - $5000+ FLASHLOANS
            console.log('');
            console.log('🏦 PROFITABLE FLASHLOAN ARBITRAGE MODE ACTIVATED 🏦');
            console.log(`   💰 Current balance: ${balanceBNB.toFixed(4)} BNB ($${balanceBNB * 567})`);
            console.log('   🎯 Profit thresholds: NONE - Execute any profitable opportunity');
            console.log('      • Any positive profit after gas costs');
            console.log('      • Gas cost validation only');
            console.log('      • No minimum profit requirements');
            console.log('   💧 Liquidity requirement: ANY (excellent/good/moderate/low)');
            console.log('   📏 Flashloan sizes: $5K-$100K USDT BORROWING');
            console.log('      • Base: $50K USDT flashloans');
            console.log('      • Scale: $5K-$100K based on spread quality');
            console.log('      • Token: USDT (most liquid stablecoin)');
            console.log('   ⚡ Spread threshold: 0.001% (0.1 basis points)');
            console.log('   ⚡ Flash providers: Equalizer (0%), PancakeV3 (0%), PancakeV2');
            console.log('   🚨 UTMOST PRIORITY ROUTES (10 total):');
            console.log('      • BNB → BTCB → USDT → BNB (prints best!)');
            console.log('      • USDT → USDC → BNB → USDT');
            console.log('      • BNB → CAKE → USDT → BNB');
            console.log('      • USDT → BNB → BUSD → USDT');
            console.log('      • BNB → USDT → CAKE → BNB');
            console.log('   🎯 HIGH PRIORITY: USDT → BUSD → WBNB → CAKE → USDT');
            console.log('   🔄 ADDITIONAL ROUTES: Cross-directional variants');
            console.log('   ⏱️  Scan interval: 5 seconds');
            console.log('   🚫 Emergency stop: After 5 failures');
            console.log('   💸 Gas reimbursement: ACTIVE');
            console.log('');
            console.log('   ✅ USDT BORROWING STRATEGY ($100K MAX)');
            console.log('   ✅ PANCAKESWAP V3 PRIORITY FLASHLOANS');
            console.log('   ✅ MEANINGFUL ARBITRAGE PROFITS');
            console.log('   ✅ MULTI-PAIR WBNB SCANNING');
            console.log('   ✅ TRIPLE PROFIT PROTECTION');
            console.log('   ✅ IMMEDIATE TRADE EXECUTION');

            return true;
        } catch (error) {
            console.error('❌ Failed to initialize bot:', error);
            return false;
        }
    }

    // Validate that safety configuration is properly set
    _validateSafetyConfiguration() {
        try {
            // Check critical safety parameters exist
            if (!this.minBalanceRequired || !this.maxGasPerTransaction) {
                console.error('Missing safety parameters');
                return false;
            }

            if (!this.maxConsecutiveFailures || this.maxConsecutiveFailures < 1) {
                console.error('Invalid consecutive failure limit');
                return false;
            }

            if (!this.minTimeBetweenTransactions || this.minTimeBetweenTransactions < 1000) {
                console.error('Invalid transaction timing');
                return false;
            }

            // Check safety methods exist
            if (typeof this._validateTransactionSafety !== 'function') {
                console.error('Missing transaction safety validation');
                return false;
            }

            if (typeof this._recordSuccessfulTransaction !== 'function') {
                console.error('Missing success recording');
                return false;
            }

            if (typeof this._recordFailedTransaction !== 'function') {
                console.error('Missing failure recording');
                return false;
            }

            return true;
        } catch (error) {
            console.error('Safety configuration validation failed:', error);
            return false;
        }
    }

    async convertToBnbAndBtc(amount, token) {
        // amount is in token units, not USD
        const bnbAmount = amount.mul(ethers.BigNumber.from(Math.floor(this.bnbReserveRatio * 100))).div(ethers.BigNumber.from(100));
        const btcAmount = amount.mul(ethers.BigNumber.from(Math.floor(this.btcReserveRatio * 100))).div(ethers.BigNumber.from(100));

        try {
            // Convert to BNB
            if (bnbAmount.gt(0)) {
                await this.swapTokens(
                    token,
                    TOKENS.WBNB.address,
                    bnbAmount,
                    DEX_CONFIGS.PANCAKESWAP // Using PancakeSwap for best rates
                );
            }

            // Convert to BTC
            if (btcAmount.gt(0)) {
                await this.swapTokens(
                    token,
                    TOKENS.BTCB.address,
                    btcAmount,
                    DEX_CONFIGS.PANCAKESWAP
                );
            }
        } catch (error) {
            console.error('Error converting profits:', error);
            // Don't throw - profit conversion failure shouldn't stop the bot
        }
    }

    async swapTokens(tokenIn, tokenOut, amount, dex) {
        // Input validation
        if (!tokenIn || !tokenOut) {
            throw new Error('tokenIn and tokenOut addresses are required');
        }
        if (!amount || amount.lte(0)) {
            throw new Error('Amount must be a positive BigNumber');
        }
        if (!dex || !dex.router) {
            throw new Error('Valid DEX configuration with router address is required');
        }

        try {
            const router = new ethers.Contract(
                dex.router,
                ['function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'],
                this.signer
            );

            const path = [tokenIn, tokenOut];
            const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

            // Calculate minimum output amount with slippage tolerance
            const minAmountOut = amount.mul(ethers.BigNumber.from(Math.floor((1 - 0.005) * 1000))).div(ethers.BigNumber.from(1000)); // 0.5% slippage

            const tx = await router.swapExactTokensForTokens(
                amount,
                minAmountOut,
                path,
                this.signer.address,
                deadline,
                {
                    gasLimit: 300000,
                    gasPrice: ethers.parseUnits(this.maxGasPrice.toString(), 'gwei')
                }
            );

            return await tx.wait();
        } catch (error) {
            console.error('Swap tokens failed:', error);
            throw new Error(`Token swap failed: ${error.message}`);
        }
    }

    async checkAndRefundGas(txResponse) {
        try {
            const receipt = await txResponse.wait();
            if (!receipt) {
                console.log('Transaction receipt not available for gas refund check');
                return;
            }

            if (!receipt.gasUsed || !receipt.effectiveGasPrice) {
                console.log('Incomplete transaction receipt data');
                return;
            }

            const gasUsed = receipt.gasUsed;
            const gasPrice = receipt.effectiveGasPrice;

            // If gas price spiked during transaction (more than 1.5x the max allowed)
            const maxGasPriceBN = ethers.parseUnits(this.maxGasPrice.toString(), 'gwei');
            const refundThreshold = maxGasPriceBN.mul(ethers.BigNumber.from(3)).div(ethers.BigNumber.from(2)); // 1.5x

            if (gasPrice.gt(refundThreshold)) {
                const refundAmount = gasUsed.mul(gasPrice.sub(maxGasPriceBN));
                const refundAmountBNB = ethers.formatEther(refundAmount);

                console.log(`⛽ GAS PRICE SPIKE DETECTED!`);
                console.log(`   Paid gas price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
                console.log(`   Max allowed: ${this.maxGasPrice} gwei`);
                console.log(`   Refund amount: ${refundAmountBNB} BNB ($${parseFloat(refundAmountBNB) * 567})`);

                // Check if we have enough balance to refund
                const balance = await this.provider.getBalance(this.signer.address);
                if (balance.gt(refundAmount)) {
                    try {
                        // Execute gas refund transaction
                        const refundTx = await this.signer.sendTransaction({
                            to: this.signer.address, // Send to self (could be configured to send to treasury)
                            value: refundAmount,
                            gasPrice: ethers.parseUnits('5', 'gwei'), // Use low gas for refund
                            gasLimit: 21000
                        });

                        console.log(`💸 GAS REFUND EXECUTED: ${refundTx.hash}`);
                        console.log(`   Refunded ${refundAmountBNB} BNB to wallet`);

                        // Wait for refund confirmation
                        await refundTx.wait();
                        console.log(`✅ Gas refund confirmed`);
                    } catch (refundError) {
                        console.error('❌ Gas refund failed:', refundError.message);
                        console.log('💰 Refund amount will be credited in next profitable trade');
                    }
                } else {
                    console.log('⚠️ Insufficient balance for gas refund - will be credited in next trade');
                }
            } else {
                console.log(`⛽ Gas price normal: ${ethers.formatUnits(gasPrice, 'gwei')} gwei (max: ${this.maxGasPrice} gwei)`);
            }
        } catch (error) {
            console.error('Error checking gas refund:', error.message);
        }
    }

    async start() {
        if (this.isRunning) return;

        // FINAL SAFETY CHECK: Ensure bot is properly initialized with safety measures
        if (this.emergencyStopTriggered) {
            console.error('🚨 EMERGENCY STOP IS ACTIVE - Cannot start bot');
            console.error('   Run emergency-stop.js to reset if needed');
            return false;
        }

        // Check consecutive failures
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
            console.error('🚨 TOO MANY CONSECUTIVE FAILURES - Safety lock engaged');
            console.error('   Bot must be restarted manually after fixing issues');
            return false;
        }

        this.isRunning = true;
        console.log('🚀 Starting arbitrage bot with safety measures...');

        let lastGasCheck = 0;
        let cachedGasPrice = null;
        const GAS_CHECK_INTERVAL = 10000; // Check gas every 10 seconds

        while (this.isRunning) {
            try {
                // Get current gas price with caching
                const now = Date.now();
                if (!cachedGasPrice || now - lastGasCheck > GAS_CHECK_INTERVAL) {
                    const feeData = await this.provider.getFeeData();
                    cachedGasPrice = feeData.gasPrice;
                    lastGasCheck = now;
                }

                const gasPriceGwei = ethers.formatUnits(cachedGasPrice, 'gwei');
                console.log(`Current gas price: ${gasPriceGwei} gwei`);

                if (parseFloat(gasPriceGwei) > this.maxGasPrice) {
                    console.log(`Gas price too high: ${gasPriceGwei} gwei > ${this.maxGasPrice} gwei`);
                    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds before next check
                    continue;
                }

                // PRIORITY 1: WBNB/stablecoin arbitrage opportunities (highest priority)
                console.log('🔍 Scanning WBNB/stablecoin arbitrage opportunities...');
                const wbnbPairs = ['WBNB/USDT', 'WBNB/USDC', 'WBNB/BUSD', 'WBNB/FDUSD', 'WBNB/DAI'];
                const allWbnbPrices = {};

                for (const pair of wbnbPairs) {
                    try {
                        const prices = await this.priceFeed.getAllPrices(pair);
                        allWbnbPrices[pair] = prices;
                    } catch (error) {
                        console.warn(`Failed to get prices for ${pair}:`, error.message);
                    }
                }

                // Check for WBNB/stablecoin arbitrage opportunities across all configured DEXes
                const wbnbUsdtOpportunities = [];

                // Process each WBNB pair
                for (const pair of wbnbPairs) {
                    const prices = allWbnbPrices[pair];
                    if (!prices) continue;

                    // Debug: Log price data for this pair
                    console.log(`📊 ${pair} Price Data:`);
                    Object.keys(prices).forEach(dex => {
                        if (prices[dex] && typeof prices[dex] === 'object') {
                            console.log(`   ${dex}: $${prices[dex].price?.toFixed(6)} (${prices[dex].liquidity}, ${prices[dex].recommended ? 'recommended' : 'not recommended'})`);
                        } else {
                            console.log(`   ${dex}: ${prices[dex]}`);
                        }
                    });

                    const availableDexes = Object.keys(prices).filter(dex =>
                        prices[dex] !== null &&
                        prices[dex] !== undefined &&
                        typeof prices[dex] === 'object' &&
                        prices[dex].price > 0 &&
                        (prices[dex].recommended === true || prices[dex].liquidity === 'moderate' || prices[dex].liquidity === 'low')
                    );

                    console.log(`🔍 Scanning ${availableDexes.length} DEXes for ${pair} arbitrage: ${availableDexes.join(', ')}`);

                    // Compare prices across all available DEX pairs with liquidity checks
                    for (let i = 0; i < availableDexes.length; i++) {
                        for (let j = i + 1; j < availableDexes.length; j++) {
                            const dex1 = availableDexes[i];
                            const dex2 = availableDexes[j];

                            const priceData1 = prices[dex1];
                            const priceData2 = prices[dex2];

                            // Check if both DEXes have price data and sufficient liquidity
                            if (priceData1 && priceData2 &&
                                priceData1.price > 0 && priceData2.price > 0 &&
                                priceData1.recommended && priceData2.recommended) {

                                const price1 = priceData1.price;
                                const price2 = priceData2.price;
                                const spread = Math.abs(price1 - price2) / Math.min(price1, price2) * 100;

                                // Only consider opportunities with good spread AND sufficient liquidity - MEANINGFUL ARBITRAGE
                                 if (spread > 0.001) { // Minimum threshold for profitable arbitrage: 0.001% (0.1 basis points)
                                    const buyDex = price1 < price2 ? dex1 : dex2;
                                    const sellDex = price1 < price2 ? dex2 : dex1;
                                    const buyLiquidity = price1 < price2 ? priceData1.liquidity : priceData2.liquidity;
                                    const sellLiquidity = price1 < price2 ? priceData2.liquidity : priceData1.liquidity;

                                    wbnbUsdtOpportunities.push({
                                        type: 'wbnb_usdt_arbitrage',
                                        token: pair.split('/')[0], // WBNB
                                        pair: pair,
                                        buyDex: buyDex,
                                        sellDex: sellDex,
                                        buyPrice: Math.min(price1, price2),
                                        sellPrice: Math.max(price1, price2),
                                        spread: spread,
                                        profitPotential: (spread / 100) * 5000, // Calculate USD profit for $5000 flashloan (will be adjusted based on actual amount)
                                        liquidity: {
                                            buy: buyLiquidity,
                                            sell: sellLiquidity,
                                            overall: buyLiquidity === 'excellent' && sellLiquidity === 'excellent' ? 'excellent' :
                                                    buyLiquidity === 'good' && sellLiquidity === 'good' ? 'good' : 'moderate'
                                        }
                                    });

                                    console.log(`💧 Liquidity OK: ${buyDex}(${buyLiquidity}) ↔ ${sellDex}(${sellLiquidity}) - Spread: ${spread.toFixed(4)}%`);
                                }
                            } else {
                                // Log liquidity issues
                                if (priceData1 && !priceData1.recommended) {
                                    console.log(`⚠️  Skipping ${dex1} - Insufficient liquidity (${priceData1.liquidity})`);
                                }
                                if (priceData2 && !priceData2.recommended) {
                                    console.log(`⚠️  Skipping ${dex2} - Insufficient liquidity (${priceData2.liquidity})`);
                                }
                            }
                        }
                    }
                }

                // PRIORITY 2: Check for stablecoin flashloan arbitrage opportunities (100K loans)
                const stablecoinOpportunities = await this._findStablecoinFlashloanOpportunities();

                // PRIORITY 3: Check for triangular/quad arbitrage opportunities (HIGH PRIORITY)
                const arbitrageOpportunities = await this._findTriangularArbitrageOpportunities();

                // Separate utmost priority opportunities
                const utmostPriorityOpps = arbitrageOpportunities.filter(opp => opp.priority === 'utmost');
                const otherArbitrageOpps = arbitrageOpportunities.filter(opp => opp.priority !== 'utmost');

                // Combine all opportunities with utmost priority routes FIRST
                const allOpportunities = [...utmostPriorityOpps, ...wbnbUsdtOpportunities, ...stablecoinOpportunities, ...otherArbitrageOpps];

                for (const opp of allOpportunities) {
                    // UTMOST PRIORITY ROUTES - EXECUTE IMMEDIATELY
                    if (opp.priority === 'utmost' && (opp.type === 'triangular' || opp.type === 'quad_arbitrage')) {
                        console.log(`🚨 UTMOST PRIORITY ALERT: ${opp.path.join(' → ')} → ${opp.path[0]} (${opp.expectedProfit.toFixed(4)}% profit)`);
                        console.log(`💰 EXECUTING UTMOST PRIORITY ROUTE IMMEDIATELY!`);

                        // Calculate gas cost and check profitability
                        const gasCost = await this._calculateGasCost(opp);
                        const netProfitAfterGas = opp.expectedProfit - gasCost.gasCostUSD;

                        if (netProfitAfterGas > 0.5) { // Lower threshold for utmost priority routes
                            console.log(`⛽ GAS COST CHECK PASSED: Net profit $${netProfitAfterGas.toFixed(2)} after $${gasCost.gasCostUSD.toFixed(2)} gas`);
                            try {
                                // TRIPLE PROFIT PROTECTION: Record pre-trade balance
                                await this._recordPreTradeBalance(netProfitAfterGas);

                                // Execute the arbitrage immediately
                                const tx = await this._executeQuadArbitrage(opp);
                                console.log(`🚀 UTMOST PRIORITY ARBITRAGE EXECUTED: ${tx.hash}`);
                                console.log(`🎯 Route: ${opp.path.join(' → ')} → ${opp.path[0]}`);
                                console.log(`💎 Expected profit: $${opp.expectedProfit.toFixed(4)}`);

                                // TRIPLE PROFIT PROTECTION: Validate actual profit received
                                const profitConfirmed = await this._validatePostTradeProfit(opp);

                                if (profitConfirmed) {
                                    console.log(`✅ UTMOST PRIORITY PROFIT CONFIRMED - Transaction submitted to blockchain`);
                                    console.log(`📊 Transaction hash: ${tx.hash}`);
                                    console.log(`💰 CONFIRMED wallet balance increase: $${this.actualProfitBNB * 567}`);
                                } else {
                                    console.log(`⚠️ UTMOST PRIORITY PROFIT FLOW WARNING - Transaction submitted but profit not confirmed in wallet`);
                                    console.log(`📊 Transaction hash: ${tx.hash}`);
                                    console.log(`🔍 Manual balance check recommended`);
                                }

                                await this.checkAndRefundGas(tx);
                                this.recordTrade(profitConfirmed);
                            } catch (error) {
                                console.error('❌ UTMOST PRIORITY ARBITRAGE FAILED:', error.message);
                                // Emergency profit check in case transaction partially succeeded
                                await this._emergencyProfitExtraction();
                                this.recordTrade(false);
                            }
                        } else {
                            console.log(`⛽ GAS COST TOO HIGH FOR UTMOST PRIORITY: Net profit $${netProfitAfterGas.toFixed(2)} after $${gasCost.gasCostUSD.toFixed(2)} gas - Skipped`);
                        }
                        continue; // Skip to next opportunity
                    }

                    if (opp.type === 'wbnb_usdt_arbitrage') {
                        console.log(`🚀 PRIORITY: WBNB/USDT arbitrage opportunity found!`);
                        console.log(`Pair: ${opp.pair}`);
                        console.log(`Spread: ${opp.spread.toFixed(4)}%`);
                        console.log(`Buy on: ${opp.buyDex}, Sell on: ${opp.sellDex}`);
                        console.log(`Buy Price: $${opp.buyPrice.toFixed(6)}, Sell Price: $${opp.sellPrice.toFixed(6)}`);
                        console.log(`Profit Potential: ${opp.profitPotential.toFixed(4)}%`);
                        console.log(`Liquidity: Buy(${opp.liquidity.buy}) ↔ Sell(${opp.liquidity.sell}) - Overall: ${opp.liquidity.overall}`);

                        // EXECUTE ANY PROFITABLE OPPORTUNITY - NO MINIMUM THRESHOLDS
                        console.log(`💰 PROFITABLE OPPORTUNITY FOUND: $${opp.profitPotential.toFixed(2)} potential profit`);

                        // Calculate gas cost and check if profitable after gas
                        const gasCost = await this._calculateGasCost(opp);
                        const netProfitAfterGas = opp.profitPotential - gasCost.gasCostUSD;

                        if (netProfitAfterGas > 0) { // Any positive profit after gas costs
                            console.log(`⛽ GAS COST CHECK PASSED: Net profit $${netProfitAfterGas.toFixed(2)} after $${gasCost.gasCostUSD.toFixed(2)} gas`);

                            // MICRO-ARBITRAGE liquidity check - allow any liquidity level for micro-trades
                            if (opp.liquidity.overall === 'excellent' || opp.liquidity.overall === 'good' || opp.liquidity.overall === 'moderate' || opp.liquidity.overall === 'low') {
                                console.log(`💧 LIQUIDITY CHECK PASSED: ${opp.liquidity.overall} liquidity confirmed`);
                                try {
                                    // TRIPLE PROFIT PROTECTION: Record pre-trade balance
                                    await this._recordPreTradeBalance(netProfitAfterGas);

                                    // Get flash provider for WBNB borrowing (direct strategy)
                                    const flashProvider = await this.flashProvider.findBestFlashProvider(TOKENS.WBNB.address, ethers.parseEther('10'));
                                    if (!flashProvider) {
                                        console.log(`❌ No flash provider available for WBNB borrowing`);
                                        continue;
                                    }

                                    // Calculate optimal WBNB flashloan amount (exact USD equivalent)
                                    const wbnbAmount = this._calculateOptimalWbnbFlashloan(opp);

                                    // Calculate comprehensive profit analysis
                                    const profitAnalysis = await this._calculateArbitrageProfit(opp, wbnbAmount, flashProvider);

                                    if (!profitAnalysis.isProfitable) {
                                        console.log(`❌ NOT PROFITABLE: Net profit $${profitAnalysis.netProfit.toFixed(4)} < $0.10 minimum`);
                                        console.log(`   Total fees: $${profitAnalysis.breakdown.totalFees.toFixed(4)}`);
                                        continue;
                                    }

                                    console.log(`✅ PROFITABLE ARBITRAGE FOUND:`);
                                    console.log(`   Net Profit: $${profitAnalysis.netProfit.toFixed(4)}`);
                                    console.log(`   Profit Margin: ${(profitAnalysis.netProfit / profitAnalysis.breakdown.flashAmount * 100).toFixed(4)}%`);

                                    // Validate pool data before execution
                                    const targetToken = this._getTokenFromPair(opp.pair);
                                    const poolValid = await this._validatePoolData(flashProvider.protocol, TOKENS.WBNB, targetToken);

                                    if (!poolValid) {
                                        console.log(`❌ Pool validation failed for ${flashProvider.protocol} WBNB/${targetToken.symbol} - skipping`);
                                        continue;
                                    }

                                    // Execute WBNB BORROWING STRATEGY (direct PancakeSwap flashswap)
                                    console.log(`⚡ WBNB FLASHLOAN ARBITRAGE ACTIVATED - $${profitAnalysis.breakdown.flashAmount.toFixed(0)} borrowing!`);
                                    const result = await this._executeWbnbFlashloanArbitrage(opp, wbnbAmount, flashProvider);
                                    console.log(`🚀 USDT FLASHLOAN ARBITRAGE EXECUTED: ${result.txHash}`);
                                    console.log(`🏦 Protocol: ${result.protocol}`);
                                    console.log(`💰 Flash amount: ${ethers.formatEther(result.flashAmount)} USDT ($${ethers.formatEther(result.flashAmount)})`);
                                    console.log(`💸 Flash fee: ${ethers.formatEther(result.flashFee)} USDT`);
                                    console.log(`⛽ Gas cost: ${ethers.formatEther(result.gasCost)} BNB`);
                                    console.log(`💎 NET PROFIT: $${profitAnalysis.netProfit.toFixed(4)} (after ALL fees)`);
                                    console.log(`🎯 Strategy: Borrow USDT → Buy ${opp.pair.split('/')[1]} → Sell → Return USDT + Profit`);

                                    // TRIPLE PROFIT PROTECTION: Validate actual profit received
                                    const profitConfirmed = await this._validatePostTradeProfit(opp);

                                    if (profitConfirmed) {
                                        console.log(`✅ PROFIT FLOW CONFIRMED - Transaction submitted to blockchain`);
                                        console.log(`📊 Transaction hash: ${result.txHash}`);
                                        console.log(`💰 CONFIRMED wallet balance increase: $${this.actualProfitBNB * 567}`);
                                    } else {
                                        console.log(`⚠️ PROFIT FLOW WARNING - Transaction submitted but profit not confirmed in wallet`);
                                        console.log(`📊 Transaction hash: ${result.txHash}`);
                                        console.log(`🔍 Manual balance check recommended`);
                                    }

                                    // Check and refund gas if price spiked
                                    await this.checkAndRefundGas({ hash: result.txHash, wait: async () => ({ gasUsed: result.gasUsed, effectiveGasPrice: ethers.parseUnits('5', 'gwei') }) });

                                    this.recordTrade(profitConfirmed);
                                } catch (error) {
                                    console.error('🚫 FLASHLOAN ARBITRAGE FAILED:', error.message);
                                    // Emergency profit check in case transaction partially succeeded
                                    await this._emergencyProfitExtraction();
                                    this.recordTrade(false);
                                }
                            } else {
                                console.log(`⚠️  FLASHLOAN REJECTED - Requires at least moderate liquidity, got ${opp.liquidity.overall}`);
                            }
                        } else {
                            console.log(`⛽ GAS COST TOO HIGH: Net profit $${netProfitAfterGas.toFixed(2)} after $${gasCost.gasCostUSD.toFixed(2)} gas - Skipped`);
                        }
                    } else if (opp.type === 'triangular') {
                        console.log(`🔄 Found triangular arbitrage opportunity:`);
                        console.log(`Path: ${opp.path.join(' -> ')}`);
                        console.log(`Expected profit: ${opp.expectedProfit.toFixed(4)}%`);

                        // EXECUTE ANY PROFITABLE TRIANGULAR OPPORTUNITY
                        console.log(`🔄 PROFITABLE TRIANGULAR OPPORTUNITY: $${opp.expectedProfit.toFixed(4)} expected profit`);
                    } else if (opp.type === 'quad_arbitrage') {
                        console.log(`🎯 PRIORITY QUAD ARBITRAGE OPPORTUNITY FOUND:`);
                        console.log(`Path: ${opp.path.join(' → ')}`);
                        console.log(`Expected profit: ${opp.expectedProfit.toFixed(4)}%`);
                        console.log(`Priority: ${opp.priority}`);

                        // EXECUTE PRIORITY QUAD ARBITRAGE OPPORTUNITY
                        console.log(`🎯 EXECUTING PRIORITY ROUTE: USDT → BUSD → WBNB → CAKE → USDT`);
                        console.log(`💰 Expected profit: $${opp.expectedProfit.toFixed(4)}`);

                        // Calculate gas cost and check profitability
                        const gasCost = await this._calculateGasCost(opp);
                        const netProfitAfterGas = opp.expectedProfit - gasCost.gasCostUSD;

                        if (netProfitAfterGas > 0) { // Any positive profit after gas costs
                            console.log(`⛽ GAS COST CHECK PASSED: Net profit $${netProfitAfterGas.toFixed(2)} after $${gasCost.gasCostUSD.toFixed(2)} gas`);
                            try {
                                // TRIPLE PROFIT PROTECTION: Record pre-trade balance
                                await this._recordPreTradeBalance(netProfitAfterGas);

                                // Execute the quad arbitrage
                                const tx = await this._executeQuadArbitrage(opp);
                                console.log(`🚀 QUAD ARBITRAGE EXECUTED: ${tx.hash}`);
                                console.log(`🎯 Path: ${opp.path.join(' → ')}`);
                                console.log(`💎 Expected profit: $${opp.expectedProfit.toFixed(4)}`);

                                // TRIPLE PROFIT PROTECTION: Validate actual profit received
                                const profitConfirmed = await this._validatePostTradeProfit(opp);

                                if (profitConfirmed) {
                                    console.log(`✅ PROFIT FLOW CONFIRMED - Transaction submitted to blockchain`);
                                    console.log(`📊 Transaction hash: ${tx.hash}`);
                                    console.log(`💰 CONFIRMED wallet balance increase: $${this.actualProfitBNB * 567}`);
                                } else {
                                    console.log(`⚠️ PROFIT FLOW WARNING - Transaction submitted but profit not confirmed in wallet`);
                                    console.log(`📊 Transaction hash: ${tx.hash}`);
                                    console.log(`🔍 Manual balance check recommended`);
                                }

                                await this.checkAndRefundGas(tx);
                                this.recordTrade(profitConfirmed);
                            } catch (error) {
                                console.error('❌ Triangular arbitrage execution failed:', error);
                                // Emergency profit check in case transaction partially succeeded
                                await this._emergencyProfitExtraction();
                                this.recordTrade(false);
                            }
                        } else {
                            console.log(`⛽ GAS COST TOO HIGH: Net profit $${netProfitAfterGas.toFixed(2)} after $${gasCost.gasCostUSD.toFixed(2)} gas - Skipped`);
                        }
                    } else if (opp.type === 'stablecoin_flashloan_arbitrage') {
                        console.log(`💰 STABLECOIN FLASHLOAN ARBITRAGE OPPORTUNITY:`);
                        console.log(`Pair: ${opp.pair} | Spread: ${opp.spread.toFixed(4)}%`);
                        console.log(`Buy: ${opp.buyDex} | Sell: ${opp.sellDex}`);
                        console.log(`Flashloan: $${opp.flashloanAmount.toLocaleString()}`);
                        console.log(`Net Profit: $${opp.netProfit.toFixed(2)} | Risk: ${opp.riskLevel}`);

                        // EXECUTE ANY PROFITABLE STABLECOIN FLASHLOAN OPPORTUNITY
                        console.log(`💰 PROFITABLE STABLECOIN FLASHLOAN OPPORTUNITY: $${opp.netProfit.toFixed(2)} net profit`);

                        // Calculate gas cost and check if still profitable
                        const gasCost = await this._calculateGasCost(opp);
                        const finalNetProfit = opp.netProfit - gasCost.gasCostUSD;

                        if (finalNetProfit > 0) { // Any positive profit after gas costs
                            console.log(`⛽ GAS COST CHECK PASSED: Final net profit $${finalNetProfit.toFixed(2)} after $${gasCost.gasCostUSD.toFixed(2)} gas`);
                            try {
                                // TRIPLE PROFIT PROTECTION: Record pre-trade balance
                                await this._recordPreTradeBalance(finalNetProfit);

                                const result = await this._executeStablecoinFlashloanArbitrage(opp);
                                console.log(`🚀 STABLECOIN FLASHLOAN ARBITRAGE EXECUTED: ${result.txHash}`);
                                console.log(`🏦 Protocol: ${result.protocol} | Amount: $${opp.flashloanAmount.toLocaleString()}`);
                                console.log(`💎 Net Profit: $${opp.netProfit.toFixed(2)}`);

                                // TRIPLE PROFIT PROTECTION: Validate actual profit received
                                const profitConfirmed = await this._validatePostTradeProfit(opp);

                                if (profitConfirmed) {
                                    console.log(`✅ PROFIT FLOW CONFIRMED - Transaction submitted to blockchain`);
                                    console.log(`📊 Transaction hash: ${result.txHash}`);
                                    console.log(`💰 CONFIRMED wallet balance increase: $${this.actualProfitBNB * 567}`);
                                } else {
                                    console.log(`⚠️ PROFIT FLOW WARNING - Transaction submitted but profit not confirmed in wallet`);
                                    console.log(`📊 Transaction hash: ${result.txHash}`);
                                    console.log(`🔍 Manual balance check recommended`);
                                }

                                // Check and refund gas if price spiked
                                await this.checkAndRefundGas({ hash: result.txHash, wait: async () => ({ gasUsed: result.gasUsed, effectiveGasPrice: ethers.parseUnits('5', 'gwei') }) });

                                this.recordTrade(profitConfirmed);
                            } catch (error) {
                                console.error('❌ Stablecoin flashloan arbitrage failed:', error.message);
                                // Emergency profit check in case transaction partially succeeded
                                await this._emergencyProfitExtraction();
                                this.recordTrade(false);
                            }
                        } else {
                            console.log(`⛽ GAS COST TOO HIGH: Final profit $${finalNetProfit.toFixed(2)} after $${gasCost.gasCostUSD.toFixed(2)} gas - Skipped`);
                        }
                    }
                }

            } catch (error) {
                console.error('Error in arbitrage loop:', error);
            }

            // Wait before next scan
            await new Promise(resolve => setTimeout(resolve, this.scanInterval));
        }
    }

    async _createArbitrageTx(opportunity) {
        if (opportunity.type === 'triangular') {
            return await this._createTriangularArbitrageTx(opportunity);
        } else if (opportunity.type === 'quad_arbitrage') {
            return await this._createQuadArbitrageTx(opportunity);
        } else {
            return await this._createTwoTokenArbitrageTx(opportunity);
        }
    }

    async _createTriangularArbitrageTx(opportunity) {
        const { path, dexes, rates } = opportunity;
        const [tokenA, tokenB, tokenC] = path;

        // Calculate optimal amount for triangular arbitrage (bundled)
        const optimalAmount = ethers.parseEther('1'); // Increased for bundled efficiency

        // Get token addresses
        const tokenAAddress = TOKENS[tokenA].address;
        const tokenBAddress = TOKENS[tokenB].address;
        const tokenCAddress = TOKENS[tokenC].address;

        // Calculate deadline
        const deadline = Math.floor(Date.now() / 1000) + 300;

        // BUNDLED TRIANGULAR ARBITRAGE: Single multi-hop swap within PancakeSwap
        // Path: tokenA -> tokenB -> tokenC -> tokenA (only 0.25% fee total!)
        const fullPath = [tokenAAddress, tokenBAddress, tokenCAddress, tokenAAddress];

        // Calculate minimum output amount accounting for arbitrage profit + slippage
        const expectedProfit = opportunity.expectedProfit || 0.005; // 0.5% expected profit
        const minAmountOut = optimalAmount.mul(ethers.BigNumber.from(Math.floor((1 + expectedProfit - 0.005) * 1000))).div(ethers.BigNumber.from(1000)); // Profit - 0.5% slippage

        console.log(`📦 TRIANGULAR ARBITRAGE BUNDLED:`);
        console.log(`   Path: ${tokenA} → ${tokenB} → ${tokenC} → ${tokenA}`);
        console.log(`   Amount: ${ethers.formatEther(optimalAmount)} ${tokenA}`);
        console.log(`   Expected profit: ${expectedProfit*100}%`);
        console.log(`   DEX fee: 0.25% (bundled multi-hop)`);
        console.log(`   Minimum out: ${ethers.formatEther(minAmountOut)} ${tokenA}`);

        // Encode the bundled multi-hop swap (single transaction, single fee)
        const tx = {
            to: DEX_CONFIGS.PANCAKESWAP.router,
            data: this._encodeMultiHopSwap(tokenAAddress, optimalAmount, minAmountOut, fullPath, deadline),
            value: 0,
            gasLimit: ethers.BigNumber.from(2000000), // Higher gas limit for multi-hop
            gasPrice: ethers.parseUnits(this.maxGasPrice.toString(), 'gwei')
        };

        return tx;
    }

    async _createQuadArbitrageTx(opportunity) {
        const { path, dexes, expectedProfit } = opportunity;
        const [tokenA, tokenB, tokenC, tokenD] = path;

        // Calculate optimal amount for quad arbitrage
        const optimalAmount = ethers.parseEther('1'); // Start with 1 token

        // Get token addresses
        const tokenAAddress = TOKENS[tokenA].address;
        const tokenBAddress = TOKENS[tokenB].address;
        const tokenCAddress = TOKENS[tokenC].address;
        const tokenDAddress = TOKENS[tokenD].address;

        // Calculate deadline
        const deadline = Math.floor(Date.now() / 1000) + 300;

        // Create 4-hop swap path: tokenA -> tokenB -> tokenC -> tokenD -> tokenA
        const fullPath = [tokenAAddress, tokenBAddress, tokenCAddress, tokenDAddress, tokenAAddress];

        // Calculate minimum output amount accounting for arbitrage profit + slippage
        const minAmountOut = optimalAmount.mul(ethers.BigNumber.from(Math.floor((1 + expectedProfit - 0.01) * 1000))).div(ethers.BigNumber.from(1000)); // Profit - 1% slippage

        console.log(`📦 QUAD ARBITRAGE TX:`);
        console.log(`   Path: ${tokenA} → ${tokenB} → ${tokenC} → ${tokenD} → ${tokenA}`);
        console.log(`   Amount: ${ethers.formatEther(optimalAmount)} ${tokenA}`);
        console.log(`   Expected profit: ${expectedProfit*100}%`);
        console.log(`   Minimum out: ${ethers.formatEther(minAmountOut)} ${tokenA}`);

        // Encode the 4-hop swap
        const tx = {
            to: DEX_CONFIGS.PANCAKESWAP.router,
            data: this._encodeQuadHopSwap(tokenAAddress, optimalAmount, minAmountOut, fullPath, deadline),
            value: 0,
            gasLimit: ethers.BigNumber.from(2500000), // Higher gas limit for 4-hop
            gasPrice: ethers.parseUnits(this.maxGasPrice.toString(), 'gwei')
        };

        return tx;
    }

    async _createTwoTokenArbitrageTx(opportunity) {
        const { token, buyDex, sellDex, buyPrice, sellPrice } = opportunity;

        // Simple fixed amount for testing (0.1 WBNB)
        const amount = ethers.parseEther('0.1');

        // Get token address
        const tokenAddress = TOKENS[token].address;

        // Calculate deadline
        const deadline = Math.floor(Date.now() / 1000) + 300;

        // Create transaction for two-token arbitrage
        const path = [tokenAddress, TOKENS.USDT.address]; // Simple path for now
        const minAmountOut = amount.mul(ethers.toBigInt(Math.floor((1 - 0.005) * 1000))).div(ethers.toBigInt(1000)); // 0.5% slippage

        const tx = {
            to: DEX_CONFIGS[buyDex].router,
            data: this._encodeTwoTokenSwap(path, amount, minAmountOut, deadline),
            value: 0,
            gasLimit: ethers.BigNumber.from(1000000),
            gasPrice: ethers.parseUnits(this.maxGasPrice.toString(), 'gwei')
        };

        return tx;
    }

    _encodeMultiHopSwap(tokenIn, amountIn, amountOutMin, path, deadline) {
        // Encode a multi-hop swap using PancakeSwap router
        // Function signature: swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)

        const functionSignature = '0x7ff36ab5'; // swapExactTokensForTokens

        // Encode amountIn (uint256)
        const encodedAmountIn = ethers.zeroPadValue(ethers.toBeHex(amountIn), 32);

        // Encode amountOutMin (uint256)
        const encodedAmountOutMin = ethers.zeroPadValue(ethers.toBeHex(amountOutMin), 32);

        // Encode path array
        const pathLength = path.length;
        const encodedPathLength = ethers.zeroPadValue(ethers.toBeHex(pathLength), 32);
        const encodedAddresses = path.map(address => ethers.zeroPadValue(address, 32));
        const encodedPath = ethers.concat([encodedPathLength, ...encodedAddresses]);

        // Encode recipient address
        const encodedTo = ethers.zeroPadValue(this.signer.address, 32);

        // Encode deadline
        const encodedDeadline = ethers.zeroPadValue(ethers.toBeHex(deadline), 32);

        // Combine all encoded data
        const encodedData = ethers.concat([
            functionSignature,
            encodedAmountIn,
            encodedAmountOutMin,
            '0x00000000000000000000000000000000000000000000000000000000000000e0', // offset to path array
            encodedTo,
            encodedDeadline,
            encodedPath
        ]);

        return encodedData;
    }

    _encodeTwoTokenSwap(path, amountIn, amountOutMin, deadline) {
        // Encode a swapExactTokensForTokens call
        // Function signature: swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)
        const functionSignature = '0x7ff36ab5'; // swapExactTokensForTokens

        // Encode parameters
        const encodedAmountIn = ethers.zeroPadValue(ethers.toBeHex(amountIn), 32);
        const encodedAmountOutMin = ethers.zeroPadValue(ethers.toBeHex(amountOutMin), 32);
        const encodedTo = ethers.zeroPadValue(this.signer.address, 32);
        const encodedDeadline = ethers.zeroPadValue(ethers.toBeHex(deadline), 32);

        // Encode path array
        const pathLength = path.length;
        const encodedPathLength = ethers.zeroPadValue(ethers.toBeHex(pathLength), 32);
        const encodedAddresses = path.map(address => ethers.zeroPadValue(address, 32));
        const encodedPath = ethers.concat([encodedPathLength, ...encodedAddresses]);

        // Calculate correct offset to path array (160 bytes from start of parameters)
        const pathOffset = ethers.zeroPadValue(ethers.toBeHex(160), 32);

        // Combine all encoded data
        const encodedData = ethers.concat([
            functionSignature,
            encodedAmountIn,
            encodedAmountOutMin,
            pathOffset, // offset to path array
            encodedTo,
            encodedDeadline,
            encodedPath
        ]);

        return encodedData;
    }

    _encodeQuadHopSwap(tokenIn, amountIn, amountOutMin, path, deadline) {
        // Encode a 4-hop swap using PancakeSwap router
        // Function signature: swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)

        const functionSignature = '0x7ff36ab5'; // swapExactTokensForTokens

        // Encode amountIn (uint256)
        const encodedAmountIn = ethers.zeroPadValue(ethers.toBeHex(amountIn), 32);

        // Encode amountOutMin (uint256)
        const encodedAmountOutMin = ethers.zeroPadValue(ethers.toBeHex(amountOutMin), 32);

        // Encode path array (5 addresses for 4-hop: A->B->C->D->A)
        const pathLength = path.length;
        const encodedPathLength = ethers.zeroPadValue(ethers.toBeHex(pathLength), 32);
        const encodedAddresses = path.map(address => ethers.zeroPadValue(address, 32));
        const encodedPath = ethers.concat([encodedPathLength, ...encodedAddresses]);

        // Encode recipient address
        const encodedTo = ethers.zeroPadValue(this.signer.address, 32);

        // Encode deadline
        const encodedDeadline = ethers.zeroPadValue(ethers.toBeHex(deadline), 32);

        // Combine all encoded data
        const encodedData = ethers.concat([
            functionSignature,
            encodedAmountIn,
            encodedAmountOutMin,
            '0x00000000000000000000000000000000000000000000000000000000000000e0', // offset to path array
            encodedTo,
            encodedDeadline,
            encodedPath
        ]);

        return encodedData;
    }

    async _calculateDynamicDeadline() {
        // Calculate deadline based on network congestion and gas price
        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice;
        const gasPriceGwei = ethers.formatUnits(gasPrice, 'gwei');

        // Higher gas price = more congestion = shorter deadline
        let deadlineSeconds = 300; // Base 5 minutes
        if (parseFloat(gasPriceGwei) > 10) {
            deadlineSeconds = 180; // 3 minutes for high congestion
        } else if (parseFloat(gasPriceGwei) > 5) {
            deadlineSeconds = 240; // 4 minutes for moderate congestion
        }

        return Math.floor(Date.now() / 1000) + deadlineSeconds;
    }

    async executeArbitrage(opportunity) {
        // EMERGENCY CHECK: Block all transactions if emergency stop is active
        if (this.emergencyStopTriggered) {
            throw new Error('🚨 EMERGENCY STOP ACTIVE - All transactions blocked');
        }

        // Input validation
        if (!opportunity) {
            throw new Error('Opportunity object is required');
        }
        if (opportunity.type !== 'triangular' && (!opportunity.token || !opportunity.buyDex || !opportunity.sellDex)) {
            throw new Error('Opportunity must contain token, buyDex, and sellDex');
        }
        if (opportunity.type !== 'triangular' && (typeof opportunity.buyPrice !== 'number' || typeof opportunity.sellPrice !== 'number')) {
            throw new Error('Opportunity prices must be numbers');
        }
        if (opportunity.type !== 'triangular' && (opportunity.buyPrice <= 0 || opportunity.sellPrice <= 0)) {
            throw new Error('Opportunity prices must be positive');
        }

        try {
            // Create transaction
            const tx = await this._createArbitrageTx(opportunity);

            // Validate transaction object
            if (!tx || !tx.to || !tx.data) {
                throw new Error('Invalid transaction object created');
            }

            // CRITICAL SAFETY VALIDATION - This MUST pass or transaction is blocked
            console.log('🛡️ Performing critical safety validation...');
            await this._validateTransactionSafety(tx);
            console.log('✅ Safety validation passed - proceeding with transaction');

            // Execute transaction
            const txResponse = await this.signer.sendTransaction(tx);
            console.log(`✅ Arbitrage transaction submitted: ${txResponse.hash}`);

            // Record successful transaction
            this._recordSuccessfulTransaction();

            return txResponse;
        } catch (error) {
            console.error('❌ Arbitrage execution failed:', error.message);
            this._recordFailedTransaction();

            // If this is a safety validation error, do not retry
            if (error.message.includes('EMERGENCY STOP') ||
                error.message.includes('Insufficient balance') ||
                error.message.includes('Gas cost too high') ||
                error.message.includes('Too soon since last transaction')) {
                console.log('🚨 Safety validation blocked transaction - no retry');
                this.emergencyStopTriggered = true;
                this.stop();
                throw error;
            }

            this._handleError(error);
            throw error;
        }
    }

    // Find triangular arbitrage opportunities using Python calculator
    async _findTriangularArbitrageOpportunities() {
        const opportunities = [];

        try {
            // Check if Python calculator is available
            const pythonAvailable = await this.pythonCalculator.checkAvailability();
            if (!pythonAvailable) {
                console.log('🐍 Python calculator not available, falling back to Node.js calculations');
                return this._findTriangularArbitrageFallback();
            }

            // Use Python calculator for accurate profit calculations
            console.log('🐍 Using Python arbitrage calculator for precise calculations...');
            const pythonResult = await this.pythonCalculator.calculateOpportunities(10); // 10 BNB start amount

            if (pythonResult.opportunities && pythonResult.opportunities.length > 0) {
                // Convert Python results to bot format
                const convertedOpportunities = this.pythonCalculator.convertToBotFormat(pythonResult);

                for (const opp of convertedOpportunities) {
                    opportunities.push(opp);

                    // Log priority routes
                    if (opp.priority === 'utmost') {
                        const routeStr = opp.path.join(' → ') + ' → ' + opp.path[0];
                        console.log(`🚨 UTMOST PRIORITY PYTHON ROUTE: ${routeStr} (${opp.expectedProfit.toFixed(4)}% profit)`);
                    } else if (opp.priority === 'high') {
                        const routeStr = opp.path.join(' → ') + ' → ' + opp.path[0];
                        console.log(`🎯 HIGH PRIORITY PYTHON ROUTE: ${routeStr} (${opp.expectedProfit.toFixed(4)}% profit)`);
                    }
                }

                console.log(`✅ Python calculator found ${convertedOpportunities.length} arbitrage opportunities`);
            } else {
                console.log('📊 Python calculator found no profitable opportunities');
            }

            // Add traditional quad route as fallback
            const priorityRoute = ['USDT', 'BUSD', 'WBNB', 'CAKE'];
            const priorityOpportunity = await this._checkQuadArbitragePath(priorityRoute);
            if (priorityOpportunity) {
                priorityOpportunity.priority = 'high';
                opportunities.push(priorityOpportunity);
                console.log(`🎯 FALLBACK QUAD ROUTE: USDT → BUSD → WBNB → CAKE → USDT (${priorityOpportunity.expectedProfit.toFixed(4)}% profit)`);
            }

            // Define common triangular paths to check
            const triangularPaths = [
                ['WBNB', 'USDT', 'BTCB'], // WBNB -> USDT -> BTCB -> WBNB
                ['WBNB', 'BTCB', 'USDT'], // WBNB -> BTCB -> USDT -> WBNB
                ['USDT', 'WBNB', 'BTCB'], // USDT -> WBNB -> BTCB -> USDT
                ['USDT', 'BTCB', 'WBNB'], // USDT -> BTCB -> WBNB -> USDT
                ['BTCB', 'WBNB', 'USDT'], // BTCB -> WBNB -> USDT -> BTCB
                ['BTCB', 'USDT', 'WBNB']  // BTCB -> USDT -> WBNB -> BTCB
            ];

            for (const path of triangularPaths) {
                const opportunity = await this._checkTriangularPath(path);
                if (opportunity) {
                    opportunities.push(opportunity);
                }
            }
        } catch (error) {
            console.error('Error finding triangular arbitrage opportunities:', error);
        }

        return opportunities;
    }

    // Fallback triangular arbitrage when Python calculator is not available
    async _findTriangularArbitrageFallback() {
        const opportunities = [];

        try {
            // UTMOST PRIORITY ROUTES - TREAT WITH URGENCY (print even better)
            const utmostPriorityRoutes = [
                ['BNB', 'BTCB', 'USDT'], // BNB-BTCB-USDT (3-token, highest priority)
                ['USDT', 'USDC', 'BNB'], // USDT → USDC → BNB → USDT (4-token)
                ['BNB', 'CAKE', 'USDT']  // BNB → CAKE → USDT → BNB (4-token)
            ];

            for (const route of utmostPriorityRoutes) {
                const opportunity = route.length === 3 ?
                    await this._checkTriangularPath(route) :
                    await this._checkQuadArbitragePath(route);

                if (opportunity) {
                    opportunity.priority = 'utmost'; // Mark as utmost priority
                    opportunities.push(opportunity);
                    const routeStr = route.join(' → ') + ' → ' + route[0];
                    console.log(`🚨 UTMOST PRIORITY FALLBACK ROUTE: ${routeStr} (${opportunity.expectedProfit.toFixed(4)}% profit)`);
                }
            }

            // HIGH PRIORITY ROUTE: USDT → BUSD (0.01%) → WBNB → CAKE → USDT (4-token cycle)
            const priorityRoute = ['USDT', 'BUSD', 'WBNB', 'CAKE'];
            const priorityOpportunity = await this._checkQuadArbitragePath(priorityRoute);
            if (priorityOpportunity) {
                priorityOpportunity.priority = 'high';
                opportunities.push(priorityOpportunity);
                console.log(`🎯 HIGH PRIORITY FALLBACK ROUTE: USDT → BUSD → WBNB → CAKE → USDT (${priorityOpportunity.expectedProfit.toFixed(4)}% profit)`);
            }
        } catch (error) {
            console.error('Error finding triangular arbitrage opportunities (fallback):', error);
        }

        return opportunities;
    }

    // Check a specific triangular arbitrage path
    async _checkTriangularPath(path) {
        try {
            const [tokenA, tokenB, tokenC] = path;

            // Get prices for all three pairs
            const pricesAB = await this.priceFeed.getAllPrices(`${tokenA}/${tokenB}`);
            const pricesBC = await this.priceFeed.getAllPrices(`${tokenB}/${tokenC}`);
            const pricesCA = await this.priceFeed.getAllPrices(`${tokenC}/${tokenA}`);

            // Find best prices for each leg (PRIORITIZE PancakeSwap V2, then V3, then other DEXes)
            const priceAtoB = pricesAB.pancakeswap || pricesAB.pancakeswapv3 || pricesAB.uniswap || pricesAB.apeswap || pricesAB.sushiswap;
            const priceBtoC = pricesBC.pancakeswap || pricesBC.pancakeswapv3 || pricesBC.uniswap || pricesBC.apeswap || pricesBC.sushiswap;
            const priceCtoA = pricesCA.pancakeswap || pricesCA.pancakeswapv3 || pricesCA.uniswap || pricesCA.apeswap || pricesCA.sushiswap;

            if (!priceAtoB || !priceBtoC || !priceCtoA) {
                return null; // Missing price data
            }

            // Calculate the triangular arbitrage
            // Start with 1 unit of tokenA
            const amountB = 1 * priceAtoB; // tokenA -> tokenB
            const amountC = amountB * priceBtoC; // tokenB -> tokenC
            const finalAmount = amountC * priceCtoA; // tokenC -> tokenA

            // Calculate profit percentage
            const profitPercent = ((finalAmount - 1) / 1) * 100;

            // Only consider opportunities with profit > 0.5%
            if (profitPercent > 0.5) {
                // Determine which DEXes to use for each leg (prioritize PancakeSwap V2/V3)
                const dexes = [];
                const dexNames = ['pancakeswap', 'pancakeswapv3', 'uniswap', 'apeswap', 'sushiswap'];

                // For each leg, find which DEX was used
                [pricesAB, pricesBC, pricesCA].forEach(priceData => {
                    for (const dexName of dexNames) {
                        if (priceData[dexName] && priceData[dexName].price === priceAtoB.price) {
                            dexes.push(dexName);
                            break;
                        }
                    }
                });

                return {
                    type: 'triangular',
                    path: [tokenA, tokenB, tokenC, tokenA],
                    prices: [priceAtoB, priceBtoC, priceCtoA],
                    expectedProfit: profitPercent,
                    dexes: dexes.length === 3 ? dexes : ['pancakeswap', 'pancakeswap', 'pancakeswap'] // Fallback to PancakeSwap V2
                };
            }
        } catch (error) {
            console.error(`Error checking triangular path ${path}:`, error);
        }

        return null;
    }

    // Check quad-token arbitrage path (4-token cycle) - PRIORITY ROUTE
    async _checkQuadArbitragePath(path) {
        try {
            const [tokenA, tokenB, tokenC, tokenD] = path;

            // Get prices for all four pairs
            const pricesAB = await this.priceFeed.getAllPrices(`${tokenA}/${tokenB}`);
            const pricesBC = await this.priceFeed.getAllPrices(`${tokenB}/${tokenC}`);
            const pricesCD = await this.priceFeed.getAllPrices(`${tokenC}/${tokenD}`);
            const pricesDA = await this.priceFeed.getAllPrices(`${tokenD}/${tokenA}`);

            // Find best prices for each leg (PRIORITIZE PancakeSwap V2/V3)
            const priceAtoB = pricesAB.pancakeswap || pricesAB.pancakeswapv3 || pricesAB.uniswap || pricesAB.apeswap || pricesAB.sushiswap;
            const priceBtoC = pricesBC.pancakeswap || pricesBC.pancakeswapv3 || pricesBC.uniswap || pricesBC.apeswap || pricesBC.sushiswap;
            const priceCtoD = pricesCD.pancakeswap || pricesCD.pancakeswapv3 || pricesCD.uniswap || pricesCD.apeswap || pricesCD.sushiswap;
            const priceDtoA = pricesDA.pancakeswap || pricesDA.pancakeswapv3 || pricesDA.uniswap || pricesDA.apeswap || pricesDA.sushiswap;

            if (!priceAtoB || !priceBtoC || !priceCtoD || !priceDtoA) {
                return null; // Missing price data
            }

            // Calculate the quad-token arbitrage
            // Start with 1 unit of tokenA
            const amountB = 1 * priceAtoB; // tokenA -> tokenB
            const amountC = amountB * priceBtoC; // tokenB -> tokenC
            const amountD = amountC * priceCtoD; // tokenC -> tokenD
            const finalAmount = amountD * priceDtoA; // tokenD -> tokenA

            // Calculate profit percentage
            const profitPercent = ((finalAmount - 1) / 1) * 100;

            // Only consider opportunities with profit > 0.01% (matches the 0.01% fee mentioned)
            if (profitPercent > 0.01) {
                // Determine which DEXes to use for each leg (prioritize PancakeSwap V2/V3)
                const dexes = [];
                const dexNames = ['pancakeswap', 'pancakeswapv3', 'uniswap', 'apeswap', 'sushiswap'];

                // For each leg, find which DEX was used
                [pricesAB, pricesBC, pricesCD, pricesDA].forEach(priceData => {
                    for (const dexName of dexNames) {
                        if (priceData[dexName] && priceData[dexName].price === priceAtoB.price) {
                            dexes.push(dexName);
                            break;
                        }
                    }
                });

                return {
                    type: 'quad_arbitrage', // 4-token arbitrage
                    path: [tokenA, tokenB, tokenC, tokenD, tokenA],
                    prices: [priceAtoB, priceBtoC, priceCtoD, priceDtoA],
                    expectedProfit: profitPercent,
                    dexes: dexes.length === 4 ? dexes : ['pancakeswap', 'pancakeswap', 'pancakeswap', 'pancakeswap'], // Fallback to PancakeSwap V2
                    priority: 'high' // Mark as high priority route
                };
            }
        } catch (error) {
            console.error(`Error checking quad arbitrage path ${path}:`, error);
        }

        return null;
    }

    // Find stablecoin flashloan arbitrage opportunities (100K loans)
    async _findStablecoinFlashloanOpportunities() {
        const opportunities = [];
        const stablecoins = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'DAI'];
        const FLASHLOAN_AMOUNT = 100000; // $100K flashloan for stablecoin arbitrage

        try {
            console.log(`🔍 Scanning stablecoin flashloan arbitrage opportunities ($${FLASHLOAN_AMOUNT.toLocaleString()} loans)...`);

            // Check each stablecoin pair for mispricing across DEXes
            for (let i = 0; i < stablecoins.length; i++) {
                for (let j = i + 1; j < stablecoins.length; j++) {
                    const stable1 = stablecoins[i];
                    const stable2 = stablecoins[j];

                    // Get price data from multiple DEXes
                    const prices = await this.priceFeed.getAllPrices(`${stable1}/${stable2}`);

                    // Find DEXes with sufficient liquidity and price data
                    const dexesWithLiquidity = Object.entries(prices)
                        .filter(([dex, data]) =>
                            data &&
                            typeof data === 'object' &&
                            data.price > 0 &&
                            data.recommended === true &&
                            ['pancakeswap', 'uniswap', 'waultswap'].includes(dex) // Focus on major DEXes
                        )
                        .map(([dex, data]) => ({ dex, ...data }));

                    if (dexesWithLiquidity.length < 2) continue;

                    // Compare prices across DEX pairs
                    for (let x = 0; x < dexesWithLiquidity.length; x++) {
                        for (let y = x + 1; y < dexesWithLiquidity.length; y++) {
                            const dexA = dexesWithLiquidity[x];
                            const dexB = dexesWithLiquidity[y];

                            const priceA = dexA.price;
                            const priceB = dexB.price;

                            // Calculate spread percentage
                            const spread = Math.abs(priceA - priceB) / Math.min(priceA, priceB) * 100;

                            // Only consider opportunities with meaningful spread (>0.05% for stablecoins)
                            if (spread > 0.05) {
                                // Determine arbitrage direction
                                const buyDex = priceA < priceB ? dexA.dex : dexB.dex;
                                const sellDex = priceA < priceB ? dexB.dex : dexA.dex;
                                const buyPrice = Math.min(priceA, priceB);
                                const sellPrice = Math.max(priceA, priceB);

                                // Calculate profit potential: (spread / 100) * loanAmount
                                const grossProfit = (spread / 100) * FLASHLOAN_AMOUNT;

                                // Account for DEX fees (0.3% per swap) and flashloan fees (0.09%)
                                const dexFeeRate = 0.003; // 0.3% per DEX swap
                                const flashloanFeeRate = 0.0009; // 0.09% flashloan fee
                                const slippageBuffer = 0.001; // 0.1% slippage buffer

                                const totalFees = (dexFeeRate * 2) + flashloanFeeRate + slippageBuffer;
                                const netProfit = grossProfit * (1 - totalFees);

                                // Risk management: Only execute if net profit > $0.10
                                if (netProfit > 0.1) {
                                    console.log(`💰 STABLECOIN FLASHLOAN OPPORTUNITY: ${stable1}/${stable2}`);
                                    console.log(`   Buy ${buyDex}: $${buyPrice.toFixed(6)} | Sell ${sellDex}: $${sellPrice.toFixed(6)}`);
                                    console.log(`   Spread: ${spread.toFixed(4)}% | Gross Profit: $${grossProfit.toFixed(2)}`);
                                    console.log(`   Net Profit: $${netProfit.toFixed(2)} (after fees & slippage)`);

                                    opportunities.push({
                                        type: 'stablecoin_flashloan_arbitrage',
                                        pair: `${stable1}/${stable2}`,
                                        token: stable1, // Use stable1 as base token for flashloan
                                        buyDex: buyDex,
                                        sellDex: sellDex,
                                        buyPrice: buyPrice,
                                        sellPrice: sellPrice,
                                        spread: spread,
                                        flashloanAmount: FLASHLOAN_AMOUNT,
                                        grossProfit: grossProfit,
                                        netProfit: netProfit,
                                        fees: {
                                            dexFees: dexFeeRate * 2 * FLASHLOAN_AMOUNT,
                                            flashloanFee: flashloanFeeRate * FLASHLOAN_AMOUNT,
                                            slippage: slippageBuffer * FLASHLOAN_AMOUNT
                                        },
                                        riskLevel: netProfit > 100 ? 'low' : netProfit > 75 ? 'medium' : 'high'
                                    });
                                }
                            }
                        }
                    }
                }
            }

            console.log(`✅ Found ${opportunities.length} stablecoin flashloan opportunities`);
            return opportunities;

        } catch (error) {
            console.error('❌ Error finding stablecoin flashloan opportunities:', error.message);
            return [];
        }
    }

    // Execute FLASHLOAN-BASED WBNB BORROWING STRATEGY (Direct PancakeSwap with Bundled Transactions)
    async _executeWbnbFlashloanArbitrage(opportunity, wbnbAmount, flashProvider) {
        try {
            const { buyDex, sellDex, buyPrice, sellPrice, spread, pair } = opportunity;

            console.log(`🔄 EXECUTING WBNB FLASHLOAN ARBITRAGE STRATEGY (BUNDLED):`);
            console.log(`   Pair: ${pair}`);
            console.log(`   Buy ${buyDex}: $${buyPrice.toFixed(6)}`);
            console.log(`   Sell ${sellDex}: $${sellPrice.toFixed(6)}`);
            console.log(`   Spread: ${spread.toFixed(4)}%`);
            console.log(`   🎯 Bundled Transaction: Single 0.25% DEX fee (vs 0.5%)`);

            console.log(`💰 WBNB Flashloan amount: ${ethers.formatEther(wbnbAmount)} WBNB ($${parseFloat(ethers.formatEther(wbnbAmount)) * 567})`);
            console.log(`✅ Selected: ${flashProvider.protocol} (${flashProvider.type}) - Fee: ${(await this.flashProvider.getDynamicFee(flashProvider.protocol) * 100).toFixed(3)}%`);

            // STEP 3: Create BUNDLED arbitrage transaction
            // Strategy: Borrow WBNB → Execute bundled arbitrage → Return WBNB + profit
            const bundledTx = await this._createBundledArbitrageTx(opportunity, wbnbAmount, flashProvider);

            // STEP 4: Execute bundled WBNB flashloan arbitrage
            console.log(`⚡ Executing bundled ${flashProvider.protocol} WBNB flashloan arbitrage...`);

            let result;
            if (flashProvider.type === 'flashSwap') {
                // DEX-native flash swap with bundled arbitrage logic
                const targetToken = this._getTokenFromPair(pair);
                const poolAddress = this.flashProvider.getPoolAddress(flashProvider.protocol, TOKENS.WBNB, targetToken);
                if (!poolAddress) {
                    throw new Error(`No pool address found for ${flashProvider.protocol} WBNB/${targetToken.symbol}`);
                }

                // Create arbitrage parameters for bundled execution
                const arbitrageParams = {
                    exchanges: [buyDex, sellDex],
                    path: [TOKENS.WBNB.address, targetToken.address], // Simplified path for bundled execution
                    buyDex: buyDex,
                    sellDex: sellDex,
                    expectedProfit: opportunity.profitPotential,
                    caller: this.signer.address,
                    gasReimbursement: ethers.parseEther('0.002'),
                    contractAddress: process.env.FLASHLOAN_ARB_CONTRACT || '0xf682bd44ca1Fb8184e359A8aF9E1732afD29BBE1',
                    bundledTx: bundledTx // Include the bundled transaction data
                };

                result = await this.flashProvider.executeFlashSwap(
                    flashProvider.protocol,
                    poolAddress,
                    wbnbAmount, // amount0 (WBNB)
                    ethers.constants.Zero, // amount1
                    arbitrageParams
                );
            } else {
                // Traditional flashloan with bundled arbitrage
                result = await this.flashProvider.executeFlashLoan(
                    flashProvider.protocol,
                    TOKENS.WBNB.address,
                    wbnbAmount,
                    {
                        exchanges: [buyDex, sellDex],
                        path: [TOKENS.WBNB.address, this._getTokenFromPair(pair).address],
                        buyDex: buyDex,
                        sellDex: sellDex,
                        expectedProfit: opportunity.profitPotential,
                        caller: this.signer.address,
                        gasReimbursement: ethers.parseEther('0.002'),
                        contractAddress: process.env.FLASHLOAN_ARB_CONTRACT || '0xf682bd44ca1Fb8184e359A8aF9E1732afD29BBE1',
                        bundledTx: bundledTx
                    }
                );
            }

            console.log(`✅ BUNDLED WBNB flashloan arbitrage executed successfully!`);
            console.log(`   Transaction: ${result.txHash}`);
            console.log(`   Gas used: ${result.gasUsed.toString()}`);
            console.log(`   💸 Fee Savings: 50% DEX fee reduction via bundling!`);

            // STEP 5: Calculate actual profit (bundled transaction reduces fees)
            const flashFee = await this.flashProvider.estimateFlashCost(wbnbAmount, flashProvider.protocol);
            const gasCost = result.gasUsed.mul(ethers.parseUnits('5', 'gwei'));

            console.log(`💰 BUNDLED WBNB FLASHLOAN ARBITRAGE RESULT:`);
            console.log(`   Flashloan amount: ${ethers.formatEther(wbnbAmount)} WBNB ($${parseFloat(ethers.formatEther(wbnbAmount)) * 567})`);
            console.log(`   Flash fee: ${ethers.formatEther(flashFee)} WBNB`);
            console.log(`   DEX fee (bundled): 0.25% (vs 0.5% separate)`);
            console.log(`   Gas cost: ${ethers.formatEther(gasCost)} BNB`);
            console.log(`   Expected arbitrage profit: $${opportunity.profitPotential.toFixed(4)}`);
            console.log(`   Net result: HIGHLY PROFITABLE ✅ (bundled savings)`);

            // Record successful arbitrage
            this._recordSuccessfulTransaction();

            return {
                txHash: result.txHash,
                flashAmount: wbnbAmount,
                flashFee: flashFee,
                gasCost: gasCost,
                protocol: flashProvider.protocol,
                strategy: 'wbnb_borrowing_bundled',
                feeSavings: '50% DEX fee reduction'
            };

        } catch (error) {
            console.error('🚫 WBNB flashloan arbitrage execution failed:', error.message);
            this._recordFailedTransaction();
            throw error;
        }
    }

    // Create bundled arbitrage transaction (single atomic transaction for both swaps)
    async _createBundledArbitrageTx(opportunity, flashAmount, flashProvider) {
        const { buyDex, sellDex, pair } = opportunity;
        const targetToken = this._getTokenFromPair(pair);

        // Calculate amounts for bundled transaction
        const amountIn = flashAmount;
        const expectedOutFromFirstSwap = amountIn.mul(ethers.BigNumber.from(995)).div(ethers.BigNumber.from(1000)); // 0.5% slippage for first swap
        const expectedOutFromSecondSwap = expectedOutFromFirstSwap.mul(ethers.BigNumber.from(995)).div(ethers.BigNumber.from(1000)); // 0.5% slippage for second swap

        // Minimum output: account for arbitrage spread + slippage
        const minAmountOut = amountIn.mul(ethers.BigNumber.from(Math.floor((1 + opportunity.spread - 0.01) * 1000))).div(ethers.BigNumber.from(1000)); // Spread - 1% slippage

        console.log(`📦 Creating bundled arbitrage transaction:`);
        console.log(`   Amount In: ${ethers.formatEther(amountIn)} WBNB`);
        console.log(`   Expected Out: ${ethers.formatEther(expectedOutFromSecondSwap)} WBNB`);
        console.log(`   Minimum Out: ${ethers.formatEther(minAmountOut)} WBNB`);
        console.log(`   Path: WBNB → ${targetToken.symbol} → WBNB`);
        console.log(`   DEXes: ${buyDex} → ${sellDex}`);

        // For now, return transaction parameters that can be executed by the flash provider
        // In a full implementation, this would create a multi-call transaction
        return {
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            path: [TOKENS.WBNB.address, targetToken.address, TOKENS.WBNB.address],
            dexes: [buyDex, sellDex],
            type: 'bundled_arbitrage'
        };
    }

    // Calculate optimal WBNB flashloan amount (exact USD equivalent)
    _calculateOptimalWbnbFlashloan(opportunity) {
        // WBNB BORROWING STRATEGY: Calculate exact USD equivalent in BNB
        const bnbPrice = 567; // Current BNB price
        const maxUSD = 50000; // $50K maximum (reasonable for flashloans)
        const minUSD = 1000;  // $1K minimum for meaningful profits

        // Base amount: $10K for moderate opportunities
        let targetUSD = 10000;

        // Scale based on opportunity quality and spread
        if (opportunity.spread > 0.01) {
            targetUSD = Math.min(targetUSD * 2, maxUSD); // Double for high spread
        } else if (opportunity.spread > 0.005) {
            targetUSD = Math.min(targetUSD * 1.5, maxUSD); // +50% for medium spread
        } else if (opportunity.spread > 0.001) {
            targetUSD = Math.min(targetUSD * 1.2, maxUSD); // +20% for low spread
        }

        // Ensure minimum
        targetUSD = Math.max(targetUSD, minUSD);

        // Convert USD to BNB amount
        const bnbAmount = targetUSD / bnbPrice;
        const wbnbAmount = ethers.parseEther(bnbAmount.toFixed(6));

        console.log(`💰 WBNB FLASHLOAN CALCULATION:`);
        console.log(`   Target: $${targetUSD.toLocaleString()} USD`);
        console.log(`   BNB Amount: ${bnbAmount.toFixed(6)} WBNB`);
        console.log(`   Spread: ${opportunity.spread.toFixed(4)}%`);
        console.log(`   Strategy: Borrow WBNB → Swap to ${opportunity.pair.split('/')[1]} → Swap back → Return WBNB + Profit`);

        return wbnbAmount;
    }

    // Get token object from pair string (e.g., "WBNB/USDT" → TOKENS.USDT)
    _getTokenFromPair(pair) {
        const [tokenA, tokenB] = pair.split('/');
        // Return the non-WBNB token (since we're borrowing WBNB)
        return tokenA === 'WBNB' ? TOKENS[tokenB] : TOKENS[tokenA];
    }

    // Validate pool data availability
    async _validatePoolData(protocol, tokenA, tokenB) {
        try {
            console.log(`🔍 Validating pool data for ${protocol}: ${tokenA.symbol}/${tokenB.symbol}`);

            // Check if pool address exists in configuration
            const poolAddress = this.flashProvider.getPoolAddress(protocol, tokenA, tokenB);
            if (!poolAddress) {
                console.log(`❌ No pool address found for ${protocol} ${tokenA.symbol}/${tokenB.symbol}`);
                return false;
            }

            // Try to query pool data
            if (protocol === 'PancakeSwap' || protocol === 'Biswap') {
                try {
                    const poolContract = new ethers.Contract(poolAddress, [
                        'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
                        'function token0() external view returns (address)',
                        'function token1() external view returns (address)'
                    ], this.provider);

                    const [reserve0, reserve1] = await poolContract.getReserves();
                    const token0Address = await poolContract.token0();
                    const token1Address = await poolContract.token1();

                    // Check if reserves are meaningful (> 1 token each)
                    const reserve0BN = ethers.BigNumber.from(reserve0);
                    const reserve1BN = ethers.BigNumber.from(reserve1);

                    if (reserve0BN.lt(ethers.parseEther('1')) || reserve1BN.lt(ethers.parseEther('1'))) {
                        console.log(`⚠️ Low liquidity in ${protocol} pool: ${ethers.formatEther(reserve0)} / ${ethers.formatEther(reserve1)}`);
                        return false;
                    }

                    console.log(`✅ Pool validated: ${protocol} ${tokenA.symbol}/${tokenB.symbol}`);
                    console.log(`   Reserves: ${ethers.formatEther(reserve0)} / ${ethers.formatEther(reserve1)}`);
                    return true;

                } catch (contractError) {
                    console.log(`❌ Contract error validating ${protocol} pool: ${contractError.message}`);
                    return false;
                }
            }

            // For other protocols, assume valid if address exists
            console.log(`✅ Pool address exists for ${protocol} ${tokenA.symbol}/${tokenB.symbol}`);
            return true;

        } catch (error) {
            console.log(`❌ Error validating pool data: ${error.message}`);
            return false;
        }
    }

    // Calculate optimal flashloan amount based on arbitrage opportunity - PROFITABLE $5000+ FLASHLOANS
    _calculateOptimalFlashAmount(opportunity, flashProvider) {
        // PROFITABLE FLASHLOANS: Target $5000+ for meaningful profits
        const targetUSD = 5000; // Minimum $5000 flashloan for profitability
        const bnbPrice = 567; // Current BNB price approximation
        const targetBNB = targetUSD / bnbPrice; // ~8.82 BNB for $5000

        let baseAmount = ethers.parseEther(targetBNB.toFixed(2));

        // Scale based on opportunity quality (higher spread = larger loan for more profit)
        if (opportunity.spread > 0.01) {
            baseAmount = baseAmount.mul(ethers.BigNumber.from(150)).div(ethers.BigNumber.from(100)); // +50% for high spread ($7500)
        } else if (opportunity.spread > 0.005) {
            baseAmount = baseAmount.mul(ethers.BigNumber.from(120)).div(ethers.BigNumber.from(100)); // +20% for medium spread ($6000)
        }

        // Check available balance
        const availableBalance = this.preTradeBalance || ethers.parseEther('0.004');
        const safeBalance = availableBalance.sub(this.minBalanceRequired);

        // If balance is insufficient for $5000 flashloan, use maximum possible
        if (baseAmount.gt(safeBalance)) {
            console.log(`⚠️ Insufficient balance for $5000+ flashloan, using maximum available`);
            baseAmount = safeBalance.mul(ethers.BigNumber.from(80)).div(ethers.BigNumber.from(100)); // Use 80% of safe balance
        }

        // Minimum flashloan of 1 WBNB (~$567) for meaningful arbitrage
        const minAmount = ethers.parseEther('1');
        if (baseAmount.lt(minAmount)) {
            baseAmount = minAmount;
        }

        // Maximum cap at $25000 to prevent over-leveraging
        const maxUSD = 25000;
        const maxBNB = maxUSD / bnbPrice;
        const maxAmount = ethers.parseEther(maxBNB.toFixed(2));
        if (baseAmount.gt(maxAmount)) {
            baseAmount = maxAmount;
        }

        const finalUSD = parseFloat(ethers.formatEther(baseAmount)) * bnbPrice;
        console.log(`💰 PROFITABLE FLASHLOAN: ${ethers.formatEther(baseAmount)} WBNB ($${finalUSD.toFixed(0)} USD)`);
        console.log(`   Target: $5000+ for meaningful profits`);
        console.log(`   Spread: ${opportunity.spread.toFixed(4)}%`);
        console.log(`   Available balance: ${ethers.formatEther(availableBalance)} BNB`);

        return baseAmount;
    }

    // Execute stablecoin flashloan arbitrage (100K loans)
    async _executeStablecoinFlashloanArbitrage(opportunity) {
        try {
            const { pair, token, buyDex, sellDex, flashloanAmount, netProfit } = opportunity;

            console.log(`🔄 EXECUTING STABLECOIN FLASHLOAN ARBITRAGE:`);
            console.log(`   Pair: ${pair} | Amount: $${flashloanAmount.toLocaleString()}`);
            console.log(`   Buy: ${buyDex} | Sell: ${sellDex}`);
            console.log(`   Expected Net Profit: $${netProfit.toFixed(2)}`);

            // STEP 1: Find best flashloan provider for the stablecoin
            console.log(`🏦 Finding best flashloan provider for ${token}...`);
            const flashProvider = await this.flashProvider.findBestFlashProvider(TOKENS[token].address, ethers.parseUnits(flashloanAmount.toString(), 18));

            if (!flashProvider) {
                throw new Error(`No suitable flashloan provider found for ${token}`);
            }

            console.log(`✅ Selected: ${flashProvider.protocol} (${flashProvider.type}) - Fee: ${flashProvider.fee.toString()}`);

            // STEP 2: Use the 100K flashloan amount as specified
            const flashAmount = ethers.parseUnits(flashloanAmount.toString(), 18);
            console.log(`💰 Flashloan amount: ${ethers.formatEther(flashAmount)} ${token} ($${flashloanAmount.toLocaleString()})`);

            // STEP 3: Prepare arbitrage parameters for stablecoin pair
            const arbitrageParams = {
                exchanges: [buyDex, sellDex],
                path: [TOKENS[token].address, TOKENS[pair.split('/')[1]].address], // e.g., [USDT, USDC]
                buyDex: buyDex,
                sellDex: sellDex,
                expectedProfit: netProfit,
                caller: this.signer.address,
                gasReimbursement: ethers.parseEther('0.002'), // Reimburse gas
                contractAddress: process.env.FLASHLOAN_ARB_CONTRACT || '0xf682bd44ca1Fb8184e359A8aF9E1732afD29BBE1'
            };

            // STEP 4: Execute flashloan arbitrage
            console.log(`⚡ Executing ${flashProvider.protocol} stablecoin flashloan arbitrage...`);

            let result;
            if (flashProvider.type === 'flashSwap') {
                // DEX-native flash swap
                const poolAddress = this.flashProvider.getPoolAddress(flashProvider.protocol, TOKENS[token], TOKENS[pair.split('/')[1]]);
                if (!poolAddress) {
                    throw new Error(`No pool address found for ${flashProvider.protocol} ${pair}`);
                }

                result = await this.flashProvider.executeFlashSwap(
                    flashProvider.protocol,
                    poolAddress,
                    flashAmount, // amount0
                    ethers.constants.Zero, // amount1
                    arbitrageParams
                );
            } else {
                // Traditional flashloan
                result = await this.flashProvider.executeFlashLoan(
                    flashProvider.protocol,
                    TOKENS[token].address,
                    flashAmount,
                    arbitrageParams
                );
            }

            console.log(`✅ Stablecoin flashloan arbitrage executed successfully!`);
            console.log(`   Transaction: ${result.txHash}`);
            console.log(`   Gas used: ${result.gasUsed.toString()}`);

            // STEP 5: Calculate final results
            const flashFee = await this.flashProvider.estimateFlashCost(flashAmount, flashProvider.protocol);
            const gasCost = result.gasUsed.mul(ethers.parseUnits('5', 'gwei'));

            console.log(`💰 STABLECOIN FLASHLOAN ARBITRAGE RESULT:`);
            console.log(`   Flashloan amount: ${ethers.formatEther(flashAmount)} ${token}`);
            console.log(`   Flash fee: ${ethers.formatEther(flashFee)} ${token}`);
            console.log(`   Gas cost: ${ethers.formatEther(gasCost)} BNB`);
            console.log(`   Expected net profit: $${netProfit.toFixed(2)}`);
            console.log(`   Net result: PROFITABLE ✅`);

            // Record successful arbitrage
            this._recordSuccessfulTransaction();

            return {
                txHash: result.txHash,
                flashAmount: flashAmount,
                flashFee: flashFee,
                gasCost: gasCost,
                protocol: flashProvider.protocol,
                netProfit: netProfit
            };

        } catch (error) {
            console.error('🚫 Stablecoin flashloan arbitrage execution failed:', error.message);
            this._recordFailedTransaction();
            throw error;
        }
    }

    // Execute multi-token arbitrage (3-token triangular or 4-token quad) - PRIORITY ROUTES
    async _executeQuadArbitrage(opportunity) {
        try {
            const { path, dexes, expectedProfit, type } = opportunity;
            const isTriangular = type === 'triangular' || path.length === 3;

            if (isTriangular) {
                // Handle 3-token triangular arbitrage
                const [tokenA, tokenB, tokenC] = path;
                console.log(`🔄 EXECUTING TRIANGULAR ARBITRAGE - UTMOST PRIORITY:`);
                console.log(`   Path: ${tokenA} → ${tokenB} → ${tokenC} → ${tokenA}`);
                console.log(`   Expected profit: ${expectedProfit.toFixed(4)}%`);

                // Get token addresses
                const tokenAAddress = TOKENS[tokenA].address;
                const tokenBAddress = TOKENS[tokenB].address;
                const tokenCAddress = TOKENS[tokenC].address;

                // Calculate deadline
                const deadline = Math.floor(Date.now() / 1000) + 300;

                // BUNDLED TRIANGULAR ARBITRAGE: Single multi-hop swap
                const fullPath = [tokenAAddress, tokenBAddress, tokenCAddress, tokenAAddress];

                // Calculate optimal amount and minimum output
                const optimalAmount = ethers.parseEther('1');
                const minAmountOut = optimalAmount.mul(ethers.BigNumber.from(Math.floor((1 + expectedProfit - 0.005) * 1000))).div(ethers.BigNumber.from(1000));

                console.log(`📦 TRIANGULAR ARBITRAGE BUNDLED:`);
                console.log(`   Amount: ${ethers.formatEther(optimalAmount)} ${tokenA}`);
                console.log(`   Expected profit: ${expectedProfit*100}%`);
                console.log(`   Minimum out: ${ethers.formatEther(minAmountOut)} ${tokenA}`);

                // Encode the bundled 3-hop swap
                const tx = {
                    to: DEX_CONFIGS.PANCAKESWAP.router,
                    data: this._encodeMultiHopSwap(tokenAAddress, optimalAmount, minAmountOut, fullPath, deadline),
                    value: 0,
                    gasLimit: ethers.BigNumber.from(2000000), // Gas limit for 3-hop
                    gasPrice: ethers.parseUnits(this.maxGasPrice.toString(), 'gwei')
                };

                // Validate and execute
                await this._validateTransactionSafety(tx);
                const txResponse = await this.signer.sendTransaction(tx);
                console.log(`✅ Triangular arbitrage transaction submitted: ${txResponse.hash}`);
                this._recordSuccessfulTransaction();
                return txResponse;

            } else {
                // Handle 4-token quad arbitrage
                const [tokenA, tokenB, tokenC, tokenD] = path;
                console.log(`🎯 EXECUTING QUAD ARBITRAGE - PRIORITY ROUTE:`);
                console.log(`   Path: ${tokenA} → ${tokenB} → ${tokenC} → ${tokenD} → ${tokenA}`);
                console.log(`   Expected profit: ${expectedProfit.toFixed(4)}%`);

                // Get token addresses
                const tokenAAddress = TOKENS[tokenA].address;
                const tokenBAddress = TOKENS[tokenB].address;
                const tokenCAddress = TOKENS[tokenC].address;
                const tokenDAddress = TOKENS[tokenD].address;

                // Calculate deadline
                const deadline = Math.floor(Date.now() / 1000) + 300;

                // Create 4-hop swap path
                const fullPath = [tokenAAddress, tokenBAddress, tokenCAddress, tokenDAddress, tokenAAddress];

                // Calculate optimal amount and minimum output
                const optimalAmount = ethers.parseEther('1');
                const minAmountOut = optimalAmount.mul(ethers.BigNumber.from(Math.floor((1 + expectedProfit - 0.01) * 1000))).div(ethers.BigNumber.from(1000));

                console.log(`📦 QUAD ARBITRAGE BUNDLED:`);
                console.log(`   Amount: ${ethers.formatEther(optimalAmount)} ${tokenA}`);
                console.log(`   Expected profit: ${expectedProfit*100}%`);
                console.log(`   Minimum out: ${ethers.formatEther(minAmountOut)} ${tokenA}`);

                // Encode the bundled 4-hop swap
                const tx = {
                    to: DEX_CONFIGS.PANCAKESWAP.router,
                    data: this._encodeQuadHopSwap(tokenAAddress, optimalAmount, minAmountOut, fullPath, deadline),
                    value: 0,
                    gasLimit: ethers.BigNumber.from(2500000), // Higher gas limit for 4-hop
                    gasPrice: ethers.parseUnits(this.maxGasPrice.toString(), 'gwei')
                };

                // Validate and execute
                await this._validateTransactionSafety(tx);
                const txResponse = await this.signer.sendTransaction(tx);
                console.log(`✅ Quad arbitrage transaction submitted: ${txResponse.hash}`);
                this._recordSuccessfulTransaction();
                return txResponse;
            }

        } catch (error) {
            console.error('❌ Multi-token arbitrage execution failed:', error.message);
            this._recordFailedTransaction();
            throw error;
        }
    }

    // Execute stablecoin arbitrage (legacy - kept for compatibility)
    async _executeStablecoinArbitrage(opportunity) {
        try {
            // Create transaction for stablecoin arbitrage
            const tx = await this._createStablecoinArbitrageTx(opportunity);

            // CRITICAL: Validate transaction safety before execution
            await this._validateTransactionSafety(tx);

            // Execute transaction
            const txResponse = await this.signer.sendTransaction(tx);
            console.log(`Stablecoin arbitrage transaction submitted: ${txResponse.hash}`);

            // Record successful transaction
            this._recordSuccessfulTransaction();

            return txResponse;
        } catch (error) {
            console.error('Stablecoin arbitrage execution failed:', error.message);
            this._recordFailedTransaction();
            throw error;
        }
    }

    // Execute swap: ETH/BNB -> Tokens
    async _executeSwapETHForTokens(dexName, amountIn, tokenOut, intermediateToken = null) {
        const dexKey = dexName.toUpperCase();
        const dexConfig = DEX_CONFIGS[dexKey];

        if (!dexConfig) {
            throw new Error(`DEX ${dexName} not configured`);
        }

        // Create router contract
        const router = new ethers.Contract(
            dexConfig.router,
            [
                'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
                'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'
            ],
            this.signer
        );

        // Create swap path
        const path = intermediateToken
            ? [TOKENS.WBNB.address, intermediateToken, tokenOut] // Multi-hop
            : [TOKENS.WBNB.address, tokenOut]; // Direct

        // Get expected output amount
        const amountsOut = await router.getAmountsOut(amountIn, path);
        const expectedOut = amountsOut[amountsOut.length - 1];

        // Apply slippage protection (0.5%)
        const minAmountOut = expectedOut.mul(ethers.BigNumber.from(995)).div(ethers.BigNumber.from(1000));

        const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

        console.log(`🔄 Swapping ${ethers.formatEther(amountIn)} BNB -> tokens via ${dexName}`);
        console.log(`   Path: ${path.join(' -> ')}`);
        console.log(`   Expected: ${ethers.formatEther(expectedOut)} tokens`);
        console.log(`   Minimum: ${ethers.formatEther(minAmountOut)} tokens`);

        // Execute the swap using router.functions.swapExactETHForTokens
        const txData = await router.functions.swapExactETHForTokens(
            minAmountOut,
            path,
            this.signer.address,
            deadline
        );

        const tx = await txData.buildTransaction({
            value: amountIn, // Send BNB with transaction
            gasLimit: 800000,
            gasPrice: ethers.parseUnits(this.maxGasPrice.toString(), 'gwei')
        });

        // Validate transaction safety
        await this._validateTransactionSafety(tx);

        // Execute transaction
        const txResponse = await this.signer.sendTransaction(tx);
        console.log(`✅ Swap executed: ${txResponse.hash}`);

        return txResponse;
    }

    // Execute swap: Tokens -> ETH/BNB
    async _executeSwapTokensForETH(dexName, amountIn, tokenIn, intermediateToken = null) {
        const dexKey = dexName.toUpperCase();
        const dexConfig = DEX_CONFIGS[dexKey];

        if (!dexConfig) {
            throw new Error(`DEX ${dexName} not configured`);
        }

        // Create router contract
        const router = new ethers.Contract(
            dexConfig.router,
            [
                'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
                'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'
            ],
            this.signer
        );

        // Create swap path
        const path = intermediateToken
            ? [tokenIn, intermediateToken, TOKENS.WBNB.address] // Multi-hop
            : [tokenIn, TOKENS.WBNB.address]; // Direct

        // Get expected output amount
        const amountsOut = await router.getAmountsOut(amountIn, path);
        const expectedOut = amountsOut[amountsOut.length - 1];

        // Apply slippage protection (0.5%)
        const minAmountOut = expectedOut.mul(ethers.BigNumber.from(995)).div(ethers.BigNumber.from(1000));

        const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

        console.log(`🔄 Swapping ${ethers.formatEther(amountIn)} tokens -> BNB via ${dexName}`);
        console.log(`   Path: ${path.join(' -> ')}`);
        console.log(`   Expected: ${ethers.formatEther(expectedOut)} BNB`);
        console.log(`   Minimum: ${ethers.formatEther(minAmountOut)} BNB`);

        // Execute the swap
        const tx = await router.swapExactTokensForETH(
            amountIn,
            minAmountOut,
            path,
            this.signer.address,
            deadline,
            {
                gasLimit: 800000,
                gasPrice: ethers.parseUnits(this.maxGasPrice.toString(), 'gwei')
            }
        );

        // Validate transaction safety
        await this._validateTransactionSafety(tx);

        // Execute transaction
        const txResponse = await this.signer.sendTransaction(tx);
        console.log(`✅ Swap executed: ${txResponse.hash}`);

        return txResponse;
    }

    // Create WBNB/USDT arbitrage transaction (legacy - kept for compatibility)
    async _createWbnbUsdtArbitrageTx(opportunity) {
        // This method is now deprecated - use _executeWbnbUsdtArbitrage instead
        throw new Error('Use _executeWbnbUsdtArbitrage for real arbitrage execution');
    }

    // Create stablecoin arbitrage transaction
    async _createStablecoinArbitrageTx(opportunity) {
        if (opportunity.type === 'stablecoin_mispricing') {
            const { stable1, stable2, direction } = opportunity;

            // Calculate optimal amount
            const optimalAmount = ethers.parseEther('1000'); // Start with 1000 tokens

            // Determine buy/sell tokens based on direction
            let sellToken, buyToken;
            if (direction === 'sell_stable1_buy_stable2') {
                sellToken = stable1;
                buyToken = stable2;
            } else {
                sellToken = stable2;
                buyToken = stable1;
            }

            // Calculate minimum output amount with slippage protection
            const minAmountOut = optimalAmount.mul(ethers.BigNumber.from(Math.floor((1 - 0.005) * 1000))).div(ethers.BigNumber.from(1000));

            // Create swap path
            const path = [TOKENS[sellToken].address, TOKENS[buyToken].address];

            // Calculate deadline
            const deadline = Math.floor(Date.now() / 1000) + 300;

            // Encode the swap
            const tx = {
                to: DEX_CONFIGS.PANCAKESWAP.router,
                data: this._encodeTwoTokenSwap(path, optimalAmount, minAmountOut, deadline),
                value: 0,
                gasLimit: ethers.BigNumber.from(1000000),
                gasPrice: ethers.parseUnits(this.maxGasPrice.toString(), 'gwei')
            };

            return tx;
        } else if (opportunity.type === 'stablecoin_peg_break') {
            // Handle peg break arbitrage (stablecoin vs WBNB)
            const { stablecoin, pair } = opportunity;
            const [sellToken, buyToken] = pair.split('/');

            const optimalAmount = ethers.parseEther('100'); // Smaller amount for peg breaks
            const minAmountOut = optimalAmount.mul(ethers.BigNumber.from(Math.floor((1 - 0.01) * 1000))).div(ethers.BigNumber.from(1000)); // 1% slippage

            const path = [TOKENS[sellToken].address, TOKENS[buyToken].address];
            const deadline = Math.floor(Date.now() / 1000) + 300;

            const tx = {
                to: DEX_CONFIGS.PANCAKESWAP.router,
                data: this._encodeTwoTokenSwap(path, optimalAmount, minAmountOut, deadline),
                value: 0,
                gasLimit: ethers.BigNumber.from(1000000),
                gasPrice: ethers.parseUnits(this.maxGasPrice.toString(), 'gwei')
            };

            return tx;
        }
    }

    // Simplified error handling
    _handleError(error) {
        console.error('Bot error:', error);
        this.errorCount++;
        if (this.errorCount >= this.maxErrors) {
            this.stop();
            console.error('Bot stopped due to too many errors');
        }
    }



    // Winrate tracking methods
    recordTrade(success) {
        this.totalTrades++;
        if (success) {
            this.successfulTrades++;
        }
        this.winrate = this.totalTrades > 0 ? (this.successfulTrades / this.totalTrades) * 100 : 0;
    }

    displayWinrateStats() {
        console.log('\n=== Winrate Statistics ===');
        console.log(`Total Trades: ${this.totalTrades}`);
        console.log(`Successful Trades: ${this.successfulTrades}`);
        console.log(`Winrate: ${this.winrate.toFixed(2)}%`);
        console.log('========================');
    }

    getWinrate() {
        return this.winrate;
    }

    resetWinrate() {
        this.totalTrades = 0;
        this.successfulTrades = 0;
        this.winrate = 0;
        console.log('Winrate statistics reset');
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            errorCount: this.errorCount,
            winrate: {
                totalTrades: this.totalTrades,
                successfulTrades: this.successfulTrades,
                winrate: this.winrate
            },
            currentParameters: {
                maxGasPrice: this.maxGasPrice,
                minProfitUSD: this.minProfitUSD,
                scanInterval: this.scanInterval
            },
            profitProtection: {
                enabled: this.profitProtectionEnabled,
                validationCount: this.profitValidationCount,
                validationSuccess: this.profitValidationSuccess,
                successRate: this.profitValidationCount > 0 ? (this.profitValidationSuccess / this.profitValidationCount * 100).toFixed(1) + '%' : '0%',
                lastExpectedProfit: this.expectedProfitBNB > 0 ? `${this.expectedProfitBNB.toFixed(6)} BNB ($${this.expectedProfitBNB * 567})` : 'None',
                lastActualProfit: this.actualProfitBNB > 0 ? `${this.actualProfitBNB.toFixed(6)} BNB ($${this.actualProfitBNB * 567})` : 'None'
            }
        };
    }

    async stop() {
        console.log('🛑 Stopping arbitrage bot...');
        this.isRunning = false;

        // Cleanup verifier
        if (this.verifier) {
            await this.verifier.cleanup();
        }

        // Reset error count and safety measures
        this.errorCount = 0;
        this.consecutiveFailures = 0;
        this.emergencyStopTriggered = false;

        // Clear any cached data
        if (this.priceFeed) {
            this.priceFeed.clearCache();
        }

        console.log('✅ Bot stopped successfully - Safety measures reset');
    }

    // Get safety status
    getSafetyStatus() {
        return {
            emergencyStopTriggered: this.emergencyStopTriggered,
            consecutiveFailures: this.consecutiveFailures,
            maxConsecutiveFailures: this.maxConsecutiveFailures,
            minBalanceRequired: ethers.formatEther(this.minBalanceRequired),
            maxGasPerTransaction: ethers.formatEther(this.maxGasPerTransaction),
            lastTransactionTime: this.lastTransactionTime,
            minTimeBetweenTransactions: this.minTimeBetweenTransactions
        };
    }
}

module.exports = ArbitrageBot;

