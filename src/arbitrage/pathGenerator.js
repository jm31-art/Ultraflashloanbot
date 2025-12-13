// BSC Token addresses
const TOKENS = {
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  USDT: "0x55d398326f99059fF775485246999027B3197955",
  USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c"
};

export function generateTriangularPaths() {
  const tokenAddresses = Object.values(TOKENS);
  const paths = [];

  for (let i = 0; i < tokenAddresses.length; i++) {
    for (let j = 0; j < tokenAddresses.length; j++) {
      for (let k = 0; k < tokenAddresses.length; k++) {
        if (i !== j && j !== k && i !== k) {
          paths.push([tokenAddresses[i], tokenAddresses[j], tokenAddresses[k]]);
        }
      }
    }
  }

  return paths;
}

export { TOKENS };