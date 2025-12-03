// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockChainlinkPriceFeed {
    int256 private price;
    uint256 private timestamp;
    
    constructor() {
        price = 30000000000; // $300.00000000
        timestamp = block.timestamp;
    }
    
    function setPrice(int256 _price) external {
        price = _price;
        timestamp = block.timestamp;
    }
    
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (
            1,              // roundId
            price,          // answer
            timestamp,      // startedAt
            timestamp,      // updatedAt
            1              // answeredInRound
        );
    }
}
