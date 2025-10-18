// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10**18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockRouter {
    uint256 private mockAmountOut;

    function setMockAmountOut(uint256 _amount) external {
        mockAmountOut = _amount;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        // Transfer input token from sender
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        // Transfer output token to recipient
        IERC20(path[path.length-1]).transfer(to, mockAmountOut);

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length-1] = mockAmountOut;
        return amounts;
    }

    function getAmountsOut(uint256 amountIn, address[] memory path)
        external
        view
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length-1] = mockAmountOut;
        return amounts;
    }
}

contract MockDodoPool {
    address public immutable _BASE_TOKEN_;
    address public immutable _QUOTE_TOKEN_;
    
    constructor(address baseToken, address quoteToken) {
        _BASE_TOKEN_ = baseToken;
        _QUOTE_TOKEN_ = quoteToken;
    }

    function flashLoan(
        uint256 baseAmount,
        uint256 quoteAmount,
        address assetTo,
        bytes calldata data
    ) external {
        if (baseAmount > 0) {
            IERC20(_BASE_TOKEN_).transfer(assetTo, baseAmount);
        }
        if (quoteAmount > 0) {
            IERC20(_QUOTE_TOKEN_).transfer(assetTo, quoteAmount);
        }

        // Call back to borrower
        (bool success, ) = assetTo.call(data);
        require(success, "Callback failed");

        // Verify repayment
        if (baseAmount > 0) {
            require(
                IERC20(_BASE_TOKEN_).transferFrom(assetTo, address(this), baseAmount + (baseAmount / 100)),
                "Base repayment failed"
            );
        }
        if (quoteAmount > 0) {
            require(
                IERC20(_QUOTE_TOKEN_).transferFrom(assetTo, address(this), quoteAmount + (quoteAmount / 100)),
                "Quote repayment failed"
            );
        }
    }
}
