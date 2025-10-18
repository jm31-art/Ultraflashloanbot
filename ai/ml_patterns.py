import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import tensorflow as tf
from typing import List, Dict, Tuple
import pandas as pd

class MLPatternDetector:
    def __init__(self):
        self.scaler = StandardScaler()
        self.isolation_forest = IsolationForest(contamination=0.1, random_state=42)
        self.lstm_model = self._build_lstm_model()
        
        # Pattern memory
        self.successful_patterns = []
        self.failed_patterns = []
        
    def _build_lstm_model(self):
        """Build LSTM model for sequence prediction"""
        model = tf.keras.Sequential([
            tf.keras.layers.LSTM(64, return_sequences=True, input_shape=(30, 5)),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.LSTM(32),
            tf.keras.layers.Dense(16, activation='relu'),
            tf.keras.layers.Dense(1, activation='sigmoid')
        ])
        model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])
        return model

    def detect_whale_patterns(self, token_data: Dict) -> float:
        """Detect whale trading patterns and market manipulation attempts"""
        volumes = np.array(token_data['volumes']).reshape(-1, 1)
        if len(volumes) < 30:
            return 0.0
            
        # Normalize volumes
        scaled_volumes = self.scaler.fit_transform(volumes)
        
        # Detect anomalies using Isolation Forest
        anomaly_scores = self.isolation_forest.fit_predict(scaled_volumes)
        recent_anomalies = anomaly_scores[-5:]  # Look at last 5 data points
        
        # Calculate whale pattern confidence
        whale_confidence = len([x for x in recent_anomalies if x == -1]) / len(recent_anomalies)
        return whale_confidence

    def detect_market_making_patterns(self, order_book: Dict) -> float:
        """Detect market making patterns and order book manipulation"""
        bids = np.array(order_book['bids'])
        asks = np.array(order_book['asks'])
        
        # Calculate order book imbalance
        bid_sum = np.sum(bids[:, 1])  # Volume
        ask_sum = np.sum(asks[:, 1])
        
        imbalance = abs(bid_sum - ask_sum) / (bid_sum + ask_sum)
        
        # Detect suspicious order book patterns
        spread = asks[0][0] - bids[0][0]
        normal_spread = np.mean([asks[i][0] - bids[i][0] for i in range(min(10, len(bids)))])
        
        spread_anomaly = abs(spread - normal_spread) / normal_spread
        return min(1.0, (imbalance + spread_anomaly) / 2)

    def detect_flashbots_mev(self, mempool_data: List[Dict]) -> float:
        """Detect potential MEV opportunities and flashbots patterns"""
        if not mempool_data:
            return 0.0
            
        # Analyze pending transactions
        gas_prices = [tx['gasPrice'] for tx in mempool_data]
        values = [tx['value'] for tx in mempool_data]
        
        # Detect sandwich attack patterns
        high_gas_txs = len([g for g in gas_prices if g > np.mean(gas_prices) * 1.5])
        high_value_txs = len([v for v in values if v > np.mean(values) * 2])
        
        mev_score = (high_gas_txs + high_value_txs) / (2 * len(mempool_data))
        return min(1.0, mev_score)

    def detect_triangle_arbitrage(self, prices: Dict[str, float]) -> Tuple[float, List[str]]:
        """Detect triangle arbitrage opportunities"""
        opportunities = []
        scores = []
        
        for base in prices:
            for quote in prices:
                if quote == base:
                    continue
                for middle in prices:
                    if middle in [base, quote]:
                        continue
                        
                    # Calculate triangle prices
                    try:
                        rate1 = prices[f"{base}/{middle}"]
                        rate2 = prices[f"{middle}/{quote}"]
                        rate3 = prices[f"{quote}/{base}"]
                        
                        # Calculate arbitrage opportunity
                        triangle_rate = rate1 * rate2 * rate3
                        if triangle_rate > 1.002:  # 0.2% minimum profit after fees
                            opportunities.append([base, middle, quote])
                            scores.append(triangle_rate - 1)
                    except KeyError:
                        continue
        
        if not scores:
            return 0.0, []
            
        best_score = max(scores)
        best_opportunity = opportunities[scores.index(best_score)]
        return best_score, best_opportunity

    def predict_price_movement(self, token_data: Dict) -> Tuple[float, float]:
        """Predict price movement using LSTM"""
        if len(token_data['prices']) < 30:
            return 0.0, 0.0
            
        # Prepare features
        features = np.array([
            token_data['prices'],
            token_data['volumes'],
            token_data['liquidity'],
            token_data['volatility'],
            token_data['momentum']
        ]).T
        
        # Scale features
        scaled_features = self.scaler.fit_transform(features)
        
        # Reshape for LSTM [samples, time steps, features]
        X = np.array([scaled_features])
        
        # Predict
        movement_prob = self.lstm_model.predict(X)[0][0]
        confidence = abs(movement_prob - 0.5) * 2  # Convert to confidence score
        
        return movement_prob, confidence

    def calculate_smart_money_flow(self, token_data: Dict) -> float:
        """Detect smart money movement patterns"""
        volumes = np.array(token_data['volumes'])
        prices = np.array(token_data['prices'])
        
        if len(volumes) < 20:
            return 0.0
            
        # Calculate volume-weighted price
        vwap = np.sum(volumes * prices) / np.sum(volumes)
        
        # Calculate smart money indicator
        smart_money_flow = 0.0
        for i in range(1, len(prices)):
            if prices[i] > prices[i-1] and volumes[i] > volumes[i-1]:
                smart_money_flow += 1
            elif prices[i] < prices[i-1] and volumes[i] < volumes[i-1]:
                smart_money_flow += 0.5
                
        return min(1.0, smart_money_flow / len(prices))
