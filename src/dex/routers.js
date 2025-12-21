import { ethers } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import rpcManager, { isRPCInitialized } from "../../infra/RPCManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load ABI
const RouterABI = JSON.parse(readFileSync(join(__dirname, "abi/IUniswapV2Router02.json"), "utf8"));

// LAZY-INITIALIZED PROVIDER AND ROUTERS
let _provider = null;
let _routers = null;

const getProvider = () => {
  if (!_provider) {
    if (!isRPCInitialized()) {
      throw new Error('❌ RPC infrastructure not initialized - call initRPC() first');
    }
    _provider = rpcManager.getReadProvider();
  }
  return _provider;
};

const getROUTERS = () => {
  if (!_routers) {
    const provider = getProvider();
    _routers = {
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
  }
  return _routers;
};

// Export getters for lazy initialization
export { getProvider as provider, getROUTERS as ROUTERS };