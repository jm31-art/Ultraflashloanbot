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

    def calculate_opportunities(self, amount_in: float = 1.0, price_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Calculate triangular arbitrage opportunities
        Args:
            amount_in: Amount to start arbitrage with
            price_data: Real-time price data from Node.js (optional)
        Returns JSON with opportunities and any errors
        """
        try:
            opportunities = []
            errors = []

            # Use provided price data or fallback to hardcoded rates
            exchange_rates = self._get_exchange_rates(price_data)

            # Calculate opportunities for each path
            for path in self.TRIANGULAR_PATHS:
                try:
                    opportunity = self._calculate_path_profit(path, amount_in, exchange_rates)
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
                'total_errors': len(errors),
                'used_real_prices': price_data is not None
            }

        except Exception as e:
            return {
                'success': False,
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'error': str(e),
                'opportunities': [],
                'errors': [{'type': 'general_error', 'error': str(e)}]
            }

    def _calculate_path_profit(self, path: List[str], amount_in: float, exchange_rates: Dict[str, float]) -> Optional[Dict[str, Any]]:
        """
        Calculate profit for a specific triangular arbitrage path
        """
        try:
            if len(path) != 3:
                return None

            token_a, token_b, token_c = path

            # Calculate the arbitrage using provided exchange rates
            # Start with amount_in of token_a
            amount_b = amount_in * exchange_rates.get(f'{token_a}_{token_b}', 1.0)
            amount_c = amount_b * exchange_rates.get(f'{token_b}_{token_c}', 1.0)
            final_amount = amount_c * exchange_rates.get(f'{token_c}_{token_a}', 1.0)

            profit_percentage = ((final_amount - amount_in) / amount_in) * 100

            # Only return profitable opportunities (> 0.5% for meaningful arbitrage)
            if profit_percentage > 0.5:
                # Convert amounts to Wei (multiply by 10^18 for BSC tokens)
                amount_in_wei = str(int(amount_in * (10 ** 18)))
                expected_profit_wei = str(int((final_amount - amount_in) * (10 ** 18)))

                return {
                    'path': [self.TOKENS[token_a], self.TOKENS[token_b], self.TOKENS[token_c]],  # Array of token addresses
                    'amountIn': amount_in_wei,  # String in Wei
                    'expectedProfit': expected_profit_wei,  # String in Wei
                    'router': 'PANCAKESWAP',  # String router name
                    'timestamp': int(time.time())  # Unix timestamp
                }

            return None

        except Exception as e:
            logging.error(f"Error calculating path {path}: {e}")
            return None

    def _get_exchange_rates(self, price_data: Optional[Dict[str, Any]] = None) -> Dict[str, float]:
        """
        Get exchange rates between token pairs
        Uses real price data when available, otherwise falls back to hardcoded rates
        """
        if price_data and 'prices' in price_data:
            # Use real price data from Node.js
            rates = {}
            prices = price_data['prices']

            # Extract rates from price data
            for pair_key, pair_data in prices.items():
                if isinstance(pair_data, dict) and 'price' in pair_data:
                    # pair_key format: "TOKEN1/TOKEN2"
                    if '/' in pair_key:
                        token1, token2 = pair_key.split('/')
                        rate_key = f'{token1}_{token2}'
                        rates[rate_key] = pair_data['price']

                        # Also add reverse rate
                        reverse_key = f'{token2}_{token1}'
                        rates[reverse_key] = 1.0 / pair_data['price'] if pair_data['price'] > 0 else 1.0

            # If we got some real rates, use them
            if rates:
                print(f"Using {len(rates)} real exchange rates from Node.js", file=sys.stderr)
                return rates

        # Fallback to hardcoded rates
        print("Using fallback hardcoded exchange rates", file=sys.stderr)
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
    Usage: python3 script.py <amount_in> [price_data_json]
    """
    try:
        # Parse command line arguments
        amount_in = 1.0  # Default 1 token
        price_data = None

        if len(sys.argv) > 1:
            try:
                amount_in = float(sys.argv[1])
            except ValueError:
                amount_in = 1.0

        # Check for price data as second argument (JSON string)
        if len(sys.argv) > 2:
            try:
                price_data = json.loads(sys.argv[2])
                print(f"Received price data with {len(price_data.get('prices', {}))} price entries", file=sys.stderr)
            except json.JSONDecodeError as e:
                print(f"Failed to parse price data JSON: {e}", file=sys.stderr)
                price_data = None

        # Create calculator and calculate opportunities
        calculator = ArbitrageCalculator()
        result = calculator.calculate_opportunities(amount_in, price_data)

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