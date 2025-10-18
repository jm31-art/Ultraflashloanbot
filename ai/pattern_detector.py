import numpy as np
from typing import Dict, List, Tuple, Optional
import pandas as pd
from scipy import stats
import logging
from web3 import Web3
from datetime import datetime, timedelta

class PatternDetector:
    def __init__(self):
        self.price_history = {}  # token => list of (timestamp, price) tuples
        self.volume_history = {}  # token => list of (timestamp, volume) tuples
        self.liquidity_history = {}  # pool => list of (timestamp, liquidity) tuples
        self.volatility_windows = {}  # token => rolling volatility
        self.correlation_matrix = {}  # token pair => correlation coefficient
        self.pattern_scores = {}  # token => pattern confidence score
        
        # Configuration
        self.MIN_DATA_POINTS = 30
        self.VOLATILITY_WINDOW = 20
        self.CONFIDENCE_THRESHOLD = 0.8
        
        # Pattern definitions
        self.PATTERNS = {
            'v_shape_recovery': {'weight': 0.3, 'min_depth': 0.02},
            'liquidity_imbalance': {'weight': 0.25, 'threshold': 0.1},
            'volume_spike': {'weight': 0.2, 'threshold': 2.0},
            'price_momentum': {'weight': 0.15, 'lookback': 5},
            'correlation_divergence': {'weight': 0.1, 'threshold': 0.7}
        }

    def update_price(self, token: str, price: float, timestamp: int = None):
        """Update price history for a token"""
        if timestamp is None:
            timestamp = int(datetime.now().timestamp())
        
        if token not in self.price_history:
            self.price_history[token] = []
        
        self.price_history[token].append((timestamp, price))
        self._update_volatility(token)

    def _update_volatility(self, token: str):
        """Calculate rolling volatility for a token"""
        prices = [p[1] for p in self.price_history[token][-self.VOLATILITY_WINDOW:]]
        if len(prices) >= self.VOLATILITY_WINDOW:
            returns = np.diff(np.log(prices))
            volatility = np.std(returns) * np.sqrt(len(returns))
            self.volatility_windows[token] = volatility

    def detect_v_shape(self, token: str) -> float:
        """Detect V-shaped recovery patterns"""
        if token not in self.price_history:
            return 0.0
            
        prices = [p[1] for p in self.price_history[token][-self.MIN_DATA_POINTS:]]
        if len(prices) < self.MIN_DATA_POINTS:
            return 0.0
            
        min_idx = np.argmin(prices)
        if min_idx == 0 or min_idx == len(prices) - 1:
            return 0.0
            
        pre_drop = prices[:min_idx]
        post_recovery = prices[min_idx:]
        
        drop_size = (max(pre_drop) - prices[min_idx]) / max(pre_drop)
        recovery_size = (prices[-1] - prices[min_idx]) / prices[min_idx]
        
        if drop_size > self.PATTERNS['v_shape_recovery']['min_depth'] and recovery_size > drop_size * 0.8:
            return min(1.0, (drop_size + recovery_size) / 2)
        return 0.0

    def detect_liquidity_imbalance(self, pool: str) -> float:
        """Detect liquidity imbalances between pools"""
        if pool not in self.liquidity_history:
            return 0.0
            
        recent_liquidity = [l[1] for l in self.liquidity_history[pool][-10:]]
        if len(recent_liquidity) < 10:
            return 0.0
            
        std_dev = np.std(recent_liquidity)
        mean_liq = np.mean(recent_liquidity)
        
        if std_dev / mean_liq > self.PATTERNS['liquidity_imbalance']['threshold']:
            return min(1.0, (std_dev / mean_liq) / self.PATTERNS['liquidity_imbalance']['threshold'])
        return 0.0

    def detect_volume_spike(self, token: str) -> float:
        """Detect unusual volume spikes"""
        if token not in self.volume_history:
            return 0.0
            
        volumes = [v[1] for v in self.volume_history[token][-20:]]
        if len(volumes) < 20:
            return 0.0
            
        recent_vol = volumes[-1]
        avg_vol = np.mean(volumes[:-1])
        
        if recent_vol > avg_vol * self.PATTERNS['volume_spike']['threshold']:
            return min(1.0, (recent_vol / avg_vol) / self.PATTERNS['volume_spike']['threshold'])
        return 0.0

    def calculate_opportunity_score(self, token: str, pools: List[str]) -> Tuple[float, Dict]:
        """Calculate overall opportunity score based on multiple patterns"""
        scores = {
            'v_shape': self.detect_v_shape(token),
            'liquidity': max([self.detect_liquidity_imbalance(p) for p in pools]),
            'volume': self.detect_volume_spike(token),
            'momentum': self._calculate_momentum_score(token),
            'correlation': self._calculate_correlation_divergence(token)
        }
        
        weighted_score = sum(scores[k] * self.PATTERNS[p]['weight'] 
                           for k, p in zip(scores.keys(), self.PATTERNS.keys()))
        
        return weighted_score, scores

    def _calculate_momentum_score(self, token: str) -> float:
        """Calculate price momentum score"""
        if token not in self.price_history:
            return 0.0
            
        prices = [p[1] for p in self.price_history[token][-self.PATTERNS['price_momentum']['lookback']:]]
        if len(prices) < self.PATTERNS['price_momentum']['lookback']:
            return 0.0
            
        momentum = (prices[-1] / prices[0]) - 1
        return min(1.0, abs(momentum))

    def _calculate_correlation_divergence(self, token: str) -> float:
        """Detect correlation divergences with related tokens"""
        if token not in self.correlation_matrix:
            return 0.0
            
        correlations = [c for c in self.correlation_matrix[token].values()]
        if not correlations:
            return 0.0
            
        # High divergence from typical correlations indicates opportunity
        return min(1.0, 1.0 - max(correlations))

    def evaluate_risk(self, token: str) -> Dict[str, float]:
        """Evaluate various risk metrics for a token"""
        return {
            'volatility': self.volatility_windows.get(token, 0),
            'liquidity_risk': 1.0 - self.detect_liquidity_imbalance(token),
            'momentum_risk': self._calculate_momentum_score(token),
            'correlation_risk': self._calculate_correlation_divergence(token)
        }

    def should_execute_trade(self, token: str, pools: List[str], min_confidence: float = 0.8) -> Tuple[bool, Dict]:
        """Determine if a trade should be executed based on pattern analysis"""
        opportunity_score, pattern_scores = self.calculate_opportunity_score(token, pools)
        risks = self.evaluate_risk(token)
        
        # Calculate risk-adjusted score
        risk_score = np.mean(list(risks.values()))
        adjusted_score = opportunity_score * (1 - risk_score)
        
        return adjusted_score > min_confidence, {
            'opportunity_score': opportunity_score,
            'risk_score': risk_score,
            'adjusted_score': adjusted_score,
            'patterns': pattern_scores,
            'risks': risks
        }
