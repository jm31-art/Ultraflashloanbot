/**
 * AI-Powered MEV Protector - JavaScript Interface
 * Provides real-time AI analysis for transaction protection
 */

import { spawn } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AIMEVProtector extends EventEmitter {
    constructor(options = {}) {
        super();
        this.pythonProcess = null;
        this.isReady = false;
        this.pendingRequests = new Map();
        this.requestId = 0;

        this.options = {
            pythonPath: options.pythonPath || 'python',
            scriptPath: options.scriptPath || path.join(__dirname, 'mev_protector.py'),
            timeout: options.timeout || 10000,
            maxRetries: options.maxRetries || 3,
            ...options
        };

        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            lastActivity: Date.now()
        };
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            try {
                console.log('🚀 Starting AI MEV Protector...');

                // Spawn Python AI process using virtual environment
                const venvPython = path.join(__dirname, '..', 'arbitrage_env', 'Scripts', 'python.exe');
                this.pythonProcess = spawn(venvPython, [this.options.scriptPath], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    cwd: path.dirname(this.options.scriptPath)
                });

                let initTimeout = setTimeout(() => {
                    reject(new Error('AI initialization timeout'));
                }, this.options.timeout);

                // Handle Python process output
                this.pythonProcess.stdout.on('data', (data) => {
                    const message = data.toString().trim();
                    if (message) {
                        try {
                            const response = JSON.parse(message);

                            if (response.status === 'ready') {
                                clearTimeout(initTimeout);
                                this.isReady = true;
                                console.log('✅ AI MEV Protector ready!');
                                this.emit('ready');
                                resolve(true);
                            } else if (response.error) {
                                console.error('AI Error:', response.error);
                                this.emit('error', new Error(response.error));
                            } else {
                                // Handle pending request
                                this._handleResponse(response);
                            }
                        } catch (e) {
                            console.log('AI Output:', message);
                        }
                    }
                });

                this.pythonProcess.stderr.on('data', (data) => {
                    console.error('AI Process Error:', data.toString());
                });

                this.pythonProcess.on('close', (code) => {
                    console.log(`AI process exited with code ${code}`);
                    this.isReady = false;
                    this.emit('exit', code);
                });

                this.pythonProcess.on('error', (error) => {
                    console.error('Failed to start AI process:', error);
                    reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    async analyzeMempool(transaction) {
        return this._sendRequest('analyze_transaction', { transaction });
    }

    async getSafeGasPrice(baseGas = 5) {
        return this._sendRequest('predict_gas', { features: { baseGas } });
    }

    async getProtectionStrategy(transaction) {
        return this._sendRequest('get_protection_strategy', { transaction });
    }

    async _sendRequest(action, data) {
        if (!this.isReady) {
            throw new Error('AI protector not initialized');
        }

        return new Promise((resolve, reject) => {
            const requestId = ++this.requestId;
            const request = {
                action,
                requestId,
                ...data,
                timestamp: Date.now()
            };

            // Store pending request
            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                startTime: Date.now(),
                action
            });

            // Send to Python process
            this.pythonProcess.stdin.write(JSON.stringify(request) + '\n');

            // Set timeout
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error(`Request timeout: ${action}`));
                }
            }, this.options.timeout);

            this.stats.totalRequests++;
            this.stats.lastActivity = Date.now();
        });
    }

    _handleResponse(response) {
        const requestId = response.requestId;
        const pending = this.pendingRequests.get(requestId);

        if (pending) {
            this.pendingRequests.delete(requestId);
            const responseTime = Date.now() - pending.startTime;

            // Update stats
            this.stats.successfulRequests++;
            this.stats.averageResponseTime =
                (this.stats.averageResponseTime + responseTime) / 2;

            if (response.error) {
                pending.reject(new Error(response.error));
            } else {
                pending.resolve(response);
            }

            this.emit('response', {
                action: pending.action,
                responseTime,
                success: !response.error
            });
        }
    }

    // Advanced AI features
    async detectSandwichAttacks(mempoolTxs) {
        // Analyze mempool for sandwich attack patterns
        const analysis = await this.analyzeMempool({ mempool: mempoolTxs });
        return analysis.mev_risk === 'HIGH' && analysis.confidence > 0.8;
    }

    async predictOptimalExecutionTime(transaction) {
        // Use AI to predict best execution time
        const strategy = await this.getProtectionStrategy(transaction);
        return {
            delay: strategy.strategy.delay_ms,
            gasMultiplier: strategy.strategy.gas_multiplier,
            method: strategy.strategy.method
        };
    }

    async analyzeArbitrageOpportunity(opp) {
        // AI analysis of arbitrage opportunities
        const gasPrediction = await this.getSafeGasPrice();
        const riskAnalysis = await this.analyzeMempool(opp);

        return {
            recommended: riskAnalysis.mev_risk !== 'HIGH',
            gasPrice: gasPrediction.gas_price,
            riskLevel: riskAnalysis.mev_risk,
            confidence: riskAnalysis.confidence
        };
    }

    getStats() {
        return {
            ...this.stats,
            isReady: this.isReady,
            pendingRequests: this.pendingRequests.size,
            uptime: Date.now() - (this.stats.startTime || Date.now())
        };
    }

    async cleanup() {
        if (this.pythonProcess) {
            this.pythonProcess.kill();
            this.pythonProcess = null;
        }
        this.isReady = false;
        this.pendingRequests.clear();
    }
}

// Export singleton instance
const aiMEVProtector = new AIMEVProtector();

export {
    AIMEVProtector,
    aiMEVProtector
};