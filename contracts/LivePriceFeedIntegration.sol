// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./Interfaces.sol";

// KILOCODE: LIVE PRICE FEED INTEGRATION (CONTINUED)
contract LivePriceFeedIntegration is Ownable {

    // Chainlink Price Feeds (BSC Mainnet)
    address constant BNB_USD_FEED = 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE;
    address constant BTC_USD_FEED = 0x264990fbd0A4796A3E3CaE8dfaC0A7b3c9E216AB;
    address constant ETH_USD_FEED = 0x9ef1B8c0E4F7dcEbf8f7A7916c1F2c49dBc6d6f9;

    // Token/Feed mapping
    mapping(address => address) public tokenPriceFeeds;
    mapping(address => uint8) public tokenDecimals;

    constructor() {
        // Initialize major token feeds
        tokenPriceFeeds[0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c] = BNB_USD_FEED; // WBNB
        tokenPriceFeeds[0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3EAd9c] = BTC_USD_FEED; // BTCB
        tokenPriceFeeds[0x2170Ed0880ac9A755fd29B2688956BD959F933F8] = ETH_USD_FEED; // ETH

        // Initialize decimals
        tokenDecimals[0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c] = 18;
        tokenDecimals[0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3EAd9c] = 18;
        tokenDecimals[0x2170Ed0880ac9A755fd29B2688956BD959F933F8] = 18;
    }

    function getRealTokenPrice(address token) public view returns (uint256 price, uint8 decimals) {

        address feedAddress = tokenPriceFeeds[token];
        require(feedAddress != address(0), "No price feed for token");

        AggregatorV3Interface priceFeed = AggregatorV3Interface(feedAddress);

        // Get the latest round data with full validation
        (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = priceFeed.latestRoundData();

        // Validate the price data
        require(answer > 0, "Invalid price answer");
        require(updatedAt != 0, "Incomplete round");
        require(answeredInRound >= roundId, "Stale price");

        // Check for price freshness (not older than 1 hour)
        require(block.timestamp - updatedAt <= 3600, "Price too stale");

        return (uint256(answer), priceFeed.decimals());
    }

    function getRealTokenPrices(
        address tokenA,
        address tokenB
    ) internal view returns (uint256 priceA, uint256 priceB) {

        (uint256 priceRawA, uint8 decimalsA) = getRealTokenPrice(tokenA);
        (uint256 priceRawB, uint8 decimalsB) = getRealTokenPrice(tokenB);

        // Normalize both prices to 18 decimals for consistent comparison
        priceA = priceRawA * (10 ** (18 - decimalsA));
        priceB = priceRawB * (10 ** (18 - decimalsB));

        return (priceA, priceB);
    }

    function calculateRealProfit(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountBReceived
    ) internal view returns (uint256 profitUSD) {

        (uint256 priceA, uint256 priceB) = getRealTokenPrices(tokenA, tokenB);

        // Calculate USD values
        uint256 valueA = amountA * priceA / (10 ** tokenDecimals[tokenA]);
        uint256 valueB = amountBReceived * priceB / (10 ** tokenDecimals[tokenB]);

        require(valueB > valueA, "No arbitrage opportunity");

        profitUSD = valueB - valueA;

        return profitUSD;
    }

    function addPriceFeed(address token, address feed, uint8 decimals) external onlyOwner {
        require(token != address(0), "Invalid token");
        require(feed != address(0), "Invalid feed");
        require(decimals > 0 && decimals <= 18, "Invalid decimals");

        // Validate the feed contract
        try AggregatorV3Interface(feed).decimals() returns (uint8 feedDecimals) {
            require(feedDecimals == decimals, "Decimals mismatch");
        } catch {
            revert("Invalid feed contract");
        }

        tokenPriceFeeds[token] = feed;
        tokenDecimals[token] = decimals;

        emit PriceFeedAdded(token, feed, decimals);
    }

    function removePriceFeed(address token) external onlyOwner {
        require(tokenPriceFeeds[token] != address(0), "No feed exists");

        delete tokenPriceFeeds[token];
        delete tokenDecimals[token];

        emit PriceFeedRemoved(token);
    }

    // Multi-oracle validation for critical prices
    function getValidatedPrice(address token) internal view returns (uint256 price) {

        address primaryFeed = tokenPriceFeeds[token];
        require(primaryFeed != address(0), "No primary feed");

        (uint256 primaryPrice,) = getRealTokenPrice(token);

        // For critical tokens, validate against backup feeds
        if (_isCriticalToken(token)) {

            uint256[] memory prices = new uint256[](3);
            prices[0] = primaryPrice;

            // Check backup feeds if available
            address backupFeed1 = getBackupFeed(token, 1);
            address backupFeed2 = getBackupFeed(token, 2);

            if (backupFeed1 != address(0)) {
                try this.getPriceFromFeed(backupFeed1) returns (uint256 backupPrice) {
                    prices[1] = backupPrice;
                } catch {
                    prices[1] = primaryPrice; // Use primary if backup fails
                }
            }

            if (backupFeed2 != address(0)) {
                try this.getPriceFromFeed(backupFeed2) returns (uint256 backupPrice) {
                    prices[2] = backupPrice;
                } catch {
                    prices[2] = primaryPrice; // Use primary if backup fails
                }
            }

            // Remove outliers and return median
            return calculateMedianPrice(prices);
        }

        return primaryPrice;
    }

    function calculateMedianPrice(uint256[] memory prices) internal pure returns (uint256) {

        // Simple median calculation for 3 prices
        if (prices[1] == 0) return prices[0]; // Only one price available
        if (prices[2] == 0) return (prices[0] + prices[1]) / 2; // Two prices, use average

        // Three prices - return median
        uint256[] memory sorted = prices;
        for (uint i = 0; i < sorted.length - 1; i++) {
            for (uint j = 0; j < sorted.length - i - 1; j++) {
                if (sorted[j] > sorted[j + 1]) {
                    (sorted[j], sorted[j + 1]) = (sorted[j + 1], sorted[j]);
                }
            }
        }

        return sorted[1]; // Middle value
    }

    function _isCriticalToken(address token) internal pure returns (bool) {

        // Define critical tokens that need multi-oracle validation
        address[6] memory criticalTokens = [
            0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c, // WBNB
            0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56, // BUSD
            0x55d398326f99059fF775485246999027B3197955, // USDT
            0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d, // USDC
            0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3EAd9c, // BTCB
            0x2170Ed0880ac9A755fd29B2688956BD959F933F8  // ETH
        ];

        for (uint i = 0; i < criticalTokens.length; i++) {
            if (token == criticalTokens[i]) return true;
        }

        return false;
    }

    function getPriceFromFeed(address feed) external view returns (uint256) {
        AggregatorV3Interface priceFeed = AggregatorV3Interface(feed);
        (,int256 answer,,,) = priceFeed.latestRoundData();
        require(answer > 0, "Invalid price");
        return uint256(answer);
    }

    function getBackupFeed(address token, uint256 index) internal pure returns (address) {
        // For simplicity, no backup feeds implemented
        return address(0);
    }

    // Events for price feed management
    event PriceFeedAdded(address indexed token, address indexed feed, uint8 decimals);
    event PriceFeedRemoved(address indexed token);
}