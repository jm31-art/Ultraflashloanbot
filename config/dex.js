const { ethers } = require('ethers');

function safeGetAddress(address) {
    try {
        return ethers.getAddress(address);
    } catch (error) {
        console.warn(`Warning: Address checksum failed for ${address}`);
        return address;
    }
}

const DEX_CONFIGS = {
    PANCAKESWAP: {
        name: 'PancakeSwap',
        factory: safeGetAddress('0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'),
        router: safeGetAddress('0x10ED43C718714eb63d5aA57B78B54704E256024E'),
        fee: 0.0025, // 0.25%
        initCode: '0x00fb7f630766e6a796048ea87d01acd3068e8ff67d078148a3fa3f4a84f69bd5'
    },
    APESWAP: {
        name: 'ApeSwap',
        factory: safeGetAddress('0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6'),
        router: safeGetAddress('0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7'),
        fee: 0.002, // 0.2%
        initCode: '0xf4ccce374816856d11f00e4069e7cada164065686fbef53c6167a63ec2fd8c5b'
    },
    SUSHISWAP: {
        name: 'SushiSwap',
        factory: safeGetAddress('0xc35DADB65012eC5796536bD9864eD8773aBc74C4'),
        router: safeGetAddress('0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506'),
        fee: 0.003, // 0.3%
        initCode: '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303'
    },

    JULSWAP: {
        name: 'JulSwap',
        factory: safeGetAddress('0x553990F2CBA90272390f62C5BDb1681fFc899675'),
        router: safeGetAddress('0xBd67D157502a23309db761c41965600c2ec788BC'),
        fee: 0.002, // 0.2%
        initCode: '0x57c940a5f05fc1b26b3c4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4'
    },
    PANCAKESWAP_V3: {
        name: 'PancakeSwap V3',
        factory: safeGetAddress('0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'),
        router: safeGetAddress('0x1b81D678ffb9C0263b24A97847620C99d213eB14'),
        fee: 0.0005, // 0.05% (variable fees)
        initCode: '0x6ce8eb472fa82df5469c6ab6d485f17c3ad13c8cd7af59b3d4a8026c5cecc160'
    },

    // Uniswap V2 on BSC (using PancakeSwap's Uniswap V2 compatible contracts)
    UNISWAP: {
        name: 'Uniswap V2',
        factory: safeGetAddress('0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'), // Same as PancakeSwap V2
        router: safeGetAddress('0x10ED43C718714eb63d5aA57B78B54704E256024E'), // Same as PancakeSwap V2
        fee: 0.003, // 0.3%
        initCode: '0x00fb7f630766e6a796048ea87d01acd3068e8ff67d078148a3fa3f4a84f69bd5' // Same as PancakeSwap V2
    },

    // Additional DEXes for cross-DEX arbitrage
    BISWAP: {
        name: 'Biswap',
        factory: safeGetAddress('0x858E3312ed3A876947EA49d572A7C42DE08af7EE0'), // Valid Biswap factory
        router: safeGetAddress('0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8'), // Valid Biswap router
        fee: 0.001, // 0.1% - competitive fee
        initCode: '0xfea293c909d87cd4153593f077b76bb7e9438d6386ef7b23a8ff3257d6596c'
    },

    // WAULTSWAP: {
    //     name: 'WaultSwap',
    //     factory: safeGetAddress('0xB42E3FE71b7E0673335b3331B3e1053BD5c85EEd'), // Invalid address
    //     router: safeGetAddress('0xD48745E39BbED146eEc15b79cBF964884F9877c2'), // Invalid address
    //     fee: 0.002, // 0.2%
    //     initCode: '0x1cdc2246d318adcf694926aa49a159ff39a42c83c537876322f9674eca74931b'
    // }
};

const TOKENS = {
    // Native and wrapped tokens
    BNB: {
        symbol: 'BNB',
        name: 'Binance Coin',
        address: '0x0000000000000000000000000000000000000000', // Native BNB
        decimals: 18,
        isNative: true
    },
    WBNB: {
        symbol: 'WBNB',
        name: 'Wrapped BNB',
        address: ethers.getAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'),
        decimals: 18,
        minLiquidity: ethers.parseEther('10'), // Minimum 10 BNB liquidity
        maxTradeSize: ethers.parseEther('100') // Maximum 100 BNB per trade
    },

    // Stablecoins
    USDT: {
        symbol: 'USDT',
        name: 'Tether USD',
        address: ethers.getAddress('0x55d398326f99059fF775485246999027B3197955'),
        decimals: 18,
        isStablecoin: true,
        targetPrice: 1.0
    },
    USDC: {
        symbol: 'USDC',
        name: 'USD Coin',
        address: ethers.getAddress('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'),
        decimals: 18,
        isStablecoin: true,
        targetPrice: 1.0
    },
    BUSD: {
        symbol: 'BUSD',
        name: 'Binance USD',
        address: ethers.getAddress('0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56'),
        decimals: 18,
        isStablecoin: true,
        targetPrice: 1.0
    },
    FDUSD: {
        symbol: 'FDUSD',
        name: 'First Digital USD',
        address: ethers.getAddress('0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409'),
        decimals: 18,
        isStablecoin: true,
        targetPrice: 1.0
    },
    DAI: {
        symbol: 'DAI',
        name: 'Dai Stablecoin',
        address: ethers.getAddress('0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3'),
        decimals: 18,
        isStablecoin: true,
        targetPrice: 1.0
    },

    // Major cryptocurrencies
    BTCB: {
        symbol: 'BTCB',
        name: 'Bitcoin BEP20',
        address: ethers.getAddress('0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c'),
        decimals: 18
    },
    ETH: {
        symbol: 'ETH',
        name: 'Ethereum Token',
        address: ethers.getAddress('0x2170Ed0880ac9A755fd29B2688956BD959F933F8'),
        decimals: 18
    },
    CAKE: {
        symbol: 'CAKE',
        name: 'PancakeSwap Token',
        address: ethers.getAddress('0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'),
        decimals: 18
    },

    // Altcoins
    XRP: {
        symbol: 'XRP',
        name: 'XRP BEP20',
        address: ethers.getAddress('0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE'),
        decimals: 18
    },
    ADA: {
        symbol: 'ADA',
        name: 'Cardano BEP20',
        address: ethers.getAddress('0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47'),
        decimals: 18
    },
    DOT: {
        symbol: 'DOT',
        name: 'Polkadot BEP20',
        address: ethers.getAddress('0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402'),
        decimals: 18
    },
    LTC: {
        symbol: 'LTC',
        name: 'Litecoin BEP20',
        address: ethers.getAddress('0x4338665CBB7B2485A8855A139b75D5e34AB0DB94'),
        decimals: 18
    },
    LINK: {
        symbol: 'LINK',
        name: 'Chainlink BEP20',
        address: ethers.getAddress('0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD'),
        decimals: 18
    },
    MATIC: {
        symbol: 'MATIC',
        name: 'Polygon BEP20',
        address: ethers.getAddress('0xCC42724C6683B7E57334c4E856f4c9965ED682bD'),
        decimals: 18
    }
};

