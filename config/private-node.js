const privateNodeConfig = {
    bsc: {
        url: process.env.BSC_PRIVATE_NODE_URL || "http://localhost:8545",
        chainId: 56,
        // Default settings for your private node
        settings: {
            maxPriorityFeePerGas: "5000000000", // 5 gwei
            maxFeePerGas: "6000000000", // 6 gwei
            gasLimit: 500000,
            confirmations: 1, // Wait for 1 confirmation for faster execution
            timeoutBlocks: 2,
            networkCheckTimeout: 10000,
            // Custom headers for private node authentication
            headers: {
                Authorization: process.env.PRIVATE_NODE_AUTH // Your private node API key if needed
            }
        },
        // Dedicated mempool settings
        mempool: {
            maxSize: 10000, // Maximum number of transactions in mempool
            minGasPrice: "1000000000", // 1 gwei minimum
            maxGasPrice: "10000000000", // 10 gwei maximum
        },
        // Websocket configuration for real-time updates
        websocket: {
            enabled: true,
            url: process.env.BSC_PRIVATE_WS_URL || "ws://localhost:8546",
            reconnectDelay: 1000,
            maxRetries: 5
        }
    },
    // Nodereal MEV Protection Configuration
    nodereal: {
        url: process.env.NODEREAL_RPC || "https://bsc-mainnet.nodereal.io/v1/your_nodereal_api_key",
        chainId: 56,
        mevProtection: true, // Enable MEV protection features
        settings: {
            maxPriorityFeePerGas: "3000000000", // 3 gwei (lower for MEV protection)
            maxFeePerGas: "5000000000", // 5 gwei
            gasLimit: 500000,
            confirmations: 2, // Slightly higher confirmations for MEV protection
            timeoutBlocks: 3,
            networkCheckTimeout: 15000,
            // Nodereal API key authentication
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": process.env.NODEREAL_API_KEY
            }
        },
        // MEV-specific settings
        mev: {
            enabled: true,
            protectionLevel: "high", // high, medium, low
            sandwichProtection: true,
            frontrunProtection: true,
            backrunProtection: true,
            privateMempool: true
        },
        // Websocket configuration for real-time MEV monitoring
        websocket: {
            enabled: true,
            url: process.env.NODEREAL_WS_URL || "wss://bsc-mainnet.nodereal.io/ws/v1/your_nodereal_api_key",
            reconnectDelay: 2000,
            maxRetries: 10
        }
    }
};

module.exports = privateNodeConfig;
