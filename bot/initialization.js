const chainConnection = require('./utils/chainConnection');

// Example usage in your bot
async function initializeBot() {
    try {
        // Get providers
        const provider = chainConnection.getHTTPProvider();
        
        // Subscribe to new blocks
        chainConnection.onNewBlock(async (blockNumber) => {
            console.log('New block:', blockNumber);
            
            // Get gas price for each block
            const gasPrice = await chainConnection.getGasPrice();
            console.log('Current gas price:', ethers.formatUnits(gasPrice, 'gwei'), 'gwei');
            
            // Check for arbitrage opportunities
            // ... your arbitrage logic here
        });

        // Optional: Monitor mempool for pending transactions
        const pendingTxs = await chainConnection.getPendingTransactions();
        if (pendingTxs) {
            console.log('Monitoring mempool transactions');
        }

    } catch (error) {
        console.error('Bot initialization failed:', error);
    }
}

module.exports = {
    initializeBot
};
