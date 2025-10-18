"""Configuration package for flashloan arbitrage bot"""

from .dodo_pools import DODO_POOLS, POOL_PAIRS, MAX_BORROW
from .tokens import TOKENS, DECIMALS, MIN_TRADE_AMOUNT

__all__ = [
    'DODO_POOLS',
    'POOL_PAIRS',
    'MAX_BORROW',
    'TOKENS',
    'DECIMALS',
    'MIN_TRADE_AMOUNT'
]
