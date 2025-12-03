import asyncio
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ArbitrageDetector")

class ArbitrageDetector:
    def __init__(self):
        # Configuration
        self.min_profit_threshold = 0.5  # 0.5% minimum profit
        self.min_liquidity_threshold = 50000  # $50k minimum liquidity
        self.max_price_impact = 0.3  # 0.3% maximum price impact
        self.max_trade_size = 1000000  # $1M maximum trade size
        self.gas_cost_bnb = 0.01  # Estimated gas cost in BNB

        # DEX configurations with fees and flash loan support
        self.dexes = {
            'PancakeSwap': {'fee': 0.25, 'priority': 1, 'flashloan_support': True},
            'BiSwap': {'fee': 0.1, 'priority': 2, 'flashloan_support': False},
            'ApeSwap': {'fee': 0.2, 'priority': 2, 'flashloan_support': False},
            'MDEX': {'fee': 0.3, 'priority': 3, 'flashloan_support': False},
            'BabySwap': {'fee': 0.3, 'priority': 4, 'flashloan_support': False},
            'UniswapV2': {'fee': 0.3, 'priority': 1, 'flashloan_support': True},
            'SushiSwap': {'fee': 0.3, 'priority': 2, 'flashloan_support': False}
        }

        # Flash loan providers
        self.flashloan_providers = {
            'DODO': {'fee': 0.02, 'max_amount': 10000000},  # 0.02% fee, $10M max
            'AaveV3': {'fee': 0.09, 'max_amount': 50000000},  # 0.09% fee, $50M max
            'UniswapV3': {'fee': 0.0, 'max_amount': 1000000}  # No fee for small amounts
        }

        # Staking opportunities tracking
        self.staking_opportunities = []

        # Track historical opportunities
        self.opportunity_history = []
        
    async def calculate_optimal_trade_size(
        self,
        buy_price: float,
        sell_price: float,
        buy_liquidity: float,
        sell_liquidity: float,
        buy_fee: float,
        sell_fee: float
    ) -> Tuple[float, float]:
        """Calculate optimal trade size and expected profit"""
        # Calculate maximum trade size based on liquidity
        max_size = min(
            buy_liquidity * 0.2,  # Use max 20% of liquidity
            sell_liquidity * 0.2,
            self.max_trade_size
        )
        
        # Calculate price impact
        price_impact_buy = (max_size / buy_liquidity) * 100
        price_impact_sell = (max_size / sell_liquidity) * 100
        
        if price_impact_buy > self.max_price_impact or price_impact_sell > self.max_price_impact:
            # Reduce trade size if price impact is too high
            adjustment_factor = min(
                self.max_price_impact / price_impact_buy,
                self.max_price_impact / price_impact_sell
            )
            max_size *= adjustment_factor
        
        # Calculate total fees
        total_fee_percent = buy_fee + sell_fee
        
        # Calculate potential profit
        price_diff = sell_price - buy_price
        profit_percent = (price_diff / buy_price * 100) - total_fee_percent
        
        return max_size, profit_percent
        
    def estimate_gas_cost_usd(self, bnb_price: float) -> float:
        """Estimate gas cost in USD"""
        return self.gas_cost_bnb * bnb_price
        
    async def analyze_opportunity(
        self,
        token_pair: Tuple[str, str],
        prices: Dict[str, Dict],
        liquidity: Dict[str, Dict],
        bnb_price: float
    ) -> Optional[Dict]:
        """Analyze arbitrage opportunity between DEXes"""
        base_token, quote_token = token_pair
        
        opportunities = []
        for buy_dex in self.dexes:
            for sell_dex in self.dexes:
                if buy_dex == sell_dex:
                    continue
                    
                # Get prices and liquidity
                buy_price = prices.get(buy_dex, {}).get('price')
                sell_price = prices.get(sell_dex, {}).get('price')
                buy_liq = liquidity.get(buy_dex, {}).get('liquidity')
                sell_liq = liquidity.get(sell_dex, {}).get('liquidity')
                
                if not all([buy_price, sell_price, buy_liq, sell_liq]):
                    continue
                    
                # Calculate optimal trade size and profit
                trade_size, profit_percent = await self.calculate_optimal_trade_size(
                    buy_price,
                    sell_price,
                    buy_liq,
                    sell_liq,
                    self.dexes[buy_dex]['fee'],
                    self.dexes[sell_dex]['fee']
                )
                
                # Calculate gas costs
                gas_cost_usd = self.estimate_gas_cost_usd(bnb_price)
                
                # Calculate net profit
                net_profit_usd = (trade_size * profit_percent / 100) - gas_cost_usd
                
                if net_profit_usd > self.min_profit_threshold:
                    opportunity = {
                        'base_token': base_token,
                        'quote_token': quote_token,
                        'buy_dex': buy_dex,
                        'sell_dex': sell_dex,
                        'buy_price': buy_price,
                        'sell_price': sell_price,
                        'trade_size_usd': trade_size,
                        'profit_percent': profit_percent,
                        'gas_cost_usd': gas_cost_usd,
                        'net_profit_usd': net_profit_usd,
                        'buy_liquidity': buy_liq,
                        'sell_liquidity': sell_liq,
                        'timestamp': datetime.now().timestamp(),
                        'confidence': min(
                            prices[buy_dex].get('confidence', 'low'),
                            prices[sell_dex].get('confidence', 'low')
                        )
                    }
                    opportunities.append(opportunity)
        
        # Return the most profitable opportunity
        if opportunities:
            best_opportunity = max(opportunities, key=lambda x: x['net_profit_usd'])
            self.opportunity_history.append(best_opportunity)
            return best_opportunity
        
        return None
        
    def get_historical_stats(self) -> Dict:
        """Get statistical analysis of historical opportunities"""
        if not self.opportunity_history:
            return {}
            
        profits = [op['net_profit_usd'] for op in self.opportunity_history]
        return {
            'total_opportunities': len(self.opportunity_history),
            'avg_profit': sum(profits) / len(profits),
            'max_profit': max(profits),
            'min_profit': min(profits),
            'total_profit': sum(profits),
            'most_profitable_pair': max(
                self.opportunity_history,
                key=lambda x: x['net_profit_usd']
            )
        }
        
    def get_dex_ranking(self) -> List[Tuple[str, float]]:
        """Get DEX ranking based on profitable opportunities"""
        if not self.opportunity_history:
            return []

        dex_profits = {}
        for op in self.opportunity_history:
            dex_profits.setdefault(op['buy_dex'], 0)
            dex_profits.setdefault(op['sell_dex'], 0)
            dex_profits[op['buy_dex']] += op['net_profit_usd'] / 2
            dex_profits[op['sell_dex']] += op['net_profit_usd'] / 2

        return sorted(dex_profits.items(), key=lambda x: x[1], reverse=True)

    async def analyze_staking_opportunities(self, token_balances: Dict[str, float], investment_horizon: int = 30) -> List[Dict]:
        """Analyze staking opportunities vs arbitrage returns"""
        staking_opportunities = []

        for token, balance in token_balances.items():
            # Calculate potential arbitrage returns (simplified)
            arbitrage_return = balance * 0.02  # Assume 2% return from arbitrage

            # Calculate staking returns
            staking_apy = self.get_staking_apy(token)
            staking_return = balance * (staking_apy / 100) * (investment_horizon / 365)

            opportunity = {
                'token': token,
                'balance': balance,
                'arbitrage_return': arbitrage_return,
                'staking_apy': staking_apy,
                'staking_return': staking_return,
                'net_benefit': staking_return - arbitrage_return,
                'recommendation': 'staking' if staking_return > arbitrage_return else 'arbitrage',
                'investment_horizon': investment_horizon
            }

            staking_opportunities.append(opportunity)

        # Sort by net benefit
        staking_opportunities.sort(key=lambda x: x['net_benefit'], reverse=True)
        self.staking_opportunities = staking_opportunities

        return staking_opportunities

    def get_staking_apy(self, token: str) -> float:
        """Get staking APY for a token (simplified)"""
        staking_apys = {
            'CAKE': 25.5,
            'BNB': 18.2,
            'BTCB': 12.8,
            'ETH': 15.3,
            'USDT': 8.5,
            'BUSD': 8.2,
            'USDC': 7.8
        }
        return staking_apys.get(token, 5.0)

    async def find_flashloan_opportunities(self, token_pair: Tuple[str, str], prices: Dict[str, Dict]) -> List[Dict]:
        """Find arbitrage opportunities that can use flash loans"""
        flash_opportunities = []

        for provider, config in self.flashloan_providers.items():
            # Check if we can get a flash loan for the base token
            base_token, quote_token = token_pair

            # Find DEXes that support flash loans
            flash_dexes = [dex for dex, info in self.dexes.items() if info['flashloan_support']]

            for buy_dex in flash_dexes:
                for sell_dex in flash_dexes:
                    if buy_dex == sell_dex:
                        continue

                    buy_price = prices.get(buy_dex, {}).get('price')
                    sell_price = prices.get(sell_dex, {}).get('price')

                    if not buy_price or not sell_price:
                        continue

                    # Calculate arbitrage profit
                    price_diff = sell_price - buy_price
                    profit_percent = (price_diff / buy_price * 100)

                    # Subtract flash loan fee
                    net_profit_percent = profit_percent - config['fee']

                    if net_profit_percent > 0.1:  # Minimum 0.1% profit after fees
                        opportunity = {
                            'token_pair': token_pair,
                            'flash_provider': provider,
                            'buy_dex': buy_dex,
                            'sell_dex': sell_dex,
                            'buy_price': buy_price,
                            'sell_price': sell_price,
                            'gross_profit_percent': profit_percent,
                            'flash_fee': config['fee'],
                            'net_profit_percent': net_profit_percent,
                            'max_flash_amount': config['max_amount'],
                            'atomic_transaction': True
                        }
                        flash_opportunities.append(opportunity)

        return flash_opportunities

    def get_flashloan_stats(self) -> Dict:
        """Get statistics on flash loan usage"""
        if not hasattr(self, 'flash_history'):
            self.flash_history = []

        if not self.flash_history:
            return {}

        profits = [op['net_profit_percent'] for op in self.flash_history]
        return {
            'total_flash_loans': len(self.flash_history),
            'avg_profit_percent': sum(profits) / len(profits),
            'max_profit_percent': max(profits),
            'success_rate': len([p for p in profits if p > 0]) / len(profits) * 100
        }
