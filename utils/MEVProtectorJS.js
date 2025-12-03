const { Web3 } = require('web3');
const { spawn } = require('child_process');
const path = require('path');

class MEVProtectorJS {
    constructor(provider) {
        this.provider = provider;
        this.pythonProcess = null;
        this.initializePython();
    }

    initializePython() {
        const scriptPath = path.join(__dirname, '..', 'ai', 'mev_protector.py');
        this.pythonProcess = spawn('python', [scriptPath]);

        this.pythonProcess.stdout.on('data', (data) => {
            console.log(`MEV Protector: ${data}`);
        });

        this.pythonProcess.stderr.on('data', (data) => {
            console.error(`MEV Protector Error: ${data}`);
        });
    }

    async analyze_mempool(tx) {
        try {
            const pendingTx = await this._formatTransaction(tx);
            return new Promise((resolve) => {
                this.pythonProcess.stdin.write(JSON.stringify({
                    action: 'analyze_mempool',
                    transaction: pendingTx
                }) + '\n');

                this.pythonProcess.stdout.once('data', (data) => {
                    try {
                        const result = JSON.parse(data.toString());
                        resolve(result);
                    } catch (error) {
                        resolve({
                            sandwich_risk: 0,
                            frontrun_risk: 0,
                            gas_manipulation: 0,
                            flashbots_risk: 0,
                            total_risk: 0
                        });
                    }
                });
            });
        } catch (error) {
            console.error('MEV analysis error:', error);
            return {
                sandwich_risk: 0,
                frontrun_risk: 0,
                gas_manipulation: 0,
                flashbots_risk: 0,
                total_risk: 0
            };
        }
    }

    async recommend_protection_strategy(tx) {
        try {
            const pendingTx = await this._formatTransaction(tx);
            return new Promise((resolve) => {
                this.pythonProcess.stdin.write(JSON.stringify({
                    action: 'recommend_protection_strategy',
                    transaction: pendingTx
                }) + '\n');

                this.pythonProcess.stdout.once('data', (data) => {
                    try {
                        const result = JSON.parse(data.toString());
                        resolve(result);
                    } catch (error) {
                        resolve({
                            use_flashbots: false,
                            increase_gas: true,
                            gas_multiplier: 1.1
                        });
                    }
                });
            });
        } catch (error) {
            console.error('Protection strategy error:', error);
            return {
                use_flashbots: false,
                increase_gas: true,
                gas_multiplier: 1.1
            };
        }
    }

    get_safe_gas_price(baseGas) {
        // Implement fallback gas price calculation if Python process fails
        return Math.floor(baseGas * 1.2); // 20% buffer
    }

    async _formatTransaction(tx) {
        const web3 = new Web3(this.provider);
        return {
            hash: tx.hash || '',
            from: tx.from || '',
            to: tx.to || '',
            value: tx.value ? web3.utils.fromWei(tx.value.toString(), 'ether') : '0',
            gasPrice: tx.gasPrice ? web3.utils.fromWei(tx.gasPrice.toString(), 'gwei') : '0',
            input: tx.data || ''
        };
    }

    cleanup() {
        if (this.pythonProcess) {
            this.pythonProcess.kill();
        }
    }
}

module.exports = MEVProtectorJS;
