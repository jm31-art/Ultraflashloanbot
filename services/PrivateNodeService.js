const ethers = require('ethers');
const privateNodeConfig = require('../config/private-node');

class PrivateNodeService {
    constructor() {
        this.config = privateNodeConfig.bsc;
        this.provider = null;
        this.wsProvider = null;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Initialize HTTP provider
            this.provider = new ethers.JsonRpcProvider(
                this.config.url,
                this.config.chainId,
                {
                    name: 'BSC-Private',
                    headers: this.config.settings.headers
                }
            );

            // Initialize WebSocket provider if enabled
            if (this.config.websocket.enabled) {
                this.wsProvider = new ethers.WebSocketProvider(
                    this.config.websocket.url,
                    {
                        chainId: this.config.chainId,
                        name: 'BSC-Private-WS'
                    }
                );

                // Setup WebSocket reconnection
                this.wsProvider._websocket.on('close', () => {
                    this.handleWsReconnection();
                });
            }

            // Test connection
            await this.provider.getNetwork();
            this.initialized = true;
            console.log('Private node connection established');
        } catch (error) {
            console.error('Failed to initialize private node connection:', error);
            throw error;
        }
    }

    async handleWsReconnection(retryCount = 0) {
        if (retryCount >= this.config.websocket.maxRetries) {
            console.error('Max WebSocket reconnection attempts reached');
            return;
        }

        setTimeout(async () => {
            try {
                this.wsProvider = new ethers.WebSocketProvider(
                    this.config.websocket.url,
                    {
                        chainId: this.config.chainId,
                        name: 'BSC-Private-WS'
                    }
                );
                console.log('WebSocket reconnected successfully');
            } catch (error) {
                console.error('WebSocket reconnection failed:', error);
                this.handleWsReconnection(retryCount + 1);
            }
        }, this.config.websocket.reconnectDelay * (retryCount + 1));
    }

    getProvider() {
        if (!this.initialized) {
            throw new Error('Private node service not initialized');
        }
        return this.provider;
    }

    getWsProvider() {
        if (!this.initialized || !this.config.websocket.enabled) {
            throw new Error('WebSocket provider not available');
        }
        return this.wsProvider;
    }

    async sendPrivateTransaction(transaction) {
        if (!this.initialized) {
            throw new Error('Private node service not initialized');
        }

        try {
            // Apply custom gas settings
            const enhancedTx = {
                ...transaction,
                maxPriorityFeePerGas: this.config.settings.maxPriorityFeePerGas,
                maxFeePerGas: this.config.settings.maxFeePerGas,
                gasLimit: this.config.settings.gasLimit
            };

            // Send transaction through private node
            const response = await this.provider.sendTransaction(enhancedTx);
            
            // Wait for confirmation
            await response.wait(this.config.settings.confirmations);
            
            return response;
        } catch (error) {
            console.error('Private transaction failed:', error);
            throw error;
        }
    }

    async getPrivateMempool() {
        if (!this.initialized) {
            throw new Error('Private node service not initialized');
        }

        try {
            const pending = await this.provider.send('txpool_content', []);
            return pending;
        } catch (error) {
            console.error('Failed to fetch private mempool:', error);
            throw error;
        }
    }
}

module.exports = new PrivateNodeService();
