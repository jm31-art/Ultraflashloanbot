import os
import json
import requests
import logging
import asyncio
import threading
from typing import Dict, List, Optional, Tuple, Any
from web3 import Web3
from web3.contract import Contract
import time
try:
    from .pattern_detector import PatternDetector
    from .token_info import TOKEN_DECIMALS
except ImportError:
    from ai.pattern_detector import PatternDetector
    from ai.token_info import TOKEN_DECIMALS

# Initialize pattern detector
pattern_detector = PatternDetector()
from concurrent.futures import ThreadPoolExecutor, as_completed

def adjust_price_impact_threshold(amount: int, token: str) -> float:
    """Dynamically adjust price impact threshold based on trade size"""
    base_threshold = 0.05  # 5% base threshold for small trades
    
    # Convert amount to human readable
    decimals = TOKEN_DECIMALS.get(token, 18)
    amount_readable = amount / (10 ** decimals)
    
    # Much more lenient thresholds for large trades to capture opportunities
    if amount_readable > 10000:  # Mega trades
        return 0.50  # Allow up to 50% impact for very large opportunities
    elif amount_readable > 5000:  # Very large trades
        return 0.40  # Allow up to 40% impact
    elif amount_readable > 1000:  # Large trades
        return 0.30  # Allow up to 30% impact
    elif amount_readable > 500:
        return 0.20  # Allow up to 20% impact
    elif amount_readable > 100:
        return 0.10  # Allow up to 10% impact
    return base_threshold

# Token addresses
WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
BTCB = "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c"
USDT = "0x55d398326f99059fF775485246999027B3197955"
BUSD = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56"

# Token symbols mapping
TOKEN_SYMBOLS = {
    WBNB: "BNB",
    BTCB: "BTC",
    USDT: "USDT",
    BUSD: "BUSD"
}

def get_token_symbol(address: str) -> str:
    """Get token symbol from address"""
    return TOKEN_SYMBOLS.get(address, "UNKNOWN")

# Priority pairs for arbitrage
PRIORITY_PAIRS = [
    (BTCB, WBNB),   # BTC-BNB pair
    (BTCB, USDT),   # BTC-USDT pair
    (BTCB, BUSD),   # BTC-BUSD pair
    (WBNB, USDT),   # BNB-USDT pair
    (WBNB, BUSD),   # BNB-BUSD pair
]

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('arbitrage.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Load environment variables
ONEINCH_API_KEY = os.getenv("ONEINCH_API_KEY")
ONEINCH_API = "https://api.1inch.dev/swap/v5.2/56/quote"  # BSC network (56)
USE_1INCH = False  # Disable 1inch if no API key

# DEX Router ABIs
def load_abi(filename: str) -> dict:
    try:
        # Try current directory first
        if os.path.exists(filename):
            with open(filename) as f:
                return json.load(f)
        
        # Try parent directory
        parent_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), filename)
        if os.path.exists(parent_path):
            with open(parent_path) as f:
                return json.load(f)
                
        logger.error(f"Could not find ABI file: {filename}")
        return {}
    except Exception as e:
        logger.error(f"Error loading ABI {filename}: {str(e)}")
        return {}

PANCAKE_ABI = load_abi('pancakeswap_router_abi.json')
BISWAP_ABI = load_abi('biswap_router_abi.json')
APESWAP_ABI = load_abi('apeswap_router_abi.json')

# Router addresses
PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E"
APESWAP_ROUTER = "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7"
BISWAP_ROUTER = "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8"

# Rate limiting and error handling
RATE_LIMIT_DELAY = 1  # seconds between API calls
MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds between retries
last_api_call = 0

def get_api_headers() -> Dict[str, str]:
    return {
        "accept": "application/json",
        "Authorization": f"Bearer {ONEINCH_API_KEY}"
    }

def rate_limit():
    global last_api_call
    now = time.time()
    if now - last_api_call < RATE_LIMIT_DELAY:
        time.sleep(RATE_LIMIT_DELAY - (now - last_api_call))
    last_api_call = time.time()

def fetch_1inch_quote(token_in: str, token_out: str, amount: int) -> Optional[Tuple[float, List[str]]]:
    """Fetch quote from 1inch with improved error handling and rate limiting"""
    rate_limit()
    
    params = {
        "fromTokenAddress": token_in,
        "toTokenAddress": token_out,
        "amount": str(amount),
    }
    
    try:
        response = requests.get(ONEINCH_API, params=params, headers=get_api_headers())
        response.raise_for_status()
        
        data = response.json()
        to_amount = int(data.get("toTokenAmount", 0))
        protocols = data.get("protocols", [[]])
        
        # Extract actual route from protocols
        route = []
        for step in protocols[0]:
            for protocol in step:
                route.append(protocol.get("name", "unknown"))
        
        return to_amount, route
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Error fetching 1inch quote: {str(e)}")
        return None
    except (KeyError, ValueError, TypeError) as e:
        logger.error(f"Error parsing 1inch response: {str(e)}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error in fetch_1inch_quote: {str(e)}")
        return None

