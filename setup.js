const fs = require('fs');
const readline = require('readline');
const { ethers } = require('ethers');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
    console.log('\n🔧 Flashloan Bot Setup Wizard');
    console.log('============================\n');

    // 1. Get wallet information
    console.log('First, we need your wallet information:');
    const privateKey = await question('Enter your BSC wallet private key: ');

    // Validate private key
    try {
        new ethers.Wallet(privateKey);
    } catch (e) {
        console.log('❌ Invalid private key format. Please check your private key and try again.');
        process.exit(1);
    }

    // 2. Create .env file
    const envContent = `PRIVATE_KEY=${privateKey}
BSC_RPC_URL=https://bsc-dataseed.binance.org
MIN_PROFIT_USD=50
MAX_GAS_PRICE=5
AUTO_WITHDRAW_THRESHOLD=1000`;

    fs.writeFileSync('.env', envContent);
    console.log('\n✅ Configuration saved to .env file');

    // 3. Install dependencies
    console.log('\n📦 Installing dependencies...');
    const { execSync } = require('child_process');
    execSync('npm install', { stdio: 'inherit' });

    console.log('\n🎉 Setup complete! You can now start the bot with:');
    console.log('npm run start');

    rl.close();
}

main().catch(console.error);