const TRADING_PAIRS = [
    // === STABLECOIN PAIRS (Highest Priority - Mispricing Detection) ===
    // All stablecoin combinations for mispricing arbitrage
    ["USDT", "USDC"], ["USDT", "BUSD"], ["USDT", "FDUSD"], ["USDT", "DAI"],
    ["USDC", "BUSD"], ["USDC", "FDUSD"], ["USDC", "DAI"],
    ["BUSD", "FDUSD"], ["BUSD", "DAI"], ["FDUSD", "DAI"],

    // === MAJOR TOKEN PAIRS ===
    // WBNB pairs (highest liquidity)
    ["WBNB", "USDT"], ["WBNB", "USDC"], ["WBNB", "BUSD"], ["WBNB", "FDUSD"], ["WBNB", "DAI"],
    ["WBNB", "BTCB"], ["WBNB", "ETH"], ["WBNB", "CAKE"],

    // BTCB pairs
    ["BTCB", "USDT"], ["BTCB", "USDC"], ["BTCB", "BUSD"], ["BTCB", "FDUSD"],
    ["BTCB", "ETH"], ["BTCB", "CAKE"],

    // ETH pairs
    ["ETH", "USDT"], ["ETH", "USDC"], ["ETH", "BUSD"], ["ETH", "FDUSD"],
    ["ETH", "CAKE"],

    // CAKE pairs
    ["CAKE", "USDT"], ["CAKE", "USDC"], ["CAKE", "BUSD"], ["CAKE", "FDUSD"],

    // === ALTCOIN PAIRS ===
    // XRP pairs
    ["XRP", "USDT"], ["XRP", "USDC"], ["XRP", "BUSD"], ["XRP", "FDUSD"],
    ["XRP", "WBNB"], ["XRP", "BTCB"], ["XRP", "ETH"],

    // ADA pairs
    ["ADA", "USDT"], ["ADA", "USDC"], ["ADA", "BUSD"], ["ADA", "FDUSD"],
    ["ADA", "WBNB"], ["ADA", "BTCB"], ["ADA", "ETH"],

    // DOT pairs
    ["DOT", "USDT"], ["DOT", "USDC"], ["DOT", "BUSD"], ["DOT", "FDUSD"],
    ["DOT", "WBNB"], ["DOT", "BTCB"], ["DOT", "ETH"],

    // LTC pairs
    ["LTC", "USDT"], ["LTC", "USDC"], ["LTC", "BUSD"], ["LTC", "FDUSD"],
    ["LTC", "WBNB"], ["LTC", "BTCB"], ["LTC", "ETH"],

    // LINK pairs
    ["LINK", "USDT"], ["LINK", "USDC"], ["LINK", "BUSD"], ["LINK", "FDUSD"],
    ["LINK", "WBNB"], ["LINK", "BTCB"], ["LINK", "ETH"],

    // MATIC pairs
    ["MATIC", "USDT"], ["MATIC", "USDC"], ["MATIC", "BUSD"], ["MATIC", "FDUSD"],
    ["MATIC", "WBNB"], ["MATIC", "BTCB"], ["MATIC", "ETH"],

    // === TRIANGULAR ARBITRAGE PAIRS ===
    // High-value triangular combinations
    ["BTCB", "ETH"], ["BTCB", "CAKE"], ["ETH", "CAKE"],
    ["WBNB", "CAKE"], ["USDT", "CAKE"], ["USDC", "CAKE"], ["BUSD", "CAKE"],

    // Cross-chain triangular opportunities
    ["BTCB", "XRP"], ["BTCB", "ADA"], ["BTCB", "DOT"], ["BTCB", "LTC"],
    ["ETH", "XRP"], ["ETH", "ADA"], ["ETH", "DOT"], ["ETH", "LTC"],
    ["CAKE", "XRP"], ["CAKE", "ADA"], ["CAKE", "DOT"], ["CAKE", "LTC"],

    // Stablecoin triangular arbitrage
    ["USDT", "FDUSD"], ["USDC", "FDUSD"], ["BUSD", "FDUSD"],
    ["USDT", "XRP"], ["USDC", "XRP"], ["BUSD", "XRP"],
    ["USDT", "ADA"], ["USDC", "ADA"], ["BUSD", "ADA"]
];

module.exports = {
    DEX_CONFIGS,
    TOKENS,
    TRADING_PAIRS
};
