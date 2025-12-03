import asyncio
import aiohttp
from web3 import Web3
from typing import Dict, Optional, List, Tuple
import json
from datetime import datetime
from .CoinAPIService import CoinAPIService

class PriceAggregator:
    def __init__(self):
        self.price_sources = {
            'pancakeswap_v3': 'https://api.pancakeswap.finance/api/v3',
            'uniswap_v3': 'https://api.uniswap.org/v3',
            'sushiswap': 'https://api.sushi.com/v3',
            'biswap': 'https://api.biswap.org/v2',  # Keeping BiSwap as backup
            'dex_aggregator': 'https://api.dexscreener.com/latest/dex'  # Quick validation only
        }
        
        # Initialize source weights for price aggregation
        self.source_weights = {
            'chainlink': 5,      # Most reliable oracle
            'dexscreener': 4,    # Real-time DEX aggregator
            'pancakeswap': 4,    # Primary DEX
            'biswap': 3,         # Major BSC DEX
            'apeswap': 3,        # Major BSC DEX
            'mdex': 3,           # Major BSC DEX
            'binance': 4,        # Major CEX
            'huobi': 3,          # Large CEX
            'kucoin': 3,         # Large CEX
            'okx': 3,            # Large CEX
            'geckoterminal': 2,  # DEX aggregator
            'dextools': 2,       # DEX aggregator
            'coingecko': 2,      # Price aggregator
            'coinapi': 1         # Backup source
        }
        
        # Initialize CoinAPI service
        try:
            self.coinapi_service = CoinAPIService()
        except ValueError as e:
            print(f"Warning: CoinAPI not configured: {e}")
            self.coinapi_service = None
        
        self.token_mappings = {
            'BNB': {
                'coingecko': 'binancecoin',
                'binance': 'BNBUSDT',
                'pancakeswap': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                'dexscreener': 'bsc/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                'geckoterminal': 'bsc/bnb',
                'dextools': 'bnb'
            },
            'WBNB': {
                'coingecko': 'binancecoin',
                'binance': 'BNBUSDT',
                'pancakeswap': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
            },
            'ETH': {
                'coingecko': 'ethereum',
                'binance': 'ETHUSDT',
                'pancakeswap': '0x2170Ed0880ac9A755fd29B2688956BD959F933F8'
            },
            'BTC': {
                'coingecko': 'bitcoin',
                'binance': 'BTCUSDT',
                'pancakeswap': '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c'
            },
            'CAKE': {
                'coingecko': 'pancakeswap-token',
                'binance': 'CAKEUSDT',
                'pancakeswap': '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'
            }
        }

        # Add stablecoin configuration with risk levels
        self.stablecoins = {
            'USDT': {
                'address': '0x55d398326f99059fF775485246999027B3197955',
                'risk': 'low',     # USDT is most liquid
                'min_liquidity': 50000  # $50k min liquidity
            },
            'USDC': {
                'address': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
                'risk': 'low',     # USDC is very stable
                'min_liquidity': 50000
            },
            'BUSD': {
                'address': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
                'risk': 'medium',  # BUSD has less liquidity
                'min_liquidity': 75000
            },
            'DAI': {
                'address': '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
                'risk': 'medium',  # DAI has complex stability mechanism
                'min_liquidity': 75000
            }
        }
        
        # Extreme optimization for profitability
        self.validation_thresholds = {
            'stablecoin': {
                'max_deviation': 0.15,         # 15% for stablecoin pairs (catch extreme opportunities)
                'min_profit': 0.0005,         # 0.05% minimum profit after fees
                'max_trade_size': 0.35,       # 35% of pool liquidity
                'min_sources': 1              # Single source for maximum speed
            },
            'major_token': {                  # BTC, ETH, BNB
                'max_deviation': 0.20,         # 20% for major token pairs
                'min_profit': 0.0008,         # 0.08% minimum profit after fees
                'max_trade_size': 0.30,       # 30% of pool liquidity
                'min_sources': 1
            },
            'other_token': {
                'max_deviation': 0.25,         # 25% for other tokens
                'min_profit': 0.001,          # 0.1% minimum profit after fees
                'max_trade_size': 0.25,       # 25% of pool liquidity
                'min_sources': 1
            }
        }

        # Define major tokens
        self.major_tokens = {
            'BTC': '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
            'ETH': '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
            'BNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
            'WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
        }

        # Define DEX fee structures for profit calculation
        self.dex_fees = {
            'pancakeswap_v3': 0.001,  # 0.1% (lowest fee tier)
            'uniswap_v3': 0.0005,     # 0.05% (lowest fee tier)
            'sushiswap': 0.0015,      # 0.15% (standard tier)
            'biswap': 0.001,          # 0.1%
            'unknown': 0.003          # 0.3% for unknown DEXes
        }

    def get_token_type(self, token: str) -> str:
        """Determine token type for validation thresholds"""
        if token in self.stablecoins:
            return 'stablecoin'
        elif token in self.major_tokens:
            return 'major_token'
        return 'other_token'

    def calculate_profit_potential(self, buy_price: float, sell_price: float, 
                                 buy_dex: str, sell_dex: str, 
                                 base_token: str, quote_token: str,
                                 liquidity: float) -> Dict:
        """Calculate potential profit considering all factors"""
        # Get validation thresholds based on token types
        base_type = self.get_token_type(base_token)
        quote_type = self.get_token_type(quote_token)
        
        # Use more conservative threshold for mixed pairs
        if base_type != quote_type:
            thresholds = self.validation_thresholds[base_type if base_type != 'stablecoin' else quote_type]
        else:
            thresholds = self.validation_thresholds[base_type]

        # Calculate spread and fees
        spread = (sell_price - buy_price) / buy_price
        buy_fee = self.dex_fees.get(buy_dex.lower(), self.dex_fees['unknown'])
        sell_fee = self.dex_fees.get(sell_dex.lower(), self.dex_fees['unknown'])
        total_fee = buy_fee + sell_fee

        # Calculate maximum trade size
        max_trade = min(
            liquidity * thresholds['max_trade_size'],
            500000  # Hard cap at $500k per trade
        )

        # Calculate potential profit
        gross_profit = max_trade * spread
        fee_cost = max_trade * total_fee
        net_profit = gross_profit - fee_cost
        profit_percentage = net_profit / max_trade * 100

        return {
            'max_trade_size': max_trade,
            'gross_profit': gross_profit,
            'fee_cost': fee_cost,
            'net_profit': net_profit,
            'profit_percentage': profit_percentage,
            'is_profitable': profit_percentage > thresholds['min_profit'] * 100,
            'spread': spread * 100,
            'total_fee_percentage': total_fee * 100
        }

    async def validate_opportunity(self, base_token: str, quote_token: str,
                                 buy_price: float, sell_price: float,
                                 buy_dex: str, sell_dex: str,
                                 buy_liquidity: float, sell_liquidity: float) -> Dict:
        """Validate arbitrage opportunity with optimized thresholds for profitability"""
        # Quick validation to catch obvious bad data
        if buy_price <= 0 or sell_price <= 0 or buy_liquidity <= 0 or sell_liquidity <= 0:
            return {'valid': False, 'reason': 'Invalid price or liquidity data'}
            
        base_type = self.get_token_type(base_token)
        quote_type = self.get_token_type(quote_token)
        
        # Use appropriate thresholds based on pair type
        if base_type == 'stablecoin' and quote_type == 'stablecoin':
            thresholds = self.validation_thresholds['stablecoin']
        else:
            # Use the more permissive threshold to catch more opportunities
            thresholds = self.validation_thresholds[
                'major_token' if base_type == 'major_token' or quote_type == 'major_token'
                else 'other_token'
            ]

        # Calculate profit potential
        min_liquidity = min(buy_liquidity, sell_liquidity)
        profit_info = self.calculate_profit_potential(
            buy_price, sell_price, buy_dex, sell_dex,
            base_token, quote_token, min_liquidity
        )

        # Validate price deviation
        price_diff = abs(sell_price - buy_price) / buy_price
        if price_diff > thresholds['max_deviation']:
            return {
                'valid': False,
                'reason': f'Price deviation {price_diff*100:.2f}% exceeds threshold {thresholds["max_deviation"]*100:.2f}%',
                'profit_info': profit_info
            }

        # Additional validation for stablecoin pairs
        if base_type == 'stablecoin' and quote_type == 'stablecoin':
            if not (0.95 <= buy_price <= 1.05) or not (0.95 <= sell_price <= 1.05):
                return {
                    'valid': False,
                    'reason': 'Stablecoin price too far from 1.0',
                    'profit_info': profit_info
                }

        # Check profitability
        if not profit_info['is_profitable']:
            return {
                'valid': False,
                'reason': f'Insufficient profit margin {profit_info["profit_percentage"]:.2f}% vs required {thresholds["min_profit"]*100:.2f}%',
                'profit_info': profit_info
            }

        return {
            'valid': True,
            'profit_info': profit_info,
            'risk_level': 'low' if base_type == 'stablecoin' and quote_type == 'stablecoin' else 'medium',
            'recommended_size': profit_info['max_trade_size']
        }

    async def _fetch_coingecko_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        try:
            coin_id = self.token_mappings[token]['coingecko']
            url = f"{self.price_sources['coingecko']}/simple/price"
            params = {'ids': coin_id, 'vs_currencies': 'usd'}
            
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    return data[coin_id]['usd']
                return None
        except Exception as e:
            print(f"CoinGecko error for {token}: {e}")
            return None

    async def _fetch_binance_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        try:
            symbol = self.token_mappings[token]['binance']
            url = f"{self.price_sources['binance']}/ticker/price"
            params = {'symbol': symbol}
            
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    return float(data['price'])
                return None
        except Exception as e:
            print(f"Binance error for {token}: {e}")
            return None

    async def _fetch_pancakeswap_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        try:
            token_address = self.token_mappings[token]['pancakeswap']
            url = f"{self.price_sources['pancakeswap']}/tokens/{token_address}"
            
            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    return float(data['data']['price'])
                return None
        except Exception as e:
            print(f"PancakeSwap error for {token}: {e}")
            return None

    async def _fetch_coinapi_price(self, token: str) -> Optional[float]:
        """Get price from CoinAPI"""
        try:
            if self.coinapi_service:
                result = await self.coinapi_service.get_token_price(token)
                if result:
                    return result['price']
            return None
        except Exception as e:
            print(f"CoinAPI error for {token}: {e}")
            return None

    async def _fetch_dexscreener_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        try:
            token_path = self.token_mappings[token]['dexscreener']
            url = f"{self.price_sources['dexscreener']}/tokens/{token_path}"
            
            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('pairs'):
                        # Filter for pairs with good liquidity and sort by volume
                        valid_pairs = [p for p in data['pairs'] 
                                     if float(p.get('liquidity', {}).get('usd', 0)) > 100000]
                        valid_pairs.sort(key=lambda x: float(x.get('volume', {}).get('h24', 0)), reverse=True)
                        
                        if valid_pairs:
                            # Use volume-weighted average price from top pairs
                            total_volume = sum(float(p.get('volume', {}).get('h24', 0)) for p in valid_pairs[:5])
                            if total_volume > 0:
                                weighted_price = sum(
                                    float(p['priceUsd']) * float(p.get('volume', {}).get('h24', 0))
                                    for p in valid_pairs[:5]
                                ) / total_volume
                                return weighted_price
                return None
        except Exception as e:
            print(f"DexScreener error for {token}: {e}")
            return None

    async def _fetch_geckoterminal_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        try:
            token_path = self.token_mappings[token]['geckoterminal']
            url = f"{self.price_sources['geckoterminal']}/tokens/{token_path}"
            
            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('data', {}).get('attributes', {}).get('price_usd'):
                        return float(data['data']['attributes']['price_usd'])
                return None
        except Exception as e:
            print(f"GeckoTerminal error for {token}: {e}")
            return None

    async def validate_price(self, token: str, price: float, liquidity: Optional[float] = None) -> bool:
        """Validate a token's price against configured thresholds"""
        if not price or price <= 0:
            return False
            
        # Check if token is a stablecoin
        if token in self.stablecoins:
            if abs(price - 1.0) > self.max_stablecoin_deviation:
                print(f"Warning: {token} price ${price} deviates >5% from $1.00")
                return False
                
        # Validate liquidity if provided
        if liquidity is not None and liquidity < self.min_liquidity_usd:
            print(f"Warning: {token} liquidity ${liquidity} below minimum ${self.min_liquidity_usd}")
            return False
            
        return True

    async def validate_pair_price(self, base_token: str, quote_token: str, price: float) -> bool:
        """Validate a trading pair's price"""
        # Both stablecoins - should be very close to 1:1
        if base_token in self.stablecoins and quote_token in self.stablecoins:
            if abs(price - 1.0) > self.max_stablecoin_deviation:
                print(f"Warning: {base_token}/{quote_token} price {price} deviates >5% from 1.0")
                return False
        
        # Cross-reference with other sources
        pair_prices = await self.get_pair_prices_all_sources(base_token, quote_token)
        if pair_prices:
            avg_price = sum(p for p in pair_prices if p is not None) / len([p for p in pair_prices if p is not None])
            deviation = abs(price - avg_price) / avg_price
            
            max_allowed = self.max_stablecoin_deviation if base_token in self.stablecoins or quote_token in self.stablecoins else self.max_token_deviation
            
            if deviation > max_allowed:
                print(f"Warning: {base_token}/{quote_token} price {price} deviates >{max_allowed*100}% from average {avg_price}")
                return False
        
        return True

    async def get_pair_prices_all_sources(self, base_token: str, quote_token: str) -> List[Optional[float]]:
        """Get pair prices from all available sources"""
        async with aiohttp.ClientSession() as session:
            tasks = [
                self._fetch_dexscreener_price(session, f"{base_token}/{quote_token}"),
                self._fetch_pancakeswap_price(session, f"{base_token}/{quote_token}"),
                self._fetch_binance_price(session, f"{base_token}{quote_token}"),
                self._fetch_geckoterminal_price(session, f"{base_token}-{quote_token}"),
                self._fetch_coingecko_price(session, base_token)  # Will need to divide by quote price
            ]
            return await asyncio.gather(*tasks)

    async def get_token_price(self, token: str) -> Optional[Dict]:
        """Get token price from multiple sources with validation"""
        if token not in self.token_mappings:
            return None

        async with aiohttp.ClientSession() as session:
            tasks = [
                self._fetch_dexscreener_price(session, token),
                self._fetch_pancakeswap_price(session, token),
                self._fetch_binance_price(session, token),
                self._fetch_geckoterminal_price(session, token),
                self._fetch_coingecko_price(session, token),
                self._fetch_coinapi_price(token)
            ]
            
            prices = await asyncio.gather(*tasks)
            valid_prices = [(p, i) for i, p in enumerate(prices) if p is not None]
            
            if len(valid_prices) < self.min_source_count:
                print(f"Warning: {token} has fewer than {self.min_source_count} price sources")
                return None
                
            prices_only = [p for p, _ in valid_prices]
            if not prices_only:
                return None
                
            # Get median price
            prices_only.sort()
            mid = len(prices_only) // 2
            median_price = prices_only[mid] if len(prices_only) % 2 == 1 else (prices_only[mid-1] + prices_only[mid]) / 2
            
            # Validate the price
            if not await self.validate_price(token, median_price):
                return None
                
            return median_price

    async def get_pair_price(self, base_token: str, quote_token: str = 'USDT') -> Optional[Dict]:
        """Get price information for a trading pair with validation"""
        base_price = await self.get_token_price(base_token)
        if quote_token != 'USDT':
            quote_price = await self.get_token_price(quote_token)
            if base_price and quote_price:
                pair_price = base_price / quote_price
                
                # Validate the pair price
                if not await self.validate_pair_price(base_token, quote_token, pair_price):
                    return None
                    
                return {
                    'price': pair_price,
                    'base_usd': base_price,
                    'quote_usd': quote_price,
                    'confidence': await self._calculate_confidence(base_token, quote_token, pair_price)
                }
        else:
            if base_price:
                if not await self.validate_price(base_token, base_price):
                    return None
                    
                return {
                    'price': base_price,
                    'base_usd': base_price,
                    'quote_usd': 1.0,
                    'confidence': await self._calculate_confidence(base_token, 'USDT', base_price)
                }
        return None

    async def _calculate_confidence(self, base_token: str, quote_token: str, price: float) -> str:
        """Calculate confidence level for a pair price"""
        # Get prices from all sources for comparison
        prices = await self.get_pair_prices_all_sources(base_token, quote_token)
        valid_prices = [p for p in prices if p is not None]
        
        if len(valid_prices) < self.min_source_count:
            return 'low'
            
        # Calculate price spread
        max_price = max(valid_prices)
        min_price = min(valid_prices)
        spread = (max_price - min_price) / price
        
        # Determine confidence based on spread and number of sources
        if spread <= 0.01 and len(valid_prices) >= 4:  # 1% spread, 4+ sources
            return 'very_high'
        elif spread <= 0.02 and len(valid_prices) >= 3:  # 2% spread, 3+ sources
            return 'high'
        elif spread <= 0.05 and len(valid_prices) >= 2:  # 5% spread, 2+ sources
            return 'medium'
        else:
            return 'low'

    async def _fetch_coingecko_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        try:
            coin_id = self.token_mappings[token]['coingecko']
            url = f"{self.price_sources['coingecko']}/simple/price"
            params = {'ids': coin_id, 'vs_currencies': 'usd'}
            
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    return data[coin_id]['usd']
                return None
        except Exception as e:
            print(f"CoinGecko error for {token}: {e}")
            return None

    async def _fetch_binance_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        try:
            symbol = self.token_mappings[token]['binance']
            url = f"{self.price_sources['binance']}/ticker/price"
            params = {'symbol': symbol}
            
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    return float(data['price'])
                return None
        except Exception as e:
            print(f"Binance error for {token}: {e}")
            return None

    async def _fetch_pancakeswap_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        try:
            token_address = self.token_mappings[token]['pancakeswap']
            url = f"{self.price_sources['pancakeswap']}/tokens/{token_address}"
            
            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    return float(data['data']['price'])
                return None
        except Exception as e:
            print(f"PancakeSwap error for {token}: {e}")
            return None

    async def _fetch_coinapi_price(self, token: str) -> Optional[float]:
        """Get price from CoinAPI"""
        try:
            if self.coinapi_service:
                result = await self.coinapi_service.get_token_price(token)
                if result:
                    return result['price']
            return None
        except Exception as e:
            print(f"CoinAPI error for {token}: {e}")
            return None

    async def _fetch_dexscreener_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        try:
            token_path = self.token_mappings[token]['dexscreener']
            url = f"{self.price_sources['dexscreener']}/tokens/{token_path}"
            
            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('pairs'):
                        # Filter for pairs with good liquidity and sort by volume
                        valid_pairs = [p for p in data['pairs'] 
                                     if float(p.get('liquidity', {}).get('usd', 0)) > 100000]
                        valid_pairs.sort(key=lambda x: float(x.get('volume', {}).get('h24', 0)), reverse=True)
                        
                        if valid_pairs:
                            # Use volume-weighted average price from top pairs
                            total_volume = sum(float(p.get('volume', {}).get('h24', 0)) for p in valid_pairs[:5])
                            if total_volume > 0:
                                weighted_price = sum(
                                    float(p['priceUsd']) * float(p.get('volume', {}).get('h24', 0))
                                    for p in valid_pairs[:5]
                                ) / total_volume
                                return weighted_price
                return None
        except Exception as e:
            print(f"DexScreener error for {token}: {e}")
            return None

    async def _fetch_geckoterminal_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        try:
            token_path = self.token_mappings[token]['geckoterminal']
            url = f"{self.price_sources['geckoterminal']}/tokens/{token_path}"
            
            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('data', {}).get('attributes', {}).get('price_usd'):
                        return float(data['data']['attributes']['price_usd'])
                return None
        except Exception as e:
            print(f"GeckoTerminal error for {token}: {e}")
            return None

    async def validate_price(self, token: str, price: float, liquidity: Optional[float] = None) -> bool:
        """Validate a token's price against configured thresholds"""
        if not price or price <= 0:
            return False
            
        # Check if token is a stablecoin
        if token in self.stablecoins:
            if abs(price - 1.0) > self.max_stablecoin_deviation:
                print(f"Warning: {token} price ${price} deviates >5% from $1.00")
                return False
                
        # Validate liquidity if provided
        if liquidity is not None and liquidity < self.min_liquidity_usd:
            print(f"Warning: {token} liquidity ${liquidity} below minimum ${self.min_liquidity_usd}")
            return False
            
        return True

    async def validate_pair_price(self, base_token: str, quote_token: str, price: float) -> bool:
        """Validate a trading pair's price"""
        # Both stablecoins - should be very close to 1:1
        if base_token in self.stablecoins and quote_token in self.stablecoins:
            if abs(price - 1.0) > self.max_stablecoin_deviation:
                print(f"Warning: {base_token}/{quote_token} price {price} deviates >5% from 1.0")
                return False
        
        # Cross-reference with other sources
        pair_prices = await self.get_pair_prices_all_sources(base_token, quote_token)
        if pair_prices:
            avg_price = sum(p for p in pair_prices if p is not None) / len([p for p in pair_prices if p is not None])
            deviation = abs(price - avg_price) / avg_price
            
            max_allowed = self.max_stablecoin_deviation if base_token in self.stablecoins or quote_token in self.stablecoins else self.max_token_deviation
            
            if deviation > max_allowed:
                print(f"Warning: {base_token}/{quote_token} price {price} deviates >{max_allowed*100}% from average {avg_price}")
                return False
        
        return True

    async def get_pair_prices_all_sources(self, base_token: str, quote_token: str) -> List[Optional[float]]:
        """Get pair prices from all available sources"""
        async with aiohttp.ClientSession() as session:
            tasks = [
                self._fetch_dexscreener_price(session, f"{base_token}/{quote_token}"),
                self._fetch_pancakeswap_price(session, f"{base_token}/{quote_token}"),
                self._fetch_binance_price(session, f"{base_token}{quote_token}"),
                self._fetch_geckoterminal_price(session, f"{base_token}-{quote_token}"),
                self._fetch_coingecko_price(session, base_token)  # Will need to divide by quote price
            ]
            return await asyncio.gather(*tasks)

    async def get_token_price(self, token: str) -> Optional[Dict]:
        """Get token price from multiple sources with validation"""
        if token not in self.token_mappings:
            return None

        async with aiohttp.ClientSession() as session:
            tasks = [
                self._fetch_dexscreener_price(session, token),
                self._fetch_pancakeswap_price(session, token),
                self._fetch_binance_price(session, token),
                self._fetch_geckoterminal_price(session, token),
                self._fetch_coingecko_price(session, token),
                self._fetch_coinapi_price(token)
            ]
            
            prices = await asyncio.gather(*tasks)
            valid_prices = [(p, i) for i, p in enumerate(prices) if p is not None]
            
            if len(valid_prices) < self.min_source_count:
                print(f"Warning: {token} has fewer than {self.min_source_count} price sources")
                return None
                
            prices_only = [p for p, _ in valid_prices]
            if not prices_only:
                return None
                
            # Get median price
            prices_only.sort()
            mid = len(prices_only) // 2
            median_price = prices_only[mid] if len(prices_only) % 2 == 1 else (prices_only[mid-1] + prices_only[mid]) / 2
            
            # Validate the price
            if not await self.validate_price(token, median_price):
                return None
                
            return median_price

    async def get_pair_price(self, base_token: str, quote_token: str = 'USDT') -> Optional[Dict]:
        """Get price information for a trading pair with validation"""
        base_price = await self.get_token_price(base_token)
        if quote_token != 'USDT':
            quote_price = await self.get_token_price(quote_token)
            if base_price and quote_price:
                pair_price = base_price / quote_price
                
                # Validate the pair price
                if not await self.validate_pair_price(base_token, quote_token, pair_price):
                    return None
                    
                return {
                    'price': pair_price,
                    'base_usd': base_price,
                    'quote_usd': quote_price,
                    'confidence': await self._calculate_confidence(base_token, quote_token, pair_price)
                }
        else:
            if base_price:
                if not await self.validate_price(base_token, base_price):
                    return None
                    
                return {
                    'price': base_price,
                    'base_usd': base_price,
                    'quote_usd': 1.0,
                    'confidence': await self._calculate_confidence(base_token, 'USDT', base_price)
                }
        return None

    async def _calculate_confidence(self, base_token: str, quote_token: str, price: float) -> str:
        """Calculate confidence level for a pair price"""
        # Get prices from all sources for comparison
        prices = await self.get_pair_prices_all_sources(base_token, quote_token)
        valid_prices = [p for p in prices if p is not None]
        
        if len(valid_prices) < self.min_source_count:
            return 'low'
            
        # Calculate price spread
        max_price = max(valid_prices)
        min_price = min(valid_prices)
        spread = (max_price - min_price) / price
        
        # Determine confidence based on spread and number of sources
        if spread <= 0.01 and len(valid_prices) >= 4:  # 1% spread, 4+ sources
            return 'very_high'
        elif spread <= 0.02 and len(valid_prices) >= 3:  # 2% spread, 3+ sources
            return 'high'
        elif spread <= 0.05 and len(valid_prices) >= 2:  # 5% spread, 2+ sources
            return 'medium'
        else:
            return 'low'

    async def _fetch_pancakeswap_v3_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        """Get price directly from PancakeSwap V3 pool"""
        try:
            token_address = self.token_mappings[token]['pancakeswap']
            # Direct V3 pool query
            url = f"{self.price_sources['pancakeswap_v3']}/pools/by-tokens"
            params = {
                'token0': token_address,
                'token1': self.stablecoins['USDT']['address']
            }
            
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('pool'):
                        return float(data['pool']['token0Price'])
                return None
        except Exception as e:
            print(f"PancakeSwap V3 error for {token}: {e}")
            return None

    async def _fetch_uniswap_v3_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        """Get price directly from Uniswap V3 pool"""
        try:
            token_address = self.token_mappings[token]['pancakeswap']  # Use same address
            url = f"{self.price_sources['uniswap_v3']}/pools/by-tokens"
            params = {
                'token0': token_address,
                'token1': self.stablecoins['USDT']['address']
            }
            
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('pool'):
                        return float(data['pool']['token0Price'])
                return None
        except Exception as e:
            print(f"Uniswap V3 error for {token}: {e}")
            return None

    async def _fetch_sushiswap_price(self, session: aiohttp.ClientSession, token: str) -> Optional[float]:
        """Get price directly from SushiSwap V3 pool"""
        try:
            token_address = self.token_mappings[token]['pancakeswap']  # Use same address
            url = f"{self.price_sources['sushiswap']}/pools/by-tokens"
            params = {
                'token0': token_address,
                'token1': self.stablecoins['USDT']['address']
            }
            
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('pool'):
                        return float(data['pool']['token0Price'])
                return None
        except Exception as e:
            print(f"SushiSwap error for {token}: {e}")
            return None

    def calculate_v3_profit(self, price_a: float, price_b: float, 
                            liquidity: float, fee_tier: str) -> Dict:
        """Calculate profit potential optimized for V3 pools"""
        # Get the optimal fee tier based on volatility
        fee = self.get_optimal_fee_tier(price_a, price_b, fee_tier)
        
        # Calculate maximum trade size based on concentrated liquidity
        max_size = min(
            liquidity * 0.5,  # Can use more of V3 liquidity due to concentration
            1000000  # Hard cap at $1M per trade for V3
        )
        
        # Calculate spread and account for reduced slippage in V3
        spread = abs(price_b - price_a) / price_a
        effective_spread = spread * 0.95  # V3 pools have less slippage
        
        # Calculate profit
        gross_profit = max_size * effective_spread
        fee_cost = max_size * fee
        net_profit = gross_profit - fee_cost
        
        return {
            'max_trade_size': max_size,
            'gross_profit': gross_profit,
            'fee_cost': fee_cost,
            'net_profit': net_profit,
            'effective_spread': effective_spread,
            'fee_tier': fee
        }
        
    def get_optimal_fee_tier(self, price_a: float, price_b: float, default_tier: str) -> float:
        """Get optimal fee tier based on price difference"""
        spread = abs(price_b - price_a) / price_a
        
        # Use lowest fee tier for small spreads
        if spread < 0.001:  # 0.1%
            return 0.0001   # 0.01% tier
        elif spread < 0.005:  # 0.5%
            return 0.0005   # 0.05% tier
        elif spread < 0.02:   # 2%
            return 0.003    # 0.3% tier
        else:
            return 0.01     # 1% tier for volatile pairs
