/**
 * Flashloan provider configurations for BSC
 * Safe aggregation - one provider per trade only
 */

export const FLASHLOAN_PROVIDERS = {
  AAVE_V3: {
    name: "Aave v3",
    maxLoanUsd: 500000,
    feeBps: 5, // 0.05%
    contractAddress: "0x6807dc923806fE8Fd134338EABCA509979a7e2205",
    supportedAssets: [
      "0x55d398326f99059fF775485246999027B3197955", // USDT
      "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", // BUSD
      "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
      "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC
      "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c"  // BTCB
    ]
  },
  VENUS: {
    name: "Venus",
    maxLoanUsd: 300000,
    feeBps: 5, // 0.05%
    contractAddress: "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D", // Venus Pool
    supportedAssets: [
      "0x55d398326f99059fF775485246999027B3197955", // USDT
      "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", // BUSD
      "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"  // WBNB
    ]
  },
  RADIANT: {
    name: "Radiant",
    maxLoanUsd: 200000,
    feeBps: 9, // 0.09%
    contractAddress: "0x0aDb5F486f9aD04a0a3A5c1b4Ef4b6b2b0b0b0b0", // Placeholder - Radiant BSC pool
    supportedAssets: [
      "0x55d398326f99059fF775485246999027B3197955", // USDT
      "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", // BUSD
      "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"  // USDC
    ]
  }
};

/**
 * Get best flashloan provider for asset and amount
 */
export function getBestProvider(asset, amountUsd) {
  const providers = Object.values(FLASHLOAN_PROVIDERS);

  // Filter providers that support the asset and can handle the amount
  const eligibleProviders = providers.filter(provider =>
    provider.supportedAssets.includes(asset.toLowerCase()) &&
    amountUsd <= provider.maxLoanUsd
  );

  if (eligibleProviders.length === 0) {
    return null;
  }

  // Return provider with lowest fee (simplified selection)
  return eligibleProviders.reduce((best, current) =>
    current.feeBps < best.feeBps ? current : best
  );
}

/**
 * Check if asset is supported by any provider
 */
export function isAssetSupported(asset) {
  return Object.values(FLASHLOAN_PROVIDERS).some(provider =>
    provider.supportedAssets.includes(asset.toLowerCase())
  );
}

/**
 * Calculate flashloan fee for provider
 */
export function calculateFee(provider, amount) {
  return (amount * BigInt(provider.feeBps)) / 10000n;
}