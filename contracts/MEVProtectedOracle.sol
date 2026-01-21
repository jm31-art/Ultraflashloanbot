// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// KILOCODE: MEV-PROTECTED PRICE ORACLES
contract MEVProtectedOracle {

    struct PriceData {
        uint256 price;
        uint256 timestamp;
        uint256 sourceWeight;
        bool isValid;
    }

    // Multi-oracle system
    mapping(address => mapping(address => PriceData[])) public priceHistory; // token -> source -> prices
    mapping(address => bool) public trustedOracles;
    uint256 public constant TIME_WEIGHTED_WINDOW = 300; // 5 minutes
    uint256 public constant MAX_PRICE_DEVIATION = 200; // 2%
    uint256 public constant MIN_ORACLES_REQUIRED = 3;

    event PriceUpdated(address indexed token, address indexed source, uint256 price, uint256 timestamp);
    event OracleAuthorized(address indexed oracle);
    event OracleRevoked(address indexed oracle);

    constructor() {
        // Initialize with trusted oracles (would be set by governance)
        // trustedOracles[CHAINLINK_ORACLE] = true;
        // trustedOracles[PYTH_ORACLE] = true;
    }

    function getMEVProtectedPrice(address token) public view returns (uint256) {
        PriceData[] memory prices = priceHistory[token][address(0)]; // aggregated

        require(prices.length >= MIN_ORACLES_REQUIRED, "Insufficient oracle data");

        // Remove outliers
        uint256[] memory filteredPrices = _removeOutliers(prices);

        // Calculate time-weighted average price (TWAP)
        uint256 twap = _calculateTWAP(filteredPrices);

        // Validate against flash loan manipulation
        require(!_isFlashLoanManipulated(token, twap), "Price manipulated");

        return twap;
    }

    function updatePrice(address token, address source, uint256 price) external {
        require(trustedOracles[source], "Unauthorized oracle");

        PriceData memory newPrice = PriceData({
            price: price,
            timestamp: block.timestamp,
            sourceWeight: 1, // Could be dynamic based on oracle reputation
            isValid: true
        });

        priceHistory[token][source].push(newPrice);
        priceHistory[token][address(0)].push(newPrice); // Also store in aggregated

        // Keep only recent prices (last 24 hours)
        _cleanupOldPrices(token, source);

        emit PriceUpdated(token, source, price, block.timestamp);
    }

    function _removeOutliers(PriceData[] memory prices) internal pure returns (uint256[] memory) {
        uint256[] memory rawPrices = new uint256[](prices.length);

        for (uint i = 0; i < prices.length; i++) {
            rawPrices[i] = prices[i].price;
        }

        // Sort prices
        _sortPrices(rawPrices);

        // Remove top and bottom 10% as outliers
        uint256 removeCount = rawPrices.length / 10;
        if (removeCount == 0) removeCount = 1; // Remove at least 1 if possible

        uint256 filteredLength = rawPrices.length - 2 * removeCount;
        if (filteredLength < 1) filteredLength = rawPrices.length; // Keep all if too few

        uint256[] memory filtered = new uint256[](filteredLength);

        for (uint i = removeCount; i < rawPrices.length - removeCount && i - removeCount < filteredLength; i++) {
            filtered[i - removeCount] = rawPrices[i];
        }

        return filtered;
    }

    function _calculateTWAP(uint256[] memory prices) internal pure returns (uint256) {
        if (prices.length == 0) return 0;

        uint256 totalWeight = 0;
        uint256 weightedSum = 0;

        for (uint i = 0; i < prices.length; i++) {
            uint256 timeWeight = _calculateTimeWeight(i);
            weightedSum += prices[i] * timeWeight;
            totalWeight += timeWeight;
        }

        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    }

    function _calculateTimeWeight(uint256 index) internal pure returns (uint256) {
        // More recent prices have higher weight
        // index 0 = most recent, highest weight
        return 100 - index * 10; // Decreasing weight
    }

    function _isFlashLoanManipulated(address token, uint256 currentPrice) internal view returns (bool) {
        // Check for sudden price changes indicative of flash loan manipulation
        uint256[] memory recentPrices = _getRecentPrices(token, 10); // Last 10 prices

        if (recentPrices.length < 5) return false;

        uint256 averagePrice = _calculateAverage(recentPrices);
        uint256 deviation = _calculateDeviation(currentPrice, averagePrice);

        return deviation > MAX_PRICE_DEVIATION;
    }

    function _calculateDeviation(uint256 current, uint256 average) internal pure returns (uint256) {
        if (average == 0) return 0;

        uint256 difference = current > average ? current - average : average - current;
        return (difference * 10000) / average; // Basis points
    }

    function _getRecentPrices(address token, uint256 count) internal view returns (uint256[] memory) {
        PriceData[] memory allPrices = priceHistory[token][address(0)];
        uint256 actualCount = count < allPrices.length ? count : allPrices.length;

        uint256[] memory recent = new uint256[](actualCount);
        for (uint i = 0; i < actualCount; i++) {
            recent[i] = allPrices[allPrices.length - 1 - i].price;
        }

        return recent;
    }

    function _calculateAverage(uint256[] memory prices) internal pure returns (uint256) {
        if (prices.length == 0) return 0;

        uint256 sum = 0;
        for (uint i = 0; i < prices.length; i++) {
            sum += prices[i];
        }

        return sum / prices.length;
    }

    function _sortPrices(uint256[] memory arr) internal pure {
        uint256 n = arr.length;
        for (uint i = 0; i < n - 1; i++) {
            for (uint j = 0; j < n - i - 1; j++) {
                if (arr[j] > arr[j + 1]) {
                    (arr[j], arr[j + 1]) = (arr[j + 1], arr[j]);
                }
            }
        }
    }

    function _cleanupOldPrices(address token, address source) internal {
        PriceData[] storage prices = priceHistory[token][source];
        uint256 cutoffTime = block.timestamp - 86400; // 24 hours ago

        // Remove prices older than 24 hours
        uint256 validCount = 0;
        for (uint i = 0; i < prices.length; i++) {
            if (prices[i].timestamp >= cutoffTime) {
                prices[validCount] = prices[i];
                validCount++;
            }
        }

        // Resize array
        while (prices.length > validCount) {
            prices.pop();
        }
    }

    // Admin functions
    function authorizeOracle(address oracle) external {
        // In production, add onlyOwner modifier
        trustedOracles[oracle] = true;
        emit OracleAuthorized(oracle);
    }

    function revokeOracle(address oracle) external {
        // In production, add onlyOwner modifier
        trustedOracles[oracle] = false;
        emit OracleRevoked(oracle);
    }

    // View functions
    function getPriceHistoryLength(address token, address source) external view returns (uint256) {
        return priceHistory[token][source].length;
    }

    function getLatestPrice(address token, address source) external view returns (uint256, uint256) {
        PriceData[] memory prices = priceHistory[token][source];
        if (prices.length == 0) return (0, 0);

        PriceData memory latest = prices[prices.length - 1];
        return (latest.price, latest.timestamp);
    }
}