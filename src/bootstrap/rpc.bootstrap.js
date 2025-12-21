/**
 * RPC BOOTSTRAP - Initialize RPC infrastructure before any other modules
 * This ensures RPCManager is ready before any provider-dependent code runs
 */

import rpcManager from "../../infra/RPCManager.js";

export async function initRPC() {
  console.log('🔧 Initializing RPC infrastructure...');

  try {
    // Initialize the SINGLE RPC MANAGER source of truth
    rpcManager.initialize();

    console.log('✅ RPC infrastructure initialized successfully');
    return true;

  } catch (error) {
    console.error('❌ RPC initialization failed:', error.message);
    throw error;
  }
}