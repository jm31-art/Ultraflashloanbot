/**
 * Block-based scheduler for EXTREME MODE execution
 * Prevents continuous scanning, runs deterministically once per block or every N blocks
 */

export function shouldRunExtremeMode({
  currentBlock,
  lastRunBlock,
  interval = 1
}) {
  if (!lastRunBlock) return true; // First run
  return currentBlock - lastRunBlock >= interval;
}

/**
 * Get current block number safely
 */
export async function getCurrentBlock(provider) {
  try {
    return await provider.getBlockNumber();
  } catch (error) {
    console.error("Failed to get current block:", error);
    return null;
  }
}

/**
 * Check if enough blocks have passed since last EXTREME MODE run
 */
export function hasBlockIntervalPassed(currentBlock, lastExtremeBlock, interval = 1) {
  if (!lastExtremeBlock) return true;
  return currentBlock >= lastExtremeBlock + interval;
}