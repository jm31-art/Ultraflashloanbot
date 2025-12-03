import aiohttp
import os
from typing import Optional, Dict

class CoinAPIService:
    def __init__(self):
        self.api_key = os.getenv('COINAPI_KEY')
        if not self.api_key:
            raise ValueError("COINAPI_KEY environment variable not set")
        
        self.base_url = "https://rest.coinapi.io/v1"
        self.headers = {
            'X-CoinAPI-Key': self.api_key,
            'Accept': 'application/json'
        }
        
        # Cache for symbol mapping
        self._symbol_map = {
            'USDT': 'USDT',
            'WBNB': 'BNB',  # Map WBNB to BNB for CoinAPI
            'ETH': 'ETH',
            'BTC': 'BTC',
            'CAKE': 'CAKE',
            # Add more mappings as needed
        }
        
    async def get_token_price(self, symbol: str) -> Optional[Dict]:
        """
        Get token price from CoinAPI
        Returns: Dict with price and other metadata or None if not found
        """
        try:
            # Map token symbol to CoinAPI format
            api_symbol = self._symbol_map.get(symbol, symbol)
            
            # Use USD as quote currency
            endpoint = f"/exchangerate/{api_symbol}/USD"
            
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.base_url}{endpoint}",
                    headers=self.headers
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        return {
                            'price': float(data['rate']),
                            'timestamp': data['time'],
                            'source': 'coinapi'
                        }
                    elif response.status == 429:
                        print("CoinAPI rate limit reached")
                        return None
                    else:
                        print(f"CoinAPI error: {response.status}")
                        return None
                        
        except Exception as e:
            print(f"Error fetching price from CoinAPI: {e}")
            return None
            
    async def get_exchange_rate(self, base_symbol: str, quote_symbol: str) -> Optional[float]:
        """
        Get exchange rate between two tokens
        Returns: Exchange rate or None if not found
        """
        try:
            base = self._symbol_map.get(base_symbol, base_symbol)
            quote = self._symbol_map.get(quote_symbol, quote_symbol)
            
            endpoint = f"/exchangerate/{base}/{quote}"
            
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.base_url}{endpoint}",
                    headers=self.headers
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        return float(data['rate'])
                    return None
                    
        except Exception as e:
            print(f"Error fetching exchange rate from CoinAPI: {e}")
            return None
