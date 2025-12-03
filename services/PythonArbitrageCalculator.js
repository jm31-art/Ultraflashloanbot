const { spawn } = require('child_process');
const path = require('path');

class PythonArbitrageCalculator {
    constructor() {
        this.pythonScript = path.join(__dirname, 'ArbitrageCalculator.py');
        this.isReady = false;
        this.pythonCommand = null;
        this.virtualEnvPath = path.join(__dirname, '..', 'arbitrage_env');
    }

    /**
     * Calculate arbitrage opportunities using Python calculator
     * @param {number} startAmountBNB - Starting amount in BNB
     * @returns {Promise<Object>} - Arbitrage opportunities
     */
    async calculateOpportunities(startAmountBNB = 10) {
        if (!this.pythonCommand) {
            await this.checkAvailability();
            if (!this.pythonCommand) {
                reject(new Error('Python not available. Please run: npm run setup:python'));
                return;
            }
        }

        return new Promise((resolve, reject) => {
            const python = spawn(this.pythonCommand, [this.pythonScript, '--amount', startAmountBNB.toString()], {
                cwd: path.dirname(this.pythonScript),
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            python.on('close', (code) => {
                if (code === 0) {
                    try {
                        const result = JSON.parse(stdout.trim());
                        resolve(result);
                    } catch (parseError) {
                        reject(new Error(`Failed to parse Python output: ${parseError.message}`));
                    }
                } else {
                    reject(new Error(`Python script failed with code ${code}: ${stderr}`));
                }
            });

            python.on('error', (error) => {
                reject(new Error(`Failed to start Python process: ${error.message}`));
            });
        });
    }

    /**
     * Execute the best arbitrage opportunity
     * @param {number} startAmountBNB - Starting amount in BNB
     * @returns {Promise<Object>} - Execution result
     */
    async executeBestArbitrage(startAmountBNB = 10) {
        if (!this.pythonCommand) {
            await this.checkAvailability();
            if (!this.pythonCommand) {
                reject(new Error('Python not available. Please run: npm run setup:python'));
                return;
            }
        }

        return new Promise((resolve, reject) => {
            const python = spawn(this.pythonCommand, [this.pythonScript, '--execute', '--amount', startAmountBNB.toString()], {
                cwd: path.dirname(this.pythonScript),
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            python.on('close', (code) => {
                if (code === 0) {
                    try {
                        const result = JSON.parse(stdout.trim());
                        resolve(result);
                    } catch (parseError) {
                        reject(new Error(`Failed to parse Python output: ${parseError.message}`));
                    }
                } else {
                    reject(new Error(`Python execution failed with code ${code}: ${stderr}`));
                }
            });

            python.on('error', (error) => {
                reject(new Error(`Failed to start Python process: ${error.message}`));
            });
        });
    }

    /**
     * Check if Python environment is available
     * @returns {Promise<boolean>}
     */
    async checkAvailability() {
        return new Promise(async (resolve) => {
            // Try different Python commands
            const pythonCommands = [];

            // Check if virtual environment exists and use its Python
            const fs = require('fs');
            const virtualEnvPython = path.join(this.virtualEnvPath, 'Scripts', 'python.exe'); // Windows
            const virtualEnvPythonUnix = path.join(this.virtualEnvPath, 'bin', 'python'); // Unix

            if (fs.existsSync(virtualEnvPython)) {
                pythonCommands.push(virtualEnvPython);
            } else if (fs.existsSync(virtualEnvPythonUnix)) {
                pythonCommands.push(virtualEnvPythonUnix);
            }

            // Try system Python commands
            pythonCommands.push('python3', 'python');

            for (const cmd of pythonCommands) {
                try {
                    const python = spawn(cmd, ['--version'], {
                        stdio: ['pipe', 'pipe', 'pipe']
                    });

                    const result = await new Promise((resolveSpawn) => {
                        python.on('close', (code) => {
                            resolveSpawn(code === 0);
                        });
                        python.on('error', () => {
                            resolveSpawn(false);
                        });
                    });

                    if (result) {
                        this.pythonCommand = cmd;
                        console.log(`✅ Found Python: ${cmd}`);
                        resolve(true);
                        return;
                    }
                } catch (error) {
                    continue;
                }
            }

            console.log('❌ No Python 3 installation found');
            console.log('Please run: npm run setup:python');
            resolve(false);
        });
    }

    /**
     * Convert Python arbitrage result to bot-compatible format
     * @param {Object} pythonResult - Result from Python calculator
     * @returns {Array} - Array of bot-compatible opportunities
     */
    convertToBotFormat(pythonResult) {
        if (!pythonResult.opportunities || !Array.isArray(pythonResult.opportunities)) {
            return [];
        }

        return pythonResult.opportunities.map(opp => {
            // Convert triangular arbitrage to bot format
            if (opp.type.includes('Triangular')) {
                const tokenMap = {
                    'BNB': 'WBNB',
                    'USDT': 'USDT',
                    'USDC': 'USDC',
                    'BUSD': 'BUSD',
                    'BTCB': 'BTCB',
                    'CAKE': 'CAKE',
                    'ETH': 'ETH',
                    'WBNB': 'WBNB'
                };

                const path = opp.path.map(token => tokenMap[token] || token);

                // Determine priority based on route characteristics
                let priority = 'high';
                if (opp.type.includes('BTCB')) {
                    priority = 'utmost'; // BNB-BTCB-USDT is highest priority
                } else if (opp.type.includes('USDT→USDC→BNB') || opp.type.includes('USDT→BUSD→BNB') ||
                          opp.type.includes('BNB→CAKE→USDT')) {
                    priority = 'utmost'; // Original high-value routes
                } else if (opp.type.includes('USDT→BNB→BUSD') || opp.type.includes('BNB→USDT→CAKE')) {
                    priority = 'utmost'; // Reverse routes requested by user
                }

                return {
                    type: 'triangular',
                    path: path,
                    expectedProfit: opp.profitPercent,
                    profitPotential: opp.profitBNB,
                    priority: priority,
                    direction: opp.direction,
                    startAmount: opp.startAmount,
                    routeName: opp.type.replace('Triangular (', '').replace(')', '')
                };
            }

            // Convert two-coin arbitrage
            if (opp.type.includes('Two-Coin')) {
                return {
                    type: 'two_coin_v2_v3',
                    pair: 'WBNB/USDT',
                    profitPotential: opp.profitBNB,
                    profitPercent: opp.profitPercent,
                    direction: opp.direction,
                    priority: 'medium'
                };
            }

            return opp; // Return as-is for other types
        });
    }
}

module.exports = PythonArbitrageCalculator;