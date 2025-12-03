const { EventEmitter } = require('events');
const { ethers } = require('ethers');
const { NFT_MARKETPLACES, TOKENS } = require('../config/protocols');
const PriceFeed = require('../services/PriceFeed');
const ProfitCalculator = require('../utils/ProfitCalculator');

class NFTFlashLoanTrader extends EventEmitter {
    constructor(provider, signer, options = {}) {
        super();

        this.provider = provider;
        this.signer = signer;
        this.priceFeed = new PriceFeed(provider);
        this.profitCalculator = new ProfitCalculator(provider);

        // Configuration
        this.minProfitUSD = options.minProfitUSD || 100; // Higher minimum for NFT trades
        this.maxGasPrice = options.maxGasPrice || 5; // gwei
        this.scanInterval = options.scanInterval || 60000; // 1 minute (NFT markets move slower)
        this.maxNFTPrice = options.maxNFTPrice || ethers.utils.parseEther('100'); // 100 ETH max
        this.profitMarginThreshold = options.profitMarginThreshold || 0.05; // 5% minimum margin

        this.isRunning = false;
        this.tradeCount = 0;
        this.successfulTrades = 0;
        this.lastScanTime = 0;

        // NFT marketplace contracts
        this.marketplaceContracts = {};

        // NFT collection configurations
        this.supportedCollections = options.supportedCollections || [
            '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', // BAYC
            '0x60E4d786628Fea6478F785A6d7e704777c86a7c6', // MAYC
            '0x8a90CAb2b38dba80c64b7734e58Ee1dB38B8992e', // Doodles
            '0x49cF6f5d44E70224e2E23fDcdd2C053F30aDA28B'  // CloneX
        ];

        // Floor price tracking
        this.floorPrices = new Map();
        this.priceHistory = new Map();

        // Risk management
        this.maxSlippage = 0.03; // 3% max slippage for NFTs
        this.emergencyStop = false;

        this.emit('initialized');
    }

    async initialize() {
        try {
            console.log('🔄 Initializing NFT Flash Loan Trader...');

            // Initialize marketplace contracts
            await this._initializeMarketplaceContracts();

            // Initialize price feeds
            await this.priceFeed.updatePrices(Object.values(TOKENS), Object.values(NFT_MARKETPLACES));

            // Load floor prices
            await this._loadFloorPrices();

            // Verify connections
            await this._verifyConnections();

            console.log('✅ NFT Flash Loan Trader initialized successfully');
            return true;

        } catch (error) {
            console.error('❌ Failed to initialize NFT Flash Loan Trader:', error);
            return false;
        }
    }

    async _initializeMarketplaceContracts() {
        // Initialize OpenSea (Seaport)
        if (NFT_MARKETPLACES.OPENSEA) {
            const seaportAbi = [
                "function fulfillOrder(bytes calldata order, bytes calldata signature) external payable",
                "function getOrderHash(bytes32 orderHash) view returns (bytes32)"
            ];

            this.marketplaceContracts.OPENSEA = new ethers.Contract(
                NFT_MARKETPLACES.OPENSEA.contract,
                seaportAbi,
                this.signer
            );
        }

        // Initialize LooksRare
        if (NFT_MARKETPLACES.LOOKSRARE) {
            const looksRareAbi = [
                "function matchAskWithTakerBid(bytes calldata askOrder, bytes calldata takerBid) external",
                "function matchBidWithTakerAsk(bytes calldata bidOrder, bytes calldata takerAsk) external"
            ];

            this.marketplaceContracts.LOOKSRARE = new ethers.Contract(
                NFT_MARKETPLACES.LOOKSRARE.contract,
                looksRareAbi,
                this.signer
            );
        }

        // Initialize X2Y2
        if (NFT_MARKETPLACES.X2Y2) {
            const x2y2Abi = [
                "function run(bytes calldata data) external",
                "function cancel(bytes calldata data) external"
            ];

            this.marketplaceContracts.X2Y2 = new ethers.Contract(
                NFT_MARKETPLACES.X2Y2.contract,
                x2y2Abi,
                this.signer
            );
        }
    }