def check_dex_price(web3: Web3, router_address: str, router_abi: List[Any], token_in: str, token_out: str, amount: int) -> Optional[Tuple[int, str, float, str]]:
    """Check price for a specific DEX with optimized liquidity validation for arbitrage"""
    try:
        router = web3.eth.contract(address=router_address, abi=router_abi)
        
        # First check quick small amount to validate pool health
        quick_check_amount = amount // 100
        try:
            quick_amounts = router.functions.getAmountsOut(quick_check_amount, [token_in, token_out]).call()
            if not quick_amounts or quick_amounts[1] <= 0:
                return None  # Pool is not healthy
        except Exception:
            return None  # Pool has issues
        
        # Check liquidity depth with multiple sample sizes
        amounts = router.functions.getAmountsOut(amount, [token_in, token_out]).call()
        
        # Calculate price impact with improved accuracy and slippage protection
        try:
            # Use multiple test amounts to better gauge liquidity
            test_amounts = [amount//1000, amount//100, amount//10] if amount >= 1000 else [amount//100]
            impacts = []
            
            for test_amount in test_amounts:
                if test_amount <= 0:
                    continue
                    
                amounts_small = router.functions.getAmountsOut(test_amount, [token_in, token_out]).call()
                if not amounts_small or len(amounts_small) < 2 or amounts_small[1] <= 0:
                    continue
                    
                expected_large = amounts_small[1] * (amount // test_amount)
                if expected_large <= 0:
                    continue
                    
                impact = (expected_large - amounts[1]) / expected_large
                impacts.append(impact)
            
            # Use the most favorable impact if we have multiple measurements
            price_impact = min(impacts) if impacts else 1.0
        except ZeroDivisionError:
            logger.error("Zero division error in price impact calculation")
            return None
        except Exception as e:
            logger.error(f"Error calculating price impact: {str(e)}")
            return None
        
        # Get token symbols
        pair_name = f"{get_token_symbol(token_in)}-{get_token_symbol(token_out)}"
        
        # Get dynamic price impact threshold
        threshold = adjust_price_impact_threshold(amount, token_in)
        
        if price_impact > threshold:
            logger.warning(f"High price impact ({price_impact*100:.2f}%) detected for {router_address} (threshold: {threshold*100:.2f}%)")
            # Instead of returning None, return the result with price impact for evaluation
            
        # Return tuple with all info for better decision making
        return {
            "output_amount": amounts[1],
            "router_address": router_address,
            "price_impact": price_impact,
            "pair_name": pair_name
        }
    except Exception as e:
        logger.error(f"Error checking price on {router_address}: {str(e)}")
        return None

def check_direct_profitable_path(web3: Web3, token_in: str, token_out: str, amount: int) -> Optional[Dict]:
    """Check for direct profitable trades between two tokens across DEXes"""
    try:
        # Check prices in parallel
        results = []
        with ThreadPoolExecutor(max_workers=4) as executor:
            future_to_dex = {
                executor.submit(check_dex_price, web3, PANCAKE_ROUTER, PANCAKE_ABI, token_in, token_out, amount): "PancakeSwap",
                executor.submit(check_dex_price, web3, APESWAP_ROUTER, APESWAP_ABI, token_in, token_out, amount): "ApeSwap", 
                executor.submit(check_dex_price, web3, BISWAP_ROUTER, BISWAP_ABI, token_in, token_out, amount): "BiSwap"
            }
            
            for future in as_completed(future_to_dex):
                dex_name = future_to_dex[future]
                try:
                    result = future.result()
                    if result and isinstance(result, dict):
                        result['dex_name'] = dex_name
                        results.append(result)
                except Exception as e:
                    logger.error(f"Error checking {dex_name}: {str(e)}")
                    continue
        
        if not results:
            return None
            
        # Find most profitable result accounting for fees
        best_profit = None
        for result in results:
            output_amount = result['output_amount']
            profit = output_amount - (amount * 1.003)  # Account for 0.3% fees
            profit_percentage = (profit / amount) * 100
            
            if profit > 0 and (not best_profit or profit > best_profit['profit']):
                best_profit = {
                    'route': [token_in, token_out],
                    'profit': profit,
                    'profit_percentage': profit_percentage,
                    'output_amount': output_amount,
                    'dex': result['dex_name'],
                    'price_impact': result['price_impact']
                }
        
        return best_profit
    except Exception as e:
        logger.error(f"Error in check_direct_profitable_path: {str(e)}")
        return None

def get_best_route(token_in: str, token_out: str, amount: int) -> Dict:
    """
    Get the best trading route across multiple DEXes with parallel price checking
    and proper error handling.
    """
    logger.info(f"Finding best route for {amount} from {token_in} to {token_out}")
    
    try:
        # Initialize Web3 with default BSC RPC if environment variable not set
        BSC_RPC = os.getenv('BSC_RPC', 'https://bsc-dataseed1.binance.org/')
        web3 = Web3(Web3.HTTPProvider(BSC_RPC))
        
        # For token-to-token trades, check direct profitable opportunities first
        if token_in != WBNB and token_out != WBNB:
            # Try direct swap first
            direct_result = check_direct_profitable_path(web3, token_in, token_out, amount)
            if direct_result and direct_result["profit_percentage"] > 1.0:
                logger.info(f"Found direct profitable trade with {direct_result['profit_percentage']:.2f}% profit!")
                return direct_result
                
            # If no direct profit, try via BNB
            bnb_result = check_direct_profitable_path(web3, token_in, WBNB, amount)
            if bnb_result and bnb_result["profit_percentage"] > 0.5:  # Lower threshold for first step
                logger.info(f"Taking BNB profit of {bnb_result['profit_percentage']:.2f}% and storing in wallet")
                return bnb_result  # Take the BNB profit instead of continuing to USDT
        
        # Check prices in parallel
        best_amount = 0
        best_route = None
        best_dex = None
        
        with ThreadPoolExecutor(max_workers=4) as executor:
            future_to_dex = {
                executor.submit(check_dex_price, web3, PANCAKE_ROUTER, PANCAKE_ABI, token_in, token_out, amount): "PancakeSwap",
                executor.submit(check_dex_price, web3, APESWAP_ROUTER, APESWAP_ABI, token_in, token_out, amount): "ApeSwap",
                executor.submit(check_dex_price, web3, BISWAP_ROUTER, BISWAP_ABI, token_in, token_out, amount): "BiSwap"
            }
            
            # Only add 1inch if enabled and API key exists
            if USE_1INCH and ONEINCH_API_KEY:
                future_to_dex[executor.submit(fetch_1inch_quote, token_in, token_out, amount)] = "1inch"
            
            # Collect all valid results
            dex_results = []
            
            for future in as_completed(future_to_dex):
                dex_name = future_to_dex[future]
                try:
                    result = future.result()
                    if result and isinstance(result, dict):
                        result['dex_name'] = dex_name
                        dex_results.append(result)
                        logger.info(f"Got quote from {dex_name}: {web3.from_wei(result['output_amount'], 'ether')} tokens, "
                                  f"Impact: {result['price_impact']*100:.2f}%")
                except Exception as e:
                    logger.error(f"Error checking {dex_name}: {str(e)}")
                    continue
                    
            # Sort results by effective output after impact
            def score_result(result):
                output = result['output_amount']
                impact = result['price_impact']
                # Favor trades with higher output and lower impact
                return output * (1 - impact * 0.5)  # Impact weighted at 50%
                
            dex_results.sort(key=score_result, reverse=True)
            
            # Profit capturing and loss minimization strategy
            profits_found = []
            
            # First pass - identify all profitable opportunities
            for result in dex_results:
                output_amount = result['output_amount']
                price_impact = result['price_impact']
                dex_name = result['dex_name']
                
                # Calculate net profit after fees and impact
                profit_after_fees = output_amount - (amount * 1.003)  # Account for 0.3% fees
                if profit_after_fees > 0:
                    profits_found.append({
                        'dex': dex_name,
                        'output': output_amount,
                        'impact': price_impact,
                        'net_profit': profit_after_fees,
                        'profit_percentage': (profit_after_fees / amount) * 100
                    })
            
            # Sort profits by net value and minimize risk
            if profits_found:
                # Sort by profit/risk ratio
                profits_found.sort(key=lambda x: x['net_profit'] * (1 - x['impact']), reverse=True)
                best_profit = profits_found[0]
                
                # If we have a good profit, take it immediately
                if best_profit['profit_percentage'] > 1.0:  # Over 1% profit
                    best_amount = best_profit['output']
                    best_route = [token_in, token_out]
                    best_dex = best_profit['dex']
                    logger.info(f"Profitable route found via {best_dex} with {best_profit['profit_percentage']:.2f}% profit "
                              f"(impact: {best_profit['impact']*100:.2f}%)")
        
        if best_amount > 0:
            profit = best_amount - amount
            profit_percentage = (profit / amount) * 100
            
            logger.info(f"Best route found via {best_dex} with {profit_percentage:.2f}% profit")
            
            return {
                "route": best_route,
                "profit": profit,
                "profit_percentage": profit_percentage,
                "output_amount": best_amount,
                "dex": best_dex
            }
        
        logger.warning("No profitable route found")
        return {
            "route": [],
            "profit": 0,
            "profit_percentage": 0,
            "output_amount": 0,
            "error": "No profitable route found"
        }
        
    except Exception as e:
        logger.error(f"Error in get_best_route: {str(e)}")
        return {
            "route": [],
            "profit": 0,
            "profit_percentage": 0,
            "output_amount": 0,
            "error": str(e)
        }
