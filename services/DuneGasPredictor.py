import pandas as pd

class DuneGasPredictor:
    def __init__(self, dune_client):
        self.client = dune_client
        self.cache = {}

    def get_historical_gas_trends(self):
        """
        Get gas price trends to predict optimal timing.
        """
        query = """
        SELECT
            DATE_TRUNC('minute', block_time) as minute,
            AVG(base_fee_gwei) as avg_base_fee,
            MAX(base_fee_gwei) as max_base_fee,
            MIN(base_fee_gwei) as min_base_fee,
            COUNT(*) as tx_count
        FROM ethereum.transactions
        WHERE block_time > NOW() - INTERVAL '24' hour
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT 1000
        """
        result = self.client.run_query(query=query)
        return pd.DataFrame(result.result.rows)

    def predict_optimal_gas(self, urgency='normal'):
        """
        Use historical patterns to predict gas prices.
        """
        trends = self.get_historical_gas_trends()

        # Your ML/statistical analysis here
        current_avg = trends['avg_base_fee'].iloc[0]
        volatility = trends['avg_base_fee'].std()

        multipliers = {
            'low': 0.9,
            'normal': 1.0,
            'high': 1.2,
            'urgent': 1.5
        }

        return {
            'base_fee': current_avg * multipliers[urgency],
            'volatility': volatility,
            'confidence': min(len(trends) / 100, 1.0)
        }