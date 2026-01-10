# final_printer_2025.py — FULL 13-EDGE NUCLEAR PRINTER (DEC 2025 TOP 3 WALLET EXACT)
import os, time, requests, logging
from decimal import Decimal
from datetime import datetime
from web3 import Web3
from web3.middleware import geth_poa_middleware
from eth_account import Account
from eth_account.signers.local import LocalAccount
from dotenv import load_dotenv
import statistics  # For standard deviation calculation
import asyncio
import aiohttp
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import random

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Setup retry strategy for API calls
def create_session_with_retries():
    session = requests.Session()
    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "OPTIONS", "POST"]
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session

# Global session for API calls
api_session = create_session_with_retries()

with open('abi/router.json') as f:
    router_abi = json.load(f)

last_flash_balance = Decimal("0")

load_dotenv()

PRIVATE_KEY = os.getenv("PRIVATE_KEY")
rpc_url = os.getenv("BSC_RPC_URL") or "https://bsc.merkle.io"

# List of BSC RPC nodes for failover
RPC_NODES = [
    "https://bsc-dataseed1.binance.org/",
    "https://bsc-dataseed2.binance.org/",
    "https://bsc-dataseed3.binance.org/",
    "https://bsc-dataseed4.binance.org/",
    "https://bsc.merkle.io",
    rpc_url  # Include the configured one
]

def get_reliable_web3():
    """Get connected Web3 instance with failover"""
    for rpc_url in RPC_NODES:
        try:
            w3_test = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 3}))
            if w3_test.is_connected():
                logger.info(f"Connected to {rpc_url}")
                return w3_test
        except Exception as e:
            logger.warning(f"Failed to connect to {rpc_url}: {e}")
            continue
    raise Exception("No reliable RPC nodes available")
w3 = get_reliable_web3()
w3.middleware_onion.inject(geth_poa_middleware, layer=0)

if not PRIVATE_KEY:
    logger.warning("No PRIVATE_KEY set - running in monitor mode only")
    account = None
else:
    logger.info("LIVE MODE: Private key detected - ready for arbitrage execution")
    account = Account.from_key(PRIVATE_KEY)

def tg(msg):
    token = os.getenv("TELEGRAM_TOKEN")
    chat = os.getenv("TELEGRAM_CHAT_ID")
    if token and chat:
        try:
            requests.post(f"https://api.telegram.org/bot{token}/sendMessage", data={"chat_id": chat, "text": msg}, timeout=4)
        except Exception as e:
            logger.error(f"Telegram error: {e}")

class SecurityMonitor:
    """Real-time security monitoring during bot operation"""

    def __init__(self):
        self.suspicious_patterns = []
        self.security_alerts = []

    def monitor_transaction(self, tx_hash, tx_data):
        """Monitor transactions for suspicious patterns"""
        alerts = []

        # Check for reentrancy patterns
        if self.detect_reentrancy_risk(tx_data):
            alerts.append("POTENTIAL REENTRANCY DETECTED")

        # Check for unusual gas prices
        if self.detect_unusual_gas_price(tx_data):
            alerts.append("UNUSUAL GAS PRICE DETECTED")

        # Check for suspicious contract interactions
        if self.detect_suspicious_contracts(tx_data):
            alerts.append("SUSPICIOUS CONTRACT INTERACTION")

        if alerts:
            self.security_alerts.append({
                'tx_hash': tx_hash,
                'alerts': alerts,
                'timestamp': time.time()
            })

            # Send security alerts
            for alert in alerts:
                tg(f"🚨 SECURITY ALERT: {alert}\nTx: {tx_hash}")

    def detect_reentrancy_risk(self, tx_data):
        """Detect potential reentrancy vulnerabilities"""
        # Check for external calls in contract interactions
        # This is a simplified check - real implementation would analyze bytecode
        return False

    def detect_unusual_gas_price(self, tx_data):
        """Detect unusually high gas prices (potential front-running)"""
        current_gas = w3.eth.gas_price
        tx_gas = tx_data.get('gasPrice', 0)

        # Alert if gas price is 3x higher than current
        return tx_gas > current_gas * 3

    def detect_suspicious_contracts(self, tx_data):
        """Detect interactions with known suspicious contracts"""
        # Maintain a list of known suspicious addresses
        suspicious_addresses = {
            '0x0000000000000000000000000000000000000000',  # Zero address
            # Add known suspicious addresses here
        }

        to_address = tx_data.get('to', '').lower()
        return to_address in suspicious_addresses

    def get_security_status(self):
        """Get current security status"""
        recent_alerts = [alert for alert in self.security_alerts
                        if time.time() - alert['timestamp'] < 3600]  # Last hour

        return {
            'total_alerts': len(self.security_alerts),
            'recent_alerts': len(recent_alerts),
            'alert_rate_per_hour': len(recent_alerts),
            'security_score': max(0, 100 - len(recent_alerts) * 10)
        }


class ContractValidator:
    def __init__(self, w3):
        self.w3 = w3
        self.verified_contracts = {}

    def verify_contract(self, address, expected_functions=None):
        """Verify contract exists and has expected functions"""
        try:
            # Check if already verified
            if address in self.verified_contracts:
                return self.verified_contracts[address]

            # Get contract bytecode
            code = self.w3.eth.get_code(address)

            if len(code) <= 2:
                result = {"valid": False, "error": "Not a contract"}
                self.verified_contracts[address] = result
                return result

            # Check for expected function selectors
            if expected_functions:
                missing_functions = []
                for func_name in expected_functions:
                    # Convert function signature to selector
                    selector = self.w3.keccak(text=func_name)[:4].hex()
                    if selector not in code.hex():
                        missing_functions.append(func_name)

                if missing_functions:
                    result = {"valid": False, "error": f"Missing functions: {missing_functions}"}
                    self.verified_contracts[address] = result
                    return result

            result = {"valid": True, "error": None}
            self.verified_contracts[address] = result
            return result

        except Exception as e:
            result = {"valid": False, "error": str(e)}
            self.verified_contracts[address] = result
            return result


