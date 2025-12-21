import { ethers } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import rpcManager from "../../infra/RPCManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load ABI
const RouterABI = JSON.parse(readFileSync(join(__dirname, "abi/IUniswapV2Router02.json"), "utf8"));

// SINGLE PROVIDER SOURCE OF TRUTH - No direct JsonRpcProvider calls allowed
const provider = rpcManager.getReadProvider();

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