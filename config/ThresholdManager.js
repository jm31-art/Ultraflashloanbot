const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

class ThresholdManager {
    constructor(configPath) {
        this.configPath = configPath;
        this.loadThresholds();
    }

    loadThresholds() {
        const configFile = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(configFile);
    }

    saveThresholds() {
        fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 4));
    }

    // Set profit threshold for a specific token
    setProfitThreshold(token, amountUSD) {
        if (!this.config.profitThresholds[token]) {
            throw new Error(`Invalid token: ${token}`);
        }
        this.config.profitThresholds[token].minProfitUSD = amountUSD.toString();
        this.saveThresholds();
    }

    // Set withdrawal threshold for a specific token
    setWithdrawalThreshold(token, amountUSD) {
        if (!this.config.withdrawalThresholds[token]) {
            throw new Error(`Invalid token: ${token}`);
        }
        this.config.withdrawalThresholds[token].minWithdrawUSD = amountUSD.toString();
        this.saveThresholds();
    }

    // Get profit threshold for a token
    getProfitThreshold(token) {
        if (!this.config.profitThresholds[token]) {
            throw new Error(`Invalid token: ${token}`);
        }
        return ethers.utils.parseUnits(
            this.config.profitThresholds[token].minProfitUSD,
            18
        );
    }

    // Get withdrawal threshold for a token
    getWithdrawalThreshold(token) {
        if (!this.config.withdrawalThresholds[token]) {
            throw new Error(`Invalid token: ${token}`);
        }
        return ethers.utils.parseUnits(
            this.config.withdrawalThresholds[token].minWithdrawUSD,
            18
        );
    }

    // Print current thresholds
    printThresholds() {
        console.log('\nCurrent Profit Thresholds:');
        console.log('------------------------');
        for (const [token, config] of Object.entries(this.config.profitThresholds)) {
            console.log(`${token}: $${config.minProfitUSD}`);
        }

        console.log('\nCurrent Withdrawal Thresholds:');
        console.log('---------------------------');
        for (const [token, config] of Object.entries(this.config.withdrawalThresholds)) {
            console.log(`${token}: $${config.minWithdrawUSD}`);
        }
    }
}

// Example usage:
if (require.main === module) {
    const manager = new ThresholdManager(path.join(__dirname, 'thresholds.json'));
    
    // Print current thresholds
    manager.printThresholds();

    // Example of updating thresholds
    // manager.setProfitThreshold('WBNB', '75');
    // manager.setWithdrawalThreshold('WBNB', '150');
}

module.exports = ThresholdManager;
