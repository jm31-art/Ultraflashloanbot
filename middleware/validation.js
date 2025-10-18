const { check, validationResult } = require('express-validator');

const validateTransaction = [
    check('amount').isNumeric().withMessage('Amount must be numeric'),
    check('tokenAddress').isEthereumAddress().withMessage('Invalid token address'),
    check('recipient').isEthereumAddress().withMessage('Invalid recipient address'),
];

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

module.exports = {
    validateTransaction,
    validate
};
