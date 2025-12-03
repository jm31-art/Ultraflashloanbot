// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IVToken {
    function liquidateBorrow(address borrower, uint repayAmount, address vTokenCollateral) external returns (uint);
    function borrowBalanceCurrent(address account) external returns (uint);
}

interface IVenusComptroller {
    function getAccountLiquidity(address account) external view returns (uint, uint, uint);
}

// Using OpenZeppelin IERC20 instead of custom interface

interface IFlashProvider {
    function flashLoan(address receiver, address token, uint256 amount, bytes calldata data) external;
}
