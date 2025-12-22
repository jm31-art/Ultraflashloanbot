// Protocol configurations for CaliFlashloanBot
// This file contains addresses and configurations for various DeFi protocols

const PROTOCOLS = {
    // DEX Protocols
    DEX_PROTOCOLS: {
        PANCAKESWAP: {
            name: 'PancakeSwap',
            router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
            factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
            fee: 0.0025, // 0.25%
            supportsFlashSwap: true
        },
        UNISWAP_V2: {
            name: 'Uniswap V2',
            router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
            factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
            fee: 0.003, // 0.3%
            supportsFlashSwap: true
        },
        SUSHISWAP: {
            name: 'SushiSwap',
            router: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
            factory: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
            fee: 0.003, // 0.3%
            supportsFlashSwap: true
        },
        BISWAP: {
            name: 'Biswap',
            router: '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8',
            factory: '0x858E3312ED3A876947EA49D572A7C42DE08AF7EE0',
            fee: 0.001, // 0.1%
            supportsFlashSwap: false, // Disabled due to API issues
            enabled: false
        },
        BABYSWAP: {
            name: 'BabySwap',
            router: '0x325E343f1dE602396E256B67eFd1F61C3A66639C',
            factory: '0x86407bEa2078ea5f5EB5A52B2caA963bC7F27977',
            fee: 0.002, // 0.2%
            supportsFlashSwap: true
        },
        APESWAP: {
            name: 'ApeSwap',
            router: '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7',
            factory: '0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6',
            fee: 0.002, // 0.2%
            supportsFlashSwap: true
        },
        JULSWAP: {
            name: 'JulSwap',
            router: '0xbd67d157502A23309Db761c41965600c2Ec788bC',
            factory: '0x553990F2CBA90272390f62C5BDb1681fFc899675',
            fee: 0.002, // 0.2%
            supportsFlashSwap: true
        }
    },

    // Lending Protocols (BSC Mainnet)
    LENDING_PROTOCOLS: {
        // AAVE V3 on BSC - DISABLED: Not properly configured for BSC
        AAVE: {
            name: 'AAVE',
            pool: '0x0000000000000000000000000000000000000000', // Invalid - AAVE V3 not active on BSC
            lendingPool: '0x0000000000000000000000000000000000000000', // Invalid
            incentivesController: '0x0000000000000000000000000000000000000000', // Invalid
            supportsFlashLoan: false,
            enabled: false // Disable AAVE on BSC
        },
        // Compound on BSC - DISABLED: Not active on BSC
        COMPOUND: {
            name: 'Compound',
            comptroller: '0x0000000000000000000000000000000000000000', // Invalid - Compound not on BSC
            priceOracle: '0x0000000000000000000000000000000000000000', // Invalid
            supportsFlashLoan: false,
            enabled: false // Disable Compound on BSC
        },
        // Venus Protocol - ACTIVE on BSC
        VENUS: {
            name: 'Venus',
            comptroller: '0xfD36E2c2a6789Db23113685031d7F16329158384',
            priceOracle: '0xd8B6dA2bfEC71D684D3E2a2FC9492Ddad5C3787F',
            supportsFlashLoan: false,
            enabled: true // Enable Venus on BSC
        },
        // Cream Finance - DISABLED: Not active on BSC
        CREAM: {
            name: 'Cream Finance',
            comptroller: '0x0000000000000000000000000000000000000000', // Invalid - Cream not on BSC
            supportsFlashLoan: false,
            enabled: false // Disable Cream on BSC
        }
    },

    // Flash Loan Providers
    FLASH_LOAN_PROVIDERS: {
        PANCAKESWAP: {
            name: 'PancakeSwap Flash Swap',
            address: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap Router
            fee: 0.0025, // 0.25% swap fee
            maxAmount: '100000000000000000000000' // 100k BNB equivalent
        },
        AAVE: {
            name: 'AAVE Flash Loans',
            address: '0x0000000000000000000000000000000000000000', // Disabled on BSC
            fee: 0.0009, // 0.09%
            maxAmount: '0'
        },
        DODO: {
            name: 'DODO Flash Loans',
            address: '0x0fe261aeE0d1C4DFdDee4102E82Dd425999065F4', // DSP address
            fee: 0.0003, // 0.03%
            maxAmount: '1000000000000000000000' // 1000 ETH equivalent
        }
    },

    // Token Addresses
    TOKENS: {
        WBNB: {
            symbol: 'WBNB',
            address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
            decimals: 18,
            isNative: true
        },
        BUSD: {
            symbol: 'BUSD',
            address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
            decimals: 18,
            isStable: true
        },
        USDT: {
            symbol: 'USDT',
            address: '0x55d398326f99059fF775485246999027B3197955',
            decimals: 18,
            isStable: true
        },
        USDC: {
            symbol: 'USDC',
            address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
            decimals: 18,
            isStable: true
        },
        DAI: {
            symbol: 'DAI',
            address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
            decimals: 18,
            isStable: true
        },
        BTCB: {
            symbol: 'BTCB',
            address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
            decimals: 18,
            isMajor: true
        },
        ETH: {
            symbol: 'ETH',
            address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
            decimals: 18,
            isMajor: true
        },
        CAKE: {
            symbol: 'CAKE',
            address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
            decimals: 18,
            isGovernance: true
        },
        XVS: {
            symbol: 'XVS',
            address: '0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C6',
            decimals: 18,
            isGovernance: true
        }
    },

    // Chain Configuration
    CHAIN_CONFIG: {
        BSC_MAINNET: {
            chainId: 56,
            name: 'BSC Mainnet',
            rpcUrl: 'https://bsc-dataseed1.binance.org/',
            blockTime: 3000, // 3 seconds
            nativeCurrency: {
                name: 'BNB',
                symbol: 'BNB',
                decimals: 18
            }
        },
        BSC_TESTNET: {
            chainId: 97,
            name: 'BSC Testnet',
            rpcUrl: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
            blockTime: 3000,
            nativeCurrency: {
                name: 'BNB',
                symbol: 'BNB',
                decimals: 18
            }
        }
    },

    // Risk Parameters
    RISK_CONFIG: {
        maxSlippage: 0.02, // 2%
        maxPriceImpact: 0.01, // 1%
        minLiquidityRatio: 0.1, // 10% of pool
        maxLeverage: 5, // 5x max leverage
        emergencyStopLoss: 0.1, // 10% stop loss
        maxDrawdown: 0.15 // 15% max drawdown
    },

    // Trading Pairs Configuration
    TRADING_PAIRS: [
        ['WBNB', 'BUSD'],
        ['WBNB', 'USDT'],
        ['WBNB', 'USDC'],
        ['WBNB', 'BTCB'],
        ['WBNB', 'ETH'],
        ['BUSD', 'USDT'],
        ['BUSD', 'USDC'],
        ['USDT', 'USDC'],
        ['BTCB', 'ETH'],
        ['CAKE', 'WBNB'],
        ['XVS', 'WBNB']
    ],

    // NFT Marketplaces
    NFT_MARKETPLACES: {
        OPENSEA: {
            name: 'OpenSea',
            contract: '0x00000000006c3852cbEf3e08E8dF289169EdE581',
            supportsFlashLoan: false
        },
        LOOKSRARE: {
            name: 'LooksRare',
            contract: '0x59728544B08AB483533076417FbBB2fD0B17CE3a',
            supportsFlashLoan: false
        },
        BLUR: {
            name: 'Blur',
            contract: '0x000000000000Ad05Ccc4F10045630fb830B95127',
            supportsFlashLoan: false
        }
    }
};

export { PROTOCOLS };
