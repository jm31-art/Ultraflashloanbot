# 🚀 MONEY TREES PRINTER 2025

**Dual-Strategy DeFi Bot System - Arbitrage + Liquidation**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/node.js-18+-green.svg)](https://nodejs.org/)

A high-performance dual-bot system optimized for **Arbitrum Nova** with native asset integration:
- **🐍 Python Bot**: Arbitrage scanning (12 edges) - Cross-DEX price gaps on WETH/USDC/USDT/ARB/WBTC
- **☕ JavaScript Bot**: Liquidation hunting - Protocol liquidations on Arbitrum Nova

Features micro-arbitrage detection, volatility-adaptive scanning, AI-powered optimization, Dune analytics integration, and specialized liquidation strategies on ultra-low-cost Arbitrum Nova.

## 🔥 Key Features

### 🎯 **Python Bot: 12 Arbitrage Edges**
1. **Collateral Swap V3** - Oracle vs DEX price gaps
2. **WBNB Premium** - Wrapped token arbitrage
3. **BeEFy + Venus Liquidation** - Protocol liquidation opportunities
4. **Alpaca FairPrice Gap** - Fair price arbitrage
5. **Pancake V3 Fee Tier Sniping** - Fee optimization
6. **Venus XVS Reward Spike** - Reward monitoring
7. **Cross-DEX Deviation** - Multi-DEX arbitrage
8. **Flash Loan Pool Dryness** - Lender rotation
9. **Memecoin Sniper** - New token detection
10. **Triangular Arbitrage** - Multi-hop arbitrage paths
11. **AI Gas Optimization** - Gas price prediction
12. **Mempool Pattern Recognition** - Large transaction monitoring

### 💀 **JavaScript Bot: Liquidation Strategy**
- **Venus Protocol** - vToken liquidation opportunities
- **AAVE V3** - Health factor monitoring
- **Cream Finance** - Liquidation detection
- **Compound** - Position monitoring

### ⚡ **Performance Features**
- **Micro-Arbitrage Detection**: 0.15%+ profit gaps (down from 0.4%)
- **Volatility-Adaptive Scanning**: 2.5s fast mode during market moves
- **AI-Powered Gas Optimization**: Predicts optimal gas prices
- **Multi-DEX Support**: PancakeSwap, ApeSwap, BiSwap, MDEX
- **Real-Time Telegram Alerts**: Instant notifications

### 💰 **Expected Performance**
- **Volatility Multiplier**: 2x faster scanning during market moves

## 📋 Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **Git**
- **BSC Private Key** (for live trading)

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/money-trees-printer-2025.git
cd money-trees-printer-2025
```

### 2. Environment Setup
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

**Required .env variables:**
```env
# Python Arbitrage Bot (existing)
PYTHON_BOT_PRIVATE_KEY=0xYOUR_PYTHON_BOT_PRIVATE_KEY_HERE

# JavaScript Liquidation Bot (separate wallet!)
LIQUIDATION_BOT_KEY=0xYOUR_LIQUIDATION_BOT_PRIVATE_KEY_HERE

# Notifications
TELEGRAM_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### 3. Install Dependencies

**Python Setup:**
```bash
# Create virtual environment
python -m venv arbitrage_env

# Activate environment
arbitrage_env\Scripts\activate  # Windows
# or
source arbitrage_env/bin/activate  # Linux/Mac

# Install Python dependencies
pip install -r requirements.txt
```

**Node.js Setup:**
```bash
# Install Node dependencies
npm install

# Compile smart contracts
npx hardhat compile
```

### 4. Run Tests
```bash
# Test Python arbitrage calculator
npm run test:calculator

# Test smart contracts
npm test
```

### 5. Start the Bots

**Python Arbitrage Bot:**
```bash
# Activate Python environment
source arbitrage_env/bin/activate

# Run arbitrage scanner
python final_printer_2025.py
```

**JavaScript Liquidation Bot:**
```bash
# Run liquidation hunter
node run_live_trading.js
```

**Run Both Bots Simultaneously:**
```bash
# Terminal 1 - Python arbitrage
source arbitrage_env/bin/activate && python final_printer_2025.py

# Terminal 2 - JavaScript liquidation
node run_live_trading.js
```

## 📁 Project Structure

```
money-trees-printer-2025/
├── 🐍 final_printer_2025.py      # Python arbitrage bot (11 edges)
├── ☕ run_live_trading.js       # JavaScript liquidation bot
├── zero-flash-bot.js           # Flash arbitrage bot
├── contracts/                  # Solidity smart contracts
│   ├── FlashloanArb.sol       # Arbitrage contract
│   ├── RealArbitrageExecutor.sol # Triangular arbitrage
│   └── Interfaces.sol         # Contract interfaces
├── bot/                        # JavaScript bot modules
│   ├── UnifiedStrategyManager.js # Strategy orchestration
│   ├── LiquidationBot.js      # Liquidation strategies
│   └── ArbitrageBot.js        # Arbitrage strategies
├── utils/                      # Utility modules
│   ├── FlashProvider.js       # Flash loan providers
│   ├── PerformanceDashboard.js # Performance tracking
│   └── SecureMEVProtector.js  # MEV protection
├── ai/                         # AI/ML models
│   ├── mev_protector.py       # MEV detection AI
│   └── gas_price_predictor.pkl # Gas prediction model
├── services/                   # Core services
│   └── ArbitrageCalculator.py # Arbitrage calculations
├── config/                     # Configuration files
│   └── dex.js                 # DEX configurations
├── test/                       # Test files
├── .env                        # Environment variables
├── requirements.txt            # Python dependencies
├── package.json               # Node.js dependencies
└── README.md                  # This file
```

## ⚙️ Configuration

### Arbitrage Settings
```python
FLASH_SIZE_USD = Decimal("78000")  # Flash loan size
MIN_PROFIT_PCT = Decimal("0.0015") # 0.15% minimum gap
MIN_PROFIT_USD = Decimal("15")     # $15 minimum profit
```

### DEX Configuration (Arbitrum Nova)
The bot monitors these DEXes on Arbitrum Nova with native asset pairs:

**Primary DEXes:**
- **Uniswap V3** - WETH/USDC, WETH/USDT, USDC/USDT, WETH/WBTC, ARB/WETH
- **SushiSwap** - WETH/USDC, WETH/USDT, USDC/USDT, WETH/WBTC, ARB/WETH
- **Camelot** - Arbitrum Nova native DEX with high liquidity

**High-Liquidity Pairs:**
- **WETH/USDC** (Very High Liquidity)
- **WETH/USDT** (Very High Liquidity)
- **USDC/USDT** (Very High Liquidity)
- **WETH/WBTC** (High Liquidity)
- **ARB/WETH** (High Liquidity)

**Note**: All pairs use Arbitrum Nova's native tokens for maximum efficiency and lowest gas costs.

### Telegram Alerts
Set up a Telegram bot for real-time notifications:
1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Create a new bot and get the token
3. Start a chat with your bot and get the chat ID
4. Add both to your `.env` file

## 🔒 Security Features

- **MEV Protection**: Advanced sandwich attack detection
- **Flash Loan Safety**: Multiple lender rotation
- **Gas Optimization**: AI-powered gas price prediction
- **Error Handling**: Graceful failure recovery
- **Rate Limiting**: API request throttling

## 📊 Monitoring & Analytics

### Real-Time Dashboard
```bash
npm run run:printer
```
Shows live scanning progress and detected opportunities.

### Performance Metrics
- **Win Rate Tracking**
- **Profit/Loss Analysis**
- **Gas Cost Optimization**
- **Strategy Performance**

### Telegram Alerts
- **Arbitrage Opportunities**: Instant profit alerts
- **System Status**: Bot health monitoring
- **Error Notifications**: Automatic error reporting

## 🧪 Testing

### Run All Tests
```bash
npm test
```

### Individual Test Suites
```bash
# Python arbitrage calculator
npm run test:calculator

# Smart contract tests
npx hardhat test

# Performance tests
npm run test:performance
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

**This software is for educational and research purposes only. Trading cryptocurrencies involves substantial risk of loss and is not suitable for every investor. The use of this software does not guarantee profits and past performance does not indicate future results.**

**Always test thoroughly on testnets before deploying to mainnet. The authors are not responsible for any financial losses incurred through the use of this software.**

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/money-trees-printer-2025/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/money-trees-printer-2025/discussions)
- **Telegram**: Join our community channel

## 🙏 Acknowledgments

- [Web3.py](https://web3py.readthedocs.io/) - Ethereum Python library
- [Ethers.js](https://docs.ethers.org/) - Ethereum JavaScript library
- [DexScreener](https://dexscreener.com/) - DEX price data
- [Beefy Finance](https://beefy.finance/) - Yield farming data
- [Venus Protocol](https://venus.io/) - Lending protocol

---

**Built with ❤️ for the DeFi community**

**Happy Arbitraging! 🚀💰**
