require('dotenv').config();
const { ethers } = require('ethers');
const ArbitrageBot = require('./bot/ArbitrageBot');

async function main() {
    // Connect to BSC
    const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC || "https://bsc-dataseed1.binance.org");
    
    // Load private key from env
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        throw new Error('Please set your PRIVATE_KEY in the .env file');
    }
    
    // Create signer
    const signer = new ethers.Wallet(privateKey, provider);
    console.log(`Connected with address: ${signer.address}`);

    // Initialize bot with options
    const bot = new ArbitrageBot(provider, signer, {
        minProfitUSD: 50,          // Minimum profit to execute trade
        maxGasPrice: 5,            // Maximum gas price in gwei
        gasPriceRefund: 1.5,       // Refund multiplier for gas price spikes
        scanInterval: 10000        // Scan every 10 seconds
    });

    // Start the bot
    await bot.start();

    // Handle shutdown gracefully
    process.on('SIGINT', () => {
        console.log('Shutting down bot...');
        bot.stop();
        process.exit();
    });
}

// Run the bot
main().catch(error => {
    console.error('Bot crashed:', error);
    process.exit(1);
});