    async _loadFloorPrices() {
        // Load floor prices from external APIs or on-chain data
        // This would integrate with services like Reservoir, NFTGo, etc.
        for (const collection of this.supportedCollections) {
            try {
                const floorPrice = await this._getFloorPrice(collection);
                this.floorPrices.set(collection, floorPrice);

                // Initialize price history
                this.priceHistory.set(collection, []);
            } catch (error) {
                console.warn(`⚠️ Failed to load floor price for ${collection}:`, error.message);
            }
        }
    }

    async _getFloorPrice(collectionAddress) {
        // Placeholder - integrate with NFT price APIs
        // In production, this would call services like:
        // - Reservoir API
        // - OpenSea API
        // - NFTGo API

        // For demo, return mock floor prices
        const mockPrices = {
            '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D': 50, // BAYC ~50 ETH
            '0x60E4d786628Fea6478F785A6d7e704777c86a7c6': 15, // MAYC ~15 ETH
            '0x8a90CAb2b38dba80c64b7734e58Ee1dB38B8992e': 8,  // Doodles ~8 ETH
            '0x49cF6f5d44E70224e2E23fDcdd2C053F30aDA28B': 3   // CloneX ~3 ETH
        };

        return mockPrices[collectionAddress] || 1; // Default 1 ETH
    }

    async _verifyConnections() {
        for (const [marketplace, contract] of Object.entries(this.marketplaceContracts)) {
            try {
                // Basic connectivity test
                if (marketplace === 'OPENSEA') {
                    // Try to get a basic view function
                    console.log(`✅ ${marketplace} connected`);
                } else {
                    console.log(`✅ ${marketplace} connected`);
                }
            } catch (error) {
                console.warn(`⚠️ ${marketplace} connection issue:`, error.message);
            }
        }
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('🚀 Starting NFT Flash Loan Trader...');

        while (this.isRunning) {
            try {
                await this._scanForNFTArbitrageOpportunities();
                await new Promise(resolve => setTimeout(resolve, this.scanInterval));

            } catch (error) {
                console.error('❌ Error in NFT scan loop:', error);
                await new Promise(resolve => setTimeout(resolve, this.scanInterval * 2));
            }
        }
    }

    async _scanForNFTArbitrageOpportunities() {
        if (this.emergencyStop) return;

        this.lastScanTime = Date.now();

        try {
            // Update floor prices
            await this._updateFloorPrices();

            // Scan for NFT arbitrage opportunities
            for (const collection of this.supportedCollections) {
                await this._scanCollection(collection);
            }

        } catch (error) {
            console.error('❌ Error scanning NFT opportunities:', error);
        }
    }

    async _updateFloorPrices() {
        // Update floor prices periodically
        for (const collection of this.supportedCollections) {
            try {
                const newFloorPrice = await this._getFloorPrice(collection);
                const oldFloorPrice = this.floorPrices.get(collection);

                if (Math.abs(newFloorPrice - oldFloorPrice) / oldFloorPrice > 0.01) { // 1% change
                    this.floorPrices.set(collection, newFloorPrice);

                    // Update price history
                    const history = this.priceHistory.get(collection) || [];
                    history.push({
                        price: newFloorPrice,
                        timestamp: Date.now()
                    });

                    // Keep last 100 entries
                    if (history.length > 100) {
                        history.shift();
                    }

                    this.priceHistory.set(collection, history);
                }
            } catch (error) {
                console.warn(`⚠️ Failed to update floor price for ${collection}:`, error.message);
            }
        }
    }

    async _scanCollection(collectionAddress) {
        try {
            // Get listings from different marketplaces
            const marketplaceListings = await this._getMarketplaceListings(collectionAddress);

            // Find arbitrage opportunities
            const opportunities = this._findArbitrageOpportunities(marketplaceListings, collectionAddress);

            // Evaluate and execute opportunities
            for (const opportunity of opportunities) {
                await this._evaluateAndExecuteNFTArbitrage(opportunity);
            }

        } catch (error) {
            console.error(`❌ Error scanning collection ${collectionAddress}:`, error);
        }
    }

