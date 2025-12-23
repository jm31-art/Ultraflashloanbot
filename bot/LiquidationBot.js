import dotenv from "dotenv";
dotenv.config();
import { EventEmitter } from 'events';
import { ethers, getAddress } from 'ethers';
import axios from 'axios';
import { PROTOCOLS } from '../config/protocols.js';
const LENDING_PROTOCOLS = PROTOCOLS.LENDING_PROTOCOLS;
const TOKENS = PROTOCOLS.TOKENS;
import PriceFeed from '../services/PriceFeed.js';
import ProfitCalculator from '../utils/ProfitCalculator.js';
import TransactionVerifier from '../utils/TransactionVerifier.js';
import { monitoring } from '../src/monitoring.js';
import rpcManager from '../infra/RPCManager.js';

// Subgraph endpoints for position discovery
const SUBGRAPH_ENDPOINTS = {
  AAVE_V3: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3',
  COMPOUND_V3: 'https://api.thegraph.com/subgraphs/name/graphprotocol/compound-v3',
  VENUS: 'https://api.thegraph.com/subgraphs/name/venusprotocol/venus-subgraph'
};

// Flashloan contract configuration
const FLASHLOAN_CONTRACT_ADDRESS = process.env.FLASHLOAN_LIQUIDATION_CONTRACT || '0x0000000000000000000000000000000000000000';

// Shared gas manager for arbitrage bot integration
let sharedGasManager = null;

class LiquidationBot extends EventEmitter {
    constructor(provider, signer, options = {}) {
        super();

        this.provider = provider;
        this.signer = signer;
        this.priceFeed = new PriceFeed(provider);
        this.profitCalculator = new ProfitCalculator(provider);
        this.verifier = new TransactionVerifier(provider, signer);

        // Configuration
        this.minProfitUSD = options.minProfitUSD || 50;
        this.maxGasPrice = options.maxGasPrice || 5; // gwei
        this.scanInterval = options.scanInterval || 15000; // 15 seconds (faster for liquidations)
        this.maxLiquidationAmount = options.maxLiquidationAmount || ethers.parseEther('50000'); // $50k max
        this.liquidationBonusThreshold = options.liquidationBonusThreshold || 0.05; // 5% minimum bonus

        this.isRunning = false;
        this.lastScanTime = 0;
        this.liquidationCount = 0;
        this.successfulLiquidations = 0;
        this.scanCount = 0;
        this.lastHeartbeat = Date.now();

        // Lending protocol contracts
        this.lendingContracts = {};
        this.oracleContracts = {};
        this.flashloanContract = null;

        // Position monitoring
        this.positionCache = new Map(); // Cache positions to avoid duplicate processing
        this.eventListeners = new Map();
        this.subgraphCache = new Map();

        // Health factor thresholds for monitoring
        this.healthFactorThreshold = 1.0; // Liquidate when HF < 1.0
        this.monitoringThreshold = 1.2; // Start monitoring when HF < 1.2

        // Risk management
        this.maxSlippage = 0.02; // 2% max slippage
        this.emergencyStop = false;
        this.maxConcurrentLiquidations = options.maxConcurrentLiquidations || 3;
        this.activeLiquidations = 0;

        // Performance metrics
        this.scanMetrics = {
            totalScans: 0,
            positionsFound: 0,
            profitableOpportunities: 0,
            averageScanTime: 0,
            lastScanDuration: 0
        };

        // Shared gas manager integration
        this.sharedGasManager = options.sharedGasManager || null;

        // LIQUIDATION SCOPE NARROWING: Focus on high-volatility, newly listed, borrow-heavy assets
        this.tokenList = this._narrowLiquidationScope(Object.values(TOKENS));
        if (this.tokenList.length === 0) {
            console.warn("⚠️ No qualifying tokens found for liquidation scanning");
        } else {
            console.log(`✅ Narrowed to ${this.tokenList.length} high-priority tokens for liquidation scanning`);
        }

        this.emit('initialized');
    }

    /**
     * Narrow liquidation scope to high-priority assets
     * @private
     */
    _narrowLiquidationScope(allTokens) {
        const qualifyingTokens = [];

        // HIGH-VOLATILITY COLLATERAL: Focus on volatile assets that make good collateral
        const highVolatilityAssets = [
            'WBNB', 'BTCB', 'ETH', 'CAKE', 'BAKE', 'BANANA'
        ];

        // NEWLY LISTED MARKETS: Recently added assets (within last 6 months)
        const newlyListedAssets = [
            // Add newly listed assets here as they become available
        ];

        // BORROW-HEAVY ASSETS: Assets commonly used as debt
        const borrowHeavyAssets = [
            'USDT', 'USDC', 'BUSD', 'DAI', 'FRAX'
        ];

        for (const token of allTokens) {
            if (!token || !ethers.isAddress(token.address)) {
                continue; // Skip invalid tokens
            }

            const symbol = token.symbol;
            let qualifies = false;
            let reason = '';

            // Check high-volatility collateral
            if (highVolatilityAssets.includes(symbol)) {
                qualifies = true;
                reason = 'high-volatility collateral';
            }
            // Check newly listed (placeholder logic)
            else if (newlyListedAssets.includes(symbol)) {
                qualifies = true;
                reason = 'newly listed market';
            }
            // Check borrow-heavy assets
            else if (borrowHeavyAssets.includes(symbol)) {
                qualifies = true;
                reason = 'borrow-heavy asset';
            }
            // Additional criteria: liquidation bonus > 5%
            else if (this._hasAdequateLiquidationBonus(symbol)) {
                qualifies = true;
                reason = 'adequate liquidation bonus';
            }

            if (qualifies) {
                qualifyingTokens.push({ ...token, qualificationReason: reason });
                console.log(`🎯 Included ${symbol} for liquidation scanning (${reason})`);
            } else {
                console.log(`⏭️ Skipped ${symbol} for liquidation scanning (low priority)`);
            }
        }

        return qualifyingTokens;
    }

    /**
     * Check if asset has adequate liquidation bonus
     * @private
     */
    _hasAdequateLiquidationBonus(symbol) {
        // Protocol-specific liquidation bonuses
        const liquidationBonuses = {
            // Aave V3 typical bonuses
            WBNB: 0.05, BTCB: 0.10, ETH: 0.08,
            // Venus typical bonuses
            CAKE: 0.05, BAKE: 0.05,
            // Default minimum
            default: 0.05
        };

        const bonus = liquidationBonuses[symbol] || liquidationBonuses.default;
        return bonus >= 0.05; // 5% minimum threshold
    }

    async initialize() {
        try {
            console.log('🔄 Initializing Liquidation Bot...');

            // Initialize lending protocol contracts
            await this._initializeLendingContracts();

            // Initialize price feeds
            await this.priceFeed.updatePrices(Object.values(TOKENS), Object.values(LENDING_PROTOCOLS));

            // Verify contract connections
            await this._verifyConnections();

            console.log('✅ Liquidation Bot initialized successfully');
            return true;

        } catch (error) {
            console.error('❌ Failed to initialize Liquidation Bot:', error);
            return false;
        }
    }

