// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Interfaces.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract FlashloanVenusLiquidator {
    using SafeERC20 for IERC20;

    address public owner;

    event LiquidationExecuted(address indexed borrower, address vTokenBorrow, address vTokenCollateral, uint repayAmount, uint profit);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    // Generic entrypoint for flash providers to call after transferring funds.
    // `data` must encode: (borrower, vTokenBorrow, vTokenCollateral, underlyingToken, minOut)
    function receiveFlashLoan(address token, uint amount, uint fee, bytes calldata data) external {
        (address borrower, address vTokenBorrow, address vTokenCollateral, address underlying, uint minOut) = abi.decode(data, (address, address, address, address, uint));

        // Approve vTokenBorrow to pull repay amount
        IERC20(token).approve(vTokenBorrow, amount);

        // Execute liquidation on Venus vToken (vTokenBorrow is the vToken representing the borrowed asset)
        IVToken(vTokenBorrow).liquidateBorrow(borrower, amount, vTokenCollateral);

        // At this point contract owns collateral tokens (vTokens). The contract should redeem or swap collateral to the `token` (underlying repay token).
        // For simplicity, assume we can swap vTokenCollateral -> underlying via DEX (off-chain executor orchestrates exact route)

        // Here we just compute repay and allow provider to pull funds back. Caller must ensure repayment approval set.
        uint repayAmount = amount + fee;
        IERC20(token).approve(msg.sender, repayAmount);

        // Profit calculation: caller (off-chain) will call `withdraw` to transfer leftover profits to owner.
        uint profit = IERC20(token).balanceOf(address(this)) > repayAmount ? IERC20(token).balanceOf(address(this)) - repayAmount : 0;
        emit LiquidationExecuted(borrower, vTokenBorrow, vTokenCollateral, amount, profit);
    }

    // Owner withdrawal for any ERC20 profit
    function withdraw(address token) external onlyOwner {
        uint bal = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(owner, bal);
    }

    // Emergency withdraw native BNB
    function withdrawBNB() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    receive() external payable {}
}
