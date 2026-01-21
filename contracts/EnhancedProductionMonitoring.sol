// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// KILOCODE: PRODUCTION MONITORING SYSTEM (ENHANCED)
contract EnhancedProductionMonitoring {

    // Advanced monitoring with metrics
    struct OperationMetrics {
        uint256 totalOperations;
        uint256 successfulOperations;
        uint256 failedOperations;
        uint256 totalProfit;
        uint256 totalGasUsed;
        uint256 averageProfitPerOperation;
        uint256 lastOperationTime;
    }

    mapping(address => OperationMetrics) public operatorMetrics;
    mapping(bytes32 => OperationRecord) public operationRecords;

    struct OperationRecord {
        address operator;
        string operationType;
        address tokenA;
        address tokenB;
        uint256 amountIn;
        uint256 amountOut;
        uint256 profit;
        uint256 gasUsed;
        uint256 timestamp;
        bool success;
        string errorType;
    }

    // Real-time metrics
    uint256 public systemTotalProfit;
    uint256 public systemTotalOperations;
    uint256 public systemSuccessRate;
    uint256 public systemAverageProfit;

    // Alert thresholds
    uint256 public constant MIN_SUCCESS_RATE = 8000; // 80%
    uint256 public constant MAX_CONSECUTIVE_FAILURES = 3;

    mapping(address => uint256) public consecutiveFailures;
    mapping(address => bool) public restrictedOperators;

    function recordOperation(
        address operator,
        string memory operationType,
        address tokenA,
        address tokenB,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit,
        uint256 gasUsed,
        bool success,
        string memory errorType
    ) internal {

        bytes32 operationId = keccak256(abi.encodePacked(
            block.timestamp,
            operator,
            operationType,
            amountIn
        ));

        // Record operation details
        operationRecords[operationId] = OperationRecord({
            operator: operator,
            operationType: operationType,
            tokenA: tokenA,
            tokenB: tokenB,
            amountIn: amountIn,
            amountOut: amountOut,
            profit: profit,
            gasUsed: gasUsed,
            timestamp: block.timestamp,
            success: success,
            errorType: errorType
        });

        // Update operator metrics
        OperationMetrics storage metrics = operatorMetrics[operator];
        metrics.totalOperations++;
        metrics.lastOperationTime = block.timestamp;

        if (success) {
            metrics.successfulOperations++;
            metrics.totalProfit += profit;
            metrics.totalGasUsed += gasUsed;
            consecutiveFailures[operator] = 0;

            // Calculate average profit
            metrics.averageProfitPerOperation = metrics.totalProfit / metrics.successfulOperations;

        } else {
            metrics.failedOperations++;
            consecutiveFailures[operator]++;

            // Check if operator should be temporarily restricted
            if (consecutiveFailures[operator] >= MAX_CONSECUTIVE_FAILURES) {
                _temporarilyRestrictOperator(operator);
            }
        }

        // Update system metrics
        systemTotalOperations++;
        if (success) {
            systemTotalProfit += profit;
            systemSuccessRate = (systemTotalOperations > 0) ? (systemTotalProfit * 10000) / systemTotalOperations : 0;
            uint256 successfulOps = systemTotalOperations - (operatorMetrics[operator].failedOperations + (success ? 0 : 1));
            systemAverageProfit = successfulOps > 0 ? systemTotalProfit / successfulOps : 0;
        }

        // Check system health
        if (systemSuccessRate < MIN_SUCCESS_RATE) {
            _triggerSystemAlert("LOW_SUCCESS_RATE", systemSuccessRate);
        }

        // Emit detailed event
        emit OperationRecorded(
            operationId,
            operator,
            operationType,
            tokenA,
            tokenB,
            amountIn,
            amountOut,
            profit,
            success,
            block.timestamp
        );

        // Real-time alerting for critical issues
        if (_isCriticalOperationFailure(operationType, errorType)) {
            _immediateCriticalAlert(operator, operationType, errorType, operationId);
        }
    }

    function _isCriticalOperationFailure(
        string memory operationType,
        string memory errorType
    ) internal pure returns (bool) {

        bytes32 typeHash = keccak256(bytes(operationType));
        bytes32 errorHash = keccak256(bytes(errorType));

        // Critical failures that need immediate attention
        return
            (typeHash == keccak256("FLASH_LOAN") &&
             (errorHash == keccak256("INSUFFICIENT_LIQUIDITY") ||
              errorHash == keccak256("UNAUTHORIZED"))) ||
            (typeHash == keccak256("ARBITRAGE") &&
             errorHash == keccak256("SLIPPAGE_EXCEEDED"));
    }

    function _immediateCriticalAlert(
        address operator,
        string memory operationType,
        string memory errorType,
        bytes32 operationId
    ) internal {

        // This would integrate with external alerting systems
        // For now, emit a special critical event
        emit CriticalFailureAlert(
            operator,
            operationType,
            errorType,
            operationId,
            block.timestamp,
            true
        );

        // Could also:
        // - Send SMS alert
        // - Create PagerDuty incident
        // - Post to Slack channel
        // - Send email notification
    }

    function getOperatorHealth(address operator) external view returns (
        uint256 successRate,
        uint256 avgProfit,
        uint256 lastOperation,
        uint256 consecutiveFails,
        bool isHealthy
    ) {

        OperationMetrics memory metrics = operatorMetrics[operator];

        if (metrics.totalOperations == 0) {
            return (0, 0, 0, 0, false);
        }

        successRate = metrics.successfulOperations * 10000 / metrics.totalOperations;
        avgProfit = metrics.averageProfitPerOperation;
        lastOperation = metrics.lastOperationTime;
        consecutiveFails = consecutiveFailures[operator];

        isHealthy = successRate >= MIN_SUCCESS_RATE && consecutiveFails < MAX_CONSECUTIVE_FAILURES;

        return (successRate, avgProfit, lastOperation, consecutiveFails, isHealthy);
    }

    function getSystemHealth() external view returns (
        uint256 totalProfit,
        uint256 totalOps,
        uint256 successRate,
        uint256 avgProfit,
        bool isHealthy
    ) {

        return (
            systemTotalProfit,
            systemTotalOperations,
            systemSuccessRate,
            systemAverageProfit,
            systemSuccessRate >= MIN_SUCCESS_RATE
        );
    }

    function _temporarilyRestrictOperator(address operator) internal {
        restrictedOperators[operator] = true;
        emit OperatorRestricted(operator, block.timestamp);
    }

    function unrestrictOperator(address operator) external {
        // In practice, add access control
        restrictedOperators[operator] = false;
        consecutiveFailures[operator] = 0;
        emit OperatorUnrestricted(operator, block.timestamp);
    }

    function _triggerSystemAlert(string memory alertType, uint256 metricValue) internal {

        emit SystemHealthAlert(
            alertType,
            metricValue,
            MIN_SUCCESS_RATE,
            block.timestamp
        );

        // Could trigger automated responses:
        // - Reduce operation frequency
        // - Switch to backup strategies
        // - Notify operations team
        // - Pause certain operations
    }

    // Events for enhanced monitoring
    event OperationRecorded(
        bytes32 indexed operationId,
        address indexed operator,
        string operationType,
        address indexed tokenA,
        address tokenB,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit,
        bool success,
        uint256 timestamp
    );

    event CriticalFailureAlert(
        address indexed operator,
        string operationType,
        string errorType,
        bytes32 indexed operationId,
        uint256 timestamp,
        bool requiresImmediateAction
    );

    event SystemHealthAlert(
        string alertType,
        uint256 metricValue,
        uint256 threshold,
        uint256 timestamp
    );

    event OperatorRestricted(address indexed operator, uint256 timestamp);
    event OperatorUnrestricted(address indexed operator, uint256 timestamp);
}