// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

// Uniswap V2 Router Interface
interface IUniswapV2Router {
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract FlashloanArb is Ownable, Pausable {
    using SafeERC20 for IERC20;

    uint256 public minProfit;
    bool public safetyChecksEnabled;
    mapping(string => address) public routers;

    event RouterSet(string indexed name, address indexed router);
    event MinProfitSet(uint256 oldProfit, uint256 newProfit);
    event SafetyChecksToggled(bool enabled);
    event TriArbExecuted(
        address indexed initiator,
        address tokenA,
        address tokenB,
        address tokenC,
        uint amountIn,
        uint finalAmountA,
        uint profit
    );

    constructor() {
        safetyChecksEnabled = true;
        minProfit = 0;
    }

    // Router management
    function setRouter(string memory name, address router) external onlyOwner {
        routers[name] = router;
        emit RouterSet(name, router);
    }

    // Safety controls
    function toggleSafetyChecks() external onlyOwner {
        safetyChecksEnabled = !safetyChecksEnabled;
        emit SafetyChecksToggled(safetyChecksEnabled);
    }

    // Profit management
    function setMinProfit(uint256 _minProfit) external onlyOwner {
        uint256 oldProfit = minProfit;
        minProfit = _minProfit;
        emit MinProfitSet(oldProfit, _minProfit);
    }

    // Pause functionality
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Triangular Arbitrage Executor
    function executeTriArb(
        address tokenA,
        address tokenB,
        address tokenC,
        uint256 amountIn,
        string memory router1Name,
        string memory router2Name,
        string memory router3Name,
        uint256 minReturnA,
        uint256 deadline
    ) external whenNotPaused onlyOwner returns (uint256 finalAmountA, uint256 profit) {
        require(amountIn > 0, "amountIn=0");

        address router1 = routers[router1Name];
        address router2 = routers[router2Name];
        address router3 = routers[router3Name];

        require(router1 != address(0) && router2 != address(0) && router3 != address(0), "router not set");

        IUniswapV2Router r1 = IUniswapV2Router(router1);
        IUniswapV2Router r2 = IUniswapV2Router(router2);
        IUniswapV2Router r3 = IUniswapV2Router(router3);

        // Transfer tokenA from caller to contract
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountIn);

        // 1) A -> B on router1
        autoApproveIfNeeded(tokenA, router1, amountIn);
        address[] memory pathAB = new address[](2);
        pathAB[0] = tokenA;
        pathAB[1] = tokenB;

        // Optional safety: estimate amountsOut and ensure reasonable slippage if safetyChecksEnabled
        if (safetyChecksEnabled) {
            uint[] memory outAB = r1.getAmountsOut(amountIn, pathAB);
            require(outAB[1] > 0, "r1 out 0");
        }

        uint[] memory amountsAB = r1.swapExactTokensForTokens(amountIn, 0, pathAB, address(this), deadline);
        uint256 amtB = amountsAB[amountsAB.length - 1];

        // Approve router2 for tokenB
        autoApproveIfNeeded(tokenB, router2, amtB);

        // 2) B -> C on router2
        address[] memory pathBC = new address[](2);
        pathBC[0] = tokenB;
        pathBC[1] = tokenC;

        if (safetyChecksEnabled) {
            uint[] memory outBC = r2.getAmountsOut(amtB, pathBC);
            require(outBC[1] > 0, "r2 out 0");
        }

        uint[] memory amountsBC = r2.swapExactTokensForTokens(amtB, 0, pathBC, address(this), deadline);
        uint256 amtC = amountsBC[amountsBC.length - 1];

        // Approve router3 for tokenC
        autoApproveIfNeeded(tokenC, router3, amtC);

        // 3) C -> A on router3
        address[] memory pathCA = new address[](2);
        pathCA[0] = tokenC;
        pathCA[1] = tokenA;

        if (safetyChecksEnabled) {
            uint[] memory outCA = r3.getAmountsOut(amtC, pathCA);
            require(outCA[1] > 0, "r3 out 0");
        }

        uint[] memory amountsCA = r3.swapExactTokensForTokens(amtC, 0, pathCA, address(this), deadline);
        finalAmountA = amountsCA[amountsCA.length - 1];

        // Optional minReturnA guard
        if (minReturnA > 0) {
            require(finalAmountA >= minReturnA, "final < minReturnA");
        }

        require(finalAmountA >= amountIn, "no profit (final < initial)");

        // profit after returning initial
        profit = finalAmountA - amountIn;
        require(profit >= minProfit, "profit < minProfit");

        // Transfer full finalAmountA to owner (initial + profit)
        IERC20(tokenA).safeTransfer(owner(), finalAmountA);

        emit TriArbExecuted(msg.sender, tokenA, tokenB, tokenC, amountIn, finalAmountA, profit);

        return (finalAmountA, profit);
    }

    // Helper to approve router if needed
    function autoApproveIfNeeded(address token, address spender, uint256 amount) internal {
        if (IERC20(token).allowance(address(this), spender) < amount) {
            // For safety, set to 0 first if needed (some tokens require 0 first)
            try IERC20(token).approve(spender, 0) {} catch {}
            IERC20(token).approve(spender, type(uint256).max);
        }
    }

    // Entry point for flashloan provider callback
    // The parameters and logic should be adapted to your specific flashloan provider signatures and arbitrage strategy
    function receiveFlashLoan(address token, uint amount, uint fee, bytes calldata data) external whenNotPaused {
        // Decode data: token0, token1, exchanges, path, caller, gasReimbursement
        (address token0, address token1, string[] memory exchanges, address[] memory path, address caller, uint gasReimbursement) = abi.decode(data, (address, address, string[], address[], address, uint));

        // Execute arbitrage trades atomically
        // Repay flashloan with fee
        // Transfer profit remaining back to owner

        // Placeholder implementation: must be implemented as per strategy
        uint repayAmount = amount + fee;
        IERC20(token).approve(msg.sender, repayAmount);

        // Transfer profit to owner if any
        uint balance = IERC20(token).balanceOf(address(this));
        if (balance > repayAmount) {
            IERC20(token).transfer(owner(), balance - repayAmount);
        }

        // Reimburse gas fees to caller from contract balance
        if (gasReimbursement > 0 && address(this).balance >= gasReimbursement) {
            payable(caller).transfer(gasReimbursement);
        }
    }

    // Owner withdrawal of any leftover tokens
    function withdraw(address token) external onlyOwner {
        uint bal = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(owner(), bal);
    }

    receive() external payable {}
}
