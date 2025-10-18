from web3 import Web3
from typing import List, Dict, Tuple
import json
import asyncio
from decimal import Decimal
import time

# Constants
DODO_FEE = Decimal('0.003')  # 0.3%
UNI_V2_FEE = Decimal('0.003')  # 0.3%
BISWAP_FEE = Decimal('0.001')  # 0.1%
MIN_PROFIT_USD = 50

class ArbitrageScanner:
    def __init__(self, rpc_url: str):
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        
        # Load ABIs
        with open('abi/dodo_pool.json') as f:
            self.dodo_abi = json.load(f)
        with open('abi/pair.json') as f:
            self.pair_abi = json.load(f)
            
        # DEX configs
        self.dexes = {
            'pancake': {'fee': Decimal('0.0025'), 'factory': '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'},
            'apeswap': {'fee': Decimal('0.003'), 'factory': '0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6'},
            'biswap': {'fee': Decimal('0.001'), 'factory': '0x858E3312ed3A876947EA49d572A7C42DE08af7EE'},
            'mdex': {'fee': Decimal('0.003'), 'factory': '0x3CD1C46068dAEa5Ebb0d3f55F6915B10648062B8'},
            'knightswap': {'fee': Decimal('0.003'), 'factory': '0xf0bc2E21a76513aa7CCaDE75a8D8b2A70c7b8139'},
            'bscswap': {'fee': Decimal('0.002'), 'factory': '0xCe8fd65646f2a2a897755A1188C04aCe94D2B8D0'}
        }
        
        # Token configs
        self.tokens = self.load_token_configs()
        
    def load_token_configs(self) -> Dict:
        return {
            'WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
            'USDT': '0x55d398326f99059fF775485246999027B3197955',
            'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
            'BUSD': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
            'BTCB': '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
            'ETH': '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
            'CAKE': '0x0E09FaBb73Bd3Ade0a17ECC321fD13a19e81cE82',
            'ALPACA': '0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F',
            'ADA': '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47'
        }
    
    async def get_pair_reserves(self, pair_address: str) -> Tuple[int, int]:
        pair = self.w3.eth.contract(address=pair_address, abi=self.pair_abi)
        reserves = await pair.functions.getReserves().call()
        return reserves[0], reserves[1]
    
    async def check_flashswap_opportunity(self, token0: str, token1: str) -> Dict:
        opportunities = []
        
        # Check all DEX pairs first
        for dex_name, dex_config in self.dexes.items():
            factory = self.w3.eth.contract(address=dex_config['factory'])
            pair_address = await factory.functions.getPair(token0, token1).call()
            
            if pair_address != '0x0000000000000000000000000000000000000000':
                reserve0, reserve1 = await self.get_pair_reserves(pair_address)
                opportunities.append({
                    'dex': dex_name,
                    'pair': pair_address,
                    'reserves': (reserve0, reserve1),
                    'fee': dex_config['fee']
                })
        
        # Find arbitrage opportunities between DEXes
        for i in range(len(opportunities)):
            for j in range(i + 1, len(opportunities)):
                dex1, dex2 = opportunities[i], opportunities[j]
                
                # Calculate price difference
                price1 = Decimal(dex1['reserves'][0]) / Decimal(dex1['reserves'][1])
                price2 = Decimal(dex2['reserves'][0]) / Decimal(dex2['reserves'][1])
                
                # Calculate potential profit
                price_diff = abs(price1 - price2)
                if price_diff > (dex1['fee'] + dex2['fee']):
                    return {
                        'type': 'flashswap',
                        'buy_dex': dex1['dex'] if price1 < price2 else dex2['dex'],
                        'sell_dex': dex2['dex'] if price1 < price2 else dex1['dex'],
                        'token0': token0,
                        'token1': token1,
                        'profit_percent': float(price_diff - (dex1['fee'] + dex2['fee'])) * 100
                    }
        
        return None
    
    async def check_dodo_opportunity(self, token0: str, token1: str) -> Dict:
        # Only try DODO if flashswap didn't work
        dodo_pool = self.w3.eth.contract(address=self.dodo_pool_address, abi=self.dodo_abi)
        
        try:
            quote_amount = await dodo_pool.functions.getQuoteAmount(token0, token1, 1e18).call()
            if quote_amount > 0:
                return {
                    'type': 'dodo',
                    'token0': token0,
                    'token1': token1,
                    'quote_amount': quote_amount
                }
        except Exception as e:
            print(f"DODO query failed: {e}")
            
        return None
    
    async def scan_opportunities(self):
        while True:
            for base_token in ['USDT', 'USDC', 'BUSD']:
                for quote_token in ['WBNB', 'BTCB', 'ETH', 'CAKE', 'ALPACA', 'ADA']:
                    if base_token != quote_token:
                        # Try flashswap first
                        opportunity = await self.check_flashswap_opportunity(
                            self.tokens[base_token],
                            self.tokens[quote_token]
                        )
                        
                        if not opportunity:
                            # Try DODO as fallback
                            opportunity = await self.check_dodo_opportunity(
                                self.tokens[base_token],
                                self.tokens[quote_token]
                            )
                        
                        if opportunity and opportunity.get('profit_percent', 0) > MIN_PROFIT_USD:
                            print(f"Found opportunity: {opportunity}")
                            
            await asyncio.sleep(1)  # Wait 1 second between scans

if __name__ == "__main__":
    scanner = ArbitrageScanner("https://bsc-dataseed1.binance.org")
    asyncio.run(scanner.scan_opportunities())
