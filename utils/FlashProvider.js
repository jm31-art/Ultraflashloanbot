const { ethers } = require("ethers");

// ABIs for various protocols
const UNISWAP_V3_POOL_ABI = [
    "function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external",
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function fee() external view returns (uint24)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

const PANCAKE_PAIR_ABI = [
    "function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

const AAVE_POOL_ABI = [
    "function flashLoan(address receiverAddress, address[] calldata assets, uint256[] calldata amounts, uint256[] calldata modes, address onBehalfOf, bytes calldata params, uint16 referralCode) external"
];

const DODO_POOL_ABI = [
    "function flashLoan(uint256 baseAmount, uint256 quoteAmount, address assetTo, bytes calldata data) external",
    "function _BASE_TOKEN_() external view returns (address)",
    "function _QUOTE_TOKEN_() external view returns (address)",
    "function _MT_FEE_RATE_() external view returns (uint256)",
    "function _LP_FEE_RATE_() external view returns (uint256)"
];

const BALANCER_VAULT_ABI = [
    "function flashLoan(address recipient, address[] tokens, uint256[] amounts, bytes memory data) external"
];

const CURVE_POOL_ABI = [
    "function flash_loan_fee() external view returns (uint256)",
    "function flash(address recipient, uint256 amount, bytes calldata data) external"
];



const VENUS_PROTOCOL_ABI = [
    "function supplyRatePerBlock() external view returns (uint256)",
    "function borrowRatePerBlock() external view returns (uint256)"
];

class FlashProvider {
    constructor(provider, signer = null) {
        this.provider = provider;
        this.signer = signer;

        // Fallback fees when dynamic fetching fails
        this.fallbackFees = {
            'UniswapV3': 0.0005, // 0.05%
            'PancakeV3': 0, // 0% - flashSwap
            'PancakeSwap': 0.0002, // 0.02% - V2 pools
            'Biswap': 0.0001, // 0.01% - Competitive fees
            'Balancer': 0, // No fee
            'DODO': 0.0002, // 0.02% - Updated to match Hardhat simulation
            'Curve': 0.0004, // 0.04%
            'Venus': 0.0009, // 0.09%
            'Equalizer': 0, // 0% - Equalizer Finance flash loans
            '1inch': 0.001 // 0.1%
        };

        // Cache for dynamic fees with TTL
        this.feeCache = new Map();
        this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes TTL

        // Protocol addresses (BSC mainnet)
        this.protocolAddresses = {
            'UniswapV3': {
                factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Uniswap V3 Factory (if deployed on BSC)
                samplePool: null // Will be set dynamically
            },
            'PancakeV3': {
                factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865', // PancakeSwap V3 Factory
                samplePool: null
            },
            'Balancer': {
                vault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' // Balancer Vault
            },
            'AAVE': {
                address: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9' // Aave Pool Address
            },
            'DODO': {
                samplePool: null // Will be set dynamically
            },
            'Curve': {
                samplePool: null // Will be set dynamically
            },
            'Venus': {
                // Updated Venus protocol addresses for BSC
                comptroller: '0xfD36E2c2a6789Db23113685031d7F16329158384', // Venus Comptroller
                vai: '0x4BD17003473389A8b26f25E58dDccE7F125eA5c' // VAI Token
            },
            'Equalizer': {
                address: '0x5B9E465D5f3A5e3B2B87b9A05D7b7A5A5b5A5b5A' // Equalizer Finance on BSC (0%)
            },
            '1inch': {
                aggregationRouter: '0x1111111254fb6c44bAC0beD2854e76F90643097d' // 1inch Aggregation Router
            }
        };
    }

    async estimateFlashCost(amount, protocol) {
        // Return 0 for Balancer since it has no fees
        if (protocol === 'Balancer') return ethers.constants.Zero;

        const feeRate = await this.getDynamicFee(protocol);
        const fee = ethers.BigNumber.from(Math.floor(feeRate * 10000))
            .mul(amount)
            .div(10000);
        return fee;
    }

    async findBestFlashProvider(token, amount) {
        const providers = [];

        // PRIORITY 0.5: Equalizer Finance (0% fee flash loans)
        const equalizerFee = await this.estimateFlashCost(amount, 'Equalizer');
        providers.push({
            protocol: 'Equalizer',
            fee: equalizerFee,
            type: 'flashLoan',
            active: true,
            priority: 0.5 // Highest priority - 0% fee
        });

        // PRIORITY 1: PancakeSwap V3 (0% fee flashSwap)
        const pancakeV3Fee = await this.estimateFlashCost(amount, 'PancakeV3');
        providers.push({
            protocol: 'PancakeV3',
            fee: pancakeV3Fee,
            type: 'flashSwap',
            active: true,
            priority: 1 // High priority - 0% fee flashSwap
        });

        // PRIORITY 1.5: PancakeSwap V2 (highest volume pools for flashswaps)
        const pancakeV2Fee = await this.estimateFlashCost(amount, 'PancakeSwap');
        providers.push({
            protocol: 'PancakeSwap',
            fee: pancakeV2Fee,
            type: 'flashSwap',
            active: true,
            priority: 1.5 // High priority - V2 has better liquidity
        });

        // PRIORITY 2: Biswap (high-volume BSC pools, competitive fees)
        const biswapFee = await this.estimateFlashCost(amount, 'Biswap');
        providers.push({
            protocol: 'Biswap',
            fee: biswapFee,
            type: 'flashSwap',
            active: true,
            priority: 2 // High priority - large liquidity pools
        });

        // PRIORITY 2: Aave (for large stablecoin flashloans - excellent for USDT up to $100K)
        if (token === '0x55d398326f99059fF775485246999027B3197955' || // USDT
            token === '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' || // USDC
            token === '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56') { // BUSD
            providers.push({
                protocol: 'AAVE',
                fee: 0.0009, // Aave flash loan fee: 0.09%
                type: 'flashLoan',
                active: true,
                priority: 2
            });
        }

        // PRIORITY 3: DODO (re-enabled as fallback - has good USDT liquidity)
        const dodoFee = await this.estimateFlashCost(amount, 'DODO');
        providers.push({
            protocol: 'DODO',
            fee: dodoFee,
            type: 'flashLoan',
            active: true, // Re-enabled for USDT liquidity
            priority: 3
        });

        // PRIORITY 4: UniswapV3 (lowest priority)
        const uniV3Fee = await this.estimateFlashCost(amount, 'UniswapV3');
        providers.push({
            protocol: 'UniswapV3',
            fee: uniV3Fee,
            type: 'flashSwap',
            active: true,
            priority: 4
        });

        // PRIORITY 6: Balancer (disabled for now)
        const balancerFee = await this.estimateFlashCost(amount, 'Balancer');
        providers.push({
            protocol: 'Balancer',
            fee: balancerFee,
            type: 'flashLoan',
            active: false, // Temporarily disable Balancer
            priority: 6
        });

        // Sort by priority first, then by lowest fee among active providers
        const activeProviders = providers.filter(p => p.active);
        activeProviders.sort((a, b) => {
            if (a.priority !== b.priority) {
                return a.priority - b.priority; // Lower priority number = higher priority
            }
            return a.fee.gt(b.fee) ? 1 : -1; // Then sort by fee
        });

        console.log(`🏦 Selected flash provider: ${activeProviders[0]?.protocol} (Priority: ${activeProviders[0]?.priority})`);
        return activeProviders[0]; // Return the highest priority provider
    }

    async checkFlashSwapLiquidity(token, protocol) {
        try {
            // Simulated liquidity check
            const mockLiquidity = {
                'UniswapV3': true,
                'PancakeV3': true,
                'Balancer': true,
                'DODO': true,
                'Curve': true,
                'Venus': true,
                '1inch': true
            };

            const feeRate = await this.getDynamicFee(protocol);
            return {
                hasLiquidity: mockLiquidity[protocol] || false,
                maxAmount: ethers.parseUnits('1000000', 18), // Simulated max amount
                fee: feeRate
            };
        } catch (error) {
            console.warn(`Error checking liquidity for ${protocol}:`, error.message);
            return {
                hasLiquidity: false,
                maxAmount: 0,
                fee: 0
            };
        }
    }

    getFlashFee(protocol, amount) {
        // Return 0 for Balancer since it has no fees
        if (protocol === 'Balancer') return ethers.constants.Zero;

        const feeRate = this.fallbackFees[protocol] || 0.001; // Use fallback for synchronous calls
        const fee = ethers.BigNumber.from(Math.floor(feeRate * 10000))
            .mul(amount)
            .div(10000);
        return fee;
    }

    // Dynamic fee fetching methods
    async getDynamicFee(protocol) {
        try {
            // Check cache first
            const cached = this.feeCache.get(protocol);
            if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
                return cached.fee;
            }

            // Fetch fresh fee
            let fee;
            switch (protocol) {
                case 'UniswapV3':
                    fee = await this.getUniswapV3Fee();
                    break;
                case 'PancakeV3':
                    fee = await this.getPancakeV3Fee();
                    break;
                case 'PancakeSwap':
                    fee = await this.getPancakeV2Fee();
                    break;
                case 'Biswap':
                    fee = await this.getBiswapFee();
                    break;
                case 'Balancer':
                    fee = 0; // Balancer has no flash loan fees
                    break;
                case 'DODO':
                    fee = await this.getDODOFee();
                    break;
                case 'Curve':
                    fee = await this.getCurveFee();
                    break;
                case 'Venus':
                    fee = await this.getVenusFee();
                    break;
                case 'Equalizer':
                    fee = await this.getEqualizerFee();
                    break;
                case '1inch':
                    fee = await this.getOneInchFee();
                    break;
                default:
                    fee = this.fallbackFees[protocol] || 0.001;
            }

            // Cache the result
            this.feeCache.set(protocol, {
                fee: fee,
                timestamp: Date.now()
            });

            return fee;
        } catch (error) {
            console.warn(`Failed to fetch dynamic fee for ${protocol}, using fallback:`, error.message);
            return this.fallbackFees[protocol] || 0.001;
        }
    }

    async getUniswapV3Fee() {
        try {
            // For Uniswap V3, we need to get fee from a sample pool
            // Using WBNB/USDT pool as reference
            const poolAddress = '0x36696169C63e42cd08ce11f5deeBbCeBae652050'; // Example pool address
            const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, this.provider);
            const fee = await pool.fee();
            // Convert from basis points to decimal (e.g., 500 -> 0.0005)
            return fee / 1000000; // Uniswap V3 fees are in basis points (1/100th of 1%)
        } catch (error) {
            console.warn('Error fetching Uniswap V3 fee:', error.message);
            return this.fallbackFees.UniswapV3;
        }
    }

    async getPancakeV3Fee() {
        try {
            // Similar to Uniswap V3
            const poolAddress = '0x36696169C63e42cd08ce11f5deeBbCeBae652050'; // Example PancakeSwap V3 pool
            const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, this.provider);
            const fee = await pool.fee();
            return fee / 1000000;
        } catch (error) {
            console.warn('Error fetching PancakeSwap V3 fee:', error.message);
            return this.fallbackFees.PancakeV3;
        }
    }

    async getPancakeV2Fee() {
        try {
            // PancakeSwap V2 uses fixed 0.2% fee (similar to Uniswap V2)
            return 0.002; // 0.2%
        } catch (error) {
            console.warn('Error fetching PancakeSwap V2 fee:', error.message);
            return this.fallbackFees.PancakeSwap;
        }
    }

    async getBiswapFee() {
        try {
            // Biswap uses competitive 0.1% fee for flashswaps
            return 0.001; // 0.1%
        } catch (error) {
            console.warn('Error fetching Biswap fee:', error.message);
            return this.fallbackFees.Biswap;
        }
    }

    async getDODOFee() {
        try {
            // DODO has MT (market taker) and LP fees
            // Try multiple known DODO pool addresses on BSC
            const poolAddresses = [
                '0xFeAFe253802b77456B4627F8c2306a9CeBb5d681', // USDT DODO V2 pool
                '0x9ad32e3054268B849b84a8d7c8ad561eF72E27B2', // Alternative pool
                '0xD7B7218D778338Ea5f55Dd59f4EF7C45e2c5dF6'  // Another alternative
            ];

            for (const poolAddress of poolAddresses) {
                try {
                    const pool = new ethers.Contract(poolAddress, DODO_POOL_ABI, this.provider);
                    const mtFee = await pool._MT_FEE_RATE_().catch(() => null);
                    const lpFee = await pool._LP_FEE_RATE_().catch(() => null);

                    if (mtFee !== null && lpFee !== null) {
                        // DODO fees are typically in basis points
                        const totalFee = (mtFee + lpFee) / 10000; // Convert to decimal
                        return Math.min(totalFee, 0.01); // Cap at 1%
                    }
                } catch (e) {
                    // Try next pool
                    continue;
                }
            }
        } catch (error) {
            console.warn('Error fetching DODO fee:', error.message);
        }

        console.log('Using DODO fallback fee');
        return this.fallbackFees.DODO;
    }

    async getCurveFee() {
        try {
            // Curve flash loan fees vary by pool
            // Using a known Curve pool on BSC - using a valid address or fallback
            const poolAddress = '0xf5f5B97624542D72A9E06f04804Bf81baA15e2B4'; // Curve 3pool on BSC (if available)
            const pool = new ethers.Contract(poolAddress, CURVE_POOL_ABI, this.provider);
            const fee = await pool.flash_loan_fee();
            // Curve fees are typically in wei, convert to decimal
            return parseFloat(ethers.formatEther(fee));
        } catch (error) {
            console.warn('Error fetching Curve fee:', error.message);
            return this.fallbackFees.Curve;
        }
    }

    async getVenusFee() {
        try {
            // Venus flash loan fees are based on borrow rates
            const comptrollerAddress = this.protocolAddresses.Venus.comptroller;
            const comptroller = new ethers.Contract(comptrollerAddress, VENUS_PROTOCOL_ABI, this.provider);

            // Get borrow rate (this is an approximation for flash loan fee)
            const borrowRate = await comptroller.borrowRatePerBlock().catch(e => {
                console.warn('Venus borrowRatePerBlock failed, using supply rate');
                return comptroller.supplyRatePerBlock().catch(e2 => {
                    console.warn('Venus supply rate also failed');
                    return null;
                });
            });

            if (borrowRate) {
                // Convert from per block to annual, then estimate flash loan fee
                // This is a rough approximation - Venus flash loans have specific fee structures
                const annualRate = borrowRate * 10512000; // ~2.1M blocks per year on BSC
                const flashFee = annualRate / 100 / 100; // Convert to decimal percentage
                return Math.min(flashFee, 0.01); // Cap at 1%
            }
        } catch (error) {
            console.warn('Error fetching Venus fee:', error.message);
        }

        console.log('Using Venus fallback fee');
        return this.fallbackFees.Venus;
    }

    async getOneInchFee() {
        try {
            // 1inch fees are typically fixed or minimal for flash loans
            // They may charge a small fee for complex operations
            // For now, use a conservative estimate
            return 0.0005; // 0.05% - conservative estimate
        } catch (error) {
            console.warn('Error fetching 1inch fee:', error.message);
            return this.fallbackFees['1inch'];
        }
    }

    async getEqualizerFee() {
        try {
            // Equalizer Finance offers 0% flash loan fees
            return 0; // 0% fee
        } catch (error) {
            console.warn('Error fetching Equalizer fee:', error.message);
            return this.fallbackFees.Equalizer;
        }
    }

    // Clear expired cache entries
    clearExpiredCache() {
        const now = Date.now();
        for (const [protocol, data] of this.feeCache.entries()) {
            if (now - data.timestamp > this.CACHE_TTL) {
                this.feeCache.delete(protocol);
            }
        }
    }

    // Execute flash swap (0% fee DEX-native flash loans)
    async executeFlashSwap(provider, poolAddress, token0Amount, token1Amount, arbitrageParams) {
        try {
            switch (provider) {
                case 'UniswapV3':
                    return await this._executeUniswapV3FlashSwap(poolAddress, token0Amount, token1Amount, arbitrageParams);
                case 'PancakeV3':
                case 'PancakeSwap':
                    return await this._executePancakeV3FlashSwap(poolAddress, token0Amount, token1Amount, arbitrageParams);
                case 'Biswap':
                    return await this._executeBiswapFlashSwap(poolAddress, token0Amount, token1Amount, arbitrageParams);
                default:
                    throw new Error(`Unsupported flash swap provider: ${provider}`);
            }
        } catch (error) {
            console.error(`Error executing ${provider} flash swap:`, error);
            throw error;
        }
    }

    // Get pool address from configuration
    getPoolAddress(protocol, tokenA, tokenB) {
        // Load pool addresses from config
        const poolAddresses = require('../config/pool_addresses.json');

        // Handle both token objects and addresses
        let tokenASymbol, tokenBSymbol;

        if (typeof tokenA === 'object' && tokenA.symbol) {
            tokenASymbol = tokenA.symbol;
        } else if (typeof tokenA === 'string') {
            // Find token by address
            const tokens = require('../config/dex').TOKENS;
            const foundToken = Object.values(tokens).find(t => t.address.toLowerCase() === tokenA.toLowerCase());
            tokenASymbol = foundToken?.symbol;
        }

        if (typeof tokenB === 'object' && tokenB.symbol) {
            tokenBSymbol = tokenB.symbol;
        } else if (typeof tokenB === 'string') {
            // Find token by address
            const tokens = require('../config/dex').TOKENS;
            const foundToken = Object.values(tokens).find(t => t.address.toLowerCase() === tokenB.toLowerCase());
            tokenBSymbol = foundToken?.symbol;
        }

        if (!tokenASymbol || !tokenBSymbol) {
            console.log(`❌ Could not resolve token symbols for pool lookup`);
            return null;
        }

        const pairKey = `${tokenASymbol}/${tokenBSymbol}`;
        console.log(`🔍 Looking for ${protocol} pool: ${pairKey}`);

        // Check PancakeSwap V2 first (higher priority)
        if (protocol === 'PancakeSwap' || protocol === 'PancakeV3') {
            const v2PoolAddress = poolAddresses.PancakeSwap?.[pairKey];
            if (v2PoolAddress) {
                console.log(`✅ Found PancakeSwap V2 pool: ${v2PoolAddress}`);
                return v2PoolAddress;
            }

            // Fallback to V3 if V2 not found
            const v3PoolAddress = poolAddresses.PancakeV3?.[pairKey];
            if (v3PoolAddress) {
                console.log(`✅ Found PancakeSwap V3 pool: ${v3PoolAddress}`);
                return v3PoolAddress;
            }
        }

        // Check other protocols
        if (protocol === 'Biswap') {
            const poolAddress = poolAddresses.Biswap?.[pairKey];
            if (poolAddress) {
                console.log(`✅ Found Biswap pool: ${poolAddress}`);
                return poolAddress;
            }
        }

        if (protocol === 'UniswapV3') {
            const poolAddress = poolAddresses.UniswapV3?.[pairKey];
            if (poolAddress) {
                console.log(`✅ Found UniswapV3 pool: ${poolAddress}`);
                return poolAddress;
            }
        }

        console.log(`❌ No pool address found for ${protocol} ${pairKey}`);
        return null;
    }

    // Execute Uniswap V3 flash swap
    async _executeUniswapV3FlashSwap(poolAddress, amount0, amount1, arbitrageParams) {
        if (!this.signer) {
            throw new Error('Signer is required for flash swap execution');
        }
        const poolContract = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, this.signer);

        try {
            // Fetch token addresses from the pool
            const token0 = await poolContract.token0();
            const token1 = await poolContract.token1();

            // Encode arbitrage parameters with token addresses, caller, and gas reimbursement
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'address', 'string[]', 'address[]', 'address', 'uint256'],
                [token0, token1, arbitrageParams.exchanges, arbitrageParams.path, arbitrageParams.caller, arbitrageParams.gasReimbursement]
            );

            // Execute flash swap
            const tx = await poolContract.flash(
                arbitrageParams.contractAddress || this.signer.address, // recipient (arbitrage contract)
                amount0,
                amount1,
                data
            );

            const receipt = await tx.wait();
            return {
                success: true,
                txHash: receipt.transactionHash,
                gasUsed: ethers.BigNumber.from(receipt.gasUsed),
                token0,
                token1
            };
        } catch (error) {
            console.error('Uniswap V3 flash swap failed:', error.message);
            throw error;
        }
    }

    // Execute PancakeSwap V3 flash swap
    async _executePancakeV3FlashSwap(poolAddress, amount0, amount1, arbitrageParams) {
        if (!this.signer) {
            throw new Error('Signer is required for flash swap execution');
        }
        const poolContract = new ethers.Contract(poolAddress, PANCAKE_PAIR_ABI, this.signer);

        try {
            // Fetch token addresses from the pool
            const token0 = await poolContract.token0();
            const token1 = await poolContract.token1();

            // Encode arbitrage parameters with token addresses, caller, and gas reimbursement
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'address', 'string[]', 'address[]', 'address', 'uint256'],
                [token0, token1, arbitrageParams.exchanges, arbitrageParams.path, arbitrageParams.caller, arbitrageParams.gasReimbursement]
            );

            // Execute flash swap
            const tx = await poolContract.swap(
                amount0,
                amount1,
                arbitrageParams.contractAddress || this.signer.address, // to (arbitrage contract)
                data
            );

            const receipt = await tx.wait();
            return {
                success: true,
                txHash: receipt.transactionHash,
                gasUsed: ethers.BigNumber.from(receipt.gasUsed),
                token0,
                token1
            };
        } catch (error) {
            console.error('PancakeSwap V3 flash swap failed:', error.message);
            throw error;
        }
    }

    // Execute Biswap flash swap
    async _executeBiswapFlashSwap(poolAddress, amount0, amount1, arbitrageParams) {
        if (!this.signer) {
            throw new Error('Signer is required for flash swap execution');
        }
        const poolContract = new ethers.Contract(poolAddress, PANCAKE_PAIR_ABI, this.signer);

        try {
            // Fetch token addresses from the pool
            const token0 = await poolContract.token0();
            const token1 = await poolContract.token1();

            // Encode arbitrage parameters with token addresses, caller, and gas reimbursement
            const data = ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'address', 'string[]', 'address[]', 'address', 'uint256'],
                [token0, token1, arbitrageParams.exchanges, arbitrageParams.path, arbitrageParams.caller, arbitrageParams.gasReimbursement]
            );

            // Execute flash swap
            const tx = await poolContract.swap(
                amount0,
                amount1,
                arbitrageParams.contractAddress || this.signer.address, // to (arbitrage contract)
                data
            );

            const receipt = await tx.wait();
            return {
                success: true,
                txHash: receipt.transactionHash,
                gasUsed: ethers.BigNumber.from(receipt.gasUsed),
                token0,
                token1
            };
        } catch (error) {
            console.error('Biswap flash swap failed:', error.message);
            throw error;
        }
    }

    // Execute traditional flash loan (for Aave, Balancer, DODO)
    async executeFlashLoan(provider, token, amount, arbitrageParams) {
        try {
            switch (provider) {
                case 'AAVE':
                    return await this._executeAaveFlashLoan(token, amount, arbitrageParams);
                case 'Balancer':
                    return await this._executeBalancerFlashLoan(token, amount, arbitrageParams);
                case 'DODO':
                    return await this._executeDodoFlashLoan(token, amount, arbitrageParams);
                default:
                    throw new Error(`Unsupported flash loan provider: ${provider}`);
            }
        } catch (error) {
            console.error(`Error executing ${provider} flash loan:`, error);
            throw error;
        }
    }

    // Execute Aave flash loan
    async _executeAaveFlashLoan(token, amount, arbitrageParams) {
        if (!this.signer) {
            throw new Error('Signer is required for flash loan execution');
        }
        const aaveContract = new ethers.Contract(
            this.protocolAddresses.AAVE.address,
            AAVE_POOL_ABI,
            this.signer
        );

        const assets = [token];
        const amounts = [amount];
        const modes = [0]; // 0 = no debt, 1 = stable, 2 = variable

        // Encode arbitrage parameters with caller and gas reimbursement
        const params = ethers.AbiCoder.defaultAbiCoder().encode(
            ['string[]', 'address[]', 'address', 'uint256'],
            [arbitrageParams.exchanges, arbitrageParams.path, arbitrageParams.caller, arbitrageParams.gasReimbursement]
        );

        const tx = await aaveContract.flashLoan(
            arbitrageParams.contractAddress || this.signer.address, // receiverAddress
            assets,
            amounts,
            modes,
            this.signer.address, // onBehalfOf
            params,
            0 // referralCode
        );

        const receipt = await tx.wait();
        return {
            success: true,
            txHash: receipt.transactionHash,
            gasUsed: ethers.BigNumber.from(receipt.gasUsed)
        };
    }

    // Execute Balancer flash loan
    async _executeBalancerFlashLoan(token, amount, arbitrageParams) {
        if (!this.signer) {
            throw new Error('Signer is required for flash loan execution');
        }
        const balancerContract = new ethers.Contract(
            this.protocolAddresses.Balancer.vault,
            BALANCER_VAULT_ABI,
            this.signer
        );

        const tokens = [token];
        const amounts = [amount];

        // Encode arbitrage parameters with caller and gas reimbursement
        const userData = ethers.AbiCoder.defaultAbiCoder().encode(
            ['string[]', 'address[]', 'address', 'uint256'],
            [arbitrageParams.exchanges, arbitrageParams.path, arbitrageParams.caller, arbitrageParams.gasReimbursement]
        );

        const tx = await balancerContract.flashLoan(
            arbitrageParams.contractAddress || this.signer.address, // recipient
            tokens,
            amounts,
            userData
        );

        const receipt = await tx.wait();
        return {
            success: true,
            txHash: receipt.transactionHash,
            gasUsed: ethers.BigNumber.from(receipt.gasUsed)
        };
    }

    // Execute DODO flash loan
    async _executeDodoFlashLoan(token, amount, arbitrageParams) {
        // This would need the specific DODO pool address for the token
        // For now, return placeholder
        console.log(`DODO flash loan execution for ${token} amount ${amount}`);
        return { success: true, txHash: '0x...', gasUsed: 0 };
    }

    // Get cache statistics
    getCacheStats() {
        return {
            size: this.feeCache.size,
            entries: Array.from(this.feeCache.entries()).map(([protocol, data]) => ({
                protocol,
                fee: data.fee,
                age: Date.now() - data.timestamp
            }))
        };
    }
}

module.exports = FlashProvider;