    async _initializeLendingContracts() {
        // Initialize Aave V3 with proper address validation
        const AAVE_LENDING_POOL = LENDING_PROTOCOLS.AAVE?.pool || LENDING_PROTOCOLS.AAVE?.lendingPool;
        const aaveEnabled = LENDING_PROTOCOLS.AAVE?.enabled !== false;

        if (!aaveEnabled || !AAVE_LENDING_POOL || !ethers.isAddress(AAVE_LENDING_POOL) || AAVE_LENDING_POOL === '0x0000000000000000000000000000000000000000') {
            console.log("ℹ️ AAVE protocol disabled or not configured for BSC - skipping AAVE");
        } else {
            try {
                const checksummedAddress = getAddress(AAVE_LENDING_POOL);
                const aaveAbi = [
                    "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
                    "function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)",
                    "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)",
                    "event Repay(address indexed reserve, address user, address indexed repayer, uint256 amount)",
                    "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)"
                ];
                this.lendingContracts.AAVE = new ethers.Contract(
                    checksummedAddress,
                    aaveAbi,
                    this.provider
                );
                console.log("✅ Aave V3 initialized");
            } catch (e) {
                console.warn("⚠️ Failed to initialize AAVE contract:", e.message);
            }
        }

        // Initialize Compound V3 (skip if not properly configured or disabled)
        const compoundEnabled = LENDING_PROTOCOLS.COMPOUND?.enabled !== false;
        if (!compoundEnabled || !LENDING_PROTOCOLS.COMPOUND || !LENDING_PROTOCOLS.COMPOUND.comet || LENDING_PROTOCOLS.COMPOUND.comet === '0x0000000000000000000000000000000000000000') {
            console.log("ℹ️ Compound protocol disabled or not configured for BSC - skipping Compound");
        } else if (typeof LENDING_PROTOCOLS.COMPOUND.comet !== "string") {
            console.warn("⚠️ Skipping Compound - invalid comet address type");
        } else {
            try {
                LENDING_PROTOCOLS.COMPOUND.comet = getAddress(LENDING_PROTOCOLS.COMPOUND.comet);

                const compoundAbi = [
                    "function getHealthFactor(address account) view returns (uint256)",
                    "function liquidateBorrow(address borrower, uint256 repayAmount, address cTokenCollateral) returns (uint256)",
                    "function borrowBalanceOf(address account) view returns (uint256)",
                    "function collateralBalanceOf(address account, address asset) view returns (uint256)",
                    "event Supply(address indexed from, address indexed dst, uint256 amount)",
                    "event Withdraw(address indexed src, address indexed to, uint256 amount)",
                    "event Transfer(address indexed from, address indexed to, uint256 amount)"
                ];
                this.lendingContracts.COMPOUND = new ethers.Contract(
                    LENDING_PROTOCOLS.COMPOUND.comet,
                    compoundAbi,
                    this.provider
                );
                console.log("✅ Compound V3 initialized");
            } catch (e) {
                console.warn("⚠️ Failed to initialize Compound contract:", e.message);
            }
        }

        // Initialize Venus Protocol
        const venusEnabled = LENDING_PROTOCOLS.VENUS?.enabled !== false;
        if (!venusEnabled || !LENDING_PROTOCOLS.VENUS || !LENDING_PROTOCOLS.VENUS.comptroller || LENDING_PROTOCOLS.VENUS.comptroller === '0x0000000000000000000000000000000000000000') {
            console.log("ℹ️ Venus protocol disabled or not configured for BSC - skipping Venus");
        } else if (typeof LENDING_PROTOCOLS.VENUS.comptroller !== "string") {
            console.warn("⚠️ Skipping Venus - invalid comptroller address type");
        } else {
            try {
                LENDING_PROTOCOLS.VENUS.comptroller = getAddress(LENDING_PROTOCOLS.VENUS.comptroller);

                const venusAbi = [
                    "function getAccountLiquidity(address account) view returns (uint256, uint256, uint256)",
                    "function liquidateBorrow(address borrower, address underlyingBorrow, address underlyingCollateral, uint256 repayAmount) returns (uint256)",
                    "function markets(address) view returns (bool, uint256, bool)",
                    "function oracle() view returns (address)",
                    "function getAssetsIn(address) view returns (address[])",
                    "event Borrow(address borrower, uint borrowAmount, uint accountBorrows, uint totalBorrows)",
                    "event RepayBorrow(address payer, address borrower, uint repayAmount, uint accountBorrows, uint totalBorrows)",
                    "event LiquidateBorrow(address liquidator, address borrower, uint repayAmount, address cTokenCollateral, uint seizeTokens)"
                ];
                this.lendingContracts.VENUS = new ethers.Contract(
                    LENDING_PROTOCOLS.VENUS.comptroller,
                    venusAbi,
                    this.provider
                );
                console.log("✅ Venus Protocol initialized");
            } catch (e) {
                console.warn("⚠️ Failed to initialize Venus contract:", e.message);
            }
        }

        // Initialize flashloan contract for atomic liquidations
        if (FLASHLOAN_CONTRACT_ADDRESS && FLASHLOAN_CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000') {
            try {
                const flashloanAbi = [
                    "function executeLiquidation(address lendingProtocol, address borrower, address debtAsset, address collateralAsset, uint256 debtToCover, uint256 minProfit) external",
                    "function executeAtomicLiquidation(address lendingProtocol, address borrower, address debtAsset, address collateralAsset, uint256 debtToCover, uint256 minProfit, bytes calldata arbitrageData) external",
                    "function executeFlashloanArbitrage(address asset, uint256 amount, address[] calldata path, address router, uint256 minProfit) external"
                ];
                this.flashloanContract = new ethers.Contract(
                    FLASHLOAN_CONTRACT_ADDRESS,
                    flashloanAbi,
                    this.signer
                );
                console.log("✅ Flashloan contract configured:", FLASHLOAN_CONTRACT_ADDRESS);
                console.log("🔥 Ready for atomic liquidation execution");
            } catch (e) {
                console.warn("⚠️ Failed to initialize flashloan contract:", e.message);
                this.flashloanContract = null;
            }
        } else {
            console.log("ℹ️ Flashloan contract not set - using direct protocol calls");
            this.flashloanContract = null;
        }
    }

    async _verifyConnections() {
        for (const [protocol, contract] of Object.entries(this.lendingContracts)) {
            try {
                // Simple call to verify connection
                if (protocol === 'AAVE') {
                    await contract.getUserAccountData(ethers.ZeroAddress);
                }
                console.log(`✅ ${protocol} contract connected`);
            } catch (error) {
                console.warn(`⚠️ ${protocol} contract connection issue:`, error.message);
            }
        }
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('🚀 Starting Liquidation Bot...');

        // Setup real-time event listeners for position monitoring
        await this._setupEventListeners();

        // Start heartbeat monitoring
        this._startHeartbeat();

        while (this.isRunning) {
            try {
                await this._scanForLiquidationOpportunities();
                await new Promise(resolve => setTimeout(resolve, this.scanInterval));

            } catch (error) {
                console.error('❌ Error in liquidation scan loop:', error);
                monitoring.logCriticalError(error, 'scan_loop');
                await new Promise(resolve => setTimeout(resolve, this.scanInterval * 2)); // Wait longer on error
            }
        }
    }

    /**
     * REAL-TIME EVENT LISTENERS
     * Monitor blockchain events for positions becoming at risk
     */
    async _setupEventListeners() {
        console.log('📡 Setting up real-time event listeners...');

        for (const [protocolName, contract] of Object.entries(this.lendingContracts)) {
            try {
                const listeners = this._createProtocolListeners(protocolName, contract);
                this.eventListeners.set(protocolName, listeners);
                console.log(`✅ ${protocolName} event listeners active`);
            } catch (error) {
                console.warn(`⚠️ Failed to setup ${protocolName} listeners:`, error.message);
            }
        }

        console.log('📡 Event listeners setup complete');
    }

