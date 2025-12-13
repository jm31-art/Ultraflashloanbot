const Moralis = require("moralis").default;

async function initMoralis(apiKey) {
    if (!global.__MORALIS_STARTED__) {
        await Moralis.start({ apiKey });
        global.__MORALIS_STARTED__ = true;
        global.moralisClient = Moralis; // Keep backward compatibility
        console.log("✅ Moralis API initialized for live DEX prices");
    } else {
        console.log("ℹ️ Moralis already initialized - skipping");
    }
    return global.moralisClient || Moralis;
}

module.exports = { initMoralis, Moralis };