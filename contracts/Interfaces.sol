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

// DEX Router Interfaces
interface IPancakeRouter02 {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

interface IBiswapRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

interface IApeRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

// Chainlink Price Feed Interface
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

// AAVE V3 Interfaces
interface IPool {
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;
    function getReserveData(address asset) external view returns (DataTypes.ReserveData memory);
}

library DataTypes {
    struct ReserveData {
        ReserveConfigurationMap configuration;
        uint128 liquidityIndex;
        uint128 variableBorrowIndex;
        uint128 currentLiquidityRate;
        uint128 currentVariableBorrowRate;
        uint128 currentStableBorrowRate;
        uint40 lastUpdateTimestamp;
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
        address interestRateStrategyAddress;
        uint8 id;
    }

    struct ReserveConfigurationMap {
        uint256 data;
    }
}

library ReserveConfiguration {
    function getActive(ReserveConfigurationMap memory self) internal pure returns (bool) {
        return (self.data & ~uint256(0) >> 248) != 0;
    }
    function getFrozen(ReserveConfigurationMap memory self) internal pure returns (bool) {
        return (self.data & ~uint256(0) >> 247) != 0;
    }
}

// Balancer Interfaces
interface IVault {
    struct FlashLoanRequest {
        address[] tokens;
        uint256[] amounts;
        bytes userData;
    }
    function flashLoan(address recipient, FlashLoanRequest memory request) external;
    function getPoolTokens(bytes32 poolId) external view returns (address[] memory tokens, uint256[] memory balances, uint256 lastChangeBlock);
}

interface IBasePool {
    function getPoolId() external view returns (bytes32);
}
