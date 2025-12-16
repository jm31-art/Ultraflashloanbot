import { ethers } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load ABI
const RouterABI = JSON.parse(readFileSync(join(__dirname, "abi/IUniswapV2Router02.json"), "utf8"));

// PRIVATE BSC RPC: Use dedicated endpoint to eliminate rate limits
// Supports higher RPS limits and dedicated infrastructure
const BSC_RPC_URL = process.env.RPC_URL || "https://bsc-mainnet.nodereal.io/v1/YOUR_API_KEY" ||
                    "https://bsc-dataseed1.binance.org/" || // Fallback to Binance if no private key
                    "https://bsc-dataseed.binance.org/";    // Ultimate fallback

console.log(`🔗 Using BSC RPC: ${BSC_RPC_URL.replace(/\/v1\/[^\/]+/, '/v1/[API_KEY]')}`); // Hide API key in logs

const provider = new ethers.JsonRpcProvider(BSC_RPC_URL, undefined, {
  // Higher timeout for private RPC stability
  timeout: 30000,
  // Enable batching for better performance
  batchMaxCount: 100,
  batchMaxDelay: 10
});

// Real BSC DEX router addresses
export const ROUTERS = {
  PANCAKESWAP: new ethers.Contract(
    "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    RouterABI,
    provider
  ),
  APESWAP: new ethers.Contract(
    "0xC0788A3aD43d79aa53B09c2EaCc313A787d1d607",
    RouterABI,
    provider
  ),
  SUSHISWAP: new ethers.Contract(
    "0x1b02da8cb0d097eb8d57a175b88c7d8b47997506",
    RouterABI,
    provider
  )
};

export { provider };