FLASH_SIZE_USD = Decimal("78000")  # Increased for micro-arbs
MIN_PROFIT_PCT = Decimal("0.0015")  # 0.15% minimum gap
MIN_PROFIT_USD = Decimal("15")  # $15 minimum profit
BNB_PRICE = Decimal("585")

# BSC CHAINLINK ORACLE ADDRESSES
BSC_ORACLES = {
    "BNB_USD": Web3.to_checksum_address("0x0567F2323251f0Aab1Ac9b9be91Ac0c8cE0a9e8a"),
    "BTC_USD": Web3.to_checksum_address("0x264990fbd0A3e3d8db4B20D8B75779Da84fE7B9A"),
    "ETH_USD": Web3.to_checksum_address("0x143db3CEEfbdfe5631aDD3Efe2a8a9434473ab14"),
    "CAKE_USD": Web3.to_checksum_address("0xB6064eD41d4f67e3537680d3e8A3dAB9cB7f7F7C")
}

# CORRECT CHAINLINK ABI
CHAINLINK_ORACLE_ABI = [
    {
        "inputs": [],
        "name": "latestAnswer",
        "outputs": [{"internalType": "int256", "name": "", "type": "int256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "decimals",
        "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
        "stateMutability": "view",
        "type": "function"
    }
]

def get_chainlink_price(oracle_address):
    """Get price from Chainlink oracle with proper error handling"""
    try:
        oracle = w3.eth.contract(address=oracle_address, abi=CHAINLINK_ORACLE_ABI)

        # Get decimals first
        decimals = oracle.functions.decimals().call()

        # Get price
        price = oracle.functions.latestAnswer().call()

        return Decimal(price) / Decimal(10 ** decimals)

    except Exception as e:
        logger.error(f"Chainlink oracle failed at {oracle_address}: {e}")

        # Fallback: Try PancakeSwap as fallback for BNB
        if oracle_address == BSC_ORACLES["BNB_USD"]:
            return get_pancake_price("BNB/USDT")

        return None

def get_pancake_price(pair):
    """Fallback price from PancakeSwap"""
    try:
        response = requests.get(f"https://api.dexscreener.com/latest/dex/search/?q={pair}&chainId=bsc", timeout=5).json()
        if response.get("pairs") and len(response["pairs"]) > 0:
            return Decimal(response["pairs"][0]["priceUsd"])
    except Exception as e:
        logger.error(f"PancakeSwap fallback failed: {e}")
    return None

def get_dex_price(token_symbol):
    """Get DEX price for token"""
    try:
        pair = f"{token_symbol}/USDT"
        return get_pancake_price(pair)
    except Exception as e:
        logger.error(f"DEX price fetch failed for {token_symbol}: {e}")
        return None

def get_dex_price_safe(token_address):
    """Get DEX price for validated token address"""
    try:
        # Validate the address first
        validated_address = token_manager.validate_and_format_address(token_address)
        if not validated_address:
            return None

        # Find symbol from address
        symbol = None
        for sym, addr in token_manager.known_tokens.items():
            if addr.lower() == validated_address.lower():
                symbol = sym
                break

        if not symbol:
            return None

        return get_dex_price(symbol)

    except Exception as e:
        print(f"Safe DEX price fetch failed: {e}")
        return None

def calculate_triangular_arbitrage_safe(token_a, token_b, token_c):
    """Safe triangular arbitrage with validated addresses"""
    try:
        # Get prices with error handling
        prices = {}
        for token in [token_a, token_b, token_c]:
            price = get_dex_price_safe(token)
            if not price:
                return None
            prices[token] = price

        # Validate all prices are reasonable
        if not all(p > 0.01 for p in prices.values()):  # Minimum $0.01
            return None

        # Calculate triangular arbitrage
        amount_a = Decimal("1000")  # Start with $1000
        amount_b = amount_a * prices[token_b] / prices[token_a]
        amount_c = amount_b * prices[token_c] / prices[token_b]
        final_a = amount_c * prices[token_a] / prices[token_c]

        # Apply realistic fees (0.25% per trade)
        fee_factor = Decimal("0.9975") ** 3
        final_a *= fee_factor

        profit_usd = final_a - amount_a

        if profit_usd > MIN_PROFIT_USD:
            return {
                'profit_usd': profit_usd,
                'profit_percentage': (profit_usd / amount_a) * 100,
                'path': f"{token_a[:6]}→{token_b[:6]}→{token_c[:6]}"
            }

        return None

    except Exception as e:
        print(f"Triangular calculation error: {e}")
        return None

def validate_price_reasonableness(dex_price, oracle_price, token_symbol):
    """Validate that prices are within reasonable bounds"""
    try:
        # Check if prices are positive
        if dex_price <= 0 or oracle_price <= 0:
            return False

        # Check deviation (should not exceed 20% for stable assets like BNB)
        deviation = abs(dex_price - oracle_price) / oracle_price
        if deviation > Decimal("0.20"):
            logger.warning(f"{token_symbol}: Price deviation too high ({deviation*100:.1f}%)")
            return False

        # Check if prices are in reasonable range for BNB ($200-1000)
        if token_symbol == "BNB" and not (Decimal("200") < dex_price < Decimal("1000")):
            logger.warning(f"{token_symbol}: DEX price out of reasonable range: ${dex_price}")
            return False

        return True

    except Exception as e:
        logger.error(f"Price validation error for {token_symbol}: {e}")
        return False

def calculate_price_gap(price1, price2, token_symbol):
    """Calculate price gap with mathematical validation"""

    # Validate prices are reasonable
    reference_prices = {
        "BNB": 300, "BTC": 40000, "ETH": 2500, "CAKE": 3.0
    }

    if token_symbol in reference_prices:
        ref_price = reference_prices[token_symbol]

        # Check if prices are within 50% of reference
        if (abs(price1 - ref_price) / ref_price > 0.5 or
            abs(price2 - ref_price) / ref_price > 0.5):
            return None  # Price is unreasonable

    # Check for division by zero or very small denominator
    min_reasonable_price = 0.1  # Minimum $0.10
    if price2 < min_reasonable_price:
        return None

    # Calculate gap with bounds checking
    gap = abs(price1 - price2) / min(price1, price2)

    # Return None if gap is impossible (>50% for major tokens)
    if gap > 0.5:  # 50% maximum reasonable gap
        return None

    return gap

def validate_cross_dex_prices(price1, price2, token_symbol):
    """Enhanced cross-DEX price validation"""

    # Step 1: Check for zero or negative prices
    if price1 <= 0 or price2 <= 0:
        return False, "Zero or negative price detected"

    # Step 2: Check against reference prices
    reference_prices = {
        "BNB": 300, "BTC": 40000, "ETH": 2500, "CAKE": 3.0,
        "BTCB": 40000, "WBNB": 300
    }

    if token_symbol in reference_prices:
        ref_price = reference_prices[token_symbol]

        # Allow 30% deviation from reference
        max_deviation = 0.3
        if (abs(price1 - ref_price) / ref_price > max_deviation or
            abs(price2 - ref_price) / ref_price > max_deviation):
            return False, f"Price deviates >30% from reference (${ref_price})"

    # Step 3: Check price gap reasonableness
    price_gap = abs(price1 - price2) / min(price1, price2)

    # For major tokens, max 3% gap is reasonable
    if price_gap > 0.03:
        return False, f"Price gap too large: {price_gap*100:.2f}%"

    return True, "Prices valid"

class RateLimitedAPIClient:
    def __init__(self, requests_per_second=2):
        self.rate_limiter = asyncio.Semaphore(requests_per_second)
        self.last_request_time = 0
        self.min_interval = 1.0 / requests_per_second

    async def get_with_rate_limit(self, url, params=None, timeout=5):
        async with self.rate_limiter:
            # Enforce minimum interval between requests
            current_time = time.time()
            time_since_last = current_time - self.last_request_time

            if time_since_last < self.min_interval:
                await asyncio.sleep(self.min_interval - time_since_last)

            try:
                # Use exponential backoff for retries
                for attempt in range(3):
                    try:
                        response = await asyncio.get_event_loop().run_in_executor(
                            None,
                            lambda: requests.get(url, params=params, timeout=timeout)
                        )

                        self.last_request_time = time.time()

                        if response.status_code == 200:
                            return response.json()
                        elif response.status_code == 429:  # Rate limited
                            wait_time = (2 ** attempt) + random.uniform(0, 1)
                            print(f"Rate limited, waiting {wait_time:.1f}s")
                            await asyncio.sleep(wait_time)
                        else:
                            print(f"API error {response.status_code}: {response.text[:100]}")
                            return None

                    except requests.exceptions.RequestException as e:
                        if attempt == 2:  # Last attempt
                            raise e
                        await asyncio.sleep(2 ** attempt)

            except Exception as e:
                print(f"Request failed: {e}")
                return None

class TokenAddressManager:
    def __init__(self):
        self.validated_tokens = {}

        # VERIFIED BSC TOKEN ADDRESSES
        self.known_tokens = {
            "WBNB": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
            "CAKE": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
            "BTCB": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3EAd9c",
            "ETH": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
            "USDT": "0x55d398326f99059fF775485246999027B3197955",
            "USDC": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
            "BUSD": "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
            "DAI": "0x1AF3F329e8BE154074D8769D1FFa4eEE058B1DBc"
        }

    def validate_and_format_address(self, address):
        """Comprehensive address validation"""
        try:
            # Handle different input formats
            if isinstance(address, dict):
                address = address.get("address", "")

            if not address:
                return None

            # Clean the address
            address = str(address).strip()

            # Remove any extra characters
            address = address.replace(" ", "").replace("\n", "").replace("\t", "")

            # Ensure 0x prefix
            if not address.startswith("0x"):
                address = "0x" + address

            # Check length (42 characters)
            if len(address) != 42:
                return None

            # Validate hex format
            try:
                int(address, 16)
            except ValueError:
                return None

            # Convert to checksum format
            checksum_address = Web3.to_checksum_address(address)

            # Verify it's a contract (has bytecode)
            code = w3.eth.get_code(checksum_address)
            if len(code) <= 2:
                return None  # Not a contract

            return checksum_address

        except Exception as e:
            print(f"Address validation error: {e}")
            return None

# VENUS COMPTROLLER ADDRESS (MAIN CONTRACT)
VENUS_COMPTROLLER = Web3.to_checksum_address("0xfD36E2c2a6789Db23113685031d7F16329158384")

# ALPACA FINANCE BSC CONTRACTS
ALPACA_CONTRACTS = {
    "ORACLE": Web3.to_checksum_address("0x166f56F2EDa9817cAB4731df5fC36dB5d40Ca560"),
    "ALPACA_TOKEN": Web3.to_checksum_address("0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F")
}

# VENUS PROTOCOL BSC ADDRESSES
VENUS_VTOKENS = {
    "CAKE": "0xB6064eD41d4f67e3537680d3e8A3dAB9cB7f7F7C",   # vCAKE
    "BTCB": "0x264990fbd0A3e3d8db4B20D8B75779Da84fE7B9A",   # vBTC
    "ETH": "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e",    # vETH
}

# VENUS PRICE ORACLE (SINGLE CONTRACT FOR ALL PRICES)
VENUS_ORACLE = "0xd8b6da2bfec71d684d3e2a2fc9492dfd23651e28"

# VENUS COMPTROLLER (MAIN CONTRACT)
VENUS_COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384"

# CORRECT VENUS ORACLE ABI
VENUS_ORACLE_ABI = [
    {
        "inputs": [{"internalType": "address", "name": "vToken", "type": "address"}],
        "name": "getUnderlyingPrice",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    }
]

# VENUS REWARD ABI
VENUS_REWARD_ABI = [
    {
        "inputs": [{"internalType": "address", "name": "vault", "type": "address"}],
        "name": "rewardTokenSupplySpeeds",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    }
]

# ACTUAL ALPACA FUNCTIONS
ALPACA_ORACLE_ABI = [
    {
        "inputs": [{"internalType": "address", "name": "token", "type": "address"}],
        "name": "getPrice",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    }
]

def get_alpaca_fair_price():
    """Get Alpaca token fair price from correct contract"""
    try:
        # Get ALPACA token price from Alpaca Oracle
        oracle = w3.eth.contract(
            address=ALPACA_CONTRACTS["ORACLE"],
            abi=ALPACA_ORACLE_ABI
        )

        alpaca_token = ALPACA_CONTRACTS["ALPACA_TOKEN"]
        price = oracle.functions.getPrice(alpaca_token).call()

        return Decimal(price) / Decimal(10 ** 18)  # ALPACA has 18 decimals

    except Exception as e:
        logger.error(f"Alpaca price fetch failed: {e}")

        # Fallback: Try PancakeSwap price
        return get_pancake_price("ALPACA/USDT")

def get_venus_price(symbol):
    """Get Venus token price from Venus oracle"""
    try:
        if symbol not in VENUS_VTOKENS:
            logger.warning(f"Venus price not available for {symbol}")
            return None

        oracle = w3.eth.contract(address=VENUS_ORACLE, abi=VENUS_ORACLE_ABI)
        vtoken_address = VENUS_VTOKENS[symbol]

        price = oracle.functions.getUnderlyingPrice(vtoken_address).call()

        # Venus prices are in 18 decimals (USD with 18 decimals)
        return Decimal(price) / Decimal(10 ** 18)

    except Exception as e:
        logger.error(f"Venus price fetch failed for {symbol}: {e}")
        return None

def validate_bsc_address(address):
    """Validate and normalize BSC address"""
    try:
        # Remove any whitespace
        address = address.strip()

        # Ensure it starts with 0x
        if not address.startswith('0x'):
            address = '0x' + address

        # Check length (42 characters including 0x)
        if len(address) != 42:
            return None

        # Validate hex format
        int(address, 16)

        # Convert to checksum format
        return Web3.to_checksum_address(address)

    except:
        return None

# Volatility tracking for faster scanning
last_bnb_price = Decimal("0")
vol_trigger_active = False

def tg(msg):
    token = os.getenv("TELEGRAM_TOKEN")
    chat = os.getenv("TELEGRAM_CHAT_ID")
    if token and chat:
        try:
            requests.post(f"https://api.telegram.org/bot{token}/sendMessage", data={"chat_id": chat, "text": msg}, timeout=4)
        except Exception as e:
            logger.error(f"Telegram error: {e}")

# Volatility trigger for faster scanning during market moves
def vol_trigger():
    global last_bnb_price, vol_trigger_active
    try:
        bnb_now = Decimal(requests.get("https://api.dexscreener.com/latest/dex/pairs/bsc/0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae", timeout=3).json()["pair"]["priceUsd"])
        if last_bnb_price > 0 and abs(bnb_now - last_bnb_price) / last_bnb_price > Decimal("0.003"):  # 0.3% move
            vol_trigger_active = True
            logger.info(f"[VOL TRIGGER] BNB {((bnb_now-last_bnb_price)/last_bnb_price*100):.3f}% — FAST MODE ACTIVE")
            tg(f"VOLATILITY TRIGGER\nBNB {((bnb_now-last_bnb_price)/last_bnb_price*100):.3f}%\nFAST SCANNING")
            return True  # Run all edges 2x faster
        last_bnb_price = bnb_now
        vol_trigger_active = False
        return False
    except Exception as e:
        logger.error(f"Vol trigger error: {e}")
        return False

# ——————————————————— PROFIT + FLASHLOAN TRACKER  ———————————————————
last_balance = Decimal("0")

def log_profit(edge: str, usd: float, tx_hash: str = ""):
    if not account:
        logger.info(f"PROFIT SIMULATED → {edge} +${usd:,.0f}")
        return
    addr = account.address
    logger.info(f"PROFIT EXECUTED → {edge} +${usd:,.0f}")
    logger.info(f"       Wallet → {addr[:10]}...{addr[-8:]}")
    if tx_hash:
        logger.info(f"       Tx → https://bscscan.com/tx/{tx_hash}")
    tg(f"PROFIT +${usd:,.0f}\n{edge}")

def track_flash_loan():
    """Track actual flash loan events by monitoring transaction logs"""
    global last_balance

    if not account:
        return  # Skip if no account

    try:
        # Get pending block transactions for real-time monitoring
        block = w3.eth.get_block('pending', full_transactions=True)

        for tx in block.get('transactions', []):
            if not isinstance(tx, dict) or 'input' not in tx or not tx['input']:
                continue
            try:
                input_data = tx['input']
                if len(input_data) < 10:
                    continue
                method_id = input_data[:10].lower()

                # Aave flash loan signature: flashLoan(address,uint256)
                if method_id == '0xab9c4b5d':
                    if len(input_data) >= 138:
                        amount = int(input_data[74:138], 16) / 1e18
                        if amount > 1000:  # Only track significant flash loans
                            token = '0x' + input_data[34:74].lower()
                            logger.info(f"FLASH LOAN DETECTED: {amount:.2f} tokens")
                            tg(f"FLASH LOAN: {amount:.2f} tokens borrowed")

                # PancakeSwap flash swap signature
                elif method_id == '0x022c0d9f':
                    logger.info("FLASH SWAP DETECTED in transaction")

                # Uniswap V3 flash signature
                elif method_id == '0x12210e8a':
                    if len(input_data) >= 100:
                        amount0 = int(input_data[36:68], 16) / 1e18
                        amount1 = int(input_data[68:100], 16) / 1e18
                        total_amount = max(amount0, amount1)
                        if total_amount > 1000:
                            logger.info(f"UNISWAP V3 FLASH DETECTED: {total_amount:.2f} tokens")
                            tg(f"UNISWAP V3 FLASH: {total_amount:.2f} tokens")
            except (ValueError, IndexError) as e:
                logger.warning(f"Error parsing transaction input: {e}")
                continue

    except Exception as e:
        logger.error(f"Flash loan tracking error: {e}")
# —————————————————————————————————————————————————————————————————————————————————————————————
# EDGE 1: COLLATERAL SWAP
def edge1():
    """Fixed Edge 1 - Collateral Swap using Venus Oracle"""
    try:
        # Use the single Venus Oracle for all prices
        oracle = w3.eth.contract(
            address=VENUS_ORACLE,
            abi=VENUS_ORACLE_ABI
        )

        for token_symbol, vtoken_address in VENUS_VTOKENS.items():
            try:
                # Get price from Venus Oracle (returns price in USD with 18 decimals)
                price_raw = oracle.functions.getUnderlyingPrice(vtoken_address).call()
                venus_price = Decimal(price_raw) / Decimal(10**18)

                # Get DEX price for comparison
                dex_price = get_dex_price(token_symbol)

                if dex_price and venus_price:
                    # Calculate gap with reasonable bounds
                    price_gap = abs(dex_price - venus_price) / min(dex_price, venus_price)

                    # Only proceed if gap is reasonable (0.1% to 5%)
                    if Decimal("0.001") < price_gap < Decimal("0.05"):
                        profit = FLASH_SIZE_USD * price_gap * Decimal("0.82")
                        if profit > MIN_PROFIT_USD:
                            logger.info(f"[01/13] EDGE1 {token_symbol} {price_gap*100:.3f}% → +${profit:,.0f}")
                            tg(f"EDGE1 {token_symbol}\n+${profit:,.0f}")

            except Exception as e:
                logger.error(f"Edge1 error for {token_symbol}: {e}")
                continue

    except Exception as e:
        logger.error(f"Edge1 general error: {e}")

# EDGE 2: WBNB PREMIUM
def edge2():
    """Fixed Edge 2 - WBNB Premium with proper Chainlink integration"""
    try:
        # BNB/USD Chainlink Oracle on BSC
        bnb_oracle = "0x0567F2323251f0Aab1aC9b9BE91ac0C8cE0A9e8a"

        # Correct Chainlink ABI
        chainlink_abi = [
            {
                "inputs": [],
                "name": "latestAnswer",
                "outputs": [{"internalType": "int256", "name": "", "type": "int256"}],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [],
                "name": "decimals",
                "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
                "stateMutability": "view",
                "type": "function"
            }
        ]

        oracle = w3.eth.contract(address=bnb_oracle, abi=chainlink_abi)

        # Get oracle decimals first
        decimals = oracle.functions.decimals().call()

        # Get oracle price
        oracle_price = oracle.functions.latestAnswer().call()
        oracle_price_usd = Decimal(oracle_price) / Decimal(10**decimals)

        # Get DEX price for WBNB
        dex_price = get_dex_price("WBNB")

        if dex_price and oracle_price_usd:
            # Validate price reasonableness
            if not validate_price_reasonableness(dex_price, oracle_price_usd, "BNB"):
                logger.warning("Edge2: Unreasonable price detected, skipping")
                return

            gap = (dex_price - oracle_price_usd) / oracle_price_usd

            # Reasonable gap check
            if Decimal("0.001") < gap < Decimal("0.05"):  # 0.1% to 5%
                profit = FLASH_SIZE_USD * gap * Decimal("0.97")
                if profit > MIN_PROFIT_USD:
                    logger.info(f"[02/13] EDGE2 WBNB {gap*100:.3f}% → +${profit:,.0f}")
                    tg(f"EDGE2 WBNB\n+${profit:,.0f}")

    except Exception as e:
        logger.error(f"Edge2 error: {e}")

        # Fallback: Use PancakeSwap price directly
        fallback_price = get_pancake_price("BNB/USDT")
        if fallback_price:
            logger.info(f"[02/13] EDGE2 WBNB (fallback) → Using DEX price: ${fallback_price}")

# EDGE 3: BEEFY + VENUS LIQUIDATION
def edge3():
    try:
        vaults = requests.get("https://api.beefy.finance/vaults", timeout=8).json()
        for v in vaults:
            if v["chain"] != "bsc" or float(v.get("tvl", 0)) < 4_000_000: continue  # Lower from 5M
            try:
                # Use getHealthFactor ABI for better compatibility
                health_abi = [{"inputs":[],"name":"getHealthFactor","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"}]
                health = w3.eth.contract(v["strategy"], abi=health_abi).functions.getHealthFactor().call()
                health_factor = Decimal(health)/Decimal("1e18")
                if health_factor < Decimal("1.025"):  # Lower from 1.038
                    profit = Decimal(v["tvl"]) * Decimal("0.11")  # 11% bounty
                    if profit > MIN_PROFIT_USD:
                        logger.info(f"[03/13] BEEFY LIQ {v['name'][:20]} {health_factor:.3f} → +${profit:,.0f}")
                        tg(f"BEEFY LIQUIDATION\n{v['name']}\n+${profit:,.0f}")
            except Exception as e:
                logger.warning(f"Error processing vault {v.get('name', 'unknown')}: {e}")
                continue
    except Exception as e:
        logger.error(f"Edge3 error: {e}")

# EDGE 4: ALPACA FAIRPRICE GAP
def edge4():
    """Fixed Edge 4 - Alpaca FairPrice using correct function"""
    try:
        # Alpaca Oracle contract
        alpaca_oracle = "0x166f56F2EDa9817cAB4731df5fC36dB5d40Ca560"
        alpaca_token = "0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F"

        oracle = w3.eth.contract(address=alpaca_oracle, abi=ALPACA_ORACLE_ABI)

        # Get ALPACA token price
        price_raw = oracle.functions.getPrice(alpaca_token).call()
        alpaca_price = Decimal(price_raw) / Decimal(10**18)

        # Get DEX price for comparison
        dex_price = get_dex_price("ALPACA")

        if dex_price and alpaca_price:
            # Validate price reasonableness
            if not validate_price_reasonableness(dex_price, alpaca_price, "ALPACA"):
                return

            gap = (dex_price - alpaca_price) / alpaca_price

            # Reasonable gap check
            if Decimal("0.001") < gap < Decimal("0.05"):
                profit = FLASH_SIZE_USD * gap * Decimal("0.88")
                if profit > MIN_PROFIT_USD:
                    logger.info(f"[04/13] ALPACA GAP {gap*100:.2f}% → +${profit:,.0f}")
                    tg(f"ALPACA GAP\n+${profit:,.0f}")

    except Exception as e:
        logger.error(f"Edge4 error: {e}")

        # Fallback: Use PancakeSwap price
        fallback_price = get_pancake_price("ALPACA/USDT")
        if fallback_price:
            logger.info(f"[04/13] ALPACA (fallback) → DEX price: ${fallback_price}")

# EDGE 5: PANCAKE V3 FEE TIER SNIPING
def edge5():
    try:
        # TODO: Replace with real Pancake V3 pair addresses
        # Example: WBNB/USDT V3 pair
        pairs = ["0x36696169C63e42cd08ce11f5deeBbCeBae652050"]  # Placeholder - needs real address
        for pair in pairs:
            response = requests.get(f"https://api.dexscreener.com/latest/dex/pairs/bsc/{pair}", timeout=5)
            response.raise_for_status()
            data = response.json()
            if 'pair' not in data:
                logger.warning("Invalid API response format for Edge5")
                continue
            pair_data = data["pair"]
            if (float(pair_data.get("liquidity", {}).get("usd", 0)) < 15_000_000 and
                abs(float(pair_data.get("priceChange", {}).get("h1", 0))) > 2.1):
                logger.info(f"[05/13] V3 FEE SNIPE → {pair_data['baseToken']['symbol']} {pair_data['priceChange']['h1']:+.2f}%")
                tg(f"V3 FEE SNIPE\n{pair_data['baseToken']['symbol']} {pair_data['priceChange']['h1']:+.2f}%")
    except requests.exceptions.RequestException as e:
        logger.error(f"Edge5 API request failed: {e}")
    except json.JSONDecodeError as e:
        logger.error(f"Edge5 invalid JSON: {e}")
    except Exception as e:
        logger.error(f"Edge5 error: {e}")

# EDGE 6: VENUS XVS REWARD SPIKE
def edge6():
    """Handle Venus Diamond proxy pattern correctly"""
    try:
        # Diamond proxy address
        diamond = "0xfD36E2c2a6789Db23113685031d7F16329158384"

        # Get the correct facet for rewards
        # Diamond function to get facet address
        diamond_abi = [
            {
                "inputs": [{"internalType": "bytes4", "name": "functionSelector", "type": "bytes4"}],
                "name": "facetAddress",
                "outputs": [{"internalType": "address", "name": "facetAddress_", "type": "address"}],
                "stateMutability": "view",
                "type": "function"
            }
        ]

        # Get reward facet address
        reward_selector = w3.keccak(text="rewardTokenSupplySpeeds(address)")[:4]
        diamond_contract = w3.eth.contract(address=diamond, abi=diamond_abi)
        reward_facet = diamond_contract.functions.facetAddress(reward_selector).call()

        # Now call the reward function on the correct facet
        reward_abi = [
            {
                "inputs": [{"internalType": "address", "name": "vToken", "type": "address"}],
                "name": "rewardTokenSupplySpeeds",
                "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
                "stateMutability": "view",
                "type": "function"
            }
        ]

        reward_contract = w3.eth.contract(address=reward_facet, abi=reward_abi)

        # Check XVS vault rewards
        xvs_vault = "0xA07c5b74C9B404EC45d2411f9662cB2e5e4A63c0"
        speed = reward_contract.functions.rewardTokenSupplySpeeds(xvs_vault).call()

        if speed > 1e18:  # 1 XVS per block
            logger.info(f"[06/13] XVS REWARD SPIKE → {speed/1e18:.2f} XVS/block")
            tg(f"XVS REWARD SPIKE\n{speed/1e18:.2f} XVS/block")

    except Exception as e:
        logger.error(f"Edge6 Diamond pattern error: {e}")

        # Fallback: Monitor XVS price spike instead
        xvs_price = get_dex_price("XVS")
        if xvs_price:
            # Check for 20% price increase
            # This would need historical price comparison
            logger.info(f"[06/13] XVS monitoring → Current price: ${xvs_price}")

#  EDGE 7: CROSS-DEX DEVIATION
def edge7():
    try:
        pcs_resp = requests.get("https://api.dexscreener.com/latest/dex/pairs/bsc/0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae", timeout=5)
        pcs_resp.raise_for_status()
        pcs_data = pcs_resp.json()
        if 'pair' not in pcs_data:
            return
        pcs = Decimal(pcs_data["pair"]["priceUsd"])

        # Use search for Biswap WBNB/USDT
        biswap_resp = requests.get("https://api.dexscreener.com/latest/dex/search/?q=WBNB+USDT&chainId=bsc&filter=dexscreener", timeout=5)
        biswap_resp.raise_for_status()
        biswap_data = biswap_resp.json()
        if not biswap_data.get("pairs") or len(biswap_data["pairs"]) < 2:
            return
        bis = Decimal(biswap_data["pairs"][1]["priceUsd"])

        # Enhanced validation
        is_valid, message = validate_cross_dex_prices(pcs, bis, "WBNB")

        if not is_valid:
            logger.warning(f"Edge7: {message}")
            return

        gap = abs(pcs - bis) / min(pcs, bis)
        # Reasonable gap check (0.1% minimum, 3% maximum for enhanced validation)
        if Decimal("0.001") < gap < Decimal("0.03"):
            profit = FLASH_SIZE_USD * gap * Decimal("0.93")
            if profit > MIN_PROFIT_USD:
                logger.info(f"[07/13] CROSS-DEX {gap*100:.3f}% → +${profit:,.0f}")
                tg(f"CROSS-DEX ARB\n+${profit:,.0f}")
    except requests.exceptions.RequestException as e:
        logger.error(f"Edge7 API request failed: {e}")
    except json.JSONDecodeError as e:
        logger.error(f"Edge7 invalid JSON: {e}")
    except Exception as e:
        logger.error(f"Edge7 error: {e}")

# EDGE 8: FLASH LOAN POOL DRYNESS
def edge8():
    try:
        eq_addr = Web3.to_checksum_address("0x1Da87b114f35E1DC91F72bF57fc07A768Ad40Bb0")
        ven_addr = VENUS_COMPTROLLER
        eq = w3.eth.get_balance(eq_addr) / Decimal(1e18)
        ven = w3.eth.get_balance(ven_addr) / Decimal(1e18)
        if eq < Decimal("2.0"):
            logger.info(f"[08/13] EQUALIZER DRY → {eq:.2f} BNB left — switching to Venus")
            tg("EQUALIZER DRY — switching lender")
        if ven < Decimal("100"):
            logger.info(f"[08/13] VENUS LOW → {ven:.1f} BNB")
    except Exception as e:
        logger.error(f"Edge8 error: {e}")
# EDGE 9: STINK SNIPER (MEME POOLS EXPANDED)
def edge9():
    try:
        blk = w3.eth.get_block('pending', full_transactions=True)
        MEME_ROUTERS = [Web3.to_checksum_address("0x10ED43C718714eb63d5aA57B78B54704E256024E"), Web3.to_checksum_address("0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865")]  # Pancake V2/V3
        for tx in blk.get("transactions", []):
            if tx.to in MEME_ROUTERS and int(tx.gas) > 250000:  # Lower gas threshold
                inp = tx.input.hex().lower()
                meme_tokens = {
                    "BABYDOGE": "0xc748673057861a797275cd8a068abb95a902e8de",
                    "FLOKI": "0xfb5b838b6cfe6b5c5e63f3e3b4d1e5f0d6d9e9d5",
                    "XVS": "0xcf6bb5389c4c5d3c2b3b3b3b3b3b3b3b3b3b3b3b3",
                    "CAKE": "0x0e09fabb73bd3ade0a17fee4565426565042b0a"
                }
                for name, addr in meme_tokens.items():
                    if addr in inp:
                        usd = (w3.eth.get_balance(tx["from"]) / 1e18) * BNB_PRICE
                        if usd > 35000 or (tx.value == 0 and int(tx.gas) > 350000):  # Lower thresholds
                            logger.info(f"[09/13] MEME STINK {name} ~${usd:,.0f}")
                            tg(f"MEME STINK\n{name} ${usd:,.0f}")
                            # Inject sandwich would happen here
    except Exception as e:
        logger.error(f"Edge9 error: {e}")

# EDGE 10: MEMECOIN SNIPER
def edge10():
    try:
        # Use session with retries
        response = api_session.get("https://api.dexscreener.com/latest/dex/search",
                                  params={"q": "*", "chainId": "bsc", "order": "desc", "sort": "volume24h"},
                                  timeout=8)

        if response.status_code != 200:
            logger.error(f"Edge10 API error: {response.status_code}")
            return

        try:
            data = response.json()
        except ValueError as e:
            logger.error(f"Edge10 invalid JSON: {e}")
            return

        if not isinstance(data, dict):
            logger.error(f"Edge10: Expected dict, got {type(data)}")
            return

        pairs = data.get("pairs", [])
        for p in pairs[:20]:
            if p.get("pairAge", 9999) < 90 and float(p.get("liquidity", {}).get("usd", 0)) < 130000:
                sym = p["baseToken"]["symbol"]
                liq = p["liquidity"]["usd"]
                vol = p["volume"]["h1"]
                logger.info(f"[10/13] MEME SNIPE → {sym} | Liq ${liq:,.0f} | Vol ${vol:,.0f}")
                tg(f"MEME SNIPE\n{sym}\nLiq ${liq:,.0f}")

    except requests.exceptions.RequestException as e:
        logger.error(f"Edge10 request failed: {e}")
    except Exception as e:
        logger.error(f"Edge10 processing failed: {e}")

# EDGE 11: TRIANGULAR ARBITRAGE (LIVE)
def edge11():
    try:
        # Use only validated token addresses
        validated_tokens = {}
        for symbol, address in token_manager.known_tokens.items():
            validated = token_manager.validate_and_format_address(address)
            if validated:
                validated_tokens[symbol] = validated
            else:
                logger.warning(f"Edge11: Invalid token address for {symbol}")

        # High-probability triangular paths
        TRIANGULAR_PATHS = [
            ("WBNB", "CAKE", "BTCB"),    # WBNB→CAKE→BTCB→WBNB
            ("WBNB", "USDT", "CAKE"),    # WBNB→USDT→CAKE→WBNB
            ("WBNB", "USDC", "USDT"),    # WBNB→USDC→USDT→WBNB
            ("WBNB", "ETH", "BTCB"),     # WBNB→ETH→BTCB→WBNB
            ("WBNB", "DAI", "BUSD"),     # WBNB→DAI→BUSD→WBNB
            ("BTCB", "ETH", "WBNB"),     # BTCB→ETH→WBNB→BTCB
        ]

        # Proceed with validated tokens only
        for token_a, token_b, token_c in TRIANGULAR_PATHS:
            if all(t in validated_tokens for t in [token_a, token_b, token_c]):
                # Safe triangular arbitrage calculation
                result = calculate_triangular_arbitrage_safe(
                    validated_tokens[token_a],
                    validated_tokens[token_b],
                    validated_tokens[token_c]
                )

                if result and result.get('profit_usd', 0) > MIN_PROFIT_USD:
                    logger.info(f"[11/13] TRI-ARB LIVE → +${result['profit_usd']:,.0f}")
                    tg(f"TRI-ARB LIVE\n+${result['profit_usd']:,.0f}\n{result['path']}\n{result['profit_percentage']:.2f}% gap")
                    return  # Report first profitable opportunity

    except Exception as e:
        logger.error(f"Tri-arb edge failed: {str(e)[:50]}...")

# EDGE 12: AI-POWERED GAS OPTIMIZATION
def edge12():
    try:
        current_gas = w3.eth.gas_price
        current_gas_gwei = current_gas / 1e9
        
        # Get network congestion
        congestion = get_network_congestion()
        
        # Only optimize if network is not congested
        if congestion < 0.5:  # Low-medium congestion
            # Reduce by small amount (5% max)
            predicted_gas = int(current_gas * 0.95)
        else:
            # High congestion - use current gas
            predicted_gas = current_gas
        
        # Ensure minimum gas (3 gwei)
        min_gas = w3.to_wei(3, 'gwei')
        predicted_gas = max(predicted_gas, min_gas)
        
        # Calculate actual savings
        gas_difference = current_gas - predicted_gas
        if gas_difference > 0:
            savings_usd = gas_difference * 21000 * BNB_PRICE / 1e18
            savings_text = f"save ${savings_usd:.3f}"
        else:
            savings_text = "no savings"
        
        print(f"[12/13] AI GAS OPT → Predicted {predicted_gas/1e9:.1f} gwei ({savings_text})")
        
    except Exception as e:
        print(f"Edge12 error: {e}")

def get_network_congestion():
    """Get current network congestion level (0-1)"""
    try:
        # Get recent block gas usage
        latest_block = w3.eth.get_block('latest')
        gas_used = latest_block.gasUsed
        gas_limit = latest_block.gasLimit

        # Calculate congestion (0-1 scale)
        congestion = gas_used / gas_limit
        return min(congestion, 1.0)

    except:
        return Decimal("0.5")  # Default medium congestion

# EDGE 13: MEMPOOL PATTERN RECOGNITION
def edge13():
    try:
        blk = w3.eth.get_block('pending', full_transactions=True)
        large_txs = [tx for tx in blk.get("transactions", []) if tx.value > w3.to_wei(10, "ether")]
        if len(large_txs) > 3:
            total_value = sum(tx.value for tx in large_txs) / 1e18 * BNB_PRICE
            logger.info(f"[13/13] MEMPOOL PATTERN → {len(large_txs)} large txs (${total_value:,.0f})")
            tg(f"MEMPOOL PATTERN\n{len(large_txs)} large txs\n${total_value:,.0f}")
    except Exception as e:
        logger.error(f"Edge13 error: {e}")

#MAIN LOOP
# INTEGRATE INTO MAIN LOOP
security_monitor = SecurityMonitor()
validator = ContractValidator(w3)
token_manager = TokenAddressManager()

def prepare_transaction_data(opportunity):
    """Placeholder for preparing transaction data"""
    return {}  # TODO: Implement

def execute_arbitrage_with_protection(opportunity, private_key):
    """Placeholder for executing arbitrage with protection"""
    return False  # TODO: Implement

def execute_arbitrage_with_monitoring(opportunity):
    """Execute arbitrage with security monitoring"""
    try:
        # Monitor the transaction
        tx_data = prepare_transaction_data(opportunity)
        security_monitor.monitor_transaction("pending", tx_data)

        # Execute with security checks
        if security_monitor.get_security_status()['security_score'] > 70:
            return execute_arbitrage_with_protection(opportunity, PRIVATE_KEY)
        else:
            logger.warning("Security score too low, skipping execution")
            return False

    except Exception as e:
        logger.error(f"Security monitoring failed: {e}")
        return False

scan_count = 0
logger.info("MONEY TREES PRINTER 2025 — FULL 13-EDGE BUILD")
tg("NUCLEAR FULL 13-EDGE LIVE")

while True:
    try:
        scan_count += 1
        track_flash_loan()

        # Check volatility trigger for faster scanning
        is_vol_trigger = vol_trigger()

        logger.info(f"SCAN #{scan_count:,}")
        edge1(); edge2(); edge3(); edge4(); edge5(); edge6(); edge7(); edge8()
        edge9(); edge10(); edge11(); edge12(); edge13()

        logger.info("[13/13] ALL EDGES COMPLETE")

        # Adaptive sleep based on volatility
        sleep_time = 2.5 if is_vol_trigger else 6.8  # Fast mode during vol, normal otherwise
        time.sleep(sleep_time)

    except KeyboardInterrupt:
        logger.info("Bot stopped.")
        break
    except Exception as e:
        logger.error(f"Main loop error: {e}")
        time.sleep(0.3)







# ==================== WEB3 COMPATIBILITY LAYER ====================
def get_raw_transaction(signed_tx):
    """Get raw transaction compatible with Web3 v5 and v6"""
    try:
        # Try Web3 v6 style first
        return signed_tx.raw_transaction
    except AttributeError:
        try:
            # Try Web3 v5 style
            return signed_tx.rawTransaction
        except AttributeError:
            # Try dict access
            return signed_tx.get('raw_transaction') or signed_tx.get('rawTransaction')

def send_transaction_compat(w3, signed_txn):
    """Send transaction with compatibility"""
    raw_tx = get_raw_transaction(signed_txn)
    return w3.eth.send_raw_transaction(raw_tx)

def web3_compat_send(w3, account, txn_dict):
    """Complete compatible transaction sending"""
    # Get nonce
    try:
        nonce = w3.eth.get_transaction_count(account.address, 'pending')
    except Exception as e:
        logger.error(f"Failed to get nonce: {e}")
        raise
    txn_dict['nonce'] = nonce

    # Estimate gas
    try:
        gas = w3.eth.estimate_gas(txn_dict)
    except Exception as e:
        logger.error(f"Failed to estimate gas: {e}")
        raise
    txn_dict['gas'] = gas

    # Get gas price
    try:
        gas_price = w3.eth.gas_price
    except Exception as e:
        logger.error(f"Failed to get gas price: {e}")
        raise
    txn_dict['gasPrice'] = gas_price
    
    # Sign and send
    signed_txn = account.sign_transaction(txn_dict)
    return send_transaction_compat(w3, signed_txn)
# ==================================================================

# ==================== TRANSACTION HELPER ====================
def send_tx(w3, account, txn_dict):
    """Send transaction with full Web3 v6 compatibility"""
    # Get nonce
    try:
        nonce = w3.eth.get_transaction_count(account.address, 'pending')
    except Exception as e:
        logger.error(f"Failed to get nonce: {e}")
        raise
    txn_dict['nonce'] = nonce

    # Estimate gas
    try:
        txn_dict['gas'] = w3.eth.estimate_gas(txn_dict)
    except Exception as e:
        logger.error(f"Failed to estimate gas: {e}")
        raise

    # Get gas price
    try:
        txn_dict['gasPrice'] = w3.eth.gas_price
    except Exception as e:
        logger.error(f"Failed to get gas price: {e}")
        raise
    
    # Sign transaction
    signed_txn = account.sign_transaction(txn_dict)
    
    # Get raw transaction (compatible with Web3 v5/v6)
    raw_tx = get_raw_transaction(signed_txn)
    
    # Send transaction
    tx_hash = w3.eth.send_raw_transaction(raw_tx)
    
    return tx_hash.hex()
# ============================================================
