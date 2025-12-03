const { ethers } = require('ethers');

class ChainlinkPriceFeed {
    constructor(provider) {
        this.provider = provider;
        this.priceFeeds = {
            'BNB/USD': '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE',
            'USDT/USD': '0xB97Ad0E74fa7d920791E90258A6E2085088b4320',
            'USDC/USD': '0x51597f405303C4377E36123cBc172b13269EA163',
            'ETH/USD': '0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e',
            'BTC/USD': '0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf'
        };
    }

    async getPriceFeed(priceFeedAddress) {
        const aggregatorV3InterfaceABI = [
            'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
        ];
        const priceFeed = new ethers.Contract(priceFeedAddress, aggregatorV3InterfaceABI, this.provider);
        const [, price, , updatedAt] = await priceFeed.latestRoundData();
        
        // Check if price is stale (older than 3 minutes)
        const timestamp = Math.floor(Date.now() / 1000);
        if (timestamp - updatedAt.toNumber() > 180) {
            throw new Error('Price feed is stale');
        }
        
        return ethers.utils.formatUnits(price, 8); // Chainlink prices have 8 decimals
    }

    async getTokenPrice(symbol) {
        const priceFeedAddress = this.priceFeeds[symbol];
        if (!priceFeedAddress) {
            throw new Error(`No price feed found for ${symbol}`);
        }
        return this.getPriceFeed(priceFeedAddress);
    }

    async getAllPrices() {
        const prices = {};
        for (const [symbol, address] of Object.entries(this.priceFeeds)) {
            prices[symbol] = await this.getPriceFeed(address);
        }
        return prices;
    }
}

module.exports = ChainlinkPriceFeed;
