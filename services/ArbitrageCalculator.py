# services/ArbitrageCalculator.py
import argparse
from decimal import Decimal
from web3 import Web3
import requests
import time
import os
from dotenv import load_dotenv

load_dotenv()

# === TOKEN ADDRESSES (BSC) ===
WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
USDT = "0x55d398326f99059fF775485246999027B3197955"
USDC = "0x8AC76a51cc950d9822D68b83fE1Ad004bD0C0b1E"
BUSD = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56"
FDUSD = "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409"
CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
BTCB = "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3EAd9c"

# PancakeSwap V2 Router & Factory
ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E"
FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73"

# RPC
RPC = os.getenv("BSC_RPC", "https://bsc-dataseed.binance.org/")
w3 = Web3(Web3.HTTPProvider(RPC))

# Base tokens for triangular arbitrage
BASE_TOKENS = [USDT, USDC, BUSD, FDUSD, BTCB, CAKE, WBNB]

# Generate all possible triangular paths dynamically
def generate_multi_hop_paths():
    """Generate multi-hop arbitrage paths (3-6 hops)"""
    paths = []

    # Triangular arbitrage (3 hops)
    for token_a in BASE_TOKENS:
        for token_b in BASE_TOKENS:
            if token_a == token_b:
                continue
            for token_c in BASE_TOKENS:
                if token_c == token_a or token_c == token_b:
                    continue
                # Create triangular path: A -> B -> C -> A
                path = [token_a, token_b, token_c, token_a]
                path_name = f"{get_token_symbol(token_a)}→{get_token_symbol(token_b)}→{get_token_symbol(token_c)}→{get_token_symbol(token_a)}"
                paths.append({
                    "name": path_name,
                    "path": path,
                    "start": token_a,
                    "hops": 3
                })

    # Quadruple arbitrage (4 hops) - more complex but potentially higher profit
    for token_a in BASE_TOKENS:
        for token_b in BASE_TOKENS:
            if token_a == token_b:
                continue
            for token_c in BASE_TOKENS:
                if token_c == token_a or token_c == token_b:
                    continue
                for token_d in BASE_TOKENS:
                    if token_d == token_a or token_d == token_b or token_d == token_c:
                        continue
                    # Create quadruple path: A -> B -> C -> D -> A
                    path = [token_a, token_b, token_c, token_d, token_a]
                    path_name = f"{get_token_symbol(token_a)}→{get_token_symbol(token_b)}→{get_token_symbol(token_c)}→{get_token_symbol(token_d)}→{get_token_symbol(token_a)}"
                    paths.append({
                        "name": path_name,
                        "path": path,
                        "start": token_a,
                        "hops": 4
                    })

    return paths

def get_token_symbol(address):
    """Get token symbol from address"""
    symbols = {
        USDT: "USDT", USDC: "USDC", BUSD: "BUSD", FDUSD: "FDUSD",
        BTCB: "BTCB", CAKE: "CAKE", WBNB: "BNB"
    }
    return symbols.get(address, address[:6])

def calculate_optimal_position_size(path_info: dict) -> Decimal:
    """Calculate optimal position size based on liquidity, volatility, and risk parameters"""
    path = path_info["path"]
    base_token = path_info["start"]

    # Get liquidity for each pair in the path
    min_liquidity = float('inf')
    total_liquidity = 0

    for i in range(len(path) - 1):
        try:
            # Estimate liquidity for the pair (simplified - would need actual pool data)
            pair_liquidity = estimate_pair_liquidity(path[i], path[i+1])
            min_liquidity = min(min_liquidity, pair_liquidity)
            total_liquidity += pair_liquidity
        except:
            return Decimal("5000")  # Conservative fallback

    if min_liquidity == float('inf'):
        return Decimal("5000")  # Conservative fallback

    # Calculate position size as percentage of minimum liquidity
    # More conservative for volatile pairs
    if base_token in [BTCB, CAKE]:  # Volatile tokens
        max_position_pct = 0.02  # 2% of liquidity
    elif base_token in [USDT, USDC, BUSD]:  # Stablecoins
        max_position_pct = 0.05  # 5% of liquidity
    else:  # Other tokens
        max_position_pct = 0.03  # 3% of liquidity

    # Convert to USD value
    if base_token in [USDT, USDC, BUSD, FDUSD]:
        # Direct USD value
        max_position_usd = min_liquidity * max_position_pct
    else:
        # Convert token amount to USD
        try:
            token_price = get_price_multi_source(base_token, USDT)
            if token_price['price'] > 0:
                max_position_usd = min_liquidity * max_position_pct * token_price['price'] / 10**18
            else:
                max_position_usd = 10000  # Fallback
        except:
            max_position_usd = 10000  # Fallback

    # Apply bounds
    optimal_size = min(max_position_usd, 50000)  # Max $50k per trade
    optimal_size = max(optimal_size, 1000)       # Min $1k per trade

    return Decimal(str(optimal_size)).quantize(Decimal("0.01"))

