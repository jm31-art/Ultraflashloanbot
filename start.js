const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function main() {
    try {
        console.log('🚀 Starting Flashloan Bot...');
        
        // 1. Check wallet balance
        const [wallet] = await ethers.getSigners();
        const balance = await wallet.getBalance();
        const balanceInBNB = ethers.utils.formatEther(balance);
        console.log(`\n💰 Wallet Balance: ${balanceInBNB} BNB`);

        if (parseFloat(balanceInBNB) < 0.05) {
            console.log('⚠️ Warning: Low balance. Please ensure you have at least 0.05 BNB for deployment and gas fees.');
            return;
        }

        // 2. Auto Deploy Contract if not already deployed
        let flashloanArb;
        const deployedAddressPath = path.join(__dirname, 'deployed-address.json');
        
        if (!fs.existsSync(deployedAddressPath)) {
            console.log('\n📄 No existing deployment found. Deploying new contract...');
            
            // Get optimized gas price (85% of current gas price)
            const gasPrice = await ethers.provider.getGasPrice();
            const optimizedGasPrice = gasPrice.mul(85).div(100);
            
            // Deploy contract
            const FlashloanArb = await ethers.getContractFactory("FlashloanArb");
            flashloanArb = await FlashloanArb.deploy({
                gasPrice: optimizedGasPrice,
                gasLimit: 3000000
            });
            await flashloanArb.deployed();
            
            // Save deployed address
            fs.writeFileSync(deployedAddressPath, JSON.stringify({
                address: flashloanArb.address,
                deploymentTime: new Date().toISOString()
            }, null, 2));
            
            console.log(`✅ Contract deployed to: ${flashloanArb.address}`);
            
            // Initialize DODO pools with optimized batch transactions
            console.log('\n🔄 Setting up DODO pools...');
            const POOLS = {
                USDT: "0x5BDCf4962FDED6B7156E710400F4C4c031f600dC",
                BUSD: "0x5BDCf4962FDED6B7156E710400F4C4c031f600dC",
                WBNB: "0xBe60d4c4250438344bEC816Ec2deC99925dEb4c7",
                BTCB: "0x2B6d3543a37aFe5Ef8516c3d2134D1C2A9CD0906",
                ETH: "0x5d0C61670229fE0cEEf2c883f1261E8C38A25fEd"
            };

            const setupPromises = Object.entries(POOLS).map(([token, pool]) => 
                flashloanArb.setDODOPool(
                    require('./config/tokens')[token],
                    pool,
                    { gasPrice: optimizedGasPrice }
                )
            );
            
            await Promise.all(setupPromises);
            console.log('✅ DODO pools initialized');
        } else {
            const deployedData = JSON.parse(fs.readFileSync(deployedAddressPath));
            console.log(`\n📄 Loading existing deployment at ${deployedData.address}`);
            const FlashloanArb = await ethers.getContractFactory("FlashloanArb");
            flashloanArb = FlashloanArb.attach(deployedData.address);
        }

        // 3. Start the arbitrage bot
        console.log('\n🤖 Starting arbitrage monitoring...');
        const ArbitrageBot = require('./bot/ArbitrageBot');
        const bot = new ArbitrageBot(flashloanArb, wallet);
        
        // Initialize bot with optimal parameters
        await bot.initialize({
            minProfitUSD: 50,  // Minimum profit to execute trade
            maxGasPrice: 5,    // Maximum gas price in gwei
            safetyChecks: true // Enable all safety checks
        });
        
        // Start monitoring
        await bot.startMonitoring();

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

// Add error handling for unhandled rejections
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
    process.exit(1);
});

// Run the bot
main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});
