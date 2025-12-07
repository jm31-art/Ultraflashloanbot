const Moralis = require("moralis").default;
let moralisStarted = false;

async function initMoralis(apiKey) {
    if (moralisStarted) return;
    await Moralis.start({ apiKey });
    moralisStarted = true;
}

module.exports = { initMoralis, Moralis };