const { ethers } = require('ethers');
const DexPriceFeed = require('../services/DexPriceFeed');

async function fetchCurrentPrices() {
    // Connect to BSC mainnet
    const provider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
    const priceFeed = new DexPriceFeed(provider);

    // Pairs to check
    const pairs = [
        'BNB/USDT',
        'BNB/USDC',
        'ETH/USDT',
        'BTC/USDT',
        'CAKE/USDT'
    ];

    console.log('Current Market Prices');
    console.log('===================\n');

    for (const pair of pairs) {
        const prices = await priceFeed.getAllPrices(pair);
        console.log(`${pair}:`);
        console.log(`Uniswap V3: $${prices.uniswap?.toFixed(2) || 'N/A'}`);
        console.log(`PancakeSwap V3: $${prices.pancakeswap?.toFixed(2) || 'N/A'}`);
        console.log(`CoinGecko: $${prices.coingecko?.toFixed(2) || 'N/A'}`);
        console.log('------------------------\n');
    }
}

// Run price check
fetchCurrentPrices().catch(console.error);
