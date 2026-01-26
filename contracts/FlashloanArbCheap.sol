// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

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

// AAVE V3 Pool Interface
interface IAAVEPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

contract FlashloanArbCheap is Ownable {
    using SafeERC20 for IERC20;

    // Only 2 DEXes
    mapping(string => address) public routers;

    // Flash loan providers
    address constant AAVE = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address constant BALANCER = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

    IAAVEPool public constant AAVE_POOL = IAAVEPool(AAVE);

    // Minimal events
    event ArbExecuted(uint256 profit);

    constructor() {
        // Pre-set routers for Arbitrum Nova
        routers["UniV3"] = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
        routers["Sushi"] = 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506;
    }

    // Execute flashloan arbitrage
    function executeFlashArb(
        address token,
        uint256 amount,
        address[3] calldata tokens,
        string calldata router
    ) external onlyOwner {
        bytes memory params = abi.encode(tokens, router);
        AAVE_POOL.flashLoanSimple(address(this), token, amount, params, 0);
    }

    // AAVE flashloan callback
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == AAVE, "Unauthorized");
        require(initiator == owner(), "Unauthorized initiator");

        (address[3] memory tokens, string memory router) = abi.decode(params, (address[3], string));

        // Execute triangular arbitrage
        uint256 profit = _executeTriArb(tokens, amount, router);

        // Repay flashloan
        uint256 repayAmount = amount + premium;
        IERC20(asset).approve(AAVE, repayAmount);

        return true;
    }

    // Triangular arbitrage (internal)
    function _executeTriArb(
        address[3] memory tokens,
        uint256 amount,
        string memory router
    ) internal returns (uint256) {
        address routerAddr = routers[router];
        require(routerAddr != address(0), "Router not set");

        IUniswapV2Router r = IUniswapV2Router(routerAddr);
        uint256 deadline = block.timestamp + 300;

        // 1) A -> B
        address[] memory pathAB = new address[](2);
        pathAB[0] = tokens[0];
        pathAB[1] = tokens[1];
        uint[] memory amountsAB = r.swapExactTokensForTokens(amount, 0, pathAB, address(this), deadline);
        uint256 amtB = amountsAB[1];

        // 2) B -> C
        address[] memory pathBC = new address[](2);
        pathBC[0] = tokens[1];
        pathBC[1] = tokens[2];
        uint[] memory amountsBC = r.swapExactTokensForTokens(amtB, 0, pathBC, address(this), deadline);
        uint256 amtC = amountsBC[1];

        // 3) C -> A
        address[] memory pathCA = new address[](2);
        pathCA[0] = tokens[2];
        pathCA[1] = tokens[0];
        uint[] memory amountsCA = r.swapExactTokensForTokens(amtC, 0, pathCA, address(this), deadline);
        uint256 finalA = amountsCA[1];

        require(finalA > amount, "No profit");
        uint256 profit = finalA - amount;

        emit ArbExecuted(profit);
        return profit;
    }

    // Direct triangular arbitrage (for testing without flashloan)
    function executeTriArb(
        address[3] calldata tokens,
        uint256 amount,
        string calldata router
    ) external onlyOwner returns (uint256) {
        // Transfer tokens from owner
        IERC20(tokens[0]).safeTransferFrom(msg.sender, address(this), amount);

        uint256 profit = _executeTriArb(tokens, amount, router);

        // Transfer profit back
        IERC20(tokens[0]).safeTransfer(owner(), amount + profit);

        return profit;
    }
}