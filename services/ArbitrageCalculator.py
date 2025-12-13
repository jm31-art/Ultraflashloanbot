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

# Triangular paths (add as many as you want)
TRI_PATHS = [
    {"name": "USDT→USDC→BNB→USDT", "path": [USDT, USDC, WBNB, USDT], "start": USDT},
    {"name": "USDT→BUSD→BNB→USDT", "path": [USDT, BUSD, WBNB, USDT], "start": USDT},
    {"name": "USDT→FDUSD→BNB→USDT", "path": [USDT, FDUSD, WBNB, USDT], "start": USDT},
    {"name": "BTCB→BNB→USDT→BTCB", "path": [BTCB, WBNB, USDT, BTCB], "start": BTCB},
    {"name": "CAKE→BNB→USDT→CAKE", "path": [CAKE, WBNB, USDT, CAKE], "start": CAKE},
]

def get_price(token_in: str, token_out: str, amount_in: int = 10**18) -> int:
    try:
        router = w3.eth.contract(address=ROUTER, abi=[
            {"inputs":[{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"address[]","name":"path","type":"address[]"}],"name":"getAmountsOut","outputs":[{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"stateMutability":"view","type":"function"}
        ])
        amounts = router.functions.getAmountsOut(amount_in, [token_in, token_out]).call()
        return amounts[-1]
    except:
        return 0

def calculate_tri_profit(path_info: dict, flash_amount_usd: Decimal = Decimal("12000")) -> Decimal:
    path = path_info["path"]
    amount = flash_amount_usd

    # Convert starting USD amount to token amount
    if path_info["start"] in [USDT, USDC, BUSD, FDUSD]:
        amount_in = int(amount * (10**18))
    else:
        price = get_price(USDT, path_info["start"])
        if price == 0: return Decimal("0")
        amount_in = int(amount * 10**18 * 10**18 // price)

    for i in range(len(path)-1):
        out = get_price(path[i], path[i+1], amount_in)
        if out == 0: return Decimal("0")
        amount_in = out * 9975 // 10000  # 0.25% fee

    # Back to USD
    final_usdt = get_price(path[-1], USDT, amount_in)
    if final_usdt == 0: return Decimal("0")
    profit_usd = Decimal(final_usdt) / Decimal(10**18) - flash_amount_usd
    return profit_usd.quantize(Decimal("0.01"))

def scan_all_paths():
    import sys
    print(f"Scanning {len(TRI_PATHS)} triangular paths...", file=sys.stderr)
    best = Decimal("0")
    best_path = None
    opportunities = []

    for p in TRI_PATHS:
        profit = calculate_tri_profit(p)
        if profit > best:
            best = profit
            best_path = p

        # Collect all opportunities with profit > 0
        if profit > Decimal("0"):
            opportunities.append({
                "type": f"Triangular ({p['name']})",
                "path": p["path"],
                "profitPercent": float(profit),
                "profitBNB": float(profit / Decimal("567")),  # Convert USD to BNB
                "direction": "forward",
                "startAmount": 10
            })

    if best > Decimal("30"):
        print(f"ARBITRAGE FOUND → {best_path['name']} | Profit ≈ ${best}", file=sys.stderr)
    else:
        print(f"No profitable arb right now (best: ${best})", file=sys.stderr)

    # Output only JSON to stdout
    result = {
        "opportunities": opportunities,
        "bestProfit": float(best),
        "timestamp": int(time.time() * 1000)
    }
    print(result)
    return best

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
