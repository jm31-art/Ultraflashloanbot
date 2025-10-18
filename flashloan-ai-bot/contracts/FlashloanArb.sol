// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IDex {
    function swap(address tokenIn, address tokenOut, uint256 amountIn) external returns (uint256 amountOut);
    function getPrice(address tokenIn, address tokenOut) external view returns (uint256);
}

contract FlashloanArb is ReentrancyGuard {
    // Minimum profit threshold in terms of token B
    uint256 public constant MIN_PROFIT = 0.01 ether;

    function executeArbitrage(
        address tokenA,
        address tokenB,
        uint256 flashloanAmount,
        address dexA,
        address dexB
    ) external nonReentrant {
        // Check initial prices
        uint256 priceA = IDex(dexA).getPrice(tokenA, tokenB);
        uint256 priceB = IDex(dexB).getPrice(tokenA, tokenB);

        require(priceA != priceB, "No price difference");

        // Calculate potential profit
        uint256 amountOutA = (flashloanAmount * priceA) / 1e18;
        uint256 amountOutB = (amountOutA * priceB) / 1e18;
        
        require(amountOutB > flashloanAmount, "No profitable arbitrage opportunity");

        uint256 profit = amountOutB - flashloanAmount;
        require(profit >= MIN_PROFIT, "Insufficient profit after gas costs");

        // Execute trades
        // Note: In a real implementation, this would use a flashloan
        IERC20(tokenA).transferFrom(msg.sender, address(this), flashloanAmount);
        
        // Approve DEX A
        IERC20(tokenA).approve(dexA, flashloanAmount);
        
        // Swap A -> B on DEX A
        uint256 receivedB = IDex(dexA).swap(tokenA, tokenB, flashloanAmount);
        
        // Approve DEX B
        IERC20(tokenB).approve(dexB, receivedB);
        
        // Swap B -> A on DEX B
        uint256 finalA = IDex(dexB).swap(tokenB, tokenA, receivedB);
        
        // Repay flashloan
        require(finalA >= flashloanAmount, "Insufficient tokens to repay flashloan");
        IERC20(tokenA).transfer(msg.sender, flashloanAmount);
        
        // Transfer profit to caller
        uint256 profitAmount = finalA - flashloanAmount;
        IERC20(tokenA).transfer(msg.sender, profitAmount);
    }
}
