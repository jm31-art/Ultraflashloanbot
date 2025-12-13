export async function simulateTriangular(router, path, amountIn) {
  try {
    const a1 = await router.getAmountsOut(amountIn, [path[0], path[1]]);
    const a2 = await router.getAmountsOut(a1[1], [path[1], path[2]]);
    const a3 = await router.getAmountsOut(a2[1], [path[2], path[0]]);

    return {
      finalOut: a3[1],
      hops: [a1, a2, a3]
    };
  } catch {
    return null;
  }
}