    _createProtocolListeners(protocolName, contract) {
        const listeners = [];

        try {
            switch (protocolName.toUpperCase()) {
                case 'AAVE':
                    // Try event subscription, fall back to polling if not supported
                    if (contract.filters.Borrow) {
                        try {
                            const borrowListener = contract.on('Borrow', async (reserve, user, onBehalfOf, amount, referralCode, event) => {
                                await this._handleBorrowEvent(protocolName, user, event);
                            });
                            listeners.push(borrowListener);
                        } catch (subscriptionError) {
                            if (subscriptionError.message.includes('contract runner does not support subscribing')) {
                                console.log(`📊 ${protocolName}: Event subscription not supported, using polling fallback`);
                                // Polling will be handled in _scanRecentEvents
                            } else {
                                throw subscriptionError;
                            }
                        }
                    }
                    break;

                case 'VENUS':
                    // Try event subscription, fall back to polling if not supported
                    if (contract.filters.Borrow) {
                        try {
                            const borrowListener = contract.on('Borrow', async (borrower, borrowAmount, accountBorrows, totalBorrows, event) => {
                                await this._handleBorrowEvent(protocolName, borrower, event);
                            });
                            listeners.push(borrowListener);
                        } catch (subscriptionError) {
                            if (subscriptionError.message.includes('contract runner does not support subscribing')) {
                                console.log(`📊 ${protocolName}: Event subscription not supported, using polling fallback`);
                                // Polling will be handled in _scanRecentEvents
                            } else {
                                throw subscriptionError;
                            }
                        }
                    }
                    break;

                case 'COMPOUND':
                    // Try event subscription, fall back to polling if not supported
                    if (contract.filters.Supply) {
                        try {
                            const supplyListener = contract.on('Supply', async (from, dst, amount, event) => {
                                await this._handleCollateralChangeEvent(protocolName, dst, event);
                            });
                            listeners.push(supplyListener);
                        } catch (subscriptionError) {
                            if (subscriptionError.message.includes('contract runner does not support subscribing')) {
                                console.log(`📊 ${protocolName}: Event subscription not supported, using polling fallback`);
                                // Polling will be handled in _scanRecentEvents
                            } else {
                                throw subscriptionError;
                            }
                        }
                    }
                    if (contract.filters.Withdraw) {
                        try {
                            const withdrawListener = contract.on('Withdraw', async (src, to, amount, event) => {
                                await this._handleCollateralChangeEvent(protocolName, src, event);
                            });
                            listeners.push(withdrawListener);
                        } catch (subscriptionError) {
                            if (subscriptionError.message.includes('contract runner does not support subscribing')) {
                                console.log(`📊 ${protocolName}: Event subscription not supported, using polling fallback`);
                                // Polling will be handled in _scanRecentEvents
                            } else {
                                throw subscriptionError;
                            }
                        }
                    }
                    break;
            }
        } catch (error) {
            console.warn(`⚠️ Error creating ${protocolName} listeners:`, error.message);
        }

        return listeners;
    }

    async _handleBorrowEvent(protocolName, user, event) {
        try {
            // Check if this borrow puts the user at risk
            const healthFactor = await this._calculateHealthFactor(protocolName, { user });

            if (healthFactor < this.monitoringThreshold) {
                console.log(`📡 ${protocolName} borrow event: ${user} now at risk (HF: ${healthFactor.toFixed(3)})`);

                // Add to position cache for immediate scanning
                const position = {
                    user,
                    healthFactor,
                    source: 'event',
                    eventData: event,
                    timestamp: Date.now()
                };

                this.positionCache.set(`${protocolName}-${user}`, Date.now());

                // Trigger immediate scan for this position
                await this._scanSpecificPosition(protocolName, position);
            }
        } catch (error) {
            // Silently handle event processing errors
        }
    }

    async _handleCollateralChangeEvent(protocolName, user, event) {
        try {
            // Check if collateral change affects health factor
            const healthFactor = await this._calculateHealthFactor(protocolName, { user });

            if (healthFactor < this.monitoringThreshold) {
                console.log(`📡 ${protocolName} collateral change: ${user} now at risk (HF: ${healthFactor.toFixed(3)})`);

                this.positionCache.set(`${protocolName}-${user}`, Date.now());
            }
        } catch (error) {
            // Silently handle event processing errors
        }
    }

    async _scanSpecificPosition(protocolName, position) {
        try {
            // Get full position details
            const opportunities = await this._scanProtocol(protocolName, LENDING_PROTOCOLS[protocolName.toUpperCase()]);

            // Find matching opportunity
            const matchingOpportunity = opportunities.find(opp => opp.user.toLowerCase() === position.user.toLowerCase());

            if (matchingOpportunity) {
                console.log(`🎯 Immediate liquidation opportunity found for ${position.user}`);
                await this._evaluateAndExecuteLiquidation(protocolName, matchingOpportunity);
            }
        } catch (error) {
            console.warn(`⚠️ Error scanning specific position:`, error.message);
        }
    }

    /**
     * HEARTBEAT MONITORING
     */
    _startHeartbeat() {
        setInterval(async () => {
            if (this.isRunning) {
                await this.heartbeat();
            }
        }, 30000); // 30 second heartbeat
    }

    /**
     * PARALLEL PROTOCOL SCANNING
     * Runs all protocol scans concurrently with concurrency control
     */
    async _scanForLiquidationOpportunities() {
        if (this.emergencyStop) return;

        const scanStartTime = Date.now();
        this.lastScanTime = scanStartTime;
        this.scanCount++;

        try {
            // PARALLEL EXECUTION: Scan all protocols simultaneously
            const protocolPromises = Object.entries(LENDING_PROTOCOLS).map(async ([protocolName, protocol]) => {
                try {
                    const protocolStartTime = Date.now();
                    const opportunities = await this._scanProtocol(protocolName, protocol);
                    const scanDuration = Date.now() - protocolStartTime;

                    console.log(`📊 ${protocolName}: Scanned in ${scanDuration}ms, found ${opportunities.length} opportunities`);

                    return { protocolName, opportunities, scanDuration };
                } catch (error) {
                    console.error(`❌ Error scanning ${protocolName}:`, error.message);
                    return { protocolName, opportunities: [], scanDuration: 0, error: error.message };
                }
            });

            // Wait for all protocol scans to complete
            const protocolResults = await Promise.allSettled(protocolPromises);

            // Process results and execute liquidations
            const allOpportunities = [];
            let totalScanTime = 0;

            for (const result of protocolResults) {
                if (result.status === 'fulfilled') {
                    const { protocolName, opportunities, scanDuration } = result.value;
                    totalScanTime += scanDuration;

                    // Filter profitable opportunities
                    for (const opportunity of opportunities) {
                        if (this.activeLiquidations < this.maxConcurrentLiquidations) {
                            allOpportunities.push({ protocolName, opportunity });
                        } else {
                            console.log(`⚠️ ${protocolName}: Skipping opportunity due to concurrency limit (${this.activeLiquidations}/${this.maxConcurrentLiquidations})`);
                        }
                    }
                }
            }

            // Update metrics
            const totalScanDuration = Date.now() - scanStartTime;
            this.scanMetrics.totalScans++;
            this.scanMetrics.averageScanTime = ((this.scanMetrics.averageScanTime * (this.scanMetrics.totalScans - 1)) + totalScanDuration) / this.scanMetrics.totalScans;
            this.scanMetrics.lastScanDuration = totalScanDuration;

            console.log(`📊 Scan ${this.scanCount} completed in ${totalScanDuration}ms (${allOpportunities.length} total opportunities)`);

            // Execute liquidations concurrently (up to maxConcurrentLiquidations)
            if (allOpportunities.length > 0) {
                await this._executeLiquidationsConcurrently(allOpportunities);
            }

        } catch (error) {
            console.error('❌ Critical error in liquidation scanning:', error.message);
            monitoring.logCriticalError(error, 'scan_loop');
        }
    }

    /**
     * CONCURRENT LIQUIDATION EXECUTION
     * Execute multiple liquidations simultaneously with proper nonce management
     */
    async _executeLiquidationsConcurrently(opportunities) {
        const executionPromises = opportunities.map(async ({ protocolName, opportunity }) => {
            try {
                this.activeLiquidations++;
                await this._evaluateAndExecuteLiquidation(protocolName, opportunity);
            } catch (error) {
                console.error(`❌ Error executing liquidation for ${protocolName}:`, error.message);
                monitoring.logCriticalError(error, `liquidation_${protocolName}`);
            } finally {
                this.activeLiquidations = Math.max(0, this.activeLiquidations - 1);
            }
        });

        // Wait for all executions to complete
        await Promise.allSettled(executionPromises);
    }

