import Moralis from "moralis";

let initialized = false;
let moralisInstance = null;

export async function initMoralis() {
  if (initialized) {
    console.log("ℹ️ Moralis already initialized - skipping");
    return;
  }

  if (!process.env.MORALIS_API_KEY) {
    console.warn("⚠️ MORALIS_API_KEY not found - Moralis features disabled");
    return;
  }

  await Moralis.start({
    apiKey: process.env.MORALIS_API_KEY,
  });

  moralisInstance = Moralis;
  initialized = true;
  console.log("✅ Moralis initialized ONCE (bootstrap)");
}

export function getMoralis() {
  if (!initialized) {
    throw new Error("Moralis not initialized - call initMoralis() first");
  }
  return moralisInstance;
}