def estimate_pair_liquidity(token_a: str, token_b: str) -> float:
    """Estimate liquidity for a token pair (simplified implementation)"""
    # This would need actual pool data - simplified estimation
    base_liquidity = {
        (USDT, WBNB): 5000000,   # $5M
        (USDC, WBNB): 3000000,   # $3M
        (BUSD, WBNB): 2000000,   # $2M
        (BTCB, WBNB): 10000000,  # $10M
        (CAKE, WBNB): 8000000,   # $8M
    }

    # Default liquidity estimate
    return base_liquidity.get((token_a, token_b), 1000000)  # $1M default

# Generate dynamic multi-hop paths
TRI_PATHS = generate_multi_hop_paths()

def get_price_multi_source(token_in: str, token_out: str, amount_in: int = 10**18) -> dict:
    """Get price from multiple DEXes with manipulation detection"""
    prices = {}
    routers = {
        'pancakeswap': ROUTER,
        'biswap': '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD48',
        'apeswap': '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7'
    }

    for dex_name, router_addr in routers.items():
        try:
            router = w3.eth.contract(address=router_addr, abi=[
                {"inputs":[{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"}],"name":"getAmountsOut","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"view","type":"function"}
            ])
            amounts = router.functions.getAmountsOut(amount_in, [token_in, token_out]).call()
            prices[dex_name] = amounts[-1]
        except:
            prices[dex_name] = 0

    # Calculate median price and detect manipulation
    valid_prices = [p for p in prices.values() if p > 0]
    if not valid_prices:
        return {'price': 0, 'confidence': 0, 'manipulation_detected': False}

    valid_prices.sort()
    median_price = valid_prices[len(valid_prices) // 2]

    # Check for price manipulation (large deviation from median)
    manipulation_detected = False
    max_deviation = 0
    for dex, price in prices.items():
        if price > 0:
            deviation = abs(price - median_price) / median_price
            max_deviation = max(max_deviation, deviation)
            if deviation > 0.05:  # 5% deviation threshold
                manipulation_detected = True

    confidence = 1.0 - min(max_deviation, 1.0)  # Higher deviation = lower confidence

    return {
        'price': median_price,
        'confidence': confidence,
        'manipulation_detected': manipulation_detected,
        'sources': len(valid_prices),
        'all_prices': prices
    }

def get_price(token_in: str, token_out: str, amount_in: int = 10**18) -> int:
    """Backward compatibility - returns median price"""
    result = get_price_multi_source(token_in, token_out, amount_in)
    return result['price']

def calculate_multi_hop_profit(path_info: dict, flash_amount_usd: Decimal = None) -> dict:
    """Calculate multi-hop arbitrage profit with enhanced validation and dynamic sizing"""
    path = path_info["path"]
    hops = path_info.get("hops", 3)

    # Dynamic position sizing based on liquidity and risk
    if flash_amount_usd is None:
        flash_amount_usd = calculate_optimal_position_size(path_info)

    amount = flash_amount_usd

    # Convert starting USD amount to token amount
    if path_info["start"] in [USDT, USDC, BUSD, FDUSD]:
        amount_in = int(amount * (10**18))
    else:
        price_data = get_price_multi_source(USDT, path_info["start"])
        if price_data['price'] == 0 or price_data['confidence'] < 0.7:
            return {'profit': Decimal("0"), 'confidence': 0, 'manipulation_risk': True}
        amount_in = int(amount * 10**18 * 10**18 // price_data['price'])

    total_manipulation_risk = False
    total_confidence = 1.0
    total_fees = 0

    # Calculate fee based on hops (more hops = more fees)
    fee_rate = 9975 // 10000  # Base 0.25% fee per swap

    for i in range(len(path)-1):
        price_data = get_price_multi_source(path[i], path[i+1], amount_in)
        if price_data['price'] == 0:
            return {'profit': Decimal("0"), 'confidence': 0, 'manipulation_risk': True}

        amount_in = price_data['price'] * fee_rate // 10000  # Apply fee
        total_fees += (price_data['price'] - amount_in)  # Track total fees paid

        total_manipulation_risk = total_manipulation_risk or price_data['manipulation_detected']
        total_confidence = min(total_confidence, price_data['confidence'])

    # Back to USD with validation
    final_price_data = get_price_multi_source(path[-1], USDT, amount_in)
    if final_price_data['price'] == 0 or final_price_data['confidence'] < 0.7:
        return {'profit': Decimal("0"), 'confidence': 0, 'manipulation_risk': True}

    final_usdt = final_price_data['price']
    profit_usd = Decimal(final_usdt) / Decimal(10**18) - flash_amount_usd

    # Additional validation
    total_manipulation_risk = total_manipulation_risk or final_price_data['manipulation_detected']
    total_confidence = min(total_confidence, final_price_data['confidence'])

    # Penalize complex paths with lower confidence for higher hop counts
    hop_penalty = max(0, hops - 3) * 0.1  # 10% confidence penalty per extra hop
    total_confidence = max(0, total_confidence - hop_penalty)

    return {
        'profit': profit_usd.quantize(Decimal("0.01")),
        'confidence': total_confidence,
        'manipulation_risk': total_manipulation_risk,
        'sources_used': min([get_price_multi_source(path[i], path[i+1])['sources'] for i in range(len(path)-1)] + [final_price_data['sources']]),
        'hops': hops,
        'total_fees_usd': Decimal(total_fees) / Decimal(10**18)
    }

def scan_all_paths():
    print(f"Scanning {len(TRI_PATHS)} multi-hop arbitrage paths...")
    best_profit = Decimal("0")
    best_path = None
    opportunities = []

    for p in TRI_PATHS:
        result = calculate_multi_hop_profit(p)
        profit = result['profit']
        confidence = result['confidence']
        manipulation_risk = result['manipulation_risk']
        hops = result.get('hops', 3)

        # Adjust profit threshold based on complexity (more hops need higher profit)
        profit_threshold = Decimal("30") + (hops - 3) * Decimal("10")  # $40 for 4-hop, $50 for 5-hop

        # Only consider opportunities with sufficient confidence and no manipulation risk
        if profit > profit_threshold and confidence > 0.75 and not manipulation_risk:
            opportunities.append({
                'path': p,
                'profit': profit,
                'confidence': confidence,
                'sources': result['sources_used'],
                'hops': hops,
                'fees': result.get('total_fees_usd', Decimal("0"))
            })

        if profit > best_profit:
            best_profit = profit
            best_path = p

    # Sort opportunities by profit efficiency (profit per hop)
    opportunities.sort(key=lambda x: x['profit'] / x['hops'], reverse=True)

    if opportunities:
        best_opp = opportunities[0]
        efficiency = best_opp['profit'] / best_opp['hops']
        print(f"🎯 ARBITRAGE FOUND → {best_opp['path']['name']}")
        print(f"   Profit: ${best_opp['profit']} | Hops: {best_opp['hops']} | Efficiency: ${efficiency:.2f}/hop")
        print(f"   Confidence: {best_opp['confidence']:.1%} | Sources: {best_opp['sources']} | Fees: ${best_opp['fees']:.2f}")
        return best_opp['profit']
    else:
        print(f"❌ No profitable arb right now (best: ${best_profit})")
        return best_profit

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Run once and exit")
    args = parser.parse_args()

    if args.once:
        scan_all_paths()
    else:
        while True:
            scan_all_paths()
            time.sleep(8)
