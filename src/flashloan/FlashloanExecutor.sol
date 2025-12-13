// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";

contract FlashloanExecutor is FlashLoanSimpleReceiverBase {
    // BSC Aave v3 Pool Addresses Provider
    IPoolAddressesProvider public immutable override ADDRESSES_PROVIDER =
        IPoolAddressesProvider(0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e);

    // Supported DEX routers
    address public constant PANCAKESWAP_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address public constant APESWAP_ROUTER = 0xC0788A3aD43d79aa53B09c2EaCc313A787d1d607;
    address public constant SUSHISWAP_ROUTER = 0x1b02da8cb0d097eb8d57a175b88c7d8b47997506;

    // Events
    event ArbitrageExecuted(
        address indexed asset,
        uint256 amount,
        uint256 profit,
        address router,
        address[] path
    );

    constructor() FlashLoanSimpleReceiverBase(ADDRESSES_PROVIDER) {}

    /**
     * @dev Execute triangular arbitrage using flashloan
     * @param asset The address of the flashloaned asset
     * @param amount The amount flashloaned
     * @param premium The fee flashloaned
     * @param initiator The address of the flashloan initiator
     * @param params The byte-encoded params containing router and path
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Decode parameters
        (address router, address[] memory path) = abi.decode(params, (address, address[]));

        // Validate path is triangular (4 addresses: A->B->C->A)
        require(path.length == 4, "Invalid triangular path");
        require(path[0] == asset, "Path must start with flashloan asset");
        require(path[3] == asset, "Path must end with flashloan asset");

        // Record initial balance
        uint256 initialBalance = IERC20(asset).balanceOf(address(this));

        // Execute triangular arbitrage
        _executeTriangularArbitrage(router, path, amount);

        // Calculate final balance
        uint256 finalBalance = IERC20(asset).balanceOf(address(this));

        // Calculate total amount to repay (loan + premium)
        uint256 totalRepayment = amount + premium;

        // Validate arbitrage was profitable
        require(finalBalance >= totalRepayment, "Arbitrage not profitable");

        // Calculate profit
        uint256 profit = finalBalance - totalRepayment;

        // Approve pool to pull repayment
        IERC20(asset).approve(address(POOL), totalRepayment);

        // Emit event
        emit ArbitrageExecuted(asset, amount, profit, router, path);

        return true;
    }

    /**
     * @dev Execute triangular arbitrage swaps
     */
    function _executeTriangularArbitrage(
        address router,
        address[] memory path,
        uint256 amount
    ) internal {
        // Approve router for all tokens in path
        for (uint i = 0; i < path.length - 1; i++) {
            IERC20(path[i]).approve(router, type(uint256).max);
        }

        // Execute first swap: asset -> tokenB
        address[] memory path1 = new address[](2);
        path1[0] = path[0];
        path1[1] = path[1];

        _swapExactTokensForTokens(router, amount, 0, path1, address(this));

        // Get amount received from first swap
        uint256 amountB = IERC20(path[1]).balanceOf(address(this));

        // Execute second swap: tokenB -> tokenC
        address[] memory path2 = new address[](2);
        path2[0] = path[1];
        path2[1] = path[2];

        _swapExactTokensForTokens(router, amountB, 0, path2, address(this));

        // Get amount received from second swap
        uint256 amountC = IERC20(path[2]).balanceOf(address(this));

        // Execute third swap: tokenC -> asset
        address[] memory path3 = new address[](2);
        path3[0] = path[2];
        path3[1] = path[3];

        _swapExactTokensForTokens(router, amountC, 0, path3, address(this));
    }

    /**
     * @dev Safe swapExactTokensForTokens wrapper
     */
    function _swapExactTokensForTokens(
        address router,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] memory path,
        address to
    ) internal {
        // Low-level call to router
        (bool success, ) = router.call(
            abi.encodeWithSignature(
                "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
                amountIn,
                amountOutMin,
                path,
                to,
                block.timestamp + 300
            )
        );
        require(success, "Swap failed");
    }

    /**
     * @dev Initiate flashloan arbitrage (called by external account)
     */
    function executeFlashloanArbitrage(
        address asset,
        uint256 amount,
        address router,
        address[] calldata path
    ) external {
        // Validate router
        require(
            router == PANCAKESWAP_ROUTER ||
            router == APESWAP_ROUTER ||
            router == SUSHISWAP_ROUTER,
            "Unsupported router"
        );

        // Encode parameters
        bytes memory params = abi.encode(router, path);

        // Request flashloan
        POOL.flashLoanSimple(
            address(this),
            asset,
            amount,
            params,
            0
        );
    }

    /**
     * @dev Withdraw profits (only owner)
     */
    function withdrawProfits(address token, uint256 amount) external {
        // In production, add onlyOwner modifier
        IERC20(token).transfer(msg.sender, amount);
    }

    /**
     * @dev Get contract balance for a token
     */
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}