const { performance } = require('perf_hooks');
const { createLogger, format, transports } = require('winston');

class PerformanceMonitor {
    constructor() {
        this.logger = createLogger({
            level: 'info',
            format: format.combine(
                format.timestamp(),
                format.json()
            ),
            transports: [
                new transports.File({ filename: 'logs/performance.log' }),
                new transports.File({ filename: 'logs/error.log', level: 'error' })
            ]
        });

        this.metrics = {
            transactions: {
                total: 0,
                successful: 0,
                failed: 0
            },
            gasUsage: [],
            profitability: [],
            latency: []
        };

        // Real-time monitoring
        setInterval(() => this.reportMetrics(), 60000); // Report every minute
    }

    startTransaction() {
        const txId = Date.now().toString();
        this.metrics.transactions.total++;
        performance.mark(`tx-start-${txId}`);
        return txId;
    }

    endTransaction(txId, success, gasUsed, profit) {
        performance.mark(`tx-end-${txId}`);
        performance.measure(`tx-${txId}`, `tx-start-${txId}`, `tx-end-${txId}`);
        
        const duration = performance.getEntriesByName(`tx-${txId}`)[0].duration;
        
        if (success) {
            this.metrics.transactions.successful++;
            this.metrics.gasUsage.push(gasUsed);
            this.metrics.profitability.push(profit);
            this.metrics.latency.push(duration);
        } else {
            this.metrics.transactions.failed++;
        }

        this.logger.info('Transaction Complete', {
            txId,
            success,
            gasUsed,
            profit,
            duration
        });
    }

    reportMetrics() {
        const averageGas = this.calculateAverage(this.metrics.gasUsage);
        const averageProfit = this.calculateAverage(this.metrics.profitability);
        const averageLatency = this.calculateAverage(this.metrics.latency);

        this.logger.info('Performance Metrics', {
            transactions: this.metrics.transactions,
            averageGas,
            averageProfit,
            averageLatency,
            successRate: (this.metrics.transactions.successful / this.metrics.transactions.total) * 100
        });
    }

    calculateAverage(array) {
        return array.length ? array.reduce((a, b) => a + b) / array.length : 0;
    }

    logError(error, context = {}) {
        this.logger.error('Error occurred', {
            error: error.message,
            stack: error.stack,
            ...context
        });
    }
}

module.exports = new PerformanceMonitor();
