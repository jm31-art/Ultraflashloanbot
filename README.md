# CaliFlashloanBot

A sophisticated arbitrage trading bot for the Binance Smart Chain (BSC) that utilizes flash loans to execute profitable trades across multiple DEXs.

## Features

- Flash loan integration with DODO Finance
- Multi-DEX arbitrage (UniswapV3, PancakeSwapV3, Curve, Balancer)
- Advanced price monitoring and arbitrage opportunity detection
- Gas-optimized smart contracts
- Comprehensive testing suite
- AI-powered trading strategies
- Risk management system
- Automated profit withdrawal

## Supported DEXs

- UniswapV3
- PancakeSwapV3
- Curve Finance
- Balancer
- DODO (Flash Loan Provider)

## Trading Pairs

- BTC/USDT, BTC/USDC, BTC/DAI
- ETH/USDT, ETH/BTC, ETH/DAI
- BNB/USDT, BNB/USDC
- Stablecoin pairs (USDT/USDC, BUSD/USDT)
- CAKE and other BSC tokens

## Requirements

- Node.js v16+
- Python 3.8+
- Hardhat
- Web3.py
- Access to BSC node (or BSC RPC URL)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/CaliFlashloanBot.git
cd CaliFlashloanBot
```

2. Install dependencies:
```bash
npm install
pip install -r requirements.txt
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Compile smart contracts:
```bash
npx hardhat compile
```

## Configuration

1. Update `config/tokens.py` with your target trading pairs
2. Configure DEX settings in `config/dex.js`
3. Set pool addresses in `config/pool_addresses.json`
4. Adjust risk parameters in `utils/riskManager.js`

## Testing

Run the test suite:

```bash
# Smart contract tests
npx hardhat test

# Python tests
python -m pytest tests/

# Simulation tests
npx hardhat test test/flashloan-simulation.test.js
```

## Deployment

1. Deploy to BSC Testnet:
```bash
npx hardhat run scripts/deploy.js --network bsc_testnet
```

2. Deploy to BSC Mainnet:
```bash
npx hardhat run scripts/deploy.js --network bsc
```

## Usage

1. Start the price monitoring service:
```bash
node services/PriceService.js
```

2. Run the bot:
```bash
node start-bot.js
```

## Performance

- Average gas cost per trade: ~$3.22
- Minimum profitable spread: 2%
- Typical profit margins: 2-3% for stablecoins, 2-10% for volatile pairs
- Flash loan fee: 0.05%

## Security Features

- Slippage protection
- Multi-signature wallet support
- Emergency stop functionality
- Price impact checks
- Gas price monitoring
- Automated risk assessment

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

MIT License

## Disclaimer

This software is for educational purposes only. Cryptocurrency trading carries significant risks. Always test thoroughly on testnets before deploying with real assets.

## Support

For support, please open an issue in the GitHub repository.
