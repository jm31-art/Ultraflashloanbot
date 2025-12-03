const { ethers } = require('ethers');

const TOKENS = {
    WBNB: {
        symbol: 'WBNB',
        name: 'Wrapped BNB',
        address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        decimals: 18
    },
    USDT: {
        symbol: 'USDT',
        name: 'USDT Token',
        address: '0x55d398326f99059fF775485246999027B3197955',
        decimals: 18
    },
    BUSD: {
        symbol: 'BUSD',
        name: 'BUSD Token',
        address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
        decimals: 18
    },
    BTCB: {
        symbol: 'BTCB',
        name: 'Bitcoin BEP20',
        address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
        decimals: 18
    },
    ETH: {
        symbol: 'ETH',
        name: 'Ethereum Token',
        address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
        decimals: 18
    },
    // CAKE token removed due to checksum issues
};

// Helper function to validate addresses
function validateAddresses() {
    for (const [symbol, token] of Object.entries(TOKENS)) {
        try {
            token.address = ethers.utils.getAddress(token.address);
        } catch (error) {
            console.error(`Invalid address for ${symbol}:`, error.message);
        }
    }
}

// Validate addresses on module load
validateAddresses();

module.exports = TOKENS;