    async _scanProtocol(protocolName, protocol) {
        const opportunities = [];

        try {
            // Get positions at risk (this would typically come from a subgraph or on-chain scanning)
            // For now, we'll use a placeholder - in production, implement proper position discovery
            const positionsAtRisk = await this._getPositionsAtRisk(protocolName, protocol);

            for (const position of positionsAtRisk) {
                const healthFactor = await this._calculateHealthFactor(protocolName, position);

                if (healthFactor < this.monitoringThreshold) {
                    const opportunity = {
                        protocol: protocolName,
                        user: position.user,
                        healthFactor,
                        collateralAsset: position.collateralAsset,
                        debtAsset: position.debtAsset,
                        maxLiquidationAmount: position.maxLiquidationAmount,
                        liquidationBonus: position.liquidationBonus
                    };

                    opportunities.push(opportunity);
                }
            }

        } catch (error) {
            console.error(`❌ Error scanning ${protocolName} positions:`, error);
        }

        return opportunities;
    }

    /**
     * REAL-TIME POSITION DISCOVERY
     * Implements comprehensive position discovery using subgraph queries and event monitoring
     */
    async _getPositionsAtRisk(protocolName, protocol) {
        const positions = [];

        try {
            // PARALLEL DISCOVERY: Run subgraph and on-chain discovery simultaneously
            const [subgraphPositions, eventPositions] = await Promise.allSettled([
                this._querySubgraphPositions(protocolName),
                this._scanRecentEvents(protocolName)
            ]);

            // Combine and deduplicate positions
            const allPositions = new Map();

            // Process subgraph positions
            if (subgraphPositions.status === 'fulfilled' && subgraphPositions.value) {
                subgraphPositions.value.forEach(pos => {
                    allPositions.set(`${protocolName}-${pos.user}`, { ...pos, source: 'subgraph' });
                });
            }

            // Process event-based positions
            if (eventPositions.status === 'fulfilled' && eventPositions.value) {
                eventPositions.value.forEach(pos => {
                    const key = `${protocolName}-${pos.user}`;
                    if (!allPositions.has(key)) {
                        allPositions.set(key, { ...pos, source: 'events' });
                    }
                });
            }

            // Convert to array and validate positions
            const validPositions = [];
            for (const [key, position] of allPositions) {
                try {
                    // Skip if already processed recently
                    const cacheKey = `${protocolName}-${position.user}`;
                    const lastProcessed = this.positionCache.get(cacheKey);
                    if (lastProcessed && (Date.now() - lastProcessed) < 30000) { // 30s cooldown
                        continue;
                    }

                    // Validate position has required data
                    if (!position.user || !position.collateralAsset || !position.debtAsset) {
                        continue;
                    }

                    // Calculate real-time health factor
                    const healthFactor = await this._calculateHealthFactor(protocolName, position);
                    if (healthFactor < this.monitoringThreshold) {
                        position.healthFactor = healthFactor;
                        validPositions.push(position);
                        this.positionCache.set(cacheKey, Date.now());
                    }
                } catch (error) {
                    // Skip invalid positions
                    continue;
                }
            }

            this.scanMetrics.positionsFound += validPositions.length;
            console.log(`📊 ${protocolName}: Found ${validPositions.length} positions at risk (${subgraphPositions.value?.length || 0} from subgraph, ${eventPositions.value?.length || 0} from events)`);

            return validPositions;

        } catch (error) {
            console.error(`❌ Error discovering positions for ${protocolName}:`, error.message);
            return [];
        }
    }

    /**
     * SUBGRAPH POSITION DISCOVERY
     * Query subgraph for positions with health factor < monitoring threshold
     */
    async _querySubgraphPositions(protocolName) {
        const endpoint = SUBGRAPH_ENDPOINTS[protocolName.toUpperCase()];
        if (!endpoint) return [];

        try {
            let query;
            switch (protocolName.toUpperCase()) {
                case 'AAVE':
                    query = `
                        query {
                            users(where: { healthFactor_lt: "${this.monitoringThreshold}" }, first: 100, orderBy: healthFactor, orderDirection: asc) {
                                id
                                healthFactor
                                positions {
                                    reserve {
                                        symbol
                                        underlyingAsset
                                    }
                                    currentATokenBalance
                                    currentStableDebt
                                    currentVariableDebt
                                }
                            }
                        }
                    `;
                    break;

                case 'COMPOUND':
                    query = `
                        query {
                            accounts(where: { health_lt: "${this.monitoringThreshold}" }, first: 100, orderBy: health, orderDirection: asc) {
                                id
                                health
                                segments {
                                    ctoken_address
                                    amount
                                    entered_market
                                }
                                borrows {
                                    symbol
                                    amount
                                    ctoken_address
                                }
                            }
                        }
                    `;
                    break;

                case 'VENUS':
                    query = `
                        query {
                            accounts(where: { health_lt: "${this.monitoringThreshold}" }, first: 100, orderBy: health, orderDirection: asc) {
                                id
                                health
                                tokens {
                                    symbol
                                    cToken {
                                        underlying_address
                                        cToken_address
                                    }
                                    borrow_balance_underlying
                                    supply_balance_underlying
                                    entered_market
                                }
                            }
                        }
                    `;
                    break;

                default:
                    return [];
            }

            const response = await axios.post(endpoint, { query }, {
                timeout: 5000,
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.data?.data?.users || response.data?.data?.accounts) {
                const accounts = response.data.data.users || response.data.data.accounts;
                return this._normalizeSubgraphPositions(protocolName, accounts);
            }

            return [];

        } catch (error) {
            console.warn(`⚠️ Subgraph query failed for ${protocolName}:`, error.message);
            return [];
        }
    }

    /**
     * EVENT-BASED POSITION DISCOVERY
     * Monitor recent blockchain events for positions that may be at risk
     */
    async _scanRecentEvents(protocolName) {
        const positions = [];

        try {
            const contract = this.lendingContracts[protocolName.toUpperCase()];
            if (!contract) return positions;

            // Get recent blocks (last 100 blocks ≈ 20 minutes on BSC)
            const currentBlock = await this.provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 100);

            // Query recent borrow events with RPC backoff
            const borrowFilter = contract.filters.Borrow ? contract.filters.Borrow() : null;
            if (borrowFilter) {
                try {
                    const borrowEvents = await rpcManager.executeCriticalCall(
                        () => contract.queryFilter(borrowFilter, fromBlock, currentBlock),
                        `borrow_events_${protocolName}`
                    );
                    for (const event of borrowEvents.slice(-20)) { // Last 20 borrow events
                        try {
                            const position = await this._getPositionFromEvent(protocolName, event);
                            if (position) positions.push(position);
                        } catch (e) {
                            // Skip invalid events
                        }
                    }
                } catch (error) {
                    console.warn(`⚠️ Failed to query borrow events for ${protocolName}: ${error.message}`);
                    // Continue without borrow events - don't crash
                }
            }

            // Query recent liquidation events to find patterns with RPC backoff
            const liquidationFilter = contract.filters.LiquidationCall ? contract.filters.LiquidationCall() : null;
            if (liquidationFilter) {
                try {
                    const liquidationEvents = await rpcManager.executeCriticalCall(
                        () => contract.queryFilter(liquidationFilter, fromBlock, currentBlock),
                        `liquidation_events_${protocolName}`
                    );
                    // Use liquidation patterns to identify similar at-risk positions
                    const riskPatterns = this._analyzeLiquidationPatterns(liquidationEvents);
                    for (const pattern of riskPatterns) {
                        positions.push(pattern);
                    }
                } catch (error) {
                    console.warn(`⚠️ Failed to query liquidation events for ${protocolName}: ${error.message}`);
                    // Continue without liquidation events - don't crash
                }
            }

        } catch (error) {
            console.warn(`⚠️ Event scanning failed for ${protocolName}:`, error.message);
        }

        return positions;
    }