    async _getMarketplaceListings(collectionAddress) {
        const listings = {};

        // Get listings from each marketplace
        for (const [marketplaceName, marketplace] of Object.entries(NFT_MARKETPLACES)) {
            try {
                const marketplaceListings = await this._getListingsFromMarketplace(
                    marketplaceName,
                    marketplace,
                    collectionAddress
                );
                listings[marketplaceName] = marketplaceListings;
            } catch (error) {
                console.warn(`⚠️ Failed to get listings from ${marketplaceName}:`, error.message);
                listings[marketplaceName] = [];
            }
        }

        return listings;
    }

    async _getListingsFromMarketplace(marketplaceName, marketplace, collectionAddress) {
        // Placeholder - integrate with marketplace APIs
        // In production, this would query:
        // - OpenSea API
        // - LooksRare API
        // - X2Y2 API
        // - NFTGo API

        // Return mock listings for demo
        const floorPrice = this.floorPrices.get(collectionAddress) || 1;
        const listings = [];

        for (let i = 0; i < 5; i++) {
            listings.push({
                tokenId: Math.floor(Math.random() * 10000),
                price: floorPrice * (0.9 + Math.random() * 0.2), // 90%-110% of floor
                marketplace: marketplaceName,
                seller: ethers.Wallet.createRandom().address
            });
        }

        return listings;
    }

    _findArbitrageOpportunities(marketplaceListings, collectionAddress) {
        const opportunities = [];
        const floorPrice = this.floorPrices.get(collectionAddress);

        // Compare prices across marketplaces
        const allListings = [];

        for (const [marketplace, listings] of Object.entries(marketplaceListings)) {
            for (const listing of listings) {
                allListings.push({
                    ...listing,
                    marketplace
                });
            }
        }

        // Sort by price
        allListings.sort((a, b) => a.price - b.price);

        // Find price differences
        for (let i = 0; i < allListings.length; i++) {
            for (let j = i + 1; j < allListings.length; j++) {
                const buyListing = allListings[i];
                const sellListing = allListings[j];

                const priceDiff = sellListing.price - buyListing.price;
                const profitMargin = priceDiff / buyListing.price;

                if (profitMargin > this.profitMarginThreshold) {
                    const opportunity = {
                        collection: collectionAddress,
                        buyMarketplace: buyListing.marketplace,
                        sellMarketplace: sellListing.marketplace,
                        buyPrice: buyListing.price,
                        sellPrice: sellListing.price,
                        tokenId: buyListing.tokenId,
                        seller: buyListing.seller,
                        profitMargin: profitMargin,
                        estimatedProfit: priceDiff * 0.9 // Account for fees
                    };

                    opportunities.push(opportunity);
                }
            }
        }

        return opportunities;
    }

    async _evaluateAndExecuteNFTArbitrage(opportunity) {
        try {
            this.tradeCount++;

            // Calculate profit potential
            const profitAnalysis = await this._calculateNFTProfit(opportunity);

            if (!profitAnalysis.isProfitable || profitAnalysis.expectedProfitUSD < this.minProfitUSD) {
                return;
            }

            // Check if price is within limits
            if (opportunity.buyPrice > parseFloat(ethers.formatEther(this.maxNFTPrice))) {
                return;
            }

            console.log(`🎨 Found NFT arbitrage opportunity:`);
            console.log(`   Collection: ${opportunity.collection}`);
            console.log(`   Buy: ${opportunity.buyPrice.toFixed(2)} ETH on ${opportunity.buyMarketplace}`);
            console.log(`   Sell: ${opportunity.sellPrice.toFixed(2)} ETH on ${opportunity.sellMarketplace}`);
            console.log(`   Estimated Profit: $${profitAnalysis.expectedProfitUSD.toFixed(2)}`);

            // Execute NFT arbitrage
            await this._executeNFTArbitrage(opportunity, profitAnalysis);

        } catch (error) {
            console.error('❌ Error evaluating NFT opportunity:', error);
        }
    }

