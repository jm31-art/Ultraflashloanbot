const { ethers } = require('ethers');
const { BigNumber } = require('ethers');
const EventEmitter = require('events');

class SettlementManager extends EventEmitter {
    constructor(provider, signer) {
        super();
        this.provider = provider;
        this.signer = signer;
        this.pendingSettlements = new Map();
        this.completedSettlements = new Map();
        this.MIN_CONFIRMATIONS = 3;
    }

    async addSettlement(txHash, expectedProfit) {
        this.pendingSettlements.set(txHash, {
            timestamp: Date.now(),
            expectedProfit,
            status: 'pending',
            retries: 0
        });

        try {
            const receipt = await this._waitForSettlement(txHash);
            await this._processSettlement(txHash, receipt);
        } catch (error) {
            console.error(`Settlement failed for ${txHash}:`, error.message);
            this._markSettlementFailed(txHash, error.message);
        }
    }

    async _waitForSettlement(txHash) {
        try {
            // Wait for multiple confirmations
            const receipt = await this.provider.waitForTransaction(
                txHash, 
                this.MIN_CONFIRMATIONS
            );

            if (!receipt.status) {
                throw new Error('Transaction reverted');
            }

            return receipt;
        } catch (error) {
            throw new Error(`Settlement wait failed: ${error.message}`);
        }
    }

    async _processSettlement(txHash, receipt) {
        try {
            // Calculate actual profit/loss
            const profitLoss = await this._calculateProfitLoss(receipt);
            
            // Calculate gas costs
            const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
            
            // Get block timestamp
            const block = await this.provider.getBlock(receipt.blockNumber);
            
            // Update settlement status
            this.completedSettlements.set(txHash, {
                timestamp: block.timestamp,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                gasCost: gasCost.toString(),
                profitLoss: profitLoss.toString(),
                status: 'completed'
            });

            this.pendingSettlements.delete(txHash);
            
            // Emit settlement complete event
            this.emit('settlementComplete', {
                txHash,
                receipt,
                profitLoss,
                gasCost
            });
        } catch (error) {
            this._markSettlementFailed(txHash, error.message);
        }
    }

    async _calculateProfitLoss(receipt) {
        let profit = BigNumber.from(0);
        
        // Decode logs to find profit events
        for (const log of receipt.logs) {
            try {
                if (this._isProfitEvent(log)) {
                    profit = profit.add(this._decodeProfitFromLog(log));
                }
            } catch (error) {
                console.warn('Error decoding profit log:', error.message);
            }
        }

        // Calculate gas cost
        const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
        
        // Return profit minus gas cost
        return profit.sub(gasCost);
    }

    _isProfitEvent(log) {
        const profitEventSignatures = [
            ethers.utils.id('ProfitGenerated(uint256)'),
            ethers.utils.id('ArbitrageComplete(uint256,uint256)'),
            ethers.utils.id('FlashloanProfit(uint256)')
        ];

        return profitEventSignatures.includes(log.topics[0]);
    }

    _decodeProfitFromLog(log) {
        try {
            const decoded = ethers.utils.defaultAbiCoder.decode(['uint256'], log.data);
            return BigNumber.from(decoded[0]);
        } catch (error) {
            return BigNumber.from(0);
        }
    }

    _markSettlementFailed(txHash, reason) {
        const settlement = this.pendingSettlements.get(txHash);
        
        if (settlement && settlement.retries < 3) {
            // Retry settlement
            settlement.retries++;
            settlement.status = 'retrying';
            this.pendingSettlements.set(txHash, settlement);
            
            // Attempt retry after delay
            setTimeout(() => {
                this._retrySettlement(txHash);
            }, 5000 * settlement.retries); // Exponential backoff
        } else {
            // Mark as failed after max retries
            this.completedSettlements.set(txHash, {
                timestamp: Date.now(),
                status: 'failed',
                reason
            });
            
            this.pendingSettlements.delete(txHash);
            
            // Emit failure event
            this.emit('settlementFailed', {
                txHash,
                reason
            });
        }
    }

    async _retrySettlement(txHash) {
        try {
            const receipt = await this._waitForSettlement(txHash);
            await this._processSettlement(txHash, receipt);
        } catch (error) {
            this._markSettlementFailed(txHash, error.message);
        }
    }

    getSettlementStatus(txHash) {
        return this.pendingSettlements.get(txHash) || 
               this.completedSettlements.get(txHash) || 
               { status: 'unknown' };
    }

    getPendingSettlements() {
        return Array.from(this.pendingSettlements.entries());
    }

    getCompletedSettlements() {
        return Array.from(this.completedSettlements.entries());
    }

    getSettlementStats() {
        const completed = this.getCompletedSettlements();
        
        // Calculate total profit/loss
        const totalProfitLoss = completed.reduce((total, [_, settlement]) => {
            if (settlement.profitLoss) {
                return total.add(BigNumber.from(settlement.profitLoss));
            }
            return total;
        }, BigNumber.from(0));

        // Calculate success rate
        const successCount = completed.filter(([_, s]) => s.status === 'completed').length;
        const totalCount = completed.length;
        const successRate = totalCount > 0 ? (successCount / totalCount) * 100 : 0;

        return {
            totalSettlements: totalCount,
            successfulSettlements: successCount,
            failedSettlements: totalCount - successCount,
            successRate: successRate.toFixed(2) + '%',
            totalProfitLoss: totalProfitLoss.toString(),
            pendingCount: this.pendingSettlements.size
        };
    }
}

module.exports = SettlementManager;
