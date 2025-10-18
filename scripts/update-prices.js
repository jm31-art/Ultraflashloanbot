const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function getCurrentPrices() {
    try {
        // Fetch current prices from CoinGecko
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: 'bitcoin,ethereum,binancecoin,binance-usd,tether,usd-coin,pancakeswap-token,alpaca-finance,cardano',
                vs_currencies: 'usd'
            }
        });

        // Add small spreads for different DEXes (realistic market conditions)
        const prices = {
            BTC: response.data.bitcoin.usd,
            ETH: response.data.ethereum.usd,
            BNB: response.data.binancecoin.usd,
            BUSD: 1.0, // Stablecoin
            USDT: 1.0, // Stablecoin
            USDC: 1.0, // Stablecoin
            CAKE: response.data['pancakeswap-token'].usd,
            ALPACA: response.data['alpaca-finance'].usd,
            ADA: response.data.cardano.usd
        };

        return prices;
    } catch (error) {
        console.error('Error fetching prices:', error);
        return null;
    }
}

async function updateTestFile() {
    const prices = await getCurrentPrices();
    if (!prices) return;

    const testFilePath = path.join(__dirname, '..', 'test', 'flashloan-simulation.test.js');
    let testFile = fs.readFileSync(testFilePath, 'utf8');

    // Update BNB/USDT pair
    const bnbPrice = prices.BNB;
    testFile = testFile.replace(
        /buyPrice: 1140\.23,\s+sellPrice: 1172\.16,/g,
        `buyPrice: ${bnbPrice.toFixed(2)},\n                sellPrice: ${(bnbPrice * 1.028).toFixed(2)}, // 2.80% spread`
    );

    // Update BTC/USDT pair
    const btcPrice = prices.BTC;
    testFile = testFile.replace(
        /buyPrice: 108103\.00,\s+sellPrice: 110643\.42,/g,
        `buyPrice: ${btcPrice.toFixed(2)},\n                sellPrice: ${(btcPrice * 1.0235).toFixed(2)}, // 2.35% spread`
    );

    // Update ETH/USDT pair
    const ethPrice = prices.ETH;
    testFile = testFile.replace(
        /buyPrice: 3895\.38,\s+sellPrice: 3991\.95,/g,
        `buyPrice: ${ethPrice.toFixed(2)},\n                sellPrice: ${(ethPrice * 1.0248).toFixed(2)}, // 2.48% spread`
    );

    // Update CAKE/USDT pair
    const cakePrice = prices.CAKE;
    testFile = testFile.replace(
        /buyPrice: 2\.95,\s+sellPrice: 3\.04,/g,
        `buyPrice: ${cakePrice.toFixed(2)},\n                sellPrice: ${(cakePrice * 1.0317).toFixed(2)}, // 3.17% spread`
    );

    fs.writeFileSync(testFilePath, testFile);
    console.log('Test file updated with current market prices');
}

updateTestFile().catch(console.error);
