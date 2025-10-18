const crypto = require('crypto');

// Store API keys in memory (in production, use a database)
const validApiKeys = new Set();

// Generate a new API key
const generateApiKey = () => {
    return crypto.randomBytes(32).toString('hex');
};

// Add an API key to valid keys
const addApiKey = (apiKey) => {
    validApiKeys.add(apiKey);
};

const verifyApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return next(new Error('API key is required'));
    }

    try {
        if (!validApiKeys.has(apiKey)) {
            return next(new Error('Invalid API key'));
        }
        next();
    } catch (error) {
        return next(new Error('Authentication failed'));
    }
};

// Generate initial API key
const initialApiKey = generateApiKey();
addApiKey(initialApiKey);

console.log('Initial API Key (store this securely):', initialApiKey);

module.exports = {
    verifyApiKey,
    generateApiKey,
    addApiKey
};
