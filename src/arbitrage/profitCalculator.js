export function calculateProfit(
  amountIn,
  finalOut,
  gasCostWei,
  tokenPriceUsd
) {
  // Ensure all values are BigInts for comparison
  const amountInBigInt = BigInt(amountIn.toString());
  const finalOutBigInt = BigInt(finalOut.toString());

  if (finalOutBigInt <= amountInBigInt) return null;

  const profitTokens = finalOutBigInt - amountInBigInt;

  const profitUsd =
    (Number(profitTokens.toString()) / 1e18) * tokenPriceUsd;

  const gasUsd =
    (Number(gasCostWei.toString()) / 1e18) * tokenPriceUsd;

  return {
    profitTokens,
    profitUsd: profitUsd - gasUsd,
    gasUsd
  };
}