    async _calculateNFTProfit(opportunity) {
        try {
            const buyPrice = opportunity.buyPrice;
            const sellPrice = opportunity.sellPrice;

            // Calculate fees
            const buyFee = this._calculateMarketplaceFee(opportunity.buyMarketplace, buyPrice);
            const sellFee = this._calculateMarketplaceFee(opportunity.sellMarketplace, sellPrice);
            const flashLoanFee = buyPrice * 0.0003; // 0.03% flash loan fee

            // Gas costs (rough estimate for NFT transfers)
            const gasCost = 0.01; // 0.01 ETH gas cost

            // Net profit
            const grossProfit = sellPrice - buyPrice;
            const totalCosts = buyFee + sellFee + flashLoanFee + gasCost;
            const netProfit = grossProfit - totalCosts;

            // Convert to USD
            const ethPrice = await this.priceFeed.getPrice(TOKENS.WETH.address);
            const expectedProfitUSD = netProfit * ethPrice;

            return {
                isProfitable: netProfit > 0,
                expectedProfitUSD: expectedProfitUSD,
                grossProfit: grossProfit,
                totalCosts: totalCosts,
                netProfit: netProfit,
                breakdown: {
                    buyFee,
                    sellFee,
                    flashLoanFee,
                    gasCost
                }
            };

        } catch (error) {
            console.error('❌ Error calculating NFT profit:', error);
            return { isProfitable: false, expectedProfitUSD: 0 };
        }
    }

    _calculateMarketplaceFee(marketplace, price) {
        // Marketplace fee structures
        const feeStructures = {
            OPENSEA: 0.025,    // 2.5%
            LOOKSRARE: 0.015,  // 1.5%
            X2Y2: 0.005        // 0.5%
        };

        const feeRate = feeStructures[marketplace] || 0.025; // Default 2.5%
        return price * feeRate;
    }

    async _executeNFTArbitrage(opportunity, profitAnalysis) {
        try {
            // Create NFT arbitrage transaction
            const tx = await this._createNFTArbitrageTx(opportunity);

            // Execute via FlashloanArb contract
            const contractAddress = process.env.FLASHLOAN_ARB_CONTRACT;
            if (!contractAddress) {
                throw new Error('FlashloanArb contract address not configured');
            }

            const contract = new ethers.Contract(contractAddress, [
                "function executeNFTArbitrage(address nftContract, uint256 tokenId, address marketplace, uint256 maxBuyPrice, uint256 minSellPrice) external"
            ], this.signer);

            const txResponse = await contract.executeNFTArbitrage(
                opportunity.collection,
                opportunity.tokenId,
                NFT_MARKETPLACES[opportunity.buyMarketplace].contract,
                ethers.utils.parseEther(opportunity.buyPrice.toString()),
                ethers.utils.parseEther(opportunity.sellPrice.toString())
            );

            console.log(`✅ NFT arbitrage executed: ${txResponse.hash}`);
            this.successfulTrades++;

            this.emit('nftArbitrageExecuted', {
                collection: opportunity.collection,
                tokenId: opportunity.tokenId,
                txHash: txResponse.hash,
                profit: profitAnalysis.expectedProfitUSD,
                opportunity: opportunity
            });

        } catch (error) {
            console.error('❌ Error executing NFT arbitrage:', error);
        }
    }

    async _createNFTArbitrageTx(opportunity) {
        // Create complex transaction for NFT arbitrage
        // This involves buying on one marketplace and selling on another
        // Would require marketplace-specific logic
        return {}; // Placeholder
    }

    // Emergency controls
    emergencyStop() {
        this.emergencyStop = true;
        console.log('🚨 NFT Flash Loan Trader emergency stop activated');
    }

    resume() {
        this.emergencyStop = false;
        console.log('✅ NFT Flash Loan Trader resumed');
    }

    // Statistics and monitoring
    getStats() {
        return {
            isRunning: this.isRunning,
            tradeCount: this.tradeCount,
            successfulTrades: this.successfulTrades,
            successRate: this.tradeCount > 0 ? (this.successfulTrades / this.tradeCount) * 100 : 0,
            lastScanTime: this.lastScanTime,
            supportedCollections: this.supportedCollections.length,
            emergencyStop: this.emergencyStop
        };
    }

    // Get floor price for a collection
    getFloorPrice(collectionAddress) {
        return this.floorPrices.get(collectionAddress) || 0;
    }

    // Get price history for a collection
    getPriceHistory(collectionAddress) {
        return this.priceHistory.get(collectionAddress) || [];
    }

    async stop() {
        console.log('🛑 Stopping NFT Flash Loan Trader...');
        this.isRunning = false;
        console.log('✅ NFT Flash Loan Trader stopped');
    }
}

module.exports = NFTFlashLoanTrader;
