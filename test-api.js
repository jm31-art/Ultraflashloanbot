const fetch = require('node-fetch');

async function testApi() {
    try {
        // First, try without API key
        console.log('Testing without API key...');
        let response = await fetch('http://localhost:3000/flashloan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: '1000',
                tokenAddress: '0x1234567890123456789012345678901234567890',
                recipient: '0x1234567890123456789012345678901234567890'
            })
        });
        console.log('Response without API key:', await response.text());

        // Then, try with API key
        console.log('\nTesting with API key...');
        // Replace 'YOUR_API_KEY' with the key that's printed when you start the server
        response = await fetch('http://localhost:3000/flashloan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'YOUR_API_KEY'
            },
            body: JSON.stringify({
                amount: '1000',
                tokenAddress: '0x1234567890123456789012345678901234567890',
                recipient: '0x1234567890123456789012345678901234567890'
            })
        });
        console.log('Response with API key:', await response.text());

    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Install node-fetch first:
// npm install node-fetch
testApi();