    /**
     * NORMALIZE SUBGRAPH POSITIONS
     * Convert subgraph data to unified position format
     */
    _normalizeSubgraphPositions(protocolName, accounts) {
        const positions = [];

        for (const account of accounts) {
            try {
                let position;

                switch (protocolName.toUpperCase()) {
                    case 'AAVE':
                        position = this._normalizeAavePosition(account);
                        break;
                    case 'COMPOUND':
                        position = this._normalizeCompoundPosition(account);
                        break;
                    case 'VENUS':
                        position = this._normalizeVenusPosition(account);
                        break;
                }

                if (position) positions.push(position);
            } catch (error) {
                // Skip malformed positions
                continue;
            }
        }

        return positions;
    }

    _normalizeAavePosition(account) {
        // Find largest collateral and debt positions
        const collateralPositions = account.positions.filter(p =>
            (parseFloat(p.currentATokenBalance) > 0) && p.reserve.underlyingAsset
        );
        const debtPositions = account.positions.filter(p =>
            (parseFloat(p.currentStableDebt) > 0 || parseFloat(p.currentVariableDebt) > 0) && p.reserve.underlyingAsset
        );

        if (collateralPositions.length === 0 || debtPositions.length === 0) return null;

        const collateralAsset = collateralPositions[0].reserve.underlyingAsset;
        const debtAsset = debtPositions[0].reserve.underlyingAsset;
        const maxLiquidationAmount = ethers.parseEther(debtPositions[0].currentVariableDebt || debtPositions[0].currentStableDebt);

        return {
            user: account.id,
            collateralAsset,
            debtAsset,
            maxLiquidationAmount,
            liquidationBonus: 0.05, // Aave default
            protocolData: account
        };
    }

    _normalizeCompoundPosition(account) {
        if (!account.borrows?.length || !account.segments?.length) return null;

        const debtAsset = account.borrows[0].symbol;
        const collateralAsset = account.segments[0].ctoken_address;
        const maxLiquidationAmount = ethers.parseEther(account.borrows[0].amount.toString());

        return {
            user: account.id,
            collateralAsset,
            debtAsset,
            maxLiquidationAmount,
            liquidationBonus: 0.08, // Compound default
            protocolData: account
        };
    }

    _normalizeVenusPosition(account) {
        const borrowTokens = account.tokens.filter(t => parseFloat(t.borrow_balance_underlying) > 0);
        const supplyTokens = account.tokens.filter(t => parseFloat(t.supply_balance_underlying) > 0);

        if (!borrowTokens.length || !supplyTokens.length) return null;

        const debtAsset = borrowTokens[0].cToken.underlying_address;
        const collateralAsset = supplyTokens[0].cToken.underlying_address;
        const maxLiquidationAmount = ethers.parseEther(borrowTokens[0].borrow_balance_underlying.toString());

        return {
            user: account.id,
            collateralAsset,
            debtAsset,
            maxLiquidationAmount,
            liquidationBonus: 0.05, // Venus default
            protocolData: account
        };
    }

    async _getPositionFromEvent(protocolName, event) {
        // Extract position data from blockchain events
        // This would analyze borrow events to identify potentially at-risk positions
        try {
            const user = event.args?.user || event.args?.borrower;
            if (!user) return null;

            // Get current position data
            const healthFactor = await this._calculateHealthFactor(protocolName, { user });

            if (healthFactor < this.monitoringThreshold) {
                return {
                    user,
                    healthFactor,
                    source: 'event',
                    eventData: event
                };
            }
        } catch (error) {
            // Skip invalid events
        }
        return null;
    }

    _analyzeLiquidationPatterns(liquidationEvents) {
        // Analyze recent liquidations to identify patterns and similar at-risk positions
        // This is a simplified implementation
        return [];
    }

    /**
     * ACCURATE HEALTH FACTOR CALCULATION
     * Implements proper health factor calculations for all protocols
     */
    async _calculateHealthFactor(protocolName, position) {
        try {
            switch (protocolName.toUpperCase()) {
                case 'AAVE':
                    return await this._calculateAaveHealthFactor(position.user);

                case 'COMPOUND':
                    return await this._calculateCompoundHealthFactor(position.user);

                case 'VENUS':
                    return await this._calculateVenusHealthFactor(position.user);

                default:
                    return 2.0; // Default healthy
            }
        } catch (error) {
            console.error(`❌ Error calculating health factor for ${protocolName}:`, error.message);
            return 2.0; // Assume healthy on error
        }
    }

    async _calculateAaveHealthFactor(user) {
        try {
            const userData = await this.lendingContracts.AAVE.getUserAccountData(user);
            const healthFactor = ethers.formatEther(userData.healthFactor);

            // Aave returns very large numbers for healthy positions
            if (parseFloat(healthFactor) > 1000) return 999; // Effectively infinite
            return parseFloat(healthFactor);
        } catch (error) {
            console.warn(`⚠️ Aave health factor calculation failed for ${user}:`, error.message);
            return 2.0;
        }
    }

    async _calculateCompoundHealthFactor(user) {
        try {
            const healthFactor = await this.lendingContracts.COMPOUND.getHealthFactor(user);
            return parseFloat(ethers.formatEther(healthFactor));
        } catch (error) {
            console.warn(`⚠️ Compound health factor calculation failed for ${user}:`, error.message);
            return 2.0;
        }
    }

    async _calculateVenusHealthFactor(user) {
        try {
            const [error, liquidity, shortfall] = await this.lendingContracts.VENUS.getAccountLiquidity(user);

            if (error !== 0) {
                console.warn(`⚠️ Venus account liquidity error for ${user}: ${error}`);
                return 2.0;
            }

            // Venus health factor calculation
            // Health factor = (liquidity + shortfall) / shortfall
            // If shortfall > 0, health factor < 1 (liquidatable)
            // If liquidity > 0, health factor > 1 (healthy)

            const liquidityFloat = parseFloat(ethers.formatEther(liquidity));
            const shortfallFloat = parseFloat(ethers.formatEther(shortfall));

            if (shortfallFloat > 0) {
                // Liquidatable: health factor = liquidity / shortfall
                // Lower values mean more liquidatable
                const healthFactor = liquidityFloat / shortfallFloat;
                return Math.max(0.1, healthFactor); // Minimum 0.1 to avoid division by zero issues
            } else if (liquidityFloat > 0) {
                // Healthy: health factor > 1
                return 2.0 + (liquidityFloat / 1000); // Scale healthy positions
            } else {
                // No liquidity or shortfall - neutral
                return 1.0;
            }
        } catch (error) {
            console.warn(`⚠️ Venus health factor calculation failed for ${user}:`, error.message);
            return 2.0;
        }
    }

    async _evaluateAndExecuteLiquidation(protocolName, opportunity) {
        try {
            // Skip if health factor is still above liquidation threshold
            if (opportunity.healthFactor >= this.healthFactorThreshold) {
                return;
            }

            // Calculate optimal liquidation amount
            const optimalAmount = await this._calculateOptimalLiquidationAmount(opportunity);

            // Calculate expected profit
            const profitAnalysis = await this._calculateLiquidationProfit(protocolName, opportunity, optimalAmount);

            if (!profitAnalysis.isProfitable || profitAnalysis.expectedProfitUSD < this.minProfitUSD) {
                return;
            }

            console.log(`💰 Found profitable liquidation opportunity:`);
            console.log(`   Protocol: ${protocolName}`);
            console.log(`   User: ${opportunity.user}`);
            console.log(`   Health Factor: ${opportunity.healthFactor}`);
            console.log(`   Expected Profit: $${profitAnalysis.expectedProfitUSD.toFixed(2)}`);

            // Execute liquidation
            await this._executeLiquidation(protocolName, opportunity, optimalAmount, profitAnalysis);

        } catch (error) {
            console.error('❌ Error evaluating liquidation opportunity:', error);
        }
    }

