/**
 * Private relay / MEV protection for BSC
 * Eliminates mempool risk by using private RPC endpoints
 */

import { ethers } from "ethers";

/**
 * Submit transaction via private relay
 * Mandatory for all arbitrage executions
 */
export async function submitPrivateTx(tx, provider) {
  // Check for private RPC configuration
  const privateRpc = process.env.BSC_PRIVATE_RPC || process.env.NODEREAL_RPC;

  if (!privateRpc) {
    throw new Error("Private relay required - BSC_PRIVATE_RPC or NODEREAL_RPC not configured");
  }

  try {
    // Create private provider
    const privateProvider = new ethers.JsonRpcProvider(privateRpc);

    // Sign the transaction
    const signedTx = await provider.signTransaction(tx);

    // Submit via private relay
    const txHash = await privateProvider.send("eth_sendRawTransaction", [signedTx]);

    return {
      hash: txHash,
      privateRelay: true,
      provider: privateRpc
    };

  } catch (error) {
    console.error("Private relay submission failed:", error);
    throw new Error(`Private relay unavailable: ${error.message}`);
  }
}

/**
 * Check if private relay is available
 */
export async function isPrivateRelayAvailable() {
  const privateRpc = process.env.BSC_PRIVATE_RPC || process.env.NODEREAL_RPC;

  if (!privateRpc) {
    return false;
  }

  try {
    const provider = new ethers.JsonRpcProvider(privateRpc);
    await provider.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get private relay status for logging
 */
export function getPrivateRelayStatus() {
  const privateRpc = process.env.BSC_PRIVATE_RPC || process.env.NODEREAL_RPC;

  return {
    available: !!privateRpc,
    endpoint: privateRpc ? privateRpc.replace(/\/.*@/, '/***:***@') : null, // Hide credentials
    type: privateRpc?.includes('nodereal') ? 'Nodereal' : 'Custom'
  };
}