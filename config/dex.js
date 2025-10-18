const DEX_CONFIGS = {
    APESWAP: {
        factory: "0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6",
        router: "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
        fee: 0.002 // 0.2%
    },
    KNIGHTSWAP: {
        factory: "0xf0bc2E21a76513aa7CCaDE75a8D8b2A70c7b8139",
        router: "0x05E61E0cDcD2170a76F9568a110CEe3AFdD6c46f",
        fee: 0.003 // 0.3%
    },
    BSCSWAP: {
        factory: "0xCe8fd65646f2a2a897755A1188C04aCe94D2B8D0",
        router: "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8",
        fee: 0.002
    },
    BISWAP: {
        factory: "0x858E3312ed3A876947EA49d572A7C42DE08af7EE",
        router: "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8",
        fee: 0.001 // 0.1%
    },
    MDEX: {
        factory: "0x3CD1C46068dAEa5Ebb0d3f55F6915B10648062B8",
        router: "0x7DAe51BD3E3376B8c7c4900E9107f12Be3AF1bA8",
        fee: 0.003
    },
    UNISWAP: {
        factory: "0xBCfCcbde45cE874adCB698cC183deBcF17952812",
        router: "0x05fF2B0DB69458A0750badebc4f9e13Ad7F7B997",
        fee: 0.003
    }
};

const TOKENS = {
    BNB: {
        address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        decimals: 18
    },
    USDT: {
        address: "0x55d398326f99059fF775485246999027B3197955",
        decimals: 18
    },
    USDC: {
        address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        decimals: 18
    },
    BUSD: {
        address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
        decimals: 18
    },
    BTCB: {
        address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
        decimals: 18
    },
    ETH: {
        address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
        decimals: 18
    },
    CAKE: {
        address: "0x0E09FaBb73Bd3Ade0a17ECC321fD13a19e81cE82",
        decimals: 18
    },
    ALPACA: {
        address: "0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F",
        decimals: 18
    },
    ADA: {
        address: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47",
        decimals: 18
    }
};

const TRADING_PAIRS = [
    ["BNB", "USDT"], ["BNB", "USDC"], ["BNB", "BTCB"], ["BNB", "ETH"],
    ["USDT", "USDC"], ["BUSD", "USDT"], ["BUSD", "USDC"],
    ["ALPACA", "CAKE"], ["ALPACA", "USDT"], ["ALPACA", "USDC"], ["ALPACA", "BNB"],
    ["CAKE", "USDT"], ["CAKE", "USDC"], ["CAKE", "ETH"], ["CAKE", "BTCB"], ["CAKE", "BNB"],
    ["ETH", "USDC"], ["ETH", "USDT"], ["ETH", "BTCB"],
    ["BUSD", "ETH"],
    ["ADA", "USDT"], ["ADA", "USDC"], ["ADA", "BNB"], ["ADA", "ETH"], ["ADA", "BTCB"],
    ["BTCB", "USDT"], ["BTCB", "USDC"], ["BUSD", "BTCB"]
];

module.exports = {
    DEX_CONFIGS,
    TOKENS,
    TRADING_PAIRS
};
