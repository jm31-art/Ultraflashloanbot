const { ethers } = require('ethers');
require('dotenv').config();

async function checkBalance() {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const balance = await provider.getBalance(process.env.WALLET_ADDRESS);
    const balanceBNB = ethers.formatEther(balance);
    const balanceUSD = (parseFloat(balanceBNB) * 567).toFixed(2);

    console.log('=== WALLET BALANCE CHECK ===');
    console.log(`Wallet Address: ${process.env.WALLET_ADDRESS}`);
    console.log(`Current Balance: ${balanceBNB} BNB`);
    console.log(`Current Balance: $${balanceUSD} USD`);

    // Bot parameters
    const maxGasPerTx = 0.003; // 0.003 BNB max per transaction
    const minRequired = 0.0001; // 0.0001 BNB minimum required

    const usableBalance = parseFloat(balanceBNB) - minRequired;
    const maxTransactions = Math.floor(usableBalance / maxGasPerTx);

    console.log('\n=== TRANSACTION CAPACITY ===');
    console.log(`Safety Reserve: ${minRequired} BNB ($${ (minRequired * 567).toFixed(2)})`);
    console.log(`Usable Balance: ${usableBalance.toFixed(6)} BNB ($${(usableBalance * 567).toFixed(2)})`);
    console.log(`Max Gas Per Transaction: ${maxGasPerTx} BNB ($${(maxGasPerTx * 567).toFixed(2)})`);
    console.log(`Maximum Transactions Possible: ${maxTransactions}`);

    if (maxTransactions <= 0) {
      console.log('\n⚠️  WARNING: Insufficient balance for any transactions!');
      console.log('   Need at least ${(minRequired + maxGasPerTx).toFixed(6)} BNB total');
    } else if (maxTransactions < 5) {
      console.log('\n⚠️  LOW BALANCE: Limited transaction capacity');
    } else {
      console.log('\n✅ Good balance for arbitrage operations');
    }

  } catch (error) {
    console.error('Error checking balance:', error.message);
  }
}

checkBalance();