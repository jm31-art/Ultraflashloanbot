from typing import Dict, List, Optional
from web3 import Web3
import numpy as np
from collections import deque
import time

class MEVProtector:
    def __init__(self, web3: Web3):
        self.web3 = web3
        self.mempool_cache = deque(maxlen=1000)
        self.known_attackers = set()
        self.suspicious_patterns = {}
        self.block_transactions = {}
        self.gas_price_history = []
        
    def analyze_mempool(self, pending_tx: Dict) -> Dict[str, float]:
        """Analyze mempool for MEV threats"""
        risk_scores = {
            'sandwich_risk': self._detect_sandwich_pattern(pending_tx),
            'frontrun_risk': self._detect_frontrunning(pending_tx),
            'gas_manipulation': self._detect_gas_manipulation(pending_tx),
            'flashbots_risk': self._detect_flashbots_activity(pending_tx)
        }
        
        # Calculate overall risk score
        risk_scores['total_risk'] = sum(risk_scores.values()) / len(risk_scores)
        return risk_scores
        
    def _detect_sandwich_pattern(self, tx: Dict) -> float:
        """Detect potential sandwich attack patterns"""
        high_gas_txs = [t for t in self.mempool_cache 
                       if t['gasPrice'] > tx['gasPrice'] * 1.2]
        
        if not high_gas_txs:
            return 0.0
            
        # Check for typical sandwich patterns
        buy_patterns = sum(1 for t in high_gas_txs 
                         if self._is_buy_transaction(t))
        sell_patterns = sum(1 for t in high_gas_txs 
                          if self._is_sell_transaction(t))
                          
        return min(1.0, (buy_patterns + sell_patterns) / 10)
        
    def _detect_frontrunning(self, tx: Dict) -> float:
        """Detect potential frontrunning attempts"""
        # Check for similar transactions with higher gas price
        similar_txs = [t for t in self.mempool_cache 
                      if self._is_similar_transaction(t, tx)]
                      
        if not similar_txs:
            return 0.0
            
        # Calculate risk based on gas price differences
        gas_prices = [t['gasPrice'] for t in similar_txs]
        max_gas = max(gas_prices)
        
        if max_gas > tx['gasPrice'] * 1.5:
            return min(1.0, (max_gas - tx['gasPrice']) / tx['gasPrice'])
            
        return 0.0
        
    def _detect_gas_manipulation(self, tx: Dict) -> float:
        """Detect gas price manipulation attempts"""
        if len(self.gas_price_history) < 10:
            return 0.0
            
        recent_gas = np.mean(self.gas_price_history[-10:])
        current_gas = tx['gasPrice']
        
        manipulation_score = abs(current_gas - recent_gas) / recent_gas
        return min(1.0, manipulation_score)
        
    def _detect_flashbots_activity(self, tx: Dict) -> float:
        """Detect potential Flashbots MEV activity"""
        # Check for typical Flashbots patterns
        if tx.get('maxPriorityFeePerGas', 0) > 0:
            return 0.8  # High likelihood of Flashbots usage
            
        if self._is_bundle_transaction(tx):
            return 1.0
            
        return 0.0
        
    def get_safe_gas_price(self, base_gas: int) -> int:
        """Calculate safe gas price to avoid MEV"""
        if not self.gas_price_history:
            return base_gas
            
        recent_gas = np.mean(self.gas_price_history[-5:])
        std_dev = np.std(self.gas_price_history[-20:]) if len(self.gas_price_history) >= 20 else 0
        
        # Add buffer based on market conditions
        safe_gas = recent_gas + (2 * std_dev)
        return int(max(base_gas, safe_gas))
        
    def recommend_protection_strategy(self, tx: Dict) -> Dict:
        """Recommend MEV protection strategy"""
        risk_scores = self.analyze_mempool(tx)
        
        strategies = {
            'use_flashbots': risk_scores['total_risk'] > 0.7,
            'increase_gas': False,
            'delay_transaction': False,
            'split_transaction': False
        }
        
        if risk_scores['gas_manipulation'] > 0.5:
            strategies['increase_gas'] = True
            strategies['gas_multiplier'] = 1.3
            
        if risk_scores['sandwich_risk'] > 0.8:
            strategies['split_transaction'] = True
            strategies['num_splits'] = 3
            
        if risk_scores['frontrun_risk'] > 0.6:
            strategies['delay_transaction'] = True
            strategies['delay_blocks'] = 2
            
        return strategies
        
    def _is_buy_transaction(self, tx: Dict) -> bool:
        """Detect if transaction is a buy"""
        # Implement DEX-specific buy detection logic
        try:
            input_data = tx.get('input', '')
            return ('swapExactETHForTokens' in input_data or
                   'swapETHForExactTokens' in input_data)
        except:
            return False
            
    def _is_sell_transaction(self, tx: Dict) -> bool:
        """Detect if transaction is a sell"""
        try:
            input_data = tx.get('input', '')
            return ('swapExactTokensForETH' in input_data or
                   'swapTokensForExactETH' in input_data)
        except:
            return False
            
    def _is_similar_transaction(self, tx1: Dict, tx2: Dict) -> bool:
        """Check if transactions are similar (targeting same pools/tokens)"""
        try:
            input1 = tx1.get('input', '')
            input2 = tx2.get('input', '')
            # Check for similar function calls and token addresses
            return (input1[:10] == input2[:10] and
                   any(addr in input2 for addr in self._extract_addresses(input1)))
        except:
            return False
            
    def _is_bundle_transaction(self, tx: Dict) -> bool:
        """Detect if transaction is part of a Flashbots bundle"""
        # Check for typical Flashbots transaction characteristics
        return (tx.get('maxFeePerGas', 0) > 0 and
                tx.get('maxPriorityFeePerGas', 0) > 0)
