// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
    
    function getAmountsOut(
        uint amountIn, 
        address[] memory path
    ) external view returns (uint[] memory amounts);
}

interface IDODO {
    function flashLoan(
        uint256 baseAmount,
        uint256 quoteAmount,
        address assetTo,
        bytes calldata data
    ) external;

    function _BASE_TOKEN_() external view returns (address);
    function _QUOTE_TOKEN_() external view returns (address);
}

contract FlashloanArb is ReentrancyGuard, Pausable, Ownable {
    IDODO public dodoPool;
    mapping(string => address) public routers;
    uint public minProfit;
    
    // Safety parameters for stable pairs
    uint256 public constant MAX_STABLECOIN_SLIPPAGE = 50; // 0.05% max slippage for stables
    uint256 public constant MIN_STABLECOIN_LIQUIDITY = 10000e18; // Reduced minimum liquidity requirement
    bool public safetyChecksEnabled = true;
    
    // DODO Pools on BSC for different tokens
    mapping(address => address) public dodoPools;
    
    // Supported tokens
    address public constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address public constant BTCB = 0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c;
    address public constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address public constant BUSD = 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56;
    address public constant ETH = 0x2170Ed0880ac9A755fd29B2688956BD959F933F8;
    address public constant CAKE = 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82;
    address public constant ALPACA = 0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F;
    address public constant USDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;
    
    event ProfitableArbitrage(
        uint profit,
        address[] path,
        string[] exchanges
    );
    
    constructor() {
        // DODO Pools will be set by the owner
        minProfit = 0;
        
        // Initialize routers (BSC addresses)
        routers["PancakeSwap"] = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
        routers["ApeSwap"] = 0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7;
        routers["BiSwap"] = 0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8;
        routers["MDEX"] = 0x7DAe51BD3E3376B8c7c4900E9107f12Be3AF1bA8;
        routers["BabySwap"] = 0x325E343f1dE602396E256B67eFd1F61C3A6B38Bd;
    }
    
    function setRouter(string memory name, address router) external onlyOwner {
        routers[name] = router;
    }
    
    function setMinProfit(uint _minProfit) external onlyOwner {
        minProfit = _minProfit;
    }
    
    function setDODOPool(address token, address pool) external onlyOwner {
        dodoPools[token] = pool;
    }

    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address /* initiator */,
        bytes calldata params
    ) external returns (bool) {
        // Decode arbitrage parameters
        (
            string[] memory exchanges,
            address[] memory path
        ) = abi.decode(params, (string[], address[]));
        
        if(path.length < 2 || exchanges.length != path.length - 1) revert();
        // Combine two requires into one to save gas
        
        uint amountIn = amounts[0];
        uint currentAmount = amountIn;
        
        // Execute swaps
        for (uint i = 0; i < exchanges.length; i++) {
            address router = routers[exchanges[i]];
            require(router != address(0), "Router not found");
            
            // Perform safety checks for stable pairs
            require(
                checkStablePairSafety(path[i], path[i + 1], exchanges[i]),
                "Failed safety checks"
            );
            
            address[] memory swapPath = new address[](2);
            swapPath[0] = path[i];
            swapPath[1] = path[i + 1];
            
            IERC20(swapPath[0]).approve(router, currentAmount);
            
            // Use unchecked for gas savings on arithmetic operations that can't overflow
            uint[] memory swapAmounts;
            unchecked {
                swapAmounts = IRouter(router).swapExactTokensForTokens(
                    currentAmount,
                    0,
                    swapPath,
                    address(this),
                    block.timestamp + 60 // Use fixed buffer instead of block.timestamp for gas saving
                );
                currentAmount = swapAmounts[1];
            }
        }
        
        unchecked {
            // Calculate profit and check requirements in one go
            uint amountToRepay = amounts[0] + premiums[0];
            if(currentAmount <= amountToRepay || currentAmount - amountIn < minProfit) revert();
            
            // Using direct revert instead of require saves gas
            uint profit = currentAmount - amountIn;
        
            // Approve DODO pool to take repayment
            IERC20(assets[0]).approve(msg.sender, amountToRepay);
            
            emit ProfitableArbitrage(profit, path, exchanges);
            
            return true;
        }
    }
    
    function executeArbitrage(
        address[] calldata path,
        string[] calldata exchanges,
        uint256 amount
    ) external nonReentrant whenNotPaused onlyOwner {
        require(path.length >= 2, "Invalid path length");
        require(exchanges.length == path.length - 1, "Invalid exchanges length");
        
        // Get the DODO pool for the token we want to borrow
        address dodoPoolAddr = dodoPools[path[0]];
        require(dodoPoolAddr != address(0), "No DODO pool for token");
        
        dodoPool = IDODO(dodoPoolAddr);
        
        // Check if we're borrowing base or quote token
        bool isBase = dodoPool._BASE_TOKEN_() == path[0];
        
        bytes memory params = abi.encode(exchanges, path);
        
        // Execute flashloan
        if (isBase) {
            dodoPool.flashLoan(amount, 0, address(this), params);
        } else {
            dodoPool.flashLoan(0, amount, address(this), params);
        }
    }
    
    // Gas reserve amount in BNB
    uint256 public constant GAS_RESERVE = 0.1 ether; // Keep 0.1 BNB for gas

    function withdraw(
        address token,
        uint256 amount
    ) external onlyOwner {
        if (token == WBNB) {
            // For BNB/WBNB, ensure we keep gas reserve
            uint256 balance = IERC20(WBNB).balanceOf(address(this));
            require(balance - amount >= GAS_RESERVE, "Must keep gas reserve");
        }
        IERC20(token).transfer(owner(), amount);
    }

    function autoWithdrawProfits() external {
        // For each supported token
        address[] memory tokens = new address[](8);
        tokens[0] = USDT;
        tokens[1] = BUSD;
        tokens[2] = USDC;
        tokens[3] = BTCB;
        tokens[4] = ETH;
        tokens[5] = CAKE;
        tokens[6] = ALPACA;
        tokens[7] = WBNB;

        for (uint i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 balance = IERC20(token).balanceOf(address(this));
            
            if (balance > 0) {
                if (token == WBNB) {
                    // Keep gas reserve for BNB
                    if (balance > GAS_RESERVE) {
                        IERC20(WBNB).transfer(owner(), balance - GAS_RESERVE);
                    }
                } else {
                    // Withdraw full balance for other tokens
                    IERC20(token).transfer(owner(), balance);
                }
            }
        }
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }

    function checkStablePairSafety(
        address tokenA,
        address tokenB,
        string memory exchangeName
    ) internal view returns (bool) {
        if (!safetyChecksEnabled) return true;
        
        // Only apply to stablecoin pairs
        if ((tokenA == BUSD && tokenB == USDC) || (tokenA == USDC && tokenB == BUSD)) {
            address router = routers[exchangeName];
            require(router != address(0), "Router not found");

            // Check liquidity
            address[] memory path = new address[](2);
            path[0] = tokenA;
            path[1] = tokenB;
            
            // Check forward path
            uint[] memory amountsOut = IRouter(router).getAmountsOut(1000e18, path);
            uint forwardRate = (amountsOut[1] * 1e18) / 1000e18;
            
            // Check reverse path
            path[0] = tokenB;
            path[1] = tokenA;
            amountsOut = IRouter(router).getAmountsOut(1000e18, path);
            uint reverseRate = (amountsOut[1] * 1e18) / 1000e18;
            
            // Calculate price deviation
            uint deviation;
            if (forwardRate > reverseRate) {
                deviation = ((forwardRate - reverseRate) * 100000) / reverseRate;
            } else {
                deviation = ((reverseRate - forwardRate) * 100000) / forwardRate;
            }
            
            // Check if deviation is within acceptable range
            if (deviation > MAX_STABLECOIN_SLIPPAGE) {
                return false;
            }

            // Ensure sufficient liquidity
            if (IERC20(tokenA).balanceOf(router) < MIN_STABLECOIN_LIQUIDITY ||
                IERC20(tokenB).balanceOf(router) < MIN_STABLECOIN_LIQUIDITY) {
                return false;
            }
        }
        return true;
    }

    function toggleSafetyChecks() external onlyOwner {
        safetyChecksEnabled = !safetyChecksEnabled;
    }
}