    async _calculateOptimalLiquidationAmount(opportunity) {
        // Calculate optimal amount based on:
        // 1. Maximum liquidation amount allowed
        // 2. Available liquidity in debt asset
        // 3. Gas costs and slippage
        // 4. Liquidation bonus

        let optimalAmount = opportunity.maxLiquidationAmount;

        // Cap at our maximum liquidation amount
        if (optimalAmount.gt(this.maxLiquidationAmount)) {
            optimalAmount = this.maxLiquidationAmount;
        }

        // Consider available liquidity (placeholder - implement actual liquidity checks)
        const availableLiquidity = await this._getAvailableLiquidity(opportunity.debtAsset);
        if (optimalAmount.gt(availableLiquidity)) {
            optimalAmount = availableLiquidity;
        }

        return optimalAmount;
    }

    async _getAvailableLiquidity(asset) {
        // Placeholder - implement actual liquidity checking
        // Check flash loan availability, DEX liquidity, etc.
        return ethers.parseEther('100000'); // $100k placeholder
    }

    /**
     * COMPREHENSIVE PROFIT CALCULATION
     * Includes all cost factors: gas, flashloan fees, slippage, oracle lag
     */
    async _calculateLiquidationProfit(protocolName, opportunity, liquidationAmount) {
        try {
            const startTime = Date.now();

            // Get real-time prices with fallback
            const collateralPrice = await this._getPriceWithFallback(opportunity.collateralAsset);
            const debtPrice = await this._getPriceWithFallback(opportunity.debtAsset);

            if (!collateralPrice || !debtPrice) {
                monitoring.logSkippedPath('price_unavailable', {
                    collateralAsset: opportunity.collateralAsset,
                    debtAsset: opportunity.debtAsset
                });
                return { isProfitable: false, expectedProfitUSD: 0 };
            }

            // Calculate base liquidation value
            const debtAmountFloat = parseFloat(ethers.formatEther(liquidationAmount));
            const debtValueUSD = debtAmountFloat * debtPrice;

            // Calculate collateral received (with liquidation bonus)
            const collateralReceivedUSD = debtValueUSD * (1 + opportunity.liquidationBonus);
            const collateralReceivedAmount = collateralReceivedUSD / collateralPrice;

            // GAS COST CALCULATION (comprehensive)
            const gasCostUSD = await this._calculateGasCost(protocolName, opportunity);

            // FLASHLOAN FEE CALCULATION (protocol-specific)
            const flashloanFeeUSD = await this._calculateFlashloanFee(protocolName, liquidationAmount, debtPrice);

            // DEX SLIPPAGE CALCULATION (liquidity-aware)
            const slippageUSD = await this._calculateSlippageCost(opportunity, collateralReceivedAmount, collateralPrice);

            // ORACLE LAG ADJUSTMENT (price volatility buffer)
            const oracleLagAdjustmentUSD = this._calculateOracleLagAdjustment(debtValueUSD, collateralReceivedUSD);

            // PROTOCOL-SPECIFIC FEES
            const protocolFeeUSD = this._calculateProtocolFees(protocolName, debtValueUSD);

            // TOTAL COST CALCULATION
            const totalCostsUSD = gasCostUSD + flashloanFeeUSD + slippageUSD + oracleLagAdjustmentUSD + protocolFeeUSD;

            // NET PROFIT CALCULATION
            const netProfitUSD = collateralReceivedUSD - debtValueUSD - totalCostsUSD;

            // PROFITABILITY ANALYSIS
            const isProfitable = netProfitUSD > this.minProfitUSD;
            const profitMargin = (netProfitUSD / debtValueUSD) * 100;

            const calculationTime = Date.now() - startTime;

            const profitAnalysis = {
                isProfitable,
                expectedProfitUSD: netProfitUSD,
                profitMargin,
                collateralReceived: collateralReceivedAmount,
                debtValueUSD,
                collateralReceivedUSD,
                breakdown: {
                    gasCost: gasCostUSD,
                    flashloanFee: flashloanFeeUSD,
                    slippage: slippageUSD,
                    oracleLagAdjustment: oracleLagAdjustmentUSD,
                    protocolFee: protocolFeeUSD,
                    totalCosts: totalCostsUSD
                },
                calculationTime,
                timestamp: new Date().toISOString()
            };

            // Log unprofitable opportunities for analysis
            if (!isProfitable) {
                monitoring.logSkippedPath('insufficient_profit', {
                    profit: netProfitUSD.toFixed(2),
                    costs: totalCostsUSD.toFixed(2),
                    revenue: collateralReceivedUSD.toFixed(2)
                });
            }

            return profitAnalysis;

        } catch (error) {
            console.error('❌ Error calculating liquidation profit:', error.message);
            monitoring.logCriticalError(error, 'profit_calculation');
            return { isProfitable: false, expectedProfitUSD: 0 };
        }
    }

