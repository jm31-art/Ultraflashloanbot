import numpy as np
from typing import Dict, List, Tuple
from scipy import stats
import pandas as pd

class RiskAnalyzer:
    def __init__(self):
        self.risk_thresholds = {
            'max_exposure': 1000000,  # $1M USD
            'max_slippage': 0.02,     # 2%
            'max_volatility': 0.05,   # 5%
            'min_liquidity': 500000   # $500K USD
        }
        
        # Risk metrics history
        self.volatility_history = {}
        self.liquidity_history = {}
        self.exposure_history = {}
        self.risk_scores = {}
        
    def calculate_impermanent_loss_risk(self, token: str, price_data: List[float]) -> float:
        """Calculate potential impermanent loss risk"""
        if len(price_data) < 2:
            return 1.0  # Maximum risk if insufficient data
            
        price_changes = np.diff(price_data) / price_data[:-1]
        volatility = np.std(price_changes)
        
        # Calculate IL risk based on price volatility
        il_risk = min(1.0, volatility * 10)  # Scale volatility to 0-1
        return il_risk

    def calculate_smart_contract_risk(self, token: str, contract_data: Dict) -> float:
        """Evaluate smart contract risk factors"""
        risk_score = 0.0
        risk_factors = {
            'code_verified': 0.3,
            'audit_status': 0.3,
            'age': 0.2,
            'complexity': 0.2
        }
        
        if contract_data.get('code_verified', False):
            risk_score += risk_factors['code_verified']
            
        if contract_data.get('audit_status', 'none') == 'audited':
            risk_score += risk_factors['audit_status']
            
        # Age risk (newer contracts are riskier)
        contract_age = contract_data.get('age_days', 0)
        if contract_age > 180:  # 6 months
            risk_score += risk_factors['age']
        elif contract_age > 90:  # 3 months
            risk_score += risk_factors['age'] * 0.7
        elif contract_age > 30:  # 1 month
            risk_score += risk_factors['age'] * 0.3
            
        # Complexity risk
        complexity_score = contract_data.get('complexity_score', 1.0)
        risk_score += (1 - complexity_score) * risk_factors['complexity']
        
        return 1 - risk_score  # Convert to risk (1 = highest risk)

    def calculate_liquidity_risk(self, token: str, pool_data: Dict) -> float:
        """Analyze liquidity risks"""
        liquidity = pool_data.get('liquidity', 0)
        depth = pool_data.get('depth', [])
        
        if not depth or liquidity < self.risk_thresholds['min_liquidity']:
            return 1.0
            
        # Calculate liquidity concentration
        total_liquidity = sum(d['amount'] for d in depth)
        top_holders_liquidity = sum(d['amount'] for d in depth[:5])
        concentration_risk = top_holders_liquidity / total_liquidity
        
        # Calculate depth stability
        depth_changes = np.diff([d['amount'] for d in depth])
        depth_volatility = np.std(depth_changes) / np.mean([d['amount'] for d in depth])
        
        return min(1.0, (concentration_risk + depth_volatility) / 2)

    def calculate_market_impact(self, token: str, trade_size: float, pool_data: Dict) -> Tuple[float, float]:
        """Calculate market impact and slippage for a given trade size"""
        if not pool_data.get('depth', []):
            return 1.0, 1.0
            
        depth = pool_data['depth']
        cumulative_liquidity = 0
        slippage = 0
        
        for level in depth:
            if cumulative_liquidity + level['amount'] >= trade_size:
                remaining = trade_size - cumulative_liquidity
                price_impact = (level['price'] - depth[0]['price']) / depth[0]['price']
                slippage += (remaining / trade_size) * price_impact
                break
            else:
                cumulative_liquidity += level['amount']
                price_impact = (level['price'] - depth[0]['price']) / depth[0]['price']
                slippage += (level['amount'] / trade_size) * price_impact
                
        market_impact = min(1.0, slippage / self.risk_thresholds['max_slippage'])
        return market_impact, slippage

    def calculate_correlation_risk(self, token: str, price_data: Dict) -> float:
        """Calculate correlation-based risks"""
        if not price_data.get('correlated_tokens', {}):
            return 1.0
            
        correlations = []
        for other_token, other_prices in price_data['correlated_tokens'].items():
            if len(other_prices) != len(price_data['prices']):
                continue
                
            correlation = stats.pearsonr(price_data['prices'], other_prices)[0]
            correlations.append(abs(correlation))
            
        if not correlations:
            return 1.0
            
        # High correlation risk indicates potential systemic risk
        avg_correlation = np.mean(correlations)
        return min(1.0, avg_correlation)

    def calculate_composability_risk(self, token: str, protocol_data: Dict) -> float:
        """Calculate risks from protocol integrations and dependencies"""
        risk_score = 0.0
        weights = {
            'dependencies': 0.4,
            'integration_complexity': 0.3,
            'upgrade_frequency': 0.3
        }
        
        # Dependency risk
        num_dependencies = len(protocol_data.get('dependencies', []))
        dep_risk = min(1.0, num_dependencies / 10)  # Normalize to 0-1
        risk_score += dep_risk * weights['dependencies']
        
        # Integration complexity risk
        complexity = protocol_data.get('integration_complexity', 1.0)
        risk_score += complexity * weights['integration_complexity']
        
        # Upgrade frequency risk
        upgrades = len(protocol_data.get('recent_upgrades', []))
        upgrade_risk = min(1.0, upgrades / 5)  # Normalize to 0-1
        risk_score += upgrade_risk * weights['upgrade_frequency']
        
        return risk_score

    def get_comprehensive_risk_score(self, token: str, data: Dict) -> Dict[str, float]:
        """Calculate comprehensive risk score combining all metrics"""
        risk_scores = {
            'impermanent_loss': self.calculate_impermanent_loss_risk(token, data.get('prices', [])),
            'smart_contract': self.calculate_smart_contract_risk(token, data.get('contract_data', {})),
            'liquidity': self.calculate_liquidity_risk(token, data.get('pool_data', {})),
            'market_impact': self.calculate_market_impact(token, data.get('trade_size', 0), data.get('pool_data', {}))[0],
            'correlation': self.calculate_correlation_risk(token, data.get('price_data', {})),
            'composability': self.calculate_composability_risk(token, data.get('protocol_data', {}))
        }
        
        # Calculate weighted average
        weights = {
            'impermanent_loss': 0.2,
            'smart_contract': 0.25,
            'liquidity': 0.2,
            'market_impact': 0.15,
            'correlation': 0.1,
            'composability': 0.1
        }
        
        total_risk = sum(score * weights[risk_type] for risk_type, score in risk_scores.items())
        risk_scores['total'] = total_risk
        
        return risk_scores
