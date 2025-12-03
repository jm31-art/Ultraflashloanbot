const Web3 = require('web3');
const { GAS_SETTINGS } = require('../config/performance');

class MEVProtector {
    constructor(web3Provider) {
        this.web3 = new Web3(web3Provider);
    }

    async protectTransaction(txData) {
        // Add private transaction support
        if (process.env.FLASHBOTS_ENABLED === 'true') {
            return this.sendViaFlashbots(txData);
        }
        
        // Implement backrunning protection
        const gasPrice = await this.calculateOptimalGasPrice();
        txData.gasPrice = gasPrice;
        
        // Add timing randomization
        const delay = Math.floor(Math.random() * 500); // 0-500ms random delay
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return txData;
    }

    async calculateOptimalGasPrice() {
        const baseGasPrice = await this.web3.eth.getGasPrice();
        const optimalPrice = Math.min(
            Math.max(baseGasPrice * 1.1, GAS_SETTINGS.minGasPrice),
            GAS_SETTINGS.maxGasPrice
        );
        return optimalPrice.toString();
    }

    async sendViaFlashbots(txData) {
        // Use Flashbots bundler for MEV protection
        const FlashbotsBundler = require('./FlashbotsBundler');
        const bundler = new FlashbotsBundler(this.web3.currentProvider, null, 'mainnet');

        try {
            await bundler.initialize();

            // Create bundle with the arbitrage transaction
            const bundle = await bundler.createArbitrageBundle(txData);

            // Get target block number
            const currentBlock = await this.web3.eth.getBlockNumber();
            const targetBlockNumber = currentBlock + 1;

            // Submit bundle
            const result = await bundler.submitBundle(bundle, targetBlockNumber);

            if (result.success) {
                console.log(`Flashbots bundle submitted successfully: ${result.bundleHash}`);
                return { success: true, bundleHash: result.bundleHash };
            } else {
                console.error('Flashbots bundle submission failed:', result.error);
                return { success: false, error: result.error };
            }
        } catch (error) {
            console.error('Flashbots transaction failed:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = MEVProtector;
