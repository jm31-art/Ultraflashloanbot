import Moralis from "moralis";

let initialized = false;

export async function initMoralis() {
  if (initialized) {
    console.log("ℹ️ Moralis already initialized - skipping");
    return;
  }

  await Moralis.start({
    apiKey: process.env.MORALIS_API_KEY,
  });

  initialized = true;
  console.log("✅ Moralis initialized ONCE (bootstrap)");
}