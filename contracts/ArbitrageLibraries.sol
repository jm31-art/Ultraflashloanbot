// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// KILOCODE: COMPREHENSIVE SECURITY AND MATH LIBRARIES

library ArbitrageMath {

    // Precision constants
    uint256 internal constant PRECISION = 1e18;
    uint256 internal constant BASIS_POINTS_DIVISOR = 10000;

    function calculateOptimalTradeSize(
        uint256 availableCapital,
        uint256 priceImpact,
        uint256 gasCost,
        uint256 expectedProfit
    ) internal pure returns (uint256) {

        // Formula: Optimal size = min(availableCapital, expectedProfit * 0.8 / priceImpact) - gasCost
        uint256 maxByCapital = availableCapital;
        uint256 maxByImpact = expectedProfit * 8 / 10 / priceImpact;

        uint256 optimalSize = maxByCapital < maxByImpact ? maxByCapital : maxByImpact;

        // Subtract estimated gas costs
        return optimalSize > gasCost ? optimalSize - gasCost : 0;
    }

    function calculateProfitWithFees(
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeIn,
        uint256 feeOut,
        uint256 gasCost
    ) internal pure returns (uint256) {

        uint256 grossProfit = amountOut > amountIn ? amountOut - amountIn : 0;
        uint256 totalFees = feeIn + feeOut + gasCost;

        return grossProfit > totalFees ? grossProfit - totalFees : 0;
    }

    function calculateSlippage(
        uint256 expectedAmount,
        uint256 actualAmount
    ) internal pure returns (uint256) {

        if (expectedAmount == 0) return 0;

        uint256 difference = expectedAmount > actualAmount ?
                           expectedAmount - actualAmount :
                           actualAmount - expectedAmount;

        return difference * BASIS_POINTS_DIVISOR / expectedAmount;
    }

    function calculateVolatility(
        uint256[] memory prices
    ) internal pure returns (uint256) {

        require(prices.length > 1, "Insufficient price data");

        uint256 mean = 0;
        for (uint i = 0; i < prices.length; i++) {
            mean += prices[i];
        }
        mean /= prices.length;

        uint256 variance = 0;
        for (uint i = 0; i < prices.length; i++) {
            int256 diff = int256(prices[i]) - int256(mean);
            variance += uint256(diff * diff);
        }
        variance /= prices.length;

        return sqrt(variance);
    }

    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;

        uint256 z = (x + 1) / 2;
        uint256 y = x;

        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }

        return y;
    }
}

library SecurityValidator {

    function validateTokenAddress(address token) internal view returns (bool) {

        // Check it's a contract
        if (token.code.length == 0) return false;

        // Check for common token function selectors
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = 0x70a08231; // balanceOf
        selectors[1] = 0x18160ddd; // totalSupply
        selectors[2] = 0x06fdde03; // name

        bytes memory code = token.code;

        for (uint i = 0; i < selectors.length; i++) {
            if (!_containsSelector(code, selectors[i])) {
                return false;
            }
        }

        return true;
    }

    function validateExchangeRouter(address router) internal view returns (bool) {

        // Check it's a contract
        if (router.code.length == 0) return false;

        // Check for router function selectors
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = 0x38ed1739; // swapExactTokensForTokens
        selectors[1] = 0x7ff36ab5; // swapExactETHForTokens
        selectors[2] = 0x18cbafe5; // swapExactTokensForETH
        selectors[3] = 0xe6a43905; // getAmountsOut

        bytes memory code = router.code;

        for (uint i = 0; i < selectors.length; i++) {
            if (!_containsSelector(code, selectors[i])) {
                return false;
            }
        }

        return true;
    }

    function _containsSelector(bytes memory code, bytes4 selector) private pure returns (bool) {

        bytes memory selectorBytes = abi.encodePacked(selector);

        for (uint i = 0; i <= code.length - 4; i++) {
            bool found = true;
            for (uint j = 0; j < 4; j++) {
                if (code[i + j] != selectorBytes[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return true;
        }

        return false;
    }
}

library ArbitrageProtection {

    uint256 private constant MAX_PROFIT_DEVIATION = 500; // 5%
    uint256 private constant MIN_LIQUIDITY_THRESHOLD = 10000 * 1e18; // $10k

    function validateArbitrageOpportunity(
        uint256 buyPrice,
        uint256 sellPrice,
        uint256 buyLiquidity,
        uint256 sellLiquidity,
        uint256 expectedProfit
    ) internal pure returns (bool) {

        // Validate price difference is reasonable
        uint256 priceDifference = sellPrice > buyPrice ? sellPrice - buyPrice : 0;
        uint256 percentageDifference = priceDifference * 10000 / buyPrice;

        // Reject if profit seems too good to be true (likely trap)
        if (percentageDifference > MAX_PROFIT_DEVIATION) return false;

        // Validate sufficient liquidity
        if (buyLiquidity < MIN_LIQUIDITY_THRESHOLD) return false;
        if (sellLiquidity < MIN_LIQUIDITY_THRESHOLD) return false;

        // Validate positive profit
        if (expectedProfit == 0) return false;

        return true;
    }

    function validateFlashLoanSafety(
        address token,
        uint256 amount,
        uint256 fee,
        address provider
    ) internal view returns (bool) {

        // Check provider is known
        if (!_isKnownProvider(provider)) return false;

        // Check fee is reasonable (< 0.1%)
        if (fee > amount / 1000) return false;

        // Check amount is not excessive
        uint256 totalSupply = IERC20(token).totalSupply();
        if (amount > totalSupply / 10) return false; // > 10% of supply is suspicious

        return true;
    }

    function _isKnownProvider(address provider) private pure returns (bool) {

        // Known legitimate flash loan providers
        address[3] memory knownProviders = [
            0xBA12222222228d8Ba445958a75a0704d566BF2C8, // Balancer
            0x794a61358D6845594F94dc1DB02A252b5b4814aD, // AAVE
            0xfD36E2c2a6789Db23113685031d7F16329158384  // Venus
        ];

        for (uint i = 0; i < knownProviders.length; i++) {
            if (provider == knownProviders[i]) return true;
        }

        return false;
    }
}
