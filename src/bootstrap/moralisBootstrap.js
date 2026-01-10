import Moralis from 'moralis';

async function initMoralis() {
  await Moralis.start({ apiKey: process.env.MORALIS_API_KEY });
  console.log('✅ Moralis initialized');
}

export default initMoralis;