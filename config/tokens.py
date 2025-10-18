"""Token configurations and addresses for BSC"""

TOKENS = {
    # Main tokens
    "WBNB": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "BTCB": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    "ETH": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    
    # Stablecoins
    "USDT": "0x55d398326f99059fF775485246999027B3197955",
    "BUSD": "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
    "USDC": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    
    # DeFi tokens
    "CAKE": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    "ALPACA": "0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F",
    
    # Other major tokens
    "DOT": "0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402",
    "XRP": "0x1D2F0da169ceb9fC7B3144628dB156f3F6c60dBE",
    "ADA": "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47",
    "LINK": "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD"
}

# Token decimals
DECIMALS = {
    "WBNB": 18,
    "BTCB": 18,
    "ETH": 18,
    "USDT": 18,
    "BUSD": 18,
    "USDC": 18,
    "CAKE": 18,
    "ALPACA": 18,
    "DOT": 18,
    "XRP": 18,
    "ADA": 18,
    "LINK": 18
}

# Minimum amounts for profitable trades (in token units)
MIN_TRADE_AMOUNT = {
    "WBNB": 0.1,    # 0.1 BNB
    "BTCB": 0.01,   # 0.01 BTC
    "ETH": 0.1,     # 0.1 ETH
    "USDT": 1000,   # 1000 USDT
    "BUSD": 1000,   # 1000 BUSD
    "USDC": 1000,   # 1000 USDC
    "CAKE": 100,    # 100 CAKE
    "ALPACA": 1000, # 1000 ALPACA
    "DOT": 100,     # 100 DOT
    "XRP": 1000,    # 1000 XRP
    "ADA": 1000,    # 1000 ADA
    "LINK": 100     # 100 LINK
}
