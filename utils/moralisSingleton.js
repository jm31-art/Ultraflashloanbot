const Moralis = require("moralis").default;

async function initMoralis(apiKey) {
    if (!global.moralisClient) {
        await Moralis.start({ apiKey });
        global.moralisClient = Moralis;
        console.log("✅ Moralis API initialized for live DEX prices");
    } else {
        console.log("ℹ️ Moralis already initialized - skipping");
    }
    return global.moralisClient;
}

module.exports = { initMoralis, Moralis };