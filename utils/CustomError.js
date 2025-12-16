class CustomError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();

        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            details: this.details,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
}

class ValidationError extends CustomError {
    constructor(message, field, value) {
        super(message, 'VALIDATION_ERROR', { field, value });
    }
}

class NetworkError extends CustomError {
    constructor(message, endpoint, statusCode) {
        super(message, 'NETWORK_ERROR', { endpoint, statusCode });
    }
}

class MEVError extends CustomError {
    constructor(message, riskLevel, threats = []) {
        super(message, 'MEV_ERROR', { riskLevel, threats });
    }
}

class LiquidityError extends CustomError {
    constructor(message, token, required, available) {
        super(message, 'LIQUIDITY_ERROR', { token, required, available });
    }
}

class GasError extends CustomError {
    constructor(message, currentGas, recommendedGas) {
        super(message, 'GAS_ERROR', { currentGas, recommendedGas });
    }
}

class ArbitrageError extends CustomError {
    constructor(message, opportunity, reason) {
        super(message, 'ARBITRAGE_ERROR', { opportunity, reason });
    }
}

class ConfigurationError extends CustomError {
    constructor(message, configKey, expectedType) {
        super(message, 'CONFIGURATION_ERROR', { configKey, expectedType });
    }
}

export {
    CustomError,
    ValidationError,
    NetworkError,
    MEVError,
    LiquidityError,
    GasError,
    ArbitrageError,
    ConfigurationError
};
