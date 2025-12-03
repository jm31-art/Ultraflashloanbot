const { ethers } = require('ethers');
require('dotenv').config();

class ChainConnection {
    constructor() {
        this.httpProvider = null;
        this.wsProvider = null;
        this.blockPollInterval = null;
        this.currentBlockCallback = null;
        this.lastBlockNumber = null;
        this.isPolling = false;
        this.nodeIndex = 0;
        
        // Backup node URLs
        this.bscNodes = [
            'https://bsc-dataseed1.binance.org',
            'https://bsc-dataseed2.binance.org',
            'https://bsc-dataseed3.binance.org',
            'https://bsc-dataseed4.binance.org',
            'https://bsc.nodereal.io'
        ];
        
        this.wsNodes = [
            'wss://bsc-ws-node.nariox.org:443',
            'wss://bsc.nodereal.io/ws'
        ];
        
        // Get node URLs from environment variables or use defaults
        this.bscNodeUrl = process.env.BSC_PRIVATE_NODE_URL || this.bscNodes[0];
        this.bscWsUrl = process.env.BSC_PRIVATE_WS_URL || this.wsNodes[0];
        this.privateNodeAuth = process.env.PRIVATE_NODE_AUTH;
    }

    async getHTTPProvider() {
        if (!this.httpProvider) {
            // Try each node until one works
            for (let i = 0; i < this.bscNodes.length; i++) {
                const nodeUrl = process.env.BSC_PRIVATE_NODE_URL || this.bscNodes[i];
                const providerConfig = {
                    url: nodeUrl,
                    timeout: 60000, // 60 second timeout
                    allowInsecureAuthentication: true
                };
                
                if (this.privateNodeAuth) {
                    providerConfig.headers = {
                        Authorization: this.privateNodeAuth
                    };
                }
                
                try {
                    const provider = new ethers.providers.JsonRpcProvider(providerConfig);
                    await provider.ready;
                    
                    // Test the connection
                    const blockNumber = await provider.getBlockNumber();
                    console.log(`Connected to BSC node ${nodeUrl}, current block: ${blockNumber}`);
                    
                    this.httpProvider = provider;
                    this.nodeIndex = i;
                    break;
                } catch (error) {
                    console.log(`Failed to connect to ${nodeUrl}: ${error.message}`);
                    continue;
                }
            }
            
            if (!this.httpProvider) {
                throw new Error('Failed to connect to any BSC node');
            }
        }
        return this.httpProvider;
    }

    getWSProvider() {
        if (!this.wsProvider) {
            try {
                // Create WebSocket provider with authentication if available
                const wsUrl = this.privateNodeAuth ? 
                    `${this.bscWsUrl}?auth=${encodeURIComponent(this.privateNodeAuth)}` :
                    this.bscWsUrl;

                this.wsProvider = new ethers.providers.WebSocketProvider(wsUrl);

                // Handle WebSocket reconnection
                this.wsProvider._websocket.on('close', () => {
                    console.log('WebSocket disconnected, reconnecting...');
                    this.wsProvider = null;
                    setTimeout(() => this.getWSProvider(), 3000);
                });

                this.wsProvider._websocket.on('error', (error) => {
                    console.log('WebSocket error:', error.message);
                    // Fall back to polling if WebSocket fails
                    if (!this.httpProvider._events.block) {
                        console.log('Falling back to HTTP polling...');
                        this.httpProvider.on('block', this.currentBlockCallback);
                    }
                });
            } catch (error) {
                console.log('Failed to initialize WebSocket, falling back to HTTP:', error.message);
                return this.getHTTPProvider();
            }
        }
        return this.wsProvider;
    }

    async getGasPrice() {
        const provider = this.getHTTPProvider();
        return await provider.getGasPrice();
    }

    async getBlockNumber() {
        const provider = this.getHTTPProvider();
        return await provider.getBlockNumber();
    }

    onNewBlock(callback) {
        this.currentBlockCallback = callback;
        
        try {
            const provider = this.getWSProvider();
            provider.on('block', callback);
        } catch (error) {
            console.log('Using HTTP polling fallback for block updates');
            const httpProvider = this.getHTTPProvider();
            
            // Set up polling for new blocks
            const pollInterval = setInterval(async () => {
                try {
                    const blockNumber = await httpProvider.getBlockNumber();
                    if (this.lastBlockNumber !== blockNumber) {
                        this.lastBlockNumber = blockNumber;
                        callback(blockNumber);
                    }
                } catch (error) {
                    console.error('Error polling for new blocks:', error);
                }
            }, 12000); // Poll every 12 seconds (average BSC block time)

            // Store the interval for cleanup
            this.blockPollInterval = pollInterval;
        }
    }

    // Get mempool transactions (if supported by node)
    async getPendingTransactions() {
        const provider = this.getHTTPProvider();
        try {
            return await provider.send('txpool_content', []);
        } catch (error) {
            console.log('Mempool access not available');
            return null;
        }
    }

    // Clean up resources
    destroy() {
        if (this.wsProvider) {
            this.wsProvider.destroy();
            this.wsProvider = null;
        }
        if (this.blockPollInterval) {
            clearInterval(this.blockPollInterval);
            this.blockPollInterval = null;
        }
        if (this.httpProvider) {
            this.httpProvider.removeAllListeners();
            this.httpProvider = null;
        }
        this.currentBlockCallback = null;
        this.lastBlockNumber = null;
    }
}

// Export singleton instance
module.exports = new ChainConnection();
