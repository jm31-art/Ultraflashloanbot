// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Interfaces.sol";

// KILOCODE: REAL DEX ARBITRAGE EXECUTION ENGINE
contract RealArbitrageExecutor {

    // Real DEX router interfaces
    IPancakeRouter02 constant PANCAKE_ROUTER = IPancakeRouter02(0x10ED43C718714eb63d5aA57B78B54704E256024E);
    IBiswapRouter constant BISWAP_ROUTER = IBiswapRouter(0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8);
    IApeRouter constant APESWAP_ROUTER = IApeRouter(0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7);

    // Slippage protection: 0.5%
    uint256 constant maxSlippage = 50; // basis points

    struct DEXRoute {
        address router;
        address[] path;
        uint256 expectedOutput;
        uint256 gasEstimate;
    }

    event RealArbitrageExecuted(
        address indexed tokenA,
        address indexed tokenB,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit,
        address buyRouter,
        address sellRouter
    );

    function executeRealArbitrage(
        address tokenA,
        address tokenB,
        uint256 amountIn,
        string[] memory exchanges
    ) internal returns (uint256 finalProfit) {

        require(exchanges.length >= 2, "Need at least 2 exchanges");

        // Get optimal arbitrage route
        DEXRoute memory buyRoute = findOptimalBuyRoute(tokenA, tokenB, amountIn, exchanges);
        DEXRoute memory sellRoute = findOptimalSellRoute(tokenA, tokenB, buyRoute.expectedOutput, exchanges);

        // Execute buy on first exchange
        uint256 tokensBought = executeBuy(tokenA, tokenB, amountIn, buyRoute);
        require(tokensBought > 0, "Buy execution failed");

        // Execute sell on second exchange
        uint256 tokensReceived = executeSell(tokenA, tokenB, tokensBought, sellRoute);
        require(tokensReceived > amountIn, "Arbitrage not profitable");

        // Calculate profit
        finalProfit = tokensReceived - amountIn;

        emit RealArbitrageExecuted(
            tokenA,
            tokenB,
            amountIn,
            tokensReceived,
            finalProfit,
            buyRoute.router,
            sellRoute.router
        );

        return finalProfit;
    }

    function findOptimalBuyRoute(
        address tokenA,
        address tokenB,
        uint256 amountIn,
        string[] memory exchanges
    ) internal view returns (DEXRoute memory optimalRoute) {

        uint256 bestOutput = 0;
        address bestRouter;

        for (uint i = 0; i < exchanges.length; i++) {
            address router = getRouterAddress(exchanges[i]);
            uint256 output = getAmountsOut(router, amountIn, tokenA, tokenB);

            if (output > bestOutput) {
                bestOutput = output;
                bestRouter = router;
            }
        }

        address[] memory path = new address[](2);
        path[0] = tokenA;
        path[1] = tokenB;

        return DEXRoute({
            router: bestRouter,
            path: path,
            expectedOutput: bestOutput,
            gasEstimate: estimateGasForSwap(bestRouter)
        });
    }

    function findOptimalSellRoute(
        address tokenA,
        address tokenB,
        uint256 amountIn,
        string[] memory exchanges
    ) internal view returns (DEXRoute memory optimalRoute) {

        uint256 bestOutput = 0;
        address bestRouter;

        for (uint i = 0; i < exchanges.length; i++) {
            address router = getRouterAddress(exchanges[i]);
            uint256 output = getAmountsOut(router, amountIn, tokenB, tokenA); // Note: selling tokenB for tokenA

            if (output > bestOutput) {
                bestOutput = output;
                bestRouter = router;
            }
        }

        address[] memory path = new address[](2);
        path[0] = tokenB;
        path[1] = tokenA;

        return DEXRoute({
            router: bestRouter,
            path: path,
            expectedOutput: bestOutput,
            gasEstimate: estimateGasForSwap(bestRouter)
        });
    }

    function executeBuy(
        address tokenA,
        address tokenB,
        uint256 amountIn,
        DEXRoute memory route
    ) internal returns (uint256 amountOut) {

        // Approve exact amount
        IERC20(tokenA).approve(route.router, amountIn);

        // Calculate minimum output with slippage protection
        uint256 minOutput = route.expectedOutput * (10000 - maxSlippage) / 10000;

        if (keccak256(bytes(getRouterName(route.router))) == keccak256(bytes("PancakeSwap"))) {

            uint256[] memory amounts = PANCAKE_ROUTER.swapExactTokensForTokens(
                amountIn,
                minOutput,
                route.path,
                address(this),
                block.timestamp + 300
            );

            return amounts[amounts.length - 1];

        } else if (keccak256(bytes(getRouterName(route.router))) == keccak256(bytes("Biswap"))) {

            uint256[] memory amounts = BISWAP_ROUTER.swapExactTokensForTokens(
                amountIn,
                minOutput,
                route.path,
                address(this),
                block.timestamp + 300
            );

            return amounts[amounts.length - 1];

        } else if (keccak256(bytes(getRouterName(route.router))) == keccak256(bytes("ApeSwap"))) {

            uint256[] memory amounts = APESWAP_ROUTER.swapExactTokensForTokens(
                amountIn,
                minOutput,
                route.path,
                address(this),
                block.timestamp + 300
            );

            return amounts[amounts.length - 1];
        }

        revert("Unsupported exchange");
    }

    function executeSell(
        address tokenA,
        address tokenB,
        uint256 amountIn,
        DEXRoute memory route
    ) internal returns (uint256 amountOut) {

        // Approve exact amount
        IERC20(tokenB).approve(route.router, amountIn);

        // Calculate minimum output with slippage protection
        uint256 minOutput = route.expectedOutput * (10000 - maxSlippage) / 10000;

        if (keccak256(bytes(getRouterName(route.router))) == keccak256(bytes("PancakeSwap"))) {

            uint256[] memory amounts = PANCAKE_ROUTER.swapExactTokensForTokens(
                amountIn,
                minOutput,
                route.path,
                address(this),
                block.timestamp + 300
            );

            return amounts[amounts.length - 1];

        } else if (keccak256(bytes(getRouterName(route.router))) == keccak256(bytes("Biswap"))) {

            uint256[] memory amounts = BISWAP_ROUTER.swapExactTokensForTokens(
                amountIn,
                minOutput,
                route.path,
                address(this),
                block.timestamp + 300
            );

            return amounts[amounts.length - 1];

        } else if (keccak256(bytes(getRouterName(route.router))) == keccak256(bytes("ApeSwap"))) {

            uint256[] memory amounts = APESWAP_ROUTER.swapExactTokensForTokens(
                amountIn,
                minOutput,
                route.path,
                address(this),
                block.timestamp + 300
            );

            return amounts[amounts.length - 1];
        }

        revert("Unsupported exchange");
    }

    function getAmountsOut(
        address router,
        uint256 amountIn,
        address tokenA,
        address tokenB
    ) internal view returns (uint256 amountOut) {

        address[] memory path = new address[](2);
        path[0] = tokenA;
        path[1] = tokenB;

        try IPancakeRouter02(router).getAmountsOut(amountIn, path) returns (uint256[] memory amounts) {
            return amounts[amounts.length - 1];
        } catch {
            return 0;
        }
    }

    function getRouterAddress(string memory exchange) internal pure returns (address) {
        if (keccak256(bytes(exchange)) == keccak256(bytes("PancakeSwap"))) {
            return 0x10ED43C718714eb63d5aA57B78B54704E256024E;
        } else if (keccak256(bytes(exchange)) == keccak256(bytes("Biswap"))) {
            return 0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8;
        } else if (keccak256(bytes(exchange)) == keccak256(bytes("ApeSwap"))) {
            return 0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7;
        }
        revert("Unknown exchange");
    }

    function getRouterName(address router) internal pure returns (string memory) {
        if (router == 0x10ED43C718714eb63d5aA57B78B54704E256024E) {
            return "PancakeSwap";
        } else if (router == 0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8) {
            return "Biswap";
        } else if (router == 0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7) {
            return "ApeSwap";
        }
        return "Unknown";
    }

    function estimateGasForSwap(address router) internal pure returns (uint256) {
        // Simple gas estimate, can be improved with actual gas oracle
        return 150000; // Approximate gas for a swap
    }
}