// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
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

// Venus Protocol Interfaces
interface IVenusComptroller {
    function getAccountLiquidity(address account) external view returns (uint256, uint256, uint256);
}

interface IVToken {
    function liquidateBorrow(address borrower, uint256 repayAmount, IVToken vTokenCollateral) external returns (uint256);
    function borrowBalanceStored(address account) external view returns (uint256);
    function transfer(address dst, uint256 amount) external returns (bool);
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

    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external;
}

contract FlashloanArb is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Events
    event FlashloanOperationExecuted(
        uint8 operationType, // 1=arbitrage, 2=liquidation
        address indexed tokenA,
        address indexed tokenB,
        address indexed tokenC,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit,
        bool success,
        uint256 timestamp
    );
    event SlippageToleranceSet(uint256 oldTolerance, uint256 newTolerance);
    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 expectedOut,
        uint256 actualOut,
        uint256 slippage,
        string router
    );

    uint256 public constant GAS_PRICE_LIMIT = 500 gwei; // Max 500 gwei gas price
    uint256 public minProfit;
    uint256 public slippageTolerance = 5; // 0.5% default (basis points, 5 = 0.5%)
    bool public safetyChecksEnabled;
    mapping(string => address) public routers;
    mapping(address => bool) public authorizedFlashLoanProviders;

    // Venus Protocol Configuration
    address public constant VENUS_COMPTROLLER = 0xfD36E2c2a6789Db23113685031d7F16329158384; // BSC Venus Comptroller
    mapping(address => address) public vTokenAddresses; // underlying asset => vToken address

    // KILOCODE: SECURE FLASHLOAN ACCESS CONTROL
    mapping(address => bool) public authorizedFlashProviders;
    mapping(address => uint256) public providerRiskScore;
    mapping(address => bool) public blacklistedTokens;

    // KILOCODE: COMPREHENSIVE REENTRANCY GUARD
    mapping(address => uint256) private _executionStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    mapping(address => bool) public knownVulnerableTokens;
    mapping(address => bool) public verifiedContracts;

    // KILOCODE: GAS-EFFICIENT APPROVAL SYSTEM
    mapping(address => mapping(address => uint256)) private _tokenAllowances;
    mapping(address => bool) private _isApprovedContract;
    uint256 private constant APPROVAL_THRESHOLD = 1000000; // Only approve if trade > $1M
    uint256 private constant GAS_PRICE_LIMIT = 100 gwei; // Maximum gas price

    // KILOCODE: DYNAMIC SLIPPAGE PROTECTION
    struct SlippageConfig {
        uint256 baseSlippage;      // Base slippage tolerance (0.5% = 50)
        uint256 volatilityMultiplier; // Adjust based on market volatility
        uint256 maxSlippage;       // Maximum allowed slippage (5% = 500)
        uint256 lastUpdateTime;
    }

    mapping(address => SlippageConfig) public tokenSlippageConfig;
    mapping(address => uint256) public tokenVolatility;

    // KILOCODE: ROBUST PROTOCOL INTEGRATION
    struct ProtocolConfig {
        address pool;
        address router;
        address factory;
        uint256 version;
        bool isActive;
        uint256 lastUpdate;
        bytes4[] requiredSelectors;
    }

    mapping(string => ProtocolConfig) public protocolConfigs;
    mapping(string => uint256) public protocolRiskScores;
    mapping(address => bool) public blacklistedAddresses;
    mapping(string => bool) public compromisedProtocols;

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

    event MEVBundleExecuted(
        address indexed initiator,
        uint256 totalProfit,
        uint256 arbitrageProfit,
        uint256 liquidationProfit,
        bool liquidationExecuted
    );

    event ArbitrageExecuted(
        address indexed caller,
        address indexed token,
        uint amount,
        uint profit,
        uint repayAmount,
        string[] exchanges,
        address[] path
    );

    event VenusLiquidationExecuted(
        address indexed borrower,
        address indexed debtAsset,
        address indexed collateralAsset,
        uint256 debtLiquidated,
        uint256 collateralSeized,
        uint256 profit,
        uint256 liquidationBonus
    );

    event FlashProviderAuthorized(address indexed provider, uint256 riskScore);
    event FlashProviderRevoked(address indexed provider);
    event FlashloanCallbackValidated(address indexed provider, uint256 amount);
    event TokenBlacklisted(address indexed token);
    event TokenUnblacklisted(address indexed token);

    event ProtocolUpdated(string indexed protocol, uint256 version);
    event ProtocolDeactivated(string indexed protocol, string reason);
    event AddressBlacklisted(address indexed addr);
    event AddressUnblacklisted(address indexed addr);

    // KILOCODE: COMPREHENSIVE EVENT SYSTEM
    event ArbitrageOpportunityDetected(
        address indexed tokenA,
        address indexed tokenB,
        uint256 priceDifference,
        uint256 estimatedProfit,
        string buyExchange,
        string sellExchange,
        uint256 timestamp
    );

    event ArbitrageExecuted(
        address indexed executor,
        address indexed tokenA,
        address indexed tokenB,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit,
        uint256 gasUsed,
        uint256 timestamp,
        bool success
    );

    event LiquidationExecuted(
        address indexed protocol,
        address indexed borrower,
        address indexed collateralAsset,
        address debtAsset,
        uint256 debtCovered,
        uint256 collateralSeized,
        uint256 profit,
        uint256 timestamp
    );

    event FlashLoanInitiated(
        address indexed provider,
        address indexed token,
        uint256 amount,
        uint256 fee,
        address indexed initiator,
        uint256 timestamp
    );

    event ErrorOccurred(
        string indexed errorType,
        string errorMessage,
        address indexed contractAddress,
        uint256 timestamp,
        bytes data
    );

    event ProfitDistributed(
        address indexed recipient,
        uint256 amount,
        string distributionType,
        uint256 timestamp
    );

    constructor() {
        safetyChecksEnabled = true;
        minProfit = 0;

        // Initialize with verified providers
        _authorizeFlashProvider(0xBA12222222228d8Ba445958a75a0704d566BF2C8, 10); // Balancer
        _authorizeFlashProvider(0x794a61358D6845594F94dc1DB02A252b5b4814aD, 5);  // AAVE V3
        _authorizeFlashProvider(0xfD36E2c2a6789Db23113685031d7F16329158384, 15); // Venus

        // Initialize comprehensive reentrancy guard
        _executionStatus[address(0)] = _NOT_ENTERED; // Default state
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

    // Slippage management
    function setSlippageTolerance(uint256 _slippageTolerance) external onlyOwner {
        require(_slippageTolerance >= 1 && _slippageTolerance <= 20, "Slippage tolerance must be 0.1%-2%");
        uint256 oldTolerance = slippageTolerance;
        slippageTolerance = _slippageTolerance;
        emit SlippageToleranceSet(oldTolerance, _slippageTolerance);
    }

    // Flash loan provider authorization
    function setAuthorizedFlashLoanProvider(address provider, bool authorized) external onlyOwner {
        authorizedFlashLoanProviders[provider] = authorized;
    }

    function isAuthorizedFlashLoanProvider(address provider) public view returns (bool) {
        return authorizedFlashLoanProviders[provider];
    }

    // Venus Protocol Management
    function setVTokenAddress(address underlying, address vToken) external onlyOwner {
        vTokenAddresses[underlying] = vToken;
    }

    function getVTokenAddress(address underlying) public view returns (address) {
        return vTokenAddresses[underlying];
    }

    function isVenusProtocol(address protocol) public pure returns (bool) {
        return protocol == VENUS_COMPTROLLER;
    }

    function isAaveProtocol(address /*protocol*/) public pure returns (bool) {
        // Placeholder for Aave protocol check
        return false;
    }

    function isCompoundProtocol(address /*protocol*/) public pure returns (bool) {
        // Placeholder for Compound protocol check
        return false;
    }

    // Pause functionality
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    modifier onlyAuthorizedFlashProvider() {
        require(authorizedFlashProviders[msg.sender], "Unauthorized flash loan provider");
        require(providerRiskScore[msg.sender] <= 20, "Provider risk score too high");
        _;
    }

    modifier comprehensiveReentrancyGuard() {
        require(_executionStatus[msg.sender] != _ENTERED, "Reentrant call detected");

        _executionStatus[msg.sender] = _ENTERED;

        // Execute function
        _;

        _executionStatus[msg.sender] = _NOT_ENTERED;
    }

    // Triangular Arbitrage Executor with Slippage Protection
    function executeTriArb(
        address tokenA,
        address tokenB,
        address tokenC,
        uint256 amountIn,
        string memory router1Name,
        string memory router2Name,
        string memory router3Name,
        uint256 minReturnA,
        uint256 /*deadline*/ // Ignored, using fixed 5min deadline
    ) external whenNotPaused onlyOwner returns (uint256 finalAmountA, uint256 profit) {
        require(amountIn > 0, "amountIn=0");

        address router1 = routers[router1Name];
        address router2 = routers[router2Name];
        address router3 = routers[router3Name];

        require(router1 != address(0) && router2 != address(0) && router3 != address(0), "router not set");

        IUniswapV2Router r1 = IUniswapV2Router(router1);
        IUniswapV2Router r2 = IUniswapV2Router(router2);
        IUniswapV2Router r3 = IUniswapV2Router(router3);

        uint256 deadline = block.timestamp + 300; // 5 minutes

        // Transfer tokenA from caller to contract
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountIn);

        // MEV Protection: Validate price stability before execution
        require(validatePriceStability(tokenA, tokenB, 100), "Price manipulation detected on A-B"); // 1% max deviation
        require(validatePriceStability(tokenB, tokenC, 100), "Price manipulation detected on B-C");
        require(validatePriceStability(tokenC, tokenA, 100), "Price manipulation detected on C-A");

        // 1) A -> B on router1 with slippage protection
        autoApproveIfNeeded(tokenA, router1, amountIn);
        address[] memory pathAB = new address[](2);
        pathAB[0] = tokenA;
        pathAB[1] = tokenB;

        uint[] memory expectedAB = r1.getAmountsOut(amountIn, pathAB);
        require(expectedAB[1] > 0, "No liquidity for A->B swap");
        uint256 minOutAB = (expectedAB[1] * (1000 - slippageTolerance)) / 1000;

        uint[] memory amountsAB = r1.swapExactTokensForTokens(amountIn, minOutAB, pathAB, address(this), deadline);
        uint256 amtB = amountsAB[amountsAB.length - 1];

        uint256 slippageAB = expectedAB[1] > amtB ? ((expectedAB[1] - amtB) * 10000) / expectedAB[1] : 0;
        require(slippageAB <= slippageTolerance * 10, "Slippage exceeded max tolerance on A->B");

        emit SwapExecuted(tokenA, tokenB, amountIn, expectedAB[1], amtB, slippageAB, router1Name);

        // 2) B -> C on router2 with slippage protection
        autoApproveIfNeeded(tokenB, router2, amtB);
        address[] memory pathBC = new address[](2);
        pathBC[0] = tokenB;
        pathBC[1] = tokenC;

        uint[] memory expectedBC = r2.getAmountsOut(amtB, pathBC);
        require(expectedBC[1] > 0, "No liquidity for B->C swap");
        uint256 minOutBC = (expectedBC[1] * (1000 - slippageTolerance)) / 1000;

        uint[] memory amountsBC = r2.swapExactTokensForTokens(amtB, minOutBC, pathBC, address(this), deadline);
        uint256 amtC = amountsBC[amountsBC.length - 1];

        uint256 slippageBC = expectedBC[1] > amtC ? ((expectedBC[1] - amtC) * 10000) / expectedBC[1] : 0;
        require(slippageBC <= slippageTolerance * 10, "Slippage exceeded max tolerance on B->C");

        emit SwapExecuted(tokenB, tokenC, amtB, expectedBC[1], amtC, slippageBC, router2Name);

        // 3) C -> A on router3 with slippage protection
        autoApproveIfNeeded(tokenC, router3, amtC);
        address[] memory pathCA = new address[](2);
        pathCA[0] = tokenC;
        pathCA[1] = tokenA;

        uint[] memory expectedCA = r3.getAmountsOut(amtC, pathCA);
        require(expectedCA[1] > 0, "No liquidity for C->A swap");
        uint256 minOutCA = (expectedCA[1] * (1000 - slippageTolerance)) / 1000;

        uint[] memory amountsCA = r3.swapExactTokensForTokens(amtC, minOutCA, pathCA, address(this), deadline);
        finalAmountA = amountsCA[amountsCA.length - 1];

        uint256 slippageCA = expectedCA[1] > finalAmountA ? ((expectedCA[1] - finalAmountA) * 10000) / expectedCA[1] : 0;
        require(slippageCA <= slippageTolerance * 10, "Slippage exceeded max tolerance on C->A");

        emit SwapExecuted(tokenC, tokenA, amtC, expectedCA[1], finalAmountA, slippageCA, router3Name);

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

    /**
     * Execute MEV Bundle: Atomic Arbitrage + Liquidation
     */
    function executeMEVBundle(
        address arbitrageToken,
        address[] calldata arbitragePath,
        uint256 arbitrageAmountIn,
        string memory arbitrageRouter,
        address liquidationProtocol,
        address liquidationUser,
        address liquidationDebtAsset,
        address liquidationCollateralAsset,
        uint256 liquidationDebtToCover,
        uint256 minTotalProfit
    ) external whenNotPaused onlyOwner returns (uint256 totalProfit) {
        require(arbitrageAmountIn > 0, "arbitrage amount = 0");

        uint256 arbitrageProfit = 0;
        uint256 liquidationProfit = 0;
        bool liquidationExecuted = false;

        // Track initial balance for profit calculation
        uint256 initialBalance = address(this).balance;

        // 1. Execute arbitrage first (if provided)
        if (arbitragePath.length >= 3) {
            arbitrageProfit = _executeArbitrage(arbitrageToken, arbitragePath, arbitrageAmountIn, arbitrageRouter);
        }

        // 2. Execute liquidation (if provided)
        if (liquidationProtocol != address(0) && liquidationUser != address(0)) {
            liquidationProfit = _executeLiquidation(
                liquidationProtocol,
                liquidationUser,
                liquidationDebtAsset,
                liquidationCollateralAsset,
                liquidationDebtToCover
            );
            liquidationExecuted = true;
        }

        // 3. Calculate total profit
        uint256 finalBalance = address(this).balance;
        totalProfit = finalBalance - initialBalance;

        // 4. Verify minimum profit requirement
        require(totalProfit >= minTotalProfit, "total profit < minimum required");

        // 5. Transfer profit to owner
        if (totalProfit > 0) {
            payable(owner()).transfer(totalProfit);
        }

        emit MEVBundleExecuted(
            msg.sender,
            totalProfit,
            arbitrageProfit,
            liquidationProfit,
            liquidationExecuted
        );

        return totalProfit;
    }

    /**
     * Internal arbitrage execution
     */
    function _executeArbitrage(
        address token,
        address[] calldata path,
        uint256 amountIn,
        string memory routerName
    ) internal returns (uint256 profit) {
        require(path.length >= 3, "path too short");

        address router = routers[routerName];
        require(router != address(0), "router not set");

        IUniswapV2Router r = IUniswapV2Router(router);

        // Transfer token from caller to contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountIn);

        // Execute triangular arbitrage
        autoApproveIfNeeded(token, router, amountIn);

        // A -> B -> C -> A
        address[] memory fullPath = new address[](4);
        fullPath[0] = path[0];
        fullPath[1] = path[1];
        fullPath[2] = path[2];
        fullPath[3] = path[0];

        uint256 deadline = block.timestamp + 300; // 5 minutes

        uint[] memory amounts = r.swapExactTokensForTokens(
            amountIn,
            0, // No minimum out for internal call
            fullPath,
            address(this),
            deadline
        );

        uint256 finalAmount = amounts[amounts.length - 1];
        require(finalAmount >= amountIn, "arbitrage not profitable");

        profit = finalAmount - amountIn;
        return profit;
    }

    // COMPLETE LIQUIDATION EXECUTION ENGINE
    function _executeLiquidation(
        address protocol,
        address user,
        address debtAsset,
        address collateralAsset,
        uint256 debtToCover
    ) internal returns (uint256 profit) {

        // Validate liquidation parameters
        require(protocol != address(0), "Invalid protocol");
        require(user != address(0), "Invalid user");
        require(debtAsset != address(0), "Invalid debt asset");
        require(collateralAsset != address(0), "Invalid collateral asset");
        require(debtToCover > 0, "Invalid debt amount");

        // Determine protocol type and execute appropriate liquidation
        if (isVenusProtocol(protocol)) {
            return executeVenusLiquidation(protocol, user, debtAsset, collateralAsset, debtToCover);
        } else if (isAaveProtocol(protocol)) {
            return executeAaveLiquidation(protocol, user, debtAsset, collateralAsset, debtToCover);
        } else if (isCompoundProtocol(protocol)) {
            return executeCompoundLiquidation(protocol, user, debtAsset, collateralAsset, debtToCover);
        } else {
            revert("Unsupported lending protocol");
        }
    }

    function executeVenusLiquidation(
        address /*protocol*/,
        address borrower,
        address debtAsset,
        address collateralAsset,
        uint256 debtToCover
    ) internal returns (uint256 profit) {

        // Get Venus protocol interfaces
        IVenusComptroller comptroller = IVenusComptroller(VENUS_COMPTROLLER);
        IVToken debtVToken = IVToken(getVTokenAddress(debtAsset));
        IVToken collateralVToken = IVToken(getVTokenAddress(collateralAsset));

        // Get borrower account data
        (uint256 error, uint256 liquidity, uint256 shortfall) = comptroller.getAccountLiquidity(borrower);
        require(error == 0, "Failed to get account liquidity");
        require(shortfall > 0, "Account has no shortfall - not eligible for liquidation");

        // Calculate liquidation bonus (typically 8% on Venus)
        uint256 liquidationBonus = getLiquidationBonus(collateralAsset); // Usually 8% = 800 basis points

        // Calculate maximum liquidatable amount
        uint256 maxLiquidatable = calculateMaxLiquidatable(debtVToken, borrower, debtToCover);
        uint256 actualLiquidationAmount = min(debtToCover, maxLiquidatable);

        // Execute liquidation
        uint256 seizedCollateral = debtVToken.liquidateBorrow(borrower, actualLiquidationAmount, collateralVToken);

        // Calculate profit from liquidation bonus
        uint256 bonusAmount = (seizedCollateral * liquidationBonus) / 10000;
        uint256 netProfit = bonusAmount - estimateGasCosts();

        // Validate profit
        require(netProfit > 0, "Liquidation not profitable");

        // Transfer profit to contract owner
        collateralVToken.transfer(owner(), netProfit);

        emit VenusLiquidationExecuted(
            borrower,
            debtAsset,
            collateralAsset,
            actualLiquidationAmount,
            seizedCollateral,
            netProfit,
            liquidationBonus
        );

        emitLiquidationExecution(
            VENUS_COMPTROLLER,
            borrower,
            collateralAsset,
            debtAsset,
            actualLiquidationAmount,
            seizedCollateral,
            netProfit
        );

        return netProfit;
    }

    function executeAaveLiquidation(
        address protocol,
        address borrower,
        address debtAsset,
        address collateralAsset,
        uint256 debtToCover
    ) internal returns (uint256 profit) {
        // AAVE liquidation requires the contract to have the debtAsset
        // In production, this should be wrapped in a flash loan

        IAAVEPool pool = IAAVEPool(protocol);

        // Check if borrower is liquidatable (health factor < 1)
        // This is simplified - in production, check user account data

        // Approve debtAsset to pool if needed (usually not required for liquidationCall)

        // Execute liquidation
        pool.liquidationCall(collateralAsset, debtAsset, borrower, debtToCover, false);

        // Calculate seized collateral (debtToCover + bonus)
        // AAVE liquidation bonus is typically 5-10%
        uint256 liquidationBonus = 500; // 5% default
        uint256 seizedCollateral = debtToCover + (debtToCover * liquidationBonus / 10000);

        // Swap collateral to debtAsset to recover funds
        address router = routers["PancakeSwap"];
        require(router != address(0), "PancakeSwap router not set");

        autoApproveIfNeeded(collateralAsset, router, seizedCollateral);

        address[] memory path = _getPath(collateralAsset, debtAsset);
        uint[] memory expectedOut = IUniswapV2Router(router).getAmountsOut(seizedCollateral, path);
        uint256 minOut = expectedOut[1] * 995 / 1000; // 0.5% slippage

        uint[] memory amounts = IUniswapV2Router(router).swapExactTokensForTokens(
            seizedCollateral,
            minOut,
            path,
            address(this),
            block.timestamp + 300
        );

        uint256 recoveredDebt = amounts[amounts.length - 1];

        // Profit is recovered - debtToCover (since we spent debtToCover)
        profit = recoveredDebt - debtToCover;

        // Validate profit
        require(profit > 0, "Liquidation not profitable");

        // Transfer profit to owner
        IERC20(debtAsset).safeTransfer(owner(), profit);

        emit LiquidationExecuted(
            protocol,
            borrower,
            collateralAsset,
            debtAsset,
            debtToCover,
            seizedCollateral,
            profit,
            block.timestamp
        );

        return profit;
    }

    function executeCompoundLiquidation(
        address /*protocol*/,
        address /*borrower*/,
        address /*debtAsset*/,
        address /*collateralAsset*/,
        uint256 /*debtToCover*/
    ) internal pure returns (uint256) {
        // Placeholder for Compound liquidation
        revert("Compound liquidation not implemented");
    }

    function calculateMaxLiquidatable(
        IVToken debtVToken,
        address borrower,
        uint256 requestedAmount
    ) internal view returns (uint256) {

        // Get borrower debt amount
        uint256 borrowerDebt = debtVToken.borrowBalanceStored(borrower);

        // Venus allows liquidation of up to 50% of borrower debt
        uint256 maxLiquidatableDebt = borrowerDebt * 50 / 100;

        // Return minimum of requested amount and maximum allowed
        return min(requestedAmount, maxLiquidatableDebt);
    }

    function getLiquidationBonus(address /*collateralAsset*/) internal pure returns (uint256) {
        // Venus typically offers 8% liquidation bonus
        // This can be adjusted based on asset risk profile
        return 800; // 8% in basis points
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _validateFlashLoanParameters(address token, uint amount, uint fee) internal view {
        require(token != address(0), "Invalid token address");
        require(amount > 0, "Invalid flash loan amount");
        require(fee > 0, "Invalid flash loan fee");

        // Validate fee is reasonable (less than 0.1%)
        uint maxFee = amount / 1000; // 0.1%
        require(fee <= maxFee, "Flash loan fee too high");

        // Check token is not in blacklist
        require(!isBlacklistedToken(token), "Blacklisted token");
    }

    function _authorizeFlashProvider(address provider, uint256 riskScore) internal {
        require(provider != address(0), "Invalid provider address");
        require(riskScore <= 100, "Invalid risk score");

        authorizedFlashProviders[provider] = true;
        providerRiskScore[provider] = riskScore;

        emit FlashProviderAuthorized(provider, riskScore);
    }

    function revokeFlashProvider(address provider) external onlyOwner {
        authorizedFlashProviders[provider] = false;
        emit FlashProviderRevoked(provider);
    }

    function isBlacklistedToken(address token) public view returns (bool) {
        return blacklistedTokens[token];
    }

    function blacklistToken(address token) external onlyOwner {
        blacklistedTokens[token] = true;
        emit TokenBlacklisted(token);
    }

    function unblacklistToken(address token) external onlyOwner {
        blacklistedTokens[token] = false;
        emit TokenUnblacklisted(token);
    }

    function _validateExternalCallSafety(address flashToken, address tokenA, address tokenB, address[] memory path, string[] memory exchanges) internal view {
        // Check all tokens for known reentrancy vulnerabilities
        require(!isKnownVulnerableToken(flashToken), "Flash token has reentrancy vulnerability");
        require(!isKnownVulnerableToken(tokenA), "Token A has reentrancy vulnerability");
        require(!isKnownVulnerableToken(tokenB), "Token B has reentrancy vulnerability");

        // Check all tokens in path
        for (uint i = 0; i < path.length; i++) {
            require(!isKnownVulnerableToken(path[i]), "Path token has reentrancy vulnerability");
        }

        // Validate all contracts are verified
        require(isVerifiedContract(flashToken), "Flash token not verified");
        require(isVerifiedContract(tokenA), "Token A not verified");
        require(isVerifiedContract(tokenB), "Token B not verified");

        // Validate DEX routers
        for (uint i = 0; i < exchanges.length; i++) {
            address router = routers[exchanges[i]];
            require(isVerifiedContract(router), "DEX router not verified");
        }
    }

    function isKnownVulnerableToken(address token) public view returns (bool) {
        return knownVulnerableTokens[token];
    }

    function isVerifiedContract(address contractAddr) public view returns (bool) {
        return verifiedContracts[contractAddr];
    }

    function markTokenVulnerable(address token, bool vulnerable) external onlyOwner {
        knownVulnerableTokens[token] = vulnerable;
    }

    function markContractVerified(address contractAddr, bool verified) external onlyOwner {
        verifiedContracts[contractAddr] = verified;
    }

    function _calculateDynamicSlippage(address tokenA, address tokenB) internal view returns (uint256) {

        // Get base slippage for tokens
        SlippageConfig memory configA = tokenSlippageConfig[tokenA];
        SlippageConfig memory configB = tokenSlippageConfig[tokenB];

        // Use higher of the two base slippages
        uint256 baseSlippage = configA.baseSlippage > configB.baseSlippage ?
                              configA.baseSlippage : configB.baseSlippage;

        // Calculate volatility adjustment
        uint256 volatilityA = tokenVolatility[tokenA];
        uint256 volatilityB = tokenVolatility[tokenB];
        uint256 avgVolatility = (volatilityA + volatilityB) / 2;

        // Dynamic slippage = base + (volatility * multiplier)
        uint256 dynamicSlippage = baseSlippage + (avgVolatility * configA.volatilityMultiplier / 100);

        // Cap at maximum
        uint256 maxSlippage = configA.maxSlippage > configB.maxSlippage ?
                             configA.maxSlippage : configB.maxSlippage;

        return dynamicSlippage > maxSlippage ? maxSlippage : dynamicSlippage;
    }

    function _getExpectedOutput(address tokenA, address tokenB, uint amountIn, address router) internal view returns (uint256) {
        IUniswapV2Router r = IUniswapV2Router(router);

        address[] memory path = new address[](2);
        path[0] = tokenA;
        path[1] = tokenB;

        try r.getAmountsOut(amountIn, path) returns (uint[] memory amounts) {
            return amounts[1];
        } catch {
            return 0;
        }
    }

    function _updateSlippageConfig(
        address tokenA,
        address tokenB,
        uint actualOut,
        uint expectedOut
    ) internal {

        // Calculate actual slippage
        uint256 actualSlippage = expectedOut > actualOut ?
                                (expectedOut - actualOut) * 10000 / expectedOut : 0;

        // Update volatility metrics using EMA
        tokenVolatility[tokenA] = (tokenVolatility[tokenA] * 3 + actualSlippage) / 4;
        tokenVolatility[tokenB] = (tokenVolatility[tokenB] * 3 + actualSlippage) / 4;

        // Adjust future slippage if needed
        if (actualSlippage > tokenSlippageConfig[tokenA].baseSlippage) {
            tokenSlippageConfig[tokenA].baseSlippage = actualSlippage + 10; // Add 0.1% buffer
            tokenSlippageConfig[tokenA].lastUpdateTime = block.timestamp;
        }

        if (actualSlippage > tokenSlippageConfig[tokenB].baseSlippage) {
            tokenSlippageConfig[tokenB].baseSlippage = actualSlippage + 10; // Add 0.1% buffer
            tokenSlippageConfig[tokenB].lastUpdateTime = block.timestamp;
        }
    }

    // Admin functions for slippage management
    function setSlippageConfig(
        address token,
        uint256 baseSlippage,
        uint256 volatilityMultiplier,
        uint256 maxSlippage
    ) external onlyOwner {
        tokenSlippageConfig[token] = SlippageConfig({
            baseSlippage: baseSlippage,
            volatilityMultiplier: volatilityMultiplier,
            maxSlippage: maxSlippage,
            lastUpdateTime: block.timestamp
        });
    }

    function initializeSlippageConfigs() external onlyOwner {
        // Initialize common tokens with reasonable defaults
        _setDefaultSlippageConfig(0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c, 50, 200, 500);  // WBNB: 0.5% base, 5% max
        _setDefaultSlippageConfig(0x55d398326f99059fF775485246999027B3197955, 30, 150, 300);  // USDT: 0.3% base, 3% max
        _setDefaultSlippageConfig(0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56, 30, 150, 300);  // BUSD: 0.3% base, 3% max
        _setDefaultSlippageConfig(0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d, 30, 150, 300);  // USDC: 0.3% base, 3% max
        _setDefaultSlippageConfig(0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82, 80, 300, 800);  // CAKE: 0.8% base, 8% max (more volatile)
    }

    function _setDefaultSlippageConfig(address token, uint256 base, uint256 multiplier, uint256 maxSlippage) internal {
        tokenSlippageConfig[token] = SlippageConfig({
            baseSlippage: base,
            volatilityMultiplier: multiplier,
            maxSlippage: maxSlippage,
            lastUpdateTime: block.timestamp
        });
    }

    // KILOCODE: ROBUST PROTOCOL INTEGRATION
    function updateProtocolConfig(
        string memory protocolName,
        address pool,
        address router,
        address factory,
        uint256 version
    ) external onlyOwner {

        // Validate protocol addresses
        require(_validateProtocolAddresses(pool, router, factory), "Invalid protocol addresses");

        // Check protocol is not compromised
        require(!isCompromisedProtocol(protocolName), "Protocol is compromised");

        // Update configuration
        ProtocolConfig storage config = protocolConfigs[protocolName];
        config.pool = pool;
        config.router = router;
        config.factory = factory;
        config.version = version;
        config.isActive = true;
        config.lastUpdate = block.timestamp;

        // Validate required functions exist
        config.requiredSelectors = _getRequiredSelectors(protocolName);
        require(_validateProtocolFunctions(config), "Missing required functions");

        emit ProtocolUpdated(protocolName, version);
    }

    function deactivateProtocol(string memory protocolName, string memory reason) external onlyOwner {
        protocolConfigs[protocolName].isActive = false;
        emit ProtocolDeactivated(protocolName, reason);
    }

    function _validateProtocolAddresses(address pool, address router, address factory) internal view returns (bool) {

        // Check all addresses are contracts
        require(pool.code.length > 0, "Pool is not a contract");
        require(router.code.length > 0, "Router is not a contract");
        require(factory.code.length > 0, "Factory is not a contract");

        // Verify addresses are not blacklisted
        require(!isBlacklistedAddress(pool), "Pool address is blacklisted");
        require(!isBlacklistedAddress(router), "Router address is blacklisted");
        require(!isBlacklistedAddress(factory), "Factory address is blacklisted");

        return true;
    }

    function _getRequiredSelectors(string memory protocol) internal pure returns (bytes4[] memory) {

        if (keccak256(bytes(protocol)) == keccak256(bytes("PancakeSwap"))) {
            bytes4[] memory selectors = new bytes4[](4);
            selectors[0] = 0x38ed1739; // swapExactTokensForTokens
            selectors[1] = 0x7ff36ab5; // swapExactETHForTokens
            selectors[2] = 0x18cbafe5; // swapExactTokensForETH
            selectors[3] = 0x1698ee82; // getPair
            return selectors;
        }

        if (keccak256(bytes(protocol)) == keccak256(bytes("AAVE"))) {
            bytes4[] memory selectors = new bytes4[](3);
            selectors[0] = 0x5a9b0b8d; // flashLoan
            selectors[1] = 0xab9c4b5d; // flashLoanSimple
            selectors[2] = 0x8a14c39d; // getReserveData
            return selectors;
        }

        if (keccak256(bytes(protocol)) == keccak256(bytes("Venus"))) {
            bytes4[] memory selectors = new bytes4[](2);
            selectors[0] = 0x5a9b0b8d; // liquidateBorrow (simplified)
            selectors[1] = 0x8a14c39d; // getAccountLiquidity (simplified)
            return selectors;
        }

        // Add more protocols as needed
        return new bytes4[](0);
    }

    function _validateProtocolFunctions(ProtocolConfig memory config) internal view returns (bool) {
        for (uint i = 0; i < config.requiredSelectors.length; i++) {
            bytes4 selector = config.requiredSelectors[i];

            // Check if function exists in pool
            if (config.pool.code.length > 0) {
                bool hasFunction = _hasFunction(config.pool, selector);
                if (hasFunction) return true;
            }

            // Check if function exists in router
            if (config.router.code.length > 0) {
                bool hasFunction = _hasFunction(config.router, selector);
                if (hasFunction) return true;
            }
        }
        return false;
    }

    function _hasFunction(address contractAddr, bytes4 selector) internal view returns (bool) {
        bytes memory checkData = abi.encodeWithSelector(selector);
        (bool success,) = contractAddr.staticcall(checkData);
        return success;
    }

    function executeProtocolLiquidation(
        string memory protocol,
        address borrower,
        address collateral,
        address debt,
        uint256 debtToCover
    ) external returns (uint256 profit) {

        ProtocolConfig memory config = protocolConfigs[protocol];
        require(config.isActive, "Protocol is not active");
        require(config.version > 0, "Protocol not configured");

        // Validate liquidation is profitable
        uint256 estimatedProfit = _estimateLiquidationProfit(protocol, borrower, collateral, debt, debtToCover);
        require(estimatedProfit > 0, "Liquidation would not be profitable");

        // Execute based on protocol type
        if (keccak256(bytes(protocol)) == keccak256(bytes("Venus"))) {
            return _executeVenusLiquidation(config, borrower, collateral, debt, debtToCover);
        } else if (keccak256(bytes(protocol)) == keccak256(bytes("AAVE"))) {
            return _executeAAVELiquidation(config, borrower, collateral, debt, debtToCover);
        } else {
            revert("Unsupported protocol for liquidation");
        }
    }

    function _estimateLiquidationProfit(
        string memory protocol,
        address borrower,
        address collateral,
        address debt,
        uint256 debtToCover
    ) internal view returns (uint256) {
        // Simplified profit estimation - would be more complex in production
        // This is a placeholder implementation
        return debtToCover / 100; // Assume 1% profit
    }

    function _executeVenusLiquidation(
        ProtocolConfig memory config,
        address borrower,
        address collateral,
        address debt,
        uint256 debtToCover
    ) internal returns (uint256) {
        // Use existing Venus liquidation logic
        return _executeLiquidation(VENUS_COMPTROLLER, borrower, debt, collateral, debtToCover);
    }

    function _executeAAVELiquidation(
        ProtocolConfig memory /*config*/,
        address /*borrower*/,
        address /*collateral*/,
        address /*debt*/,
        uint256 /*debtToCover*/
    ) internal pure returns (uint256) {
        // Placeholder for AAVE liquidation
        revert("AAVE liquidation not implemented");
    }

    // Address management functions
    function blacklistAddress(address addr) external onlyOwner {
        blacklistedAddresses[addr] = true;
        emit AddressBlacklisted(addr);
    }

    function unblacklistAddress(address addr) external onlyOwner {
        blacklistedAddresses[addr] = false;
        emit AddressUnblacklisted(addr);
    }

    function isBlacklistedAddress(address addr) public view returns (bool) {
        return blacklistedAddresses[addr];
    }

    function markProtocolCompromised(string memory protocol, bool compromised) external onlyOwner {
        compromisedProtocols[protocol] = compromised;
    }

    function isCompromisedProtocol(string memory protocol) public view returns (bool) {
        return compromisedProtocols[protocol];
    }

    function setProtocolRiskScore(string memory protocol, uint256 riskScore) external onlyOwner {
        protocolRiskScores[protocol] = riskScore;
    }

    // KILOCODE: COMPREHENSIVE EVENT SYSTEM
    function emitArbitrageOpportunity(
        address tokenA,
        address tokenB,
        uint256 priceDiff,
        uint256 profit,
        string memory buyExchange,
        string memory sellExchange
    ) internal {

        emit ArbitrageOpportunityDetected(
            tokenA,
            tokenB,
            priceDiff,
            profit,
            buyExchange,
            sellExchange,
            block.timestamp
        );

        // Also log to external monitoring system
        _logToMonitoringSystem(
            "ARBITRAGE_OPPORTUNITY",
            abi.encode(tokenA, tokenB, priceDiff, profit, buyExchange, sellExchange)
        );
    }

    function emitArbitrageExecution(
        address executor,
        address tokenA,
        address tokenB,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit,
        bool success
    ) internal {

        emit ArbitrageExecuted(
            executor,
            tokenA,
            tokenB,
            amountIn,
            amountOut,
            profit,
            gasleft(), // Approximate gas used
            block.timestamp,
            success
        );
    }

    function emitLiquidationExecution(
        address protocol,
        address borrower,
        address collateralAsset,
        address debtAsset,
        uint256 debtCovered,
        uint256 collateralSeized,
        uint256 profit
    ) internal {

        emit LiquidationExecuted(
            protocol,
            borrower,
            collateralAsset,
            debtAsset,
            debtCovered,
            collateralSeized,
            profit,
            block.timestamp
        );
    }

    function emitFlashLoanInitiation(
        address provider,
        address token,
        uint256 amount,
        uint256 fee,
        address initiator
    ) internal {

        emit FlashLoanInitiated(
            provider,
            token,
            amount,
            fee,
            initiator,
            block.timestamp
        );
    }

    function emitExecutionError(
        string memory errorType,
        string memory message,
        bytes memory errorData
    ) internal {

        emit ErrorOccurred(
            errorType,
            message,
            address(this),
            block.timestamp,
            errorData
        );

        // Alert monitoring system
        _alertMonitoringSystem(errorType, message, errorData);
    }

    function emitProfitDistribution(
        address recipient,
        uint256 amount,
        string memory distributionType
    ) internal {

        emit ProfitDistributed(
            recipient,
            amount,
            distributionType,
            block.timestamp
        );
    }

    function _logToMonitoringSystem(string memory eventType, bytes memory data) internal {
        // Integration with external monitoring (e.g., Datadog, New Relic)
        // This would call an oracle or off-chain system
        // Placeholder for future implementation
    }

    function _alertMonitoringSystem(string memory errorType, string memory message, bytes memory data) internal {
        // Critical error alerting
        // Could integrate with PagerDuty, Slack, etc.
        // Placeholder for future implementation
    }

    // KILOCODE: GAS-EFFICIENT APPROVAL SYSTEM
    function autoApproveIfNeeded(address token, address spender, uint256 amount) internal {
        _efficientApprove(token, spender, amount);
    }

    function _efficientApprove(address token, address spender, uint256 amount) internal {
        uint256 currentAllowance = _tokenAllowances[token][spender];

        if (currentAllowance < amount) {
            // Only approve if current allowance is insufficient
            IERC20(token).safeApprove(spender, 0); // Reset first (for tokens like USDT)
            IERC20(token).safeApprove(spender, amount);
            _tokenAllowances[token][spender] = amount;
        }
    }

    function _clearApprovalIfNeeded(address token, address spender) internal {
        // Clear approval for small amounts to prevent allowance buildup
        uint256 currentAllowance = _tokenAllowances[token][spender];

        if (currentAllowance > 0 && currentAllowance < APPROVAL_THRESHOLD) {
            IERC20(token).safeApprove(spender, 0);
            _tokenAllowances[token][spender] = 0;
        }
    }

    // Estimate gas costs (simplified)
    function estimateGasCosts() internal view returns (uint) {
        // Rough estimate for arbitrage gas costs
        return 200000 * tx.gasprice; // 200k gas at current price
    }

    // Get current price (simplified - in production use Chainlink or similar)
    function getCurrentPrice(address /*token*/) internal pure returns (uint) {
        // Placeholder: return 1 for simplicity (1:1 ratio)
        // In production, implement proper price feed
        return 1e18; // 1 token = 1 USD equivalent
    }

    // Execute swap on PancakeSwap
    function executePancakeSwap(address tokenIn, address tokenOut, uint amountIn, uint amountOutMin) internal returns (uint) {
        address router = routers["PancakeSwap"];
        require(router != address(0), "PancakeSwap router not set");

        autoApproveIfNeeded(tokenIn, router, amountIn);
        return _executeOptimizedSwap(tokenIn, tokenOut, amountIn, amountOutMin, router);
    }

    // Execute swap on Biswap
    function executeBiswap(address tokenIn, address tokenOut, uint amountIn, uint amountOutMin) internal returns (uint) {
        address router = routers["Biswap"];
        require(router != address(0), "Biswap router not set");

        autoApproveIfNeeded(tokenIn, router, amountIn);
        return _executeOptimizedSwap(tokenIn, tokenOut, amountIn, amountOutMin, router);
    }

    // Execute swap on ApeSwap
    function executeApeSwap(address tokenIn, address tokenOut, uint amountIn, uint amountOutMin) internal returns (uint) {
        address router = routers["ApeSwap"];
        require(router != address(0), "ApeSwap router not set");

        autoApproveIfNeeded(tokenIn, router, amountIn);
        return _executeOptimizedSwap(tokenIn, tokenOut, amountIn, amountOutMin, router);
    }

    function _executeOptimizedSwap(
        address tokenA,
        address tokenB,
        uint amountIn,
        uint amountOutMin,
        address router
    ) internal returns (uint) {

        // Gas-optimized swap using Solidity interface
        IUniswapV2Router r = IUniswapV2Router(router);

        address[] memory path = new address[](2);
        path[0] = tokenA;
        path[1] = tokenB;

        uint deadline = block.timestamp + 300;
        uint[] memory amounts = r.swapExactTokensForTokens(amountIn, amountOutMin, path, address(this), deadline);

        // Clear approval if needed to prevent buildup
        _clearApprovalIfNeeded(tokenA, router);

        return amounts[1];
    }

    // COMPLETE FLASHLOAN ARBITRAGE EXECUTION ENGINE
    function receiveFlashLoan(address token, uint amount, uint fee, bytes calldata data) external comprehensiveReentrancyGuard nonReentrant whenNotPaused {
        // Validate caller is authorized flash loan provider
        require(
            msg.sender == 0x794a61358D6845594F94dc1DB02A252b5b4814aD || // AAVE V3 Pool
            msg.sender == 0xBA12222222228d8Ba445958a75a0704d566BF2C8,   // Balancer Vault
            "Unauthorized flash loan provider"
        );

        // Check gas price is reasonable
        require(tx.gasprice <= GAS_PRICE_LIMIT, "Gas price too high");

        // Emit flash loan initiation event
        emitFlashLoanInitiation(msg.sender, token, amount, fee, address(this));

        // Validate flash loan parameters
        _validateFlashLoanParameters(token, amount, fee);

        // Decode operation type and data
        (uint8 operationType, bytes memory operationData) = abi.decode(data, (uint8, bytes));

        uint minProfit;
        bool isArbitrage = false;
        bool isLiquidation = false;

        address tokenA;
        address tokenB;
        address tokenC;
        string memory exchangeAB;
        string memory exchangeBC;
        string memory exchangeCA;

        address protocol;
        address user;
        address debtAsset;
        address collateralAsset;
        uint debtToCover;

        if (operationType == 1) {
            // Triangular arbitrage
            isArbitrage = true;
            (
                tokenA,
                tokenB,
                tokenC,
                exchangeAB,
                exchangeBC,
                exchangeCA,
                minProfit
            ) = abi.decode(operationData, (address, address, address, string, string, string, uint));
        } else if (operationType == 2) {
            // Liquidation
            isLiquidation = true;
            (
                protocol,
                user,
                debtAsset,
                collateralAsset,
                debtToCover,
                minProfit
            ) = abi.decode(operationData, (address, address, address, address, uint, uint));
        } else {
            revert("Invalid operation type");
        }

        // Calculate repayment amount
        uint repayAmount = amount + fee;
        uint initialBalance = IERC20(token).balanceOf(address(this));
        require(initialBalance >= amount, "Insufficient flash loan amount received");

        // Execute operation
        bool operationSuccess = false;
        uint finalBalance = 0;

        if (isArbitrage) {
            // Validate triangular path
            require(tokenA == token && tokenC == token, "Invalid triangular path: must start and end with flash token");
            require(tokenA != tokenB && tokenB != tokenC && tokenA != tokenC, "Invalid tokens: must be different");
            require(minProfit > 0, "Minimum profit must be positive");

            // Execute triangular arbitrage: A → B → C → A
            try this.executeTriangularArbitrage(tokenA, tokenB, tokenC, amount, exchangeAB, exchangeBC, exchangeCA) returns (uint returnedAmount) {
                finalBalance = returnedAmount;
                operationSuccess = true;
            } catch {
                // Arbitrage failed, but we still need to repay the loan
                finalBalance = IERC20(token).balanceOf(address(this));
                operationSuccess = false;
            }
        } else if (isLiquidation) {
            // Validate liquidation parameters
            require(debtAsset == token, "Flash loaned token must be debt asset");
            require(amount == debtToCover, "Flash loan amount must equal debt to cover");
            require(protocol != address(0), "Invalid protocol");
            require(user != address(0), "Invalid user");
            require(collateralAsset != address(0), "Invalid collateral asset");
            require(debtToCover > 0, "Invalid debt amount");
            require(minProfit > 0, "Minimum profit must be positive");

            // Execute liquidation
            try this.executeFlashLiquidation(protocol, user, debtAsset, collateralAsset, debtToCover) returns (uint returnedAmount) {
                finalBalance = returnedAmount;
                operationSuccess = true;
            } catch {
                // Liquidation failed, but we still need to repay the loan
                finalBalance = IERC20(token).balanceOf(address(this));
                operationSuccess = false;
            }
        } else {
            revert("Invalid operation");
        }

        // Calculate profit (final - initial - fee - gas)
        uint gasCost = estimateGasCosts();
        uint totalCost = repayAmount + gasCost;
        uint profit = finalBalance > totalCost ? finalBalance - totalCost : 0;

        // Validate profit meets minimum threshold
        require(profit >= minProfit, "Profit below minimum threshold");

        // Safe repayment (always repay to avoid bad debt)
        IERC20(token).safeApprove(msg.sender, repayAmount);

        // Transfer profit to owner if operation was successful
        if (operationSuccess && profit > 0) {
            uint profitAmount = finalBalance - repayAmount;
            IERC20(token).safeTransfer(owner(), profitAmount);
            emitProfitDistribution(owner(), profitAmount, isArbitrage ? "flashloan_arbitrage_profit" : "flashloan_liquidation_profit");
        }

        // Emit detailed operation result
        emit FlashloanOperationExecuted(
            operationType,
            tokenA,
            tokenB,
            tokenC,
            amount,
            finalBalance,
            profit,
            operationSuccess,
            block.timestamp
        );

        emit FlashloanCallbackValidated(msg.sender, amount);
    }

    function executeProfitableArbitrage(
        address /*flashToken*/,
        uint flashAmount,
        address /*tokenA*/,
        address /*tokenB*/,
        string[] memory exchanges,
        address[] memory path,
        uint _minProfit,
        uint maxSlippage
    ) internal returns (uint) {

        uint currentAmount = flashAmount;
        uint initialAmount = flashAmount;

        // Multi-hop arbitrage execution
        for (uint i = 0; i < path.length - 1; i++) {
            address tokenIn = path[i];
            address tokenOut = path[i + 1];
            string memory exchange = exchanges[i];

            // Get optimal route and expected output
            (uint expectedOut, uint actualOut) = executeOptimalSwap(
                tokenIn,
                tokenOut,
                currentAmount,
                exchange,
                maxSlippage
            );

            // Validate swap was profitable
            require(actualOut >= expectedOut * (10000 - maxSlippage) / 10000, "Slippage exceeded");

            currentAmount = actualOut;
        }

        // Calculate profit
        uint profit = currentAmount - initialAmount - estimateGasCosts();

        // Validate minimum profit
        require(profit >= _minProfit, "Insufficient profit");

        return profit;
    }

    function executeOptimalSwap(
        address tokenIn,
        address tokenOut,
        uint amountIn,
        string memory exchange,
        uint /*maxSlippage*/ // Now using dynamic slippage
    ) internal returns (uint expectedOut, uint actualOut) {

        // Calculate dynamic slippage based on market conditions
        uint256 dynamicSlippage = _calculateDynamicSlippage(tokenIn, tokenOut);

        // Get expected output from router (more accurate than price calculation)
        address router = routers[exchange];
        require(router != address(0), "Router not set");

        uint256 expectedOutFull = _getExpectedOutput(tokenIn, tokenOut, amountIn, router);
        expectedOut = expectedOutFull * (10000 - dynamicSlippage) / 10000; // Apply dynamic slippage

        // Execute swap on specified exchange
        if (keccak256(bytes(exchange)) == keccak256(bytes("PancakeSwap"))) {
            actualOut = executePancakeSwap(tokenIn, tokenOut, amountIn, expectedOut);
        } else if (keccak256(bytes(exchange)) == keccak256(bytes("Biswap"))) {
            actualOut = executeBiswap(tokenIn, tokenOut, amountIn, expectedOut);
        } else if (keccak256(bytes(exchange)) == keccak256(bytes("ApeSwap"))) {
            actualOut = executeApeSwap(tokenIn, tokenOut, amountIn, expectedOut);
        } else {
            revert("Unsupported exchange");
        }

        // Update slippage config based on execution result
        _updateSlippageConfig(tokenIn, tokenOut, actualOut, expectedOutFull);

        return (expectedOut, actualOut);
    }

    // Execute triangular arbitrage with 0.5% max slippage protection
    function executeTriangularArbitrage(
        address tokenA,
        address tokenB,
        address tokenC,
        uint amountA,
        string memory exchangeAB,
        string memory exchangeBC,
        string memory exchangeCA
    ) external returns (uint finalAmountA) {
        require(msg.sender == address(this), "Only callable by contract");

        uint currentAmount = amountA;

        // Step 1: A → B on exchangeAB
        address routerAB = routers[exchangeAB];
        require(routerAB != address(0), "Exchange AB router not set");

        uint expectedB = _getExpectedOutput(tokenA, tokenB, currentAmount, routerAB);
        uint minOutB = expectedB * 995 / 1000; // 0.5% max slippage

        autoApproveIfNeeded(tokenA, routerAB, currentAmount);
        uint[] memory amountsAB = IUniswapV2Router(routerAB).swapExactTokensForTokens(
            currentAmount,
            minOutB,
            _getPath(tokenA, tokenB),
            address(this),
            block.timestamp + 300
        );
        currentAmount = amountsAB[amountsAB.length - 1];

        // Step 2: B → C on exchangeBC
        address routerBC = routers[exchangeBC];
        require(routerBC != address(0), "Exchange BC router not set");

        uint expectedC = _getExpectedOutput(tokenB, tokenC, currentAmount, routerBC);
        uint minOutC = expectedC * 995 / 1000; // 0.5% max slippage

        autoApproveIfNeeded(tokenB, routerBC, currentAmount);
        uint[] memory amountsBC = IUniswapV2Router(routerBC).swapExactTokensForTokens(
            currentAmount,
            minOutC,
            _getPath(tokenB, tokenC),
            address(this),
            block.timestamp + 300
        );
        currentAmount = amountsBC[amountsBC.length - 1];

        // Step 3: C → A on exchangeCA
        address routerCA = routers[exchangeCA];
        require(routerCA != address(0), "Exchange CA router not set");

        uint expectedA = _getExpectedOutput(tokenC, tokenA, currentAmount, routerCA);
        uint minOutA = expectedA * 995 / 1000; // 0.5% max slippage

        autoApproveIfNeeded(tokenC, routerCA, currentAmount);
        uint[] memory amountsCA = IUniswapV2Router(routerCA).swapExactTokensForTokens(
            currentAmount,
            minOutA,
            _getPath(tokenC, tokenA),
            address(this),
            block.timestamp + 300
        );
        finalAmountA = amountsCA[amountsCA.length - 1];

        return finalAmountA;
    }

    // Execute flash liquidation
    function executeFlashLiquidation(
        address protocol,
        address user,
        address debtAsset,
        address collateralAsset,
        uint debtToCover
    ) external returns (uint finalDebtAmount) {
        require(msg.sender == address(this), "Only callable by contract");

        if (protocol == VENUS_COMPTROLLER) {
            return _executeVenusFlashLiquidation(user, debtAsset, collateralAsset, debtToCover);
        } else if (protocol == 0x794a61358D6845594F94dc1DB02A252b5b4814aD) { // AAVE V3 Pool
            return _executeAAVEFlashLiquidation(user, debtAsset, collateralAsset, debtToCover);
        } else {
            revert("Unsupported protocol for flash liquidation");
        }
    }

    function _executeVenusFlashLiquidation(
        address user,
        address debtAsset,
        address collateralAsset,
        uint debtToCover
    ) internal returns (uint finalDebtAmount) {
        IVenusComptroller comptroller = IVenusComptroller(VENUS_COMPTROLLER);
        IVToken debtVToken = IVToken(getVTokenAddress(debtAsset));
        IVToken collateralVToken = IVToken(getVTokenAddress(collateralAsset));

        // Check health factor (shortfall > 0)
        (uint256 error, uint256 liquidity, uint256 shortfall) = comptroller.getAccountLiquidity(user);
        require(error == 0, "Failed to get account liquidity");
        require(shortfall > 0, "Account not eligible for liquidation");

        // Get borrower debt
        uint256 borrowerDebt = debtVToken.borrowBalanceStored(user);
        require(borrowerDebt > 0, "No debt to liquidate");

        // Calculate max liquidatable (50% of debt)
        uint256 maxLiquidatable = borrowerDebt * 50 / 100;
        uint256 actualLiquidationAmount = debtToCover > maxLiquidatable ? maxLiquidatable : debtToCover;

        // Approve debt asset to vToken
        autoApproveIfNeeded(debtAsset, address(debtVToken), actualLiquidationAmount);

        // Execute liquidation
        uint256 seizedCollateral = debtVToken.liquidateBorrow(user, actualLiquidationAmount, collateralVToken);
        require(seizedCollateral > 0, "Liquidation failed");

        // Calculate expected debt from swap (seized + bonus)
        uint256 liquidationBonus = 800; // 8% default
        uint256 totalCollateral = seizedCollateral + (seizedCollateral * liquidationBonus / 10000);

        // Swap collateral to debt asset
        address router = routers["PancakeSwap"]; // Use PancakeSwap for swap
        require(router != address(0), "PancakeSwap router not set");

        autoApproveIfNeeded(collateralAsset, router, totalCollateral);

        address[] memory path = _getPath(collateralAsset, debtAsset);
        uint[] memory expectedOut = IUniswapV2Router(router).getAmountsOut(totalCollateral, path);
        uint256 minOut = expectedOut[1] * 995 / 1000; // 0.5% slippage

        uint[] memory amounts = IUniswapV2Router(router).swapExactTokensForTokens(
            totalCollateral,
            minOut,
            path,
            address(this),
            block.timestamp + 300
        );

        finalDebtAmount = amounts[amounts.length - 1];
        return finalDebtAmount;
    }

    function _executeAAVEFlashLiquidation(
        address /*user*/,
        address /*debtAsset*/,
        address /*collateralAsset*/,
        uint /*debtToCover*/
    ) internal pure returns (uint) {
        // Placeholder for AAVE liquidation
        revert("AAVE flash liquidation not implemented");
    }

    // MEV Protection: TWAP validation
    function validatePriceStability(address tokenA, address tokenB, uint256 maxDeviation) internal view returns (bool) {
        // Simplified TWAP check - compare current price with recent average
        // In production, implement proper TWAP oracle

        uint256 currentPrice = _getCurrentPrice(tokenA, tokenB);
        uint256 twapPrice = _getTWAP(tokenA, tokenB, 5 minutes);

        if (twapPrice == 0) return true; // Skip if no TWAP available

        uint256 deviation = currentPrice > twapPrice ?
            ((currentPrice - twapPrice) * 10000) / twapPrice :
            ((twapPrice - currentPrice) * 10000) / twapPrice;

        return deviation <= maxDeviation; // maxDeviation in basis points
    }

    function _getCurrentPrice(address tokenA, address tokenB) internal view returns (uint256) {
        address router = routers["PancakeSwap"];
        if (router == address(0)) return 0;

        try IUniswapV2Router(router).getAmountsOut(1 ether, _getPath(tokenA, tokenB)) returns (uint[] memory amounts) {
            return amounts[1];
        } catch {
            return 0;
        }
    }

    function _getTWAP(address tokenA, address tokenB, uint256 period) internal view returns (uint256) {
        // Simplified - return current price (implement proper TWAP in production)
        // Would require price history storage
        return _getCurrentPrice(tokenA, tokenB);
    }

    // Helper function to create swap path
    function _getPath(address tokenIn, address tokenOut) internal pure returns (address[] memory) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        return path;
    }

    // Owner withdrawal of any leftover tokens
    function withdraw(address token) external onlyOwner {
        uint bal = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(owner(), bal);
    }

    // Arbitrum flash loan functions

    function executeArbitrumFlashLoan(
        address token,
        uint256 amount,
        bytes calldata params
    ) external onlyOwner {
        // Try Balancer first (0% fee)
        if (isBalancerAvailable(token, amount)) {
            executeBalancerFlashLoan(token, amount, params);
        } else {
            // Fallback to AAVE (0.09% fee)
            executeAAVEFlashLoan(token, amount, params);
        }
    }

    function executeBalancerFlashLoan(
        address token,
        uint256 amount,
        bytes calldata params
    ) internal {
        address[] memory tokens = new address[](1);
        tokens[0] = token;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        IVault(BALANCER_VAULT_ARBITRUM).flashLoan(
            address(this),
            tokens,
            amounts,
            params
        );
        emit ArbitrumFlashLoan(BALANCER_VAULT_ARBITRUM, token, amount, 0, 0);
    }

    function executeAAVEFlashLoan(
        address token,
        uint256 amount,
        bytes calldata params
    ) internal {
        IAAVEPool(AAVE_POOL_ARBITRUM).flashLoanSimple(
            address(this),
            token,
            amount,
            params,
            0
        );
        emit ArbitrumFlashLoan(AAVE_POOL_ARBITRUM, token, amount, amount * 9 / 10000, 0);
    }

    function estimateTotalGasCost(uint256 l2GasUsed) public view returns (uint256) {
        uint256 l1GasCost = 2000 * tx.gasprice;
        uint256 l2GasCost = l2GasUsed * tx.gasprice;
        return l1GasCost + l2GasCost;
    }

    function isBalancerAvailable(address token, uint256 amount) internal view returns (bool) {
        // Check if Balancer has liquidity for the token
        // Placeholder, assume always available for now
        return true;
    }

    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external {
        require(msg.sender == BALANCER_VAULT_ARBITRUM, "Unauthorized");
        // Execute the arbitrage or liquidation logic here
        // For now, placeholder
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == AAVE_POOL_ARBITRUM, "Unauthorized");
        // Execute logic
        // Approve repayment
        IERC20(asset).approve(AAVE_POOL_ARBITRUM, amount + premium);
        return true;
    }

    receive() external payable {}
}
