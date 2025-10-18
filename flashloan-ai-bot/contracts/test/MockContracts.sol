// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}

contract MockDex {
    mapping(address => mapping(address => uint256)) public prices;
    mapping(address => uint256) public balances;

    function setPrice(address tokenIn, address tokenOut, uint256 price) external {
        prices[tokenIn][tokenOut] = price;
    }

    function getPrice(address tokenIn, address tokenOut) external view returns (uint256) {
        return prices[tokenIn][tokenOut];
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external returns (uint256 amountOut) {
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "Transfer failed");
        
        amountOut = (amountIn * prices[tokenIn][tokenOut]) / 1e18;
        require(IERC20(tokenOut).transfer(msg.sender, amountOut), "Transfer failed");
    }
}
