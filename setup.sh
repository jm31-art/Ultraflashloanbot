#!/bin/bash

# MONEY TREES PRINTER 2025 - SETUP SCRIPT
echo "🚀 Setting up Money Trees Printer 2025..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if Python is installed
if ! command -v python &> /dev/null; then
    echo "❌ Python is not installed. Please install Python 3.11+ first."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Compile smart contracts
echo "🔨 Compiling smart contracts..."
npm run compile

# Create Python virtual environment
echo "🐍 Setting up Python virtual environment..."
python -m venv arbitrage_env

# Activate virtual environment and install dependencies
echo "📚 Installing Python dependencies..."
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    # Windows
    arbitrage_env\\Scripts\\activate && pip install -r requirements.txt
else
    # Unix/Linux/Mac
    source arbitrage_env/bin/activate && pip install -r requirements.txt
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your PRIVATE_KEY and other settings"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Edit .env file with your private key and Telegram settings"
echo "2. Run tests: npm test"
echo "3. Start the bot: npm run run:auto"
echo ""
echo "📖 See README.md for detailed instructions"