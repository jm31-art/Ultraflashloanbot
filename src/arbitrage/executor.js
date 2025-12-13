import { executeFlashloanArbitrage } from "../flashloan/flashloanExecutor.js";

export async function executeArbitrage(
  router,
  signer,
  path,
  amountIn,
  flashloanContractAddress,
  extremeMode = false
) {
  if (extremeMode && flashloanContractAddress) {
    // Use flashloan execution
    return executeFlashloanArbitrage({
      asset: path[0],
      amountWei: amountIn,
      router: router.target,
      path: path,
      flashloanContractAddress,
      signer
    });
  } else {
    // Fallback to direct wallet execution (not recommended for production)
    console.log("⚠️ Using direct wallet execution (not recommended)");
    const deadline = Math.floor(Date.now() / 1000) + 30;

    return router
      .connect(signer)
      .swapExactTokensForTokens(
        amountIn,
        0,
        [...path, path[0]],
        signer.address,
        deadline
      );
  }
}