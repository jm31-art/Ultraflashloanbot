const { ethers } = require('ethers');
const fs = require('fs');

async function calculateOptimalTradeAmount(flashloanArb, tokenIn, tokenOut, dexBuy, dexSell) {
    // Load production config for safe amounts
    const productionConfig = JSON.parse(fs.readFileSync('./config/production.json', 'utf8'));
    const tokenSymbol = getTokenSymbol(tokenIn);

    // Get safe amount limits from config
    const safeConfig = productionConfig.safeTradeAmounts[tokenSymbol] || {
        maxSafeAmount: ethers.parseEther('1').toString(), // Default 1 ETH equivalent
        slippageThreshold: 0.005,
        liquidityRatio: 0.1
    };

    // Get liquidity from DODO pool
    const dodoLiquidity = await flashloanArb.getLiquidity(tokenIn);

    // Get DEX liquidity
    const buyDexLiquidity = await getDexLiquidity(dexBuy, tokenIn, tokenOut);
    const sellDexLiquidity = await getDexLiquidity(dexSell, tokenIn, tokenOut);

    // Calculate safe amount based on liquidity ratios
    const liquidityBasedAmount = ethers.BigNumber.from(
        Math.min(
            dodoLiquidity.toString(),
            buyDexLiquidity.toString(),
            sellDexLiquidity.toString()
        )
    ).mul(Math.floor(safeConfig.liquidityRatio * 100)).div(100);

    // Apply slippage safety factor
    const slippageSafeAmount = ethers.BigNumber.from(safeConfig.maxSafeAmount)
        .mul(Math.floor((1 - safeConfig.slippageThreshold) * 100))
        .div(100);

    // Use the minimum of all safety limits
    const maxSafeAmount = liquidityBasedAmount.lt(slippageSafeAmount) ?
        liquidityBasedAmount : slippageSafeAmount;

    // Get current token prices
    const buyPrice = await getDexPrice(dexBuy, tokenIn, tokenOut);
    const sellPrice = await getDexPrice(dexSell, tokenIn, tokenOut);

    // Calculate optimal amount based on price difference and fees
    const priceDiff = Math.abs(sellPrice - buyPrice);
    const fees = await calculateTotalFees(flashloanArb, tokenIn, maxSafeAmount);

    // Ensure profit covers fees with a safety margin
    const minProfit = fees.mul(150).div(100); // Require 50% more than fees for safety
    const optimalAmount = maxSafeAmount.mul(priceDiff).div(buyPrice);

    // Return the smaller of maxSafeAmount and optimalAmount
    return optimalAmount.lt(maxSafeAmount) ? optimalAmount : maxSafeAmount;
}

async function getDexLiquidity(dex, tokenIn, tokenOut) {
    // Implementation to get DEX liquidity
    // This should query the specific DEX's contracts
    return ethers.constants.MaxUint256; // Placeholder
}

async function calculateTotalFees(flashloanArb, token, amount) {
    // Get DODO flash loan fee
    const flashLoanFee = await flashloanArb.getFlashLoanFee(token, amount);
    
    // Estimate gas fees (can be adjusted based on network conditions)
    const gasPrice = await ethers.provider.getGasPrice();
    const estimatedGas = ethers.BigNumber.from(500000); // Estimated gas used
    const gasFee = gasPrice.mul(estimatedGas);
    
    // Add DEX fees (usually 0.3% per swap)
    const dexFees = amount.mul(6).div(1000); // 0.6% for two swaps
    
    return flashLoanFee.add(gasFee).add(dexFees);
}

async function getDexPrice(dex, tokenIn, tokenOut) {
    // Implementation to get current price from DEX
    // This should query the specific DEX's contracts
    return 0; // Placeholder
}

function getTokenAddress(symbol) {
    const addresses = {
        'WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        'USDT': '0x55d398326f99059fF775485246999027B3197955',
        'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        'ETH': '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
        'BTC': '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c'
    };
    return addresses[symbol];
}

function getTokenSymbol(tokenAddress) {
    const symbols = {
        '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c': 'WBNB',
        '0x55d398326f99059fF775485246999027B3197955': 'USDT',
        '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d': 'USDC',
        '0x2170Ed0880ac9A755fd29B2688956BD959F933F8': 'ETH',
        '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c': 'BTC'
    };
    return symbols[tokenAddress.toLowerCase()] || 'UNKNOWN';
}

module.exports = {
    calculateOptimalTradeAmount,
    getDexLiquidity,
    calculateTotalFees,
    getDexPrice,
    getTokenAddress
};
