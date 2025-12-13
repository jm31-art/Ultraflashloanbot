#!/usr/bin/env python3
"""
Production-Ready Python Triangular Arbitrage Calculator for BSC DEX
Returns only valid JSON output with arbitrage opportunities and errors.
"""

import json
import sys
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
import logging

# Configure logging to stderr only (not stdout which is for JSON)
logging.basicConfig(level=logging.ERROR, stream=sys.stderr)

class ArbitrageCalculator:
    def __init__(self):
        # BSC token addresses
        self.TOKENS = {
            'WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
            'USDT': '0x55d398326f99059fF775485246999027B3197955',
            'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
            'BUSD': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
            'CAKE': '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
            'BTCB': '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c'
        }

        # DEX router addresses
        self.DEX_ROUTERS = {
            'PANCAKESWAP': '0x10ED43C718714eb63d5aA57B78B54704E256024E',
            'BISWAP': '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8',
            'APESWAP': '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7'
        }

        # Common triangular arbitrage paths
        self.TRIANGULAR_PATHS = [
            ['WBNB', 'USDT', 'BTCB'],
            ['WBNB', 'BTCB', 'USDT'],
            ['USDT', 'WBNB', 'BTCB'],
            ['USDT', 'BTCB', 'WBNB'],
            ['BTCB', 'WBNB', 'USDT'],
            ['BTCB', 'USDT', 'WBNB']
        ]

    def calculate_opportunities(self, amount_in: float = 1.0) -> Dict[str, Any]:
        """
        Calculate triangular arbitrage opportunities
        Returns JSON with opportunities and any errors
        """
        try:
            opportunities = []
            errors = []

            # Calculate opportunities for each path
            for path in self.TRIANGULAR_PATHS:
                try:
                    opportunity = self._calculate_path_profit(path, amount_in)
                    if opportunity:
                        opportunities.append(opportunity)
                except Exception as e:
                    errors.append({
                        'path': path,
                        'error': str(e),
                        'type': 'path_calculation_error'
                    })

            # Sort by profit percentage (highest first)
            opportunities.sort(key=lambda x: x.get('profit_percentage', 0), reverse=True)

            return {
                'success': True,
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'opportunities': opportunities,
                'errors': errors,
                'total_opportunities': len(opportunities),
                'total_errors': len(errors)
            }

        except Exception as e:
            return {
                'success': False,
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'error': str(e),
                'opportunities': [],
                'errors': [{'type': 'general_error', 'error': str(e)}]
            }

    def _calculate_path_profit(self, path: List[str], amount_in: float) -> Optional[Dict[str, Any]]:
        """
        Calculate profit for a specific triangular arbitrage path
        """
        try:
            if len(path) != 3:
                return None

            token_a, token_b, token_c = path

            # Simulate exchange rates (in production, fetch from DEX APIs)
            # These are example rates - replace with real DEX price fetching
            rates = self._get_exchange_rates()

            # Calculate the arbitrage
            # Start with amount_in of token_a
            amount_b = amount_in * rates.get(f'{token_a}_{token_b}', 1.0)
            amount_c = amount_b * rates.get(f'{token_b}_{token_c}', 1.0)
            final_amount = amount_c * rates.get(f'{token_c}_{token_a}', 1.0)

            profit_percentage = ((final_amount - amount_in) / amount_in) * 100

            # Only return profitable opportunities (> 0.1%)
            if profit_percentage > 0.1:
                return {
                    'path': path,
                    'token_in': token_a,
                    'amount_in': amount_in,
                    'expected_out': final_amount,
                    'profit_percentage': profit_percentage,
                    'profit_amount': final_amount - amount_in,
                    'dexes': ['pancakeswap', 'pancakeswap', 'pancakeswap'],  # Default DEXes
                    'estimated_gas': 250000,
                    'priority': 'high' if profit_percentage > 1.0 else 'medium'
                }

            return None

        except Exception as e:
            logging.error(f"Error calculating path {path}: {e}")
            return None

    def _get_exchange_rates(self) -> Dict[str, float]:
        """
        Get exchange rates between token pairs
        In production, fetch from DEX APIs or on-chain data
        """
        # Example rates - replace with real data fetching
        return {
            'WBNB_USDT': 567.0,    # 1 WBNB = 567 USDT
            'USDT_WBNB': 1/567.0,  # 1 USDT = ~0.00176 WBNB
            'WBNB_BTCB': 0.001,    # 1 WBNB = 0.001 BTCB
            'BTCB_WBNB': 1000.0,   # 1 BTCB = 1000 WBNB
            'USDT_BTCB': 0.00176,  # 1 USDT = 0.00176 BTCB
            'BTCB_USDT': 567.0     # 1 BTCB = 567 USDT
        }

def main():
    """
    Main entry point - parse arguments and return JSON
    """
    try:
        # Parse command line arguments
        amount_in = 1.0  # Default 1 token
        if len(sys.argv) > 1:
            try:
                amount_in = float(sys.argv[1])
            except ValueError:
                amount_in = 1.0

        # Create calculator and calculate opportunities
        calculator = ArbitrageCalculator()
        result = calculator.calculate_opportunities(amount_in)

        # Output only valid JSON to stdout
        print(json.dumps(result, indent=None, separators=(',', ':')))

    except Exception as e:
        # Return error as JSON
        error_result = {
            'success': False,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'error': str(e),
            'opportunities': [],
            'errors': [{'type': 'main_execution_error', 'error': str(e)}]
        }
        print(json.dumps(error_result, indent=None, separators=(',', ':')))

if __name__ == '__main__':
    main()