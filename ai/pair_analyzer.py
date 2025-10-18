import numpy as np
import time
import requests
from typing import Dict, List, Tuple
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
import tensorflow as tf
from scipy.signal import savgol_filter
from web3 import Web3
from datetime import datetime, timedelta

class TokenPairAnalyzer:
    def __init__(self):
        self.pair_history = {}
        self.correlation_matrix = {}
        self.volume_profiles = {}
        self.liquidity_profiles = {}
        self.rf_model = RandomForestClassifier(n_estimators=100)
        self.scaler = StandardScaler()
        self.lstm_model = self._build_pair_lstm()
        
    def _build_pair_lstm(self):
        """Build LSTM model for pair-specific analysis"""
        model = tf.keras.Sequential([
            tf.keras.layers.LSTM(128, return_sequences=True, input_shape=(50, 8)),
            tf.keras.layers.Dropout(0.3),
            tf.keras.layers.LSTM(64, return_sequences=True),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.LSTM(32),
            tf.keras.layers.Dense(16, activation='relu'),
            tf.keras.layers.Dense(3, activation='softmax')  # [profit_prob, loss_prob, neutral_prob]
        ])
        model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])
        return model

    def analyze_pair_correlation(self, token1: str, token2: str, price_history: Dict) -> Dict:
        """Analyze correlation and causation between token pairs"""
        prices1 = np.array(price_history[token1])
        prices2 = np.array(price_history[token2])
        
        # Calculate rolling correlations
        window_sizes = [5, 15, 30, 60]
        correlations = {}
        
        for window in window_sizes:
            if len(prices1) >= window and len(prices2) >= window:
                rolling_corr = []
                for i in range(len(prices1) - window + 1):
                    corr = np.corrcoef(prices1[i:i+window], prices2[i:i+window])[0,1]
                    rolling_corr.append(corr)
                correlations[f'window_{window}'] = rolling_corr
        
        # Calculate lead-lag relationship
        lead_lag = self._calculate_lead_lag(prices1, prices2)
        
        return {
            'correlations': correlations,
            'lead_lag': lead_lag,
            'recent_correlation': correlations.get('window_5', [])[-1] if correlations.get('window_5') else None
        }

    def _calculate_lead_lag(self, prices1: np.ndarray, prices2: np.ndarray, max_lag: int = 10) -> Dict:
        """Calculate lead-lag relationship between pairs"""
        best_lag = 0
        max_corr = 0
        
        for lag in range(-max_lag, max_lag + 1):
            if lag < 0:
                p1 = prices1[:lag]
                p2 = prices2[-lag:]
            else:
                p1 = prices1[lag:]
                p2 = prices2[:-lag] if lag > 0 else prices2
            
            corr = np.corrcoef(p1, p2)[0,1]
            if abs(corr) > abs(max_corr):
                max_corr = corr
                best_lag = lag
        
        return {
            'best_lag': best_lag,
            'max_correlation': max_corr
        }

    def analyze_liquidity_ratio(self, token1: str, token2: str, pool_data: Dict) -> Dict:
        """Analyze liquidity distribution and imbalances"""
        token1_liquidity = pool_data.get(token1, 0)
        token2_liquidity = pool_data.get(token2, 0)
        
        ratio = token1_liquidity / token2_liquidity if token2_liquidity else 0
        historical_ratios = self.liquidity_profiles.get(f"{token1}_{token2}", [])
        
        # Calculate liquidity stability
        stability = np.std(historical_ratios) if len(historical_ratios) > 0 else 1
        
        return {
            'current_ratio': ratio,
            'stability': stability,
            'is_balanced': 0.8 <= ratio <= 1.2
        }

    def predict_pair_movement(self, token1: str, token2: str, market_data: Dict) -> Dict:
        """Predict relative price movement between pairs"""
        features = self._extract_pair_features(token1, token2, market_data)
        features_scaled = self.scaler.fit_transform(features.reshape(1, -1))
        
        # LSTM prediction
        sequence = self._prepare_sequence(features_scaled)
        lstm_pred = self.lstm_model.predict(sequence)
        
        # Random Forest prediction for confirmation
        rf_pred = self.rf_model.predict_proba(features_scaled)
        
        # Combine predictions
        combined_score = (lstm_pred[0] + rf_pred[0]) / 2
        
        return {
            'profit_probability': combined_score[0],
            'loss_probability': combined_score[1],
            'neutral_probability': combined_score[2],
            'confidence': max(combined_score)
        }

    def analyze_cross_pool_arbitrage(self, token1: str, token2: str, pool_data: List[Dict]) -> Dict:
        """Analyze arbitrage opportunities across different pools and simulate multiple trades"""
        from .trade_simulator import TradeSimulator
        opportunities = []
        simulator = TradeSimulator(initial_loan_size=10_000_000)  # $10M flash loan
        
        for i, pool1 in enumerate(pool_data):
            for j, pool2 in enumerate(pool_data):
                if i >= j:
                    continue
                    
                price1 = pool1['price']
                price2 = pool2['price']
                
                # Increased minimum spread to 0.5% for better profit guarantee
                price_diff = abs(price1 - price2) / min(price1, price2)
                if price_diff > 0.005:  # 0.5% minimum spread
                    # Calculate gas cost impact
                    estimated_gas_cost = 300000 * pool1.get('gas_price', 5e9)  # 300k gas units * gas price
                    estimated_profit = self._calculate_profit_after_fees(price1, price2, pool1, pool2)
                    
                    # Only add if profit exceeds gas cost significantly
                    if estimated_profit > estimated_gas_cost * 1.5:  # 50% more than gas cost
                        opportunities.append({
                            'pool1': pool1['name'],
                            'pool2': pool2['name'],
                            'price_diff_percent': price_diff * 100,
                            'estimated_profit': estimated_profit,
                            'net_profit': estimated_profit - estimated_gas_cost,
                            'roi_percent': ((estimated_profit - estimated_gas_cost) / estimated_gas_cost) * 100
                        })
        
        # Sort opportunities by estimated profit
        sorted_opps = sorted(opportunities, key=lambda x: x['estimated_profit'], reverse=True)
        
        # Simulate 50 trades with the $10M flash loan
        simulation_results = simulator.simulate_multiple_trades(sorted_opps, num_trades=50)
        
        # Calculate comprehensive profit metrics
        successful_trades = [trade for trade in simulation_results if trade['success']]
        failed_trades = [trade for trade in simulation_results if not trade['success']]
        
        total_profit = sum(trade['net_profit'] for trade in successful_trades)
        total_gas_cost = sum(trade['gas_cost'] for trade in simulation_results)
        net_profit = total_profit - total_gas_cost
        
        # Find best and worst trades
        best_trade = max(successful_trades, key=lambda x: x['net_profit']) if successful_trades else None
        worst_trade = min(successful_trades, key=lambda x: x['net_profit']) if successful_trades else None
        
        # Calculate projected annual profit (based on successful execution rate)
        success_rate = len(successful_trades) / len(simulation_results)
        daily_trades = 400  # Target daily trades
        projected_daily_profit = (net_profit / len(simulation_results)) * daily_trades
        projected_annual_profit = projected_daily_profit * 365
        
        return {
            'opportunities': sorted_opps,
            'simulation_results': simulation_results,
            'summary': {
                'flash_loan_size': 10_000_000,
                'successful_trades': len(successful_trades),
                'failed_trades': len(failed_trades),
                'total_profit': total_profit,
                'total_gas_cost': total_gas_cost,
                'net_profit': net_profit,
                'average_roi': (net_profit / total_gas_cost * 100) if total_gas_cost > 0 else 0,
                'projected_annual_profit': projected_annual_profit,
                'best_trade': {
                    'pools': f"{best_trade['pool1']} -> {best_trade['pool2']}" if best_trade else None,
                    'net_profit': best_trade['net_profit'] if best_trade else 0,
                    'roi': best_trade['roi_percent'] if best_trade else 0
                },
                'worst_trade': {
                    'pools': f"{worst_trade['pool1']} -> {worst_trade['pool2']}" if worst_trade else None,
                    'net_profit': worst_trade['net_profit'] if worst_trade else 0,
                    'roi': worst_trade['roi_percent'] if worst_trade else 0
                }
            }
        }

    def _calculate_profit_after_fees(self, price1: float, price2: float, pool1: Dict, pool2: Dict) -> float:
        """Calculate expected profit after fees using DODO's free flash loans"""
        # DODO has no flash loan fees
        flash_loan_fee = 0  # DODO flash loans are free
        
        # Pool fees - Use actual pool fees or defaults
        pool1_fee = pool1.get('fee_percent', 0.3) / 100
        pool2_fee = pool2.get('fee_percent', 0.3) / 100
        
        # Set flash loan size to $10M
        FLASH_LOAN_SIZE = 10_000_000  # $10M
        
        # Calculate optimal trade size considering the $10M flash loan
        max_profitable_size = self._calculate_max_profitable_size(pool1['liquidity'], pool2['liquidity'], price1, price2)
        optimal_size = min(FLASH_LOAN_SIZE, max_profitable_size, min(pool1['liquidity'], pool2['liquidity']) * 0.2)  # Up to 20% of pool liquidity
        
        # Calculate expected slippage
        slippage1 = self._estimate_slippage(optimal_size, pool1['liquidity'])
        slippage2 = self._estimate_slippage(optimal_size, pool2['liquidity'])
        
        # Calculate gross profit
        gross_profit = optimal_size * abs(price1 - price2)
        
        # Subtract fees and slippage
        net_profit = gross_profit * (1 - pool1_fee) * (1 - pool2_fee) * (1 - slippage1) * (1 - slippage2)
        
        return net_profit

    def _estimate_slippage(self, trade_size: float, liquidity: float) -> float:
        """Estimate slippage based on trade size and liquidity"""
        return min(1.0, (trade_size / liquidity) ** 2)

    def _extract_pair_features(self, token1: str, token2: str, market_data: Dict) -> np.ndarray:
        """Extract relevant features for pair analysis"""
        features = []
        
        # Price features
        features.extend([
            market_data['price_ratio'],
            market_data['price_ratio_ma5'] / market_data['price_ratio'],
            market_data['price_ratio_ma20'] / market_data['price_ratio'],
            market_data['price_ratio_volatility']
        ])
        
        # Volume features
        features.extend([
            market_data['volume_ratio'],
            market_data['volume_ratio_ma5'] / market_data['volume_ratio'],
            market_data['relative_volume_strength']
        ])
        
        # Liquidity features
        features.extend([
            market_data['liquidity_ratio'],
            market_data['liquidity_stability']
        ])
        
        return np.array(features)

    def _prepare_sequence(self, features: np.ndarray) -> np.ndarray:
        """Prepare feature sequence for LSTM"""
        sequence = np.zeros((1, 50, features.shape[1]))
        sequence[0, -1] = features
        return sequence
        
    def withdraw_profits(self, external_wallet: str, amount: float = None, chain: str = "BSC") -> Dict:
        """
        Withdraw profits to external wallet
        
        Args:
            external_wallet (str): The destination wallet address
            amount (float): Amount to withdraw in USD. If None, withdraws all available profits
            chain (str): Blockchain network to use (default: BSC)
            
        Returns:
            Dict with transaction details
        """
        # Validate wallet address
        if not self._validate_wallet_address(external_wallet):
            return {
                'success': False,
                'error': 'Invalid wallet address format'
            }
            
        # Get available balance
        available_balance = self._get_contract_balance()
        
        # If no specific amount requested, withdraw all available profits
        withdraw_amount = amount if amount is not None else available_balance
        
        # Validate withdrawal amount
        if withdraw_amount > available_balance:
            return {
                'success': False,
                'error': f'Insufficient balance. Available: ${available_balance:.2f}, Requested: ${withdraw_amount:.2f}'
            }
            
        try:
            # Prepare withdrawal transaction
            gas_price = self._get_optimal_gas_price()
            tx_data = {
                'to': external_wallet,
                'value': withdraw_amount,
                'gasPrice': gas_price,
                'chainId': 56 if chain == "BSC" else None  # BSC chainId
            }
            
            # Execute withdrawal
            tx_hash = self._execute_withdrawal(tx_data)
            
            return {
                'success': True,
                'transaction': {
                    'hash': tx_hash,
                    'amount': withdraw_amount,
                    'to': external_wallet,
                    'chain': chain,
                    'gas_price': gas_price,
                    'timestamp': int(time.time())
                }
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def _validate_wallet_address(self, address: str) -> bool:
        """Validate wallet address format"""
        # Basic BSC/ETH address validation
        if not address.startswith('0x'):
            return False
        if len(address) != 42:  # 0x + 40 hex chars
            return False
        try:
            int(address[2:], 16)  # Validate hex format
            return True
        except ValueError:
            return False
            
    def _get_contract_balance(self) -> float:
        """Get current contract balance"""
        # Implementation would connect to the contract and get actual balance
        # This is a placeholder that should be replaced with actual contract interaction
        return self.current_balance
        
    def get_token_balances(self) -> Dict[str, float]:
        """Get balances of different tokens in the contract"""
        # This would normally query the smart contract for actual balances
        # For now, returning example values
        return {
            'USDT': self.current_balance * 0.45,  # 45% in USDT
            'BUSD': self.current_balance * 0.25,  # 25% in BUSD
            'USDC': self.current_balance * 0.15,  # 15% in USDC
            'BNB': self.current_balance * 0.15    # 15% in BNB
        }

    def display_profit_summary(self) -> Dict:
        """Display current profit summary and balance"""
        balance = self._get_contract_balance()
        
        # Get recent trade statistics
        recent_trades = self.analyze_cross_pool_arbitrage(None, None, [])['summary']
        
        # Get top performing token pairs
        top_pairs = self._get_top_performing_pairs()
        
        # Calculate token distribution
        token_balances = self.get_token_balances()
        total_balance = sum(token_balances.values())
        token_distribution = {
            token: (balance / total_balance) * 100 
            for token, balance in token_balances.items()
        }
        
        return {
            'current_balance': f"${balance:,.2f}",
            'today_profit': f"${recent_trades['total_profit']:,.2f}",
            'today_trades': recent_trades['successful_trades'],
            'failed_trades': recent_trades['failed_trades'],
            'avg_profit_per_trade': f"${recent_trades['total_profit']/recent_trades['successful_trades']:,.2f}",
            'projected_daily': f"${recent_trades['net_profit']:,.2f}",
            'projected_annual': f"${recent_trades['projected_annual_profit']:,.2f}",
            'best_trade': {
                'pools': recent_trades['best_trade']['pools'],
                'profit': f"${recent_trades['best_trade']['net_profit']:,.2f}",
                'roi': f"{recent_trades['best_trade']['roi']:.2f}%"
            },
            'top_tokens': top_pairs,
            'token_distribution': token_distribution,
            'bnb_metrics': self._get_bnb_metrics()
        }
        
    def _get_bnb_metrics(self) -> Dict:
        """Get current BNB metrics including price and holdings from Binance API"""
        try:
            # Fetch current BNB price from Binance
            ticker_url = "https://api.binance.com/api/v3/ticker/24hr?symbol=BNBUSDT"
            klines_url = "https://api.binance.com/api/v3/klines?symbol=BNBUSDT&interval=1h&limit=24"
            
            # Get current price and 24h change
            ticker_response = requests.get(ticker_url)
            ticker_data = ticker_response.json()
            
            current_price = float(ticker_data['lastPrice'])
            price_change = float(ticker_data['priceChangePercent'])
            
            # Get hourly price data for volatility
            klines_response = requests.get(klines_url)
            klines_data = klines_response.json()
            
            # Calculate hourly volatility
            hourly_prices = [float(k[4]) for k in klines_data]  # Close prices
            volatility = np.std(hourly_prices) / np.mean(hourly_prices) * 100
            
            # Calculate BNB balance and value
            token_balances = self.get_token_balances()
            bnb_balance = token_balances['BNB'] / current_price
            bnb_value = token_balances['BNB']
            
            # Get market indicators
            rsi = self._calculate_rsi(hourly_prices)
            
            return {
                'price': current_price,
                'price_change': price_change,
                'balance': bnb_balance,
                'value': bnb_value,
                'volatility': round(volatility, 2),
                'rsi': round(rsi, 2),
                'updated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'market_signal': self._get_market_signal(price_change, rsi, volatility)
            }
            
        except Exception as e:
            # Fallback to default values if API call fails
            print(f"Error fetching BNB price: {str(e)}")
            return {
                'price': 300.00,
                'price_change': 0.0,
                'balance': self.get_token_balances()['BNB'] / 300,
                'value': self.get_token_balances()['BNB'],
                'volatility': 0.0,
                'rsi': 50.0,
                'updated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'market_signal': 'NEUTRAL'
            }
            
    def _calculate_rsi(self, prices: List[float], periods: int = 14) -> float:
        """Calculate Relative Strength Index"""
        deltas = np.diff(prices)
        gain = np.where(deltas > 0, deltas, 0)
        loss = np.where(deltas < 0, -deltas, 0)
        
        avg_gain = np.mean(gain[:periods])
        avg_loss = np.mean(loss[:periods])
        
        for i in range(periods, len(deltas)):
            avg_gain = (avg_gain * (periods - 1) + gain[i]) / periods
            avg_loss = (avg_loss * (periods - 1) + loss[i]) / periods
            
        rs = avg_gain / avg_loss if avg_loss != 0 else 0
        return 100 - (100 / (1 + rs))
        
    def _get_market_signal(self, price_change: float, rsi: float, volatility: float) -> str:
        """Generate market signal based on indicators"""
        if rsi > 70 and price_change > 3:
            return 'STRONG_SELL'
        elif rsi < 30 and price_change < -3:
            return 'STRONG_BUY'
        elif rsi > 60:
            return 'SELL'
        elif rsi < 40:
            return 'BUY'
        else:
            return 'NEUTRAL'
        
    def _get_top_performing_pairs(self) -> List[Dict]:
        """Get top performing token pairs"""
        # This would normally analyze actual trading history
        # For now, returning example values
        return [
            {
                'pair': 'CAKE/BUSD',
                'profit': '$2,450.25',
                'roi': '12.5'
            },
            {
                'pair': 'BNB/USDT',
                'profit': '$1,850.75',
                'roi': '8.2'
            },
            {
                'pair': 'ETH/BUSD',
                'profit': '$1,275.50',
                'roi': '6.8'
            }
        ]
        
    def _get_optimal_gas_price(self) -> int:
        """Get optimal gas price for withdrawal"""
        # Implementation would get current network gas prices
        # This is a placeholder that should be replaced with actual gas price fetching
        return Web3.toWei('5', 'gwei')  # Example: 5 gwei
        
    def _execute_withdrawal(self, tx_data: Dict) -> str:
        """Execute the withdrawal transaction"""
        # Implementation would send the actual transaction
        # This is a placeholder that should be replaced with actual transaction sending
        return "0x..." # Transaction hash would be returned here

    def _calculate_max_profitable_size(self, liquidity1: float, liquidity2: float, price1: float, price2: float) -> float:
        """Calculate maximum profitable trade size considering price impact"""
        # Constants for price impact calculation
        k1 = liquidity1 * liquidity1  # constant product k for pool1
        k2 = liquidity2 * liquidity2  # constant product k for pool2
        
        # Calculate optimal size using quadratic formula
        # This finds the point where marginal profit = marginal cost
        a = 1  # coefficient of x^2
        b = -(liquidity1 + liquidity2)  # coefficient of x
        c = price2 * liquidity1 - price1 * liquidity2  # constant term
        
        # Quadratic formula: (-b + sqrt(b^2 - 4ac)) / (2a)
        discriminant = b * b - 4 * a * c
        if discriminant < 0:
            return 0
            
        optimal_size = (-b + np.sqrt(discriminant)) / (2 * a)
        return max(0, min(optimal_size, min(liquidity1, liquidity2) * 0.2))  # Cap at 20% of liquidity