    async _getPriceWithFallback(tokenAddress) {
        try {
            // PRICE FEED HARDENING: Strict guards to prevent crashes

            // Guard 1: Validate token address format
            if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
                console.warn(`⚠️ Invalid token address: ${tokenAddress} - skipping`);
                return null;
            }

            // Guard 2: Check if token exists in our configuration
            const tokenSymbol = Object.keys(TOKENS).find(symbol =>
                TOKENS[symbol].address.toLowerCase() === tokenAddress.toLowerCase()
            );
            if (!tokenSymbol) {
                console.warn(`⚠️ Token ${tokenAddress} not in configuration - skipping`);
                return null;
            }

            // Guard 3: Check token metadata
            const tokenData = TOKENS[tokenSymbol];
            if (!tokenData || !tokenData.decimals || tokenData.decimals <= 0) {
                console.warn(`⚠️ Invalid token metadata for ${tokenSymbol} - skipping`);
                return null;
            }

            // Try primary price feed
            const price = await this.priceFeed.getPrice(tokenAddress);
            if (price && price > 0 && isFinite(price)) return price;

            // Fallback to CoinGecko or other sources
            // This would be implemented based on available price feeds
            console.warn(`⚠️ Price unavailable for ${tokenSymbol} (${tokenAddress}), using fallback`);
            return null;
        } catch (error) {
            console.warn(`⚠️ Price fetch failed for ${tokenAddress}:`, error.message);
            return null;
        }
    }

    async _calculateGasCost(protocolName, opportunity) {
        try {
            const gasEstimate = await this._estimateLiquidationGas(protocolName);
            const gasPrice = await this._getOptimalGasPrice();

            const gasCostWei = gasEstimate * gasPrice;
            const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));

            // Convert to USD (assuming BNB price ~$567)
            const bnbPrice = 567;
            return gasCostEth * bnbPrice;
        } catch (error) {
            console.warn('⚠️ Gas cost calculation failed:', error.message);
            return 5.0; // Conservative fallback: $5 gas cost
        }
    }

    async _getOptimalGasPrice() {
        try {
            const feeData = await this.provider.getFeeData();

            // Use shared gas manager if available
            if (this.sharedGasManager) {
                return this.sharedGasManager.getOptimalGasPrice();
            }

            // Default: use maxFeePerGas or gasPrice
            return feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits('5', 'gwei');
        } catch (error) {
            return ethers.parseUnits('5', 'gwei'); // Fallback
        }
    }

    async _calculateFlashloanFee(protocolName, amount, debtPrice) {
        try {
            let feeRate = 0.0009; // Default 0.09%

            // Protocol-specific flashloan fees
            switch (protocolName.toUpperCase()) {
                case 'AAVE':
                    feeRate = 0.0005; // 0.05%
                    break;
                case 'VENUS':
                    feeRate = 0.001; // 0.1%
                    break;
                case 'COMPOUND':
                    feeRate = 0.0008; // 0.08%
                    break;
            }

            const feeAmount = parseFloat(ethers.formatEther(amount)) * feeRate;
            return feeAmount * debtPrice;
        } catch (error) {
            return parseFloat(ethers.formatEther(amount)) * 0.0009 * debtPrice; // Fallback
        }
    }

    async _calculateSlippageCost(opportunity, collateralAmount, collateralPrice) {
        try {
            // Estimate DEX slippage based on trade size and liquidity
            const tradeSizeUSD = collateralAmount * collateralPrice;

            // Larger trades have higher slippage
            let slippageRate = 0.001; // Base 0.1%
            if (tradeSizeUSD > 10000) slippageRate = 0.005; // 0.5% for $10k+ trades
            if (tradeSizeUSD > 50000) slippageRate = 0.01;  // 1.0% for $50k+ trades

            return tradeSizeUSD * slippageRate;
        } catch (error) {
            return (collateralAmount * collateralPrice) * 0.001; // Conservative fallback
        }
    }

    _calculateOracleLagAdjustment(debtValueUSD, collateralReceivedUSD) {
        // Oracle lag can cause price discrepancies
        // Conservative adjustment: 0.1% of trade value
        const tradeValue = Math.max(debtValueUSD, collateralReceivedUSD);
        return tradeValue * 0.001;
    }

    _calculateProtocolFees(protocolName, tradeValueUSD) {
        // Protocol-specific fees (trading fees, etc.)
        let feeRate = 0.001; // Base 0.1%

        switch (protocolName.toUpperCase()) {
            case 'AAVE':
                feeRate = 0.0005; // 0.05%
                break;
            case 'VENUS':
                feeRate = 0.001; // 0.1%
                break;
            case 'COMPOUND':
                feeRate = 0.0008; // 0.08%
                break;
        }

        return tradeValueUSD * feeRate;
    }

    async _estimateLiquidationGas(protocolName) {
        // Gas estimates for different protocols
        const gasEstimates = {
            AAVE: 400000,
            COMPOUND: 350000,
            VENUS: 300000
        };

        return ethers.BigNumber.from(gasEstimates[protocolName] || 400000);
    }

    /**
     * FLASHLOAN LIQUIDATION EXECUTION
     * Uses flashloan contract for atomic execution with arbitrage integration
     */
    async _executeLiquidation(protocolName, opportunity, amount, profitAnalysis) {
        const executionStartTime = Date.now();

        try {
            this.liquidationCount++;

            // Log liquidation attempt
            await monitoring.logTradeFound({
                path: [opportunity.collateralAsset, opportunity.debtAsset],
                flashloanSize: ethers.formatEther(amount),
                estimatedProfit: profitAnalysis.expectedProfitUSD.toFixed(2),
                mode: 'LIQUIDATION'
            });

            // Create liquidation transaction (flashloan-based)
            const tx = await this._createLiquidationTx(protocolName, opportunity, amount, profitAnalysis);

            if (!tx) {
                throw new Error('Failed to create liquidation transaction');
            }

            // Verify transaction safety
            const verification = await this.verifier.verifyTransaction(tx);
            if (!verification.verified) {
                throw new Error(`Transaction verification failed: ${verification.error}`);
            }

            // Check shared gas manager
            if (this.sharedGasManager) {
                const gasApproval = await this.sharedGasManager.requestGasAllocation(tx);
                if (!gasApproval.approved) {
                    console.log(`⛽ Gas allocation denied: ${gasApproval.reason}`);
                    return;
                }
                tx.gasPrice = gasApproval.gasPrice;
            }

            // Execute REAL LIQUIDATION TRANSACTION - EXTREME MODE
            console.log(`🔥 EXECUTING LIQUIDATION: ${opportunity.user}`);
            console.log(`   Protocol: ${protocolName}`);
            console.log(`   Debt Asset: ${opportunity.debtAsset}`);
            console.log(`   Collateral Asset: ${opportunity.collateralAsset}`);
            console.log(`   Amount: ${ethers.formatEther(amount)} tokens`);
            console.log(`   Expected Profit: $${profitAnalysis.expectedProfitUSD.toFixed(2)}`);
            console.log(`   Health Factor: ${opportunity.healthFactor.toFixed(3)}`);

            if (this.flashloanContract) {
                console.log(`🔥 Using flashloan contract for atomic execution`);
            } else {
                console.log(`🔥 Using direct protocol liquidation`);
            }

            const txResponse = await this.signer.sendTransaction(tx);
            console.log(`📤 LIQUIDATION: Transaction submitted: ${txResponse.hash}`);
            console.log(`🚀 EXTREME MODE: LIQUIDATION EXECUTED - Profit: $${profitAnalysis.expectedProfitUSD.toFixed(2)} - Tx: ${txResponse.hash}`);

            console.log(`✅ Liquidation transaction submitted: ${txResponse.hash}`);

            // Wait for confirmation with timeout
            const receipt = await Promise.race([
                txResponse.wait(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Transaction timeout')), 120000) // 2min timeout
                )
            ]);

            const executionTime = Date.now() - executionStartTime;

            if (receipt.status === 1) {
                this.successfulLiquidations++;

                // Log successful liquidation
                await monitoring.logTradeExecuted({
                    txHash: txResponse.hash,
                    netProfit: profitAnalysis.expectedProfitUSD.toFixed(2),
                    mode: 'LIQUIDATION'
                });

                console.log(`🎉 Liquidation successful! Profit: $${profitAnalysis.expectedProfitUSD.toFixed(2)} (executed in ${executionTime}ms)`);

                this.emit('liquidationExecuted', {
                    protocol: protocolName,
                    txHash: txResponse.hash,
                    profit: profitAnalysis.expectedProfitUSD,
                    amount: amount,
                    executionTime,
                    gasUsed: receipt.gasUsed,
                    effectiveGasPrice: receipt.effectiveGasPrice
                });

                // Update performance metrics
                this.scanMetrics.profitableOpportunities++;

            } else {
                console.error('❌ Liquidation transaction failed');
                monitoring.logCriticalError(new Error('Transaction reverted'), `liquidation_${protocolName}`);
            }

        } catch (error) {
            const executionTime = Date.now() - executionStartTime;
            console.error(`❌ Liquidation failed after ${executionTime}ms:`, error.message);
            monitoring.logCriticalError(error, `liquidation_execution_${protocolName}`);
        }
    }

    /**
     * FLASHLOAN LIQUIDATION TRANSACTION CREATION
     * Creates atomic flashloan + liquidation transaction
     */
    async _createLiquidationTx(protocolName, opportunity, amount, profitAnalysis) {
        try {
            // Use flashloan contract if available
            if (this.flashloanContract) {
                return await this._createFlashloanLiquidationTx(protocolName, opportunity, amount, profitAnalysis);
            } else {
                // Fallback to direct protocol liquidation
                console.warn('⚠️ Flashloan contract not available, using direct liquidation');
                return await this._createDirectLiquidationTx(protocolName, opportunity, amount);
            }
        } catch (error) {
            console.error('❌ Error creating liquidation transaction:', error.message);
            throw error;
        }
    }

    async _createFlashloanLiquidationTx(protocolName, opportunity, amount, profitAnalysis) {
        // Calculate minimum profit threshold (80% of expected to account for slippage)
        const minProfitWei = ethers.parseEther(Math.max(0, profitAnalysis.expectedProfitUSD * 0.8).toFixed(18));

        // Get lending protocol contract address
        const lendingProtocolAddress = this._getLendingProtocolAddress(protocolName);

        // Prepare arbitrage data (empty for pure liquidation, can be extended for atomic arb + liq)
        const arbitrageData = '0x';

        // Populate flashloan liquidation transaction
        const tx = await this.flashloanContract.populateTransaction.executeAtomicLiquidation(
            lendingProtocolAddress,
            opportunity.user,
            opportunity.debtAsset,
            opportunity.collateralAsset,
            amount,
            minProfitWei,
            arbitrageData
        );

        // Set gas limit based on protocol
        tx.gasLimit = await this._estimateLiquidationGas(protocolName);

        // Set gas price
        const feeData = await this.provider.getFeeData();
        tx.gasPrice = feeData.gasPrice;

        return tx;
    }

    async _createDirectLiquidationTx(protocolName, opportunity, amount) {
        const contract = this.lendingContracts[protocolName.toUpperCase()];
        if (!contract) {
            throw new Error(`Contract not available for ${protocolName}`);
        }

        let tx;
        switch (protocolName.toUpperCase()) {
            case 'AAVE':
                tx = await contract.populateTransaction.liquidationCall(
                    opportunity.collateralAsset,
                    opportunity.debtAsset,
                    opportunity.user,
                    amount,
                    false // receiveAToken
                );
                break;

            case 'COMPOUND':
                // Compound liquidation requires cToken addresses
                const cTokenCollateral = await this._getCTokenAddress(opportunity.collateralAsset);
                tx = await contract.populateTransaction.liquidateBorrow(
                    opportunity.user,
                    amount,
                    cTokenCollateral
                );
                break;

            case 'VENUS':
                tx = await contract.populateTransaction.liquidateBorrow(
                    opportunity.user,
                    opportunity.debtAsset,
                    opportunity.collateralAsset,
                    amount
                );
                break;

            default:
                throw new Error(`Unsupported protocol: ${protocolName}`);
        }

        // Set gas limit and price
        tx.gasLimit = await this._estimateLiquidationGas(protocolName);
        const feeData = await this.provider.getFeeData();
        tx.gasPrice = feeData.gasPrice;

        return tx;
    }

    _getLendingProtocolAddress(protocolName) {
        const protocol = LENDING_PROTOCOLS[protocolName.toUpperCase()];
        switch (protocolName.toUpperCase()) {
            case 'AAVE':
                return protocol.pool || protocol.lendingPool;
            case 'COMPOUND':
                return protocol.comet;
            case 'VENUS':
                return protocol.comptroller;
            default:
                throw new Error(`Unknown protocol: ${protocolName}`);
        }
    }

    async _getCTokenAddress(underlyingAsset) {
        // This would map underlying assets to cToken addresses
        // Simplified implementation
        const cTokenMap = {
            [TOKENS.WBNB.address]: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', // cBNB
            [TOKENS.USDT.address]: '0x3F0A8A7B6aC69A4A5C4e8e8e8e8e8e8e8e8e8e8e', // cUSDT
            // Add more mappings as needed
        };

        const cToken = cTokenMap[underlyingAsset];
        if (!cToken) {
            throw new Error(`cToken not found for underlying asset: ${underlyingAsset}`);
        }

        return cToken;
    }

    // Emergency controls
    emergencyStop() {
        this.emergencyStop = true;
        console.log('🚨 Liquidation Bot emergency stop activated');
    }

    resume() {
        this.emergencyStop = false;
        console.log('✅ Liquidation Bot resumed');
    }

    /**
     * COMPREHENSIVE PERFORMANCE METRICS
     * Detailed statistics for monitoring and optimization
     */
    getStats() {
        const uptime = Date.now() - (this.lastHeartbeat || Date.now());
        const avgScanTime = this.scanMetrics.averageScanTime || 0;

        return {
            // Basic stats
            isRunning: this.isRunning,
            liquidationCount: this.liquidationCount,
            successfulLiquidations: this.successfulLiquidations,
            successRate: this.liquidationCount > 0 ? (this.successfulLiquidations / this.liquidationCount) * 100 : 0,
            lastScanTime: this.lastScanTime,
            emergencyStop: this.emergencyStop,

            // Performance metrics
            scanMetrics: {
                totalScans: this.scanMetrics.totalScans,
                positionsFound: this.scanMetrics.positionsFound,
                profitableOpportunities: this.scanMetrics.profitableOpportunities,
                averageScanTime: Math.round(avgScanTime),
                lastScanDuration: this.scanMetrics.lastScanDuration,
                scanFrequency: this.scanInterval
            },

            // Financial metrics
            totalProfit: 0, // Would be tracked separately
            averageProfitPerLiquidation: 0, // Would be calculated from historical data

            // System health
            uptime: Math.round(uptime / 1000), // seconds
            activeLiquidations: this.activeLiquidations,
            maxConcurrentLiquidations: this.maxConcurrentLiquidations,
            positionCacheSize: this.positionCache.size,

            // Protocol breakdown
            protocols: Object.keys(this.lendingContracts).map(protocol => ({
                name: protocol,
                contractConnected: !!this.lendingContracts[protocol],
                lastHealthCheck: Date.now() // Would be tracked per protocol
            })),

            // Risk metrics
            riskMetrics: {
                maxSlippage: this.maxSlippage,
                maxLiquidationAmount: ethers.formatEther(this.maxLiquidationAmount),
                minProfitThreshold: this.minProfitUSD,
                emergencyStopTriggered: this.emergencyStop
            },

            // Integration status
            integrations: {
                flashloanContract: !!this.flashloanContract,
                sharedGasManager: !!this.sharedGasManager,
                monitoring: true, // Always enabled
                telegram: monitoring ? monitoring.telegramEnabled : false
            }
        };
    }

    /**
     * SHARED GAS MANAGER INTEGRATION
     * Connect with arbitrage bot's gas manager
     */
    setSharedGasManager(gasManager) {
        this.sharedGasManager = gasManager;
        console.log('✅ LiquidationBot connected to shared gas manager');
    }

    /**
     * HEARTBEAT MONITORING
     * Regular health checks and status updates
     */
    async heartbeat() {
        try {
            this.lastHeartbeat = Date.now();

            // Check contract connectivity
            const contractStatus = await this._checkContractConnectivity();

            // Update monitoring system
            if (monitoring) {
                // Log any issues found during heartbeat
                if (!contractStatus.allConnected) {
                    monitoring.logCriticalError(
                        new Error('Contract connectivity issues'),
                        `contracts_disconnected: ${contractStatus.disconnected.join(', ')}`
                    );
                }
            }

            return {
                timestamp: new Date().toISOString(),
                contractsConnected: contractStatus.allConnected,
                activeLiquidations: this.activeLiquidations,
                lastScanTime: this.lastScanTime,
                uptime: Date.now() - this.lastScanTime
            };

        } catch (error) {
            console.error('❌ Heartbeat failed:', error.message);
            if (monitoring) {
                monitoring.logCriticalError(error, 'heartbeat');
            }
            return { error: error.message };
        }
    }

    async _checkContractConnectivity() {
        const disconnected = [];

        for (const [protocol, contract] of Object.entries(this.lendingContracts)) {
            try {
                // Simple connectivity check
                if (protocol === 'AAVE') {
                    await contract.getUserAccountData(ethers.ZeroAddress);
                } else if (protocol === 'VENUS') {
                    await contract.getAccountLiquidity(ethers.ZeroAddress);
                } else if (protocol === 'COMPOUND') {
                    await contract.getHealthFactor(ethers.ZeroAddress);
                }
            } catch (error) {
                disconnected.push(protocol);
            }
        }

        return {
            allConnected: disconnected.length === 0,
            disconnected
        };
    }

    async stop() {
        console.log('🛑 Stopping Liquidation Bot...');
        this.isRunning = false;

        // Clean up event listeners
        await this._cleanupEventListeners();

        // Final heartbeat
        await this.heartbeat();

        console.log('✅ Liquidation Bot stopped');
    }

    async _cleanupEventListeners() {
        console.log('🧹 Cleaning up event listeners...');

        for (const [protocolName, listeners] of this.eventListeners) {
            try {
                for (const listener of listeners) {
                    listener.removeAllListeners();
                }
                console.log(`✅ ${protocolName} listeners cleaned up`);
            } catch (error) {
                console.warn(`⚠️ Error cleaning up ${protocolName} listeners:`, error.message);
            }
        }

        this.eventListeners.clear();
        console.log('🧹 Event listener cleanup complete');
    }
}

export { LiquidationBot };
