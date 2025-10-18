const chai = require('chai');
const expect = chai.expect;
const { validateTransaction } = require('../middleware/validation');
const { verifyApiKey } = require('../middleware/auth');
const { AppError } = require('../utils/errorHandler');

describe('Validation Middleware', () => {
    it('should validate transaction parameters', () => {
        const req = {
            body: {
                amount: '1000',
                tokenAddress: '0x1234567890123456789012345678901234567890',
                recipient: '0x1234567890123456789012345678901234567890'
            }
        };
        
        expect(() => validateTransaction(req)).to.not.throw();
    });
});

describe('Auth Middleware', () => {
    it('should verify API key', () => {
        const req = {
            headers: {
                'x-api-key': 'test-api-key'
            }
        };
        
        expect(() => verifyApiKey(req)).to.not.throw();
    });
});

describe('Error Handler', () => {
    it('should create operational error', () => {
        const error = new AppError('Test error', 400);
        expect(error.isOperational).to.be.true;
        expect(error.statusCode).to.equal(400);
    });
});
