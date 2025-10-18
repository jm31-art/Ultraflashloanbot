const express = require('express');
const limiter = require('./middleware/rateLimiter');
const { verifyApiKey, generateApiKey, addApiKey } = require('./middleware/auth');
const { validateTransaction, validate } = require('./middleware/validation');
const { handleError } = require('./utils/errorHandler');

const app = express();

// Apply rate limiting
app.use(limiter);

// Apply API key verification
app.use(verifyApiKey);

// Apply JSON parsing
app.use(express.json());

// Apply JSON parsing middleware
app.use(express.json());

// Example protected route with validation
app.post('/flashloan', 
    validateTransaction,
    validate,
    async (req, res, next) => {
        try {
            // Your flashloan logic here
            res.status(200).json({
                status: 'success',
                message: 'Flashloan executed successfully'
            });
        } catch (error) {
            next(error);
        }
    }
);

// Error handling middleware
app.use(handleError);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
