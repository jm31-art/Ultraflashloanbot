export async function executeArbitrage(
  router,
  signer,
  path,
  amountIn
) {
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