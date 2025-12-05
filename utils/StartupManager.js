const { ethers } = require('ethers');
const TransactionVerifier = require('./TransactionVerifier');

class StartupManager {
    constructor(config) {
        this.config = config;
        this.provider = null;
        this.signer = null;
        this.transactionVerifier = null;
    }

    async initialize() {
        try {
            console.log('Initializing bot systems...');

            // Initialize provider
            this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
            console.log('Provider initialized:', await this.provider.getNetwork());

            // Initialize signer
            this.signer = new ethers.Wallet(this.config.privateKey, this.provider);
            console.log('Signer initialized:', this.signer.address);

            // Initialize transaction verifier
            this.transactionVerifier = new TransactionVerifier(this.provider, this.signer);
            console.log('Transaction verifier initialized');

            // Test connection
            await this._testConnection();

            return {
                provider: this.provider,
                signer: this.signer,
                transactionVerifier: this.transactionVerifier
            };
        } catch (error) {
            console.error('Initialization failed:', error);
            throw error;
        }
    }

    async _testConnection() {
        try {
            // Test provider connection
            await this.provider.getBlockNumber();

            // Test signer balance
            const balance = await this.signer.getBalance();
            console.log('Wallet balance:', ethers.formatEther(balance), 'ETH');

            // Test transaction verifier
            const mockTx = {
                to: this.signer.address,
                value: 0,
                data: '0x',
            };
            await this.transactionVerifier._verifyBasicParams(mockTx);

            console.log('All systems tested successfully');
        } catch (error) {
            console.error('Connection test failed:', error);
            throw new Error('Failed to establish connection: ' + error.message);
        }
    }

    async cleanup() {
        if (this.transactionVerifier) {
            await this.transactionVerifier.cleanup();
        }
    }
}

module.exports = StartupManager;
