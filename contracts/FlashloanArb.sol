// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

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

contract FlashloanArb is Ownable, Pausable, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    uint256 public minProfit;
    bool public safetyChecksEnabled;
    mapping(string => address) public routers;

    // Multi-sig requirements
    uint256 public constant REQUIRED_CONFIRMATIONS = 2;
    mapping(bytes32 => uint256) public confirmations;
    mapping(bytes32 => mapping(address => bool)) public hasConfirmed;
    mapping(bytes32 => address[]) public confirmationList;

    // Authorized flashloan providers (security critical)
    mapping(address => bool) public authorizedFlashloanProviders;

    // Circuit breakers for extreme conditions
    uint256 public maxGasPrice = 1000 gwei; // 1000 gwei max
    uint256 public maxSlippageTolerance = 50; // 5% max slippage
    uint256 public minLiquidityRequired = 100000 * 10**18; // $100k min liquidity
    uint256 public maxTradeSize = 500000 * 10**18; // $500k max trade size
    bool public circuitBreakerActive = false;

    // Gas limit validation
    uint256 public constant MAX_ARBITRAGE_GAS = 1000000; // 1M gas limit for arbitrage

    event RouterSet(string indexed name, address indexed router);
    event MinProfitSet(uint256 oldProfit, uint256 newProfit);
    event SafetyChecksToggled(bool enabled);
    event ConfirmationRequired(bytes32 indexed txId, string action);
    event TransactionConfirmed(bytes32 indexed txId, address confirmer);
    event TransactionExecuted(bytes32 indexed txId);
    event TriArbExecuted(
        address indexed initiator,
        address tokenA,
        address tokenB,
        address tokenC,
        uint amountIn,
        uint finalAmountA,
        uint profit
    );

    constructor(address[] memory operators, address[] memory emergencyOperators) {
        safetyChecksEnabled = true;
        minProfit = 0;

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        // Add operators
        for (uint i = 0; i < operators.length; i++) {
            _grantRole(OPERATOR_ROLE, operators[i]);
        }

        // Add emergency operators
        for (uint i = 0; i < emergencyOperators.length; i++) {
            _grantRole(EMERGENCY_ROLE, emergencyOperators[i]);
        }

        // Set up authorized flashloan providers (BSC mainnet)
        authorizedFlashloanProviders[0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9] = true; // Aave V3 Pool
        authorizedFlashloanProviders[0x89d065572136814230A55DdEeDDEC9DF34EB0B76] = true; // Venus Pool
        authorizedFlashloanProviders[0x470fBfb1e62D0c1c0c5b6d3b5e5e5e5e5e5e5e5] = true; // Equalizer
        authorizedFlashloanProviders[0x1F98431c8aD98523631AE4a59f267346ea31F984] = true; // Uniswap V3 Factory (for flash swaps)
        authorizedFlashloanProviders[0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73] = true; // PancakeSwap Factory
    }

    // Flashloan provider management (only admin)
    function addFlashloanProvider(address provider) external onlyRole(DEFAULT_ADMIN_ROLE) {
        authorizedFlashloanProviders[provider] = true;
    }

    function removeFlashloanProvider(address provider) external onlyRole(DEFAULT_ADMIN_ROLE) {
        authorizedFlashloanProviders[provider] = false;
    }

    // Circuit breaker management
    function setCircuitBreaker(bool active) external onlyRole(EMERGENCY_ROLE) {
        circuitBreakerActive = active;
    }

    function updateCircuitBreakerSettings(
        uint256 _maxGasPrice,
        uint256 _maxSlippageTolerance,
        uint256 _minLiquidityRequired,
        uint256 _maxTradeSize
    ) external onlyRole(OPERATOR_ROLE) {
        maxGasPrice = _maxGasPrice;
        maxSlippageTolerance = _maxSlippageTolerance;
        minLiquidityRequired = _minLiquidityRequired;
        maxTradeSize = _maxTradeSize;
    }

    // Multi-sig router management
    function proposeRouterChange(string memory name, address newRouter) external onlyRole(OPERATOR_ROLE) {
        bytes32 txId = keccak256(abi.encodePacked("setRouter", name, newRouter, block.timestamp));
        _proposeTransaction(txId, "setRouter");
    }

    function confirmRouterChange(bytes32 txId, string memory name, address newRouter) external onlyRole(OPERATOR_ROLE) {
        require(_confirmTransaction(txId), "Confirmation failed");

        routers[name] = newRouter;
        emit RouterSet(name, newRouter);
        emit TransactionExecuted(txId);
    }

    // Emergency safety controls (single approval for immediate action)
    function emergencyToggleSafety() external onlyRole(EMERGENCY_ROLE) {
        safetyChecksEnabled = !safetyChecksEnabled;
        emit SafetyChecksToggled(safetyChecksEnabled);
    }

    // Multi-sig profit management
    function proposeMinProfitChange(uint256 _minProfit) external onlyRole(OPERATOR_ROLE) {
        bytes32 txId = keccak256(abi.encodePacked("setMinProfit", _minProfit, block.timestamp));
        _proposeTransaction(txId, "setMinProfit");
    }

    function confirmMinProfitChange(bytes32 txId, uint256 _minProfit) external onlyRole(OPERATOR_ROLE) {
        require(_confirmTransaction(txId), "Confirmation failed");

        uint256 oldProfit = minProfit;
        minProfit = _minProfit;
        emit MinProfitSet(oldProfit, _minProfit);
        emit TransactionExecuted(txId);
    }

    // Multi-sig helper functions
    function _proposeTransaction(bytes32 txId, string memory action) internal {
        require(confirmations[txId] == 0, "Transaction already proposed");
        confirmations[txId] = 1;
        hasConfirmed[txId][msg.sender] = true;
        confirmationList[txId].push(msg.sender);
        emit ConfirmationRequired(txId, action);
    }

    function _confirmTransaction(bytes32 txId) internal returns (bool) {
        require(confirmations[txId] > 0, "Transaction not proposed");
        require(!hasConfirmed[txId][msg.sender], "Already confirmed");

        confirmations[txId]++;
        hasConfirmed[txId][msg.sender] = true;
        confirmationList[txId].push(msg.sender);

        emit TransactionConfirmed(txId, msg.sender);

        return confirmations[txId] >= REQUIRED_CONFIRMATIONS;
    }

    function getTransactionConfirmations(bytes32 txId) external view returns (uint256, address[] memory) {
        return (confirmations[txId], confirmationList[txId]);
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
    ) external whenNotPaused onlyRole(OPERATOR_ROLE) returns (uint256 finalAmountA, uint256 profit) {
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

    // Helper to approve router with exact amount needed (safer than infinite approval)
    function autoApproveIfNeeded(address token, address spender, uint256 amount) internal {
        uint256 currentAllowance = IERC20(token).allowance(address(this), spender);
        if (currentAllowance < amount) {
            // Reset to zero first for tokens that require it
            if (currentAllowance > 0) {
                try IERC20(token).approve(spender, 0) {} catch {}
            }
            // Approve exact amount needed plus 1% buffer for slippage
            uint256 approveAmount = amount * 101 / 100;
            IERC20(token).approve(spender, approveAmount);
        }
    }

    // Entry point for flashloan provider callback with comprehensive security
    function receiveFlashLoan(address token, uint amount, uint fee, bytes calldata data) external whenNotPaused nonReentrant {
        // CRITICAL: Only authorized flashloan providers can call this
        require(authorizedFlashloanProviders[msg.sender], "Unauthorized flashloan provider");
        require(amount > 0 && amount <= maxTradeSize, "Invalid flashloan amount");
        require(!circuitBreakerActive, "Circuit breaker active");

        // Gas limit validation
        require(gasleft() >= MAX_ARBITRAGE_GAS, "Insufficient gas for arbitrage");

        // Gas price circuit breaker
        require(tx.gasprice <= maxGasPrice, "Gas price too high");

        // Decode arbitrage parameters
        (address token0, address token1, string[] memory exchanges, address[] memory path, address caller, uint gasReimbursement) = abi.decode(data, (address, address, string[], address[], address, uint));

        // Validate arbitrage path
        require(path.length >= 3 && path.length <= 6, "Invalid arbitrage path length");
        require(path[0] == token0 && path[path.length - 1] == token0, "Path must start and end with token0");

        // Execute triangular arbitrage: token0 -> token1 -> token -> token0
        uint initialBalance = IERC20(token).balanceOf(address(this));

        // Step 1: token0 -> token1 on first exchange
        address router1 = routers[exchanges[0]];
        require(router1 != address(0), "Router1 not configured");

        autoApproveIfNeeded(token0, router1, amount);
        address[] memory path01 = new address[](2);
        path01[0] = token0;
        path01[1] = token1;

        // Calculate minimum output with slippage protection
        uint[] memory expectedOutAB = IUniswapV2Router(router1).getAmountsOut(amount, path01);
        uint minOutAB = expectedOutAB[expectedOutAB.length - 1] * (10000 - maxSlippageTolerance) / 10000;

        IUniswapV2Router(router1).swapExactTokensForTokens(
            amount,
            minOutAB, // Protected minimum output
            path01,
            address(this),
            block.timestamp + 300
        );

        uint token1Balance = IERC20(token1).balanceOf(address(this));
        require(token1Balance > 0, "Step 1 failed");

        // Step 2: token1 -> token on second exchange
        address router2 = routers[exchanges[1]];
        require(router2 != address(0), "Router2 not configured");

        autoApproveIfNeeded(token1, router2, token1Balance);
        address[] memory path12 = new address[](2);
        path12[0] = token1;
        path12[1] = token;

        // Calculate minimum output for second swap
        uint[] memory expectedOutBC = IUniswapV2Router(router2).getAmountsOut(token1Balance, path12);
        uint minOutBC = expectedOutBC[expectedOutBC.length - 1] * (10000 - maxSlippageTolerance) / 10000;

        IUniswapV2Router(router2).swapExactTokensForTokens(
            token1Balance,
            minOutBC, // Protected minimum output
            path12,
            address(this),
            block.timestamp + 300
        );

        uint tokenBalance = IERC20(token).balanceOf(address(this));
        require(tokenBalance > initialBalance, "Arbitrage failed - no profit");

        // Step 3: token -> token0 on third exchange (if needed for triangular arb)
        if (exchanges.length >= 3) {
            address router3 = routers[exchanges[2]];
            require(router3 != address(0), "Router3 not configured");

            uint profitAmount = tokenBalance - initialBalance - fee;
            require(profitAmount >= minProfit, "Profit below minimum threshold");

            // Convert some profit back to token0 if needed
            if (token != token0) {
                uint amountToConvert = (tokenBalance - initialBalance - fee) / 2; // Convert half for gas efficiency
                autoApproveIfNeeded(token, router3, amountToConvert);

                address[] memory path20 = new address[](2);
                path20[0] = token;
                path20[1] = token0;

                // Calculate minimum output for third swap
                uint[] memory expectedOutCA = IUniswapV2Router(router3).getAmountsOut(amountToConvert, path20);
                uint minOutCA = expectedOutCA[expectedOutCA.length - 1] * (10000 - maxSlippageTolerance) / 10000;

                IUniswapV2Router(router3).swapExactTokensForTokens(
                    amountToConvert,
                    minOutCA, // Protected minimum output
                    path20,
                    address(this),
                    block.timestamp + 300
                );
            }
        }

        // Calculate final profit
        uint finalBalance = IERC20(token).balanceOf(address(this));
        uint repayAmount = amount + fee;
        require(finalBalance >= repayAmount, "Insufficient funds to repay flashloan");

        // Approve flashloan repayment
        IERC20(token).approve(msg.sender, repayAmount);

        // Transfer remaining profit to owner
        uint remainingProfit = finalBalance - repayAmount;
        if (remainingProfit > 0) {
            IERC20(token).transfer(owner(), remainingProfit);
        }

        // Reimburse gas fees to caller
        if (gasReimbursement > 0 && address(this).balance >= gasReimbursement) {
            payable(caller).transfer(gasReimbursement);
        }

        emit TriArbExecuted(caller, token0, token1, token, amount, finalBalance, remainingProfit);
    }

    // Operator withdrawal of any leftover tokens (with multi-sig requirement for large amounts)
    function withdraw(address token, uint256 amount) external onlyRole(OPERATOR_ROLE) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(amount <= balance, "Insufficient balance");

        // Large withdrawals require multi-sig confirmation
        if (amount > 1000 * 10**18) { // More than 1000 tokens
            bytes32 txId = keccak256(abi.encodePacked("withdraw", token, amount, block.timestamp));
            require(_confirmTransaction(txId), "Large withdrawal requires confirmation");
            emit TransactionExecuted(txId);
        }

        IERC20(token).transfer(msg.sender, amount);
    }

    // Emergency withdrawal (only emergency role, no multi-sig needed for security)
    function emergencyWithdraw(address token) external onlyRole(EMERGENCY_ROLE) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");
        IERC20(token).transfer(msg.sender, balance);
    }

    receive() external payable {}
}
