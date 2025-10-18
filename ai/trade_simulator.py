import numpy as np
from typing import Dict, List
from datetime import datetime, timedelta

class TradeSimulator:
    def __init__(self, initial_loan_size=10_000_000):
        self.loan_size = initial_loan_size
        self.total_profit = 0
        self.trades_history = []
        self.gas_costs = []
        
    def simulate_multiple_trades(self, opportunities: List[Dict], num_trades: int = 50) -> Dict:
        """Simulate multiple trades with a $10M flash loan"""
        simulation_results = {
            'total_profit': 0,
            'successful_trades': 0,
            'failed_trades': 0,
            'average_roi': 0,
            'total_gas_cost': 0,
            'net_profit': 0,
            'best_trade': None,
            'worst_trade': None,
            'trades': []
        }
        
        # Sort opportunities by ROI
        sorted_opps = sorted(opportunities, key=lambda x: x['roi_percent'], reverse=True)
        
        for i in range(min(num_trades, len(sorted_opps))):
            trade = sorted_opps[i]
            
            # Simulate gas price fluctuation
            gas_multiplier = np.random.normal(1, 0.2)  # Random gas price variation ±20%
            gas_cost = trade['estimated_gas_cost'] * gas_multiplier
            
            # Simulate price impact and execution
            execution_success = np.random.random() > 0.1  # 90% success rate
            
            if execution_success:
                # Calculate actual profit with some randomness for real-world variation
                profit_multiplier = np.random.normal(0.95, 0.05)  # Reality is usually slightly worse than estimate
                actual_profit = trade['estimated_profit'] * profit_multiplier
                
                trade_result = {
                    'pools': f"{trade['pool1']} -> {trade['pool2']}",
                    'profit': actual_profit,
                    'gas_cost': gas_cost,
                    'net_profit': actual_profit - gas_cost,
                    'roi': ((actual_profit - gas_cost) / gas_cost) * 100,
                    'timestamp': datetime.now() + timedelta(minutes=i*14.4)  # Simulate trades 14.4 minutes apart (100 trades/day)
                }
                
                simulation_results['trades'].append(trade_result)
                simulation_results['total_profit'] += actual_profit
                simulation_results['total_gas_cost'] += gas_cost
                simulation_results['successful_trades'] += 1
                
                # Update best/worst trade
                if not simulation_results['best_trade'] or trade_result['net_profit'] > simulation_results['best_trade']['net_profit']:
                    simulation_results['best_trade'] = trade_result
                if not simulation_results['worst_trade'] or trade_result['net_profit'] < simulation_results['worst_trade']['net_profit']:
                    simulation_results['worst_trade'] = trade_result
            else:
                simulation_results['failed_trades'] += 1
                simulation_results['total_gas_cost'] += gas_cost  # Still pay gas for failed transactions
        
        # Calculate final statistics
        if simulation_results['successful_trades'] > 0:
            simulation_results['average_roi'] = (simulation_results['total_profit'] - simulation_results['total_gas_cost']) / simulation_results['total_gas_cost'] * 100
        
        simulation_results['net_profit'] = simulation_results['total_profit'] - simulation_results['total_gas_cost']
        
        # Add projected annual profit if maintained
        trades_per_day = 50 / (3/24)  # 50 trades every 3 hours
        daily_profit = simulation_results['net_profit'] * (trades_per_day / 50)
        simulation_results['projected_annual_profit'] = daily_profit * 365
        
        return simulation_results

    def print_simulation_summary(self, results: Dict):
        """Print a detailed summary of the simulation results"""
        print("\n=== Flash Loan Arbitrage Simulation Summary ===")
        print(f"Flash Loan Size: ${self.loan_size:,.2f}")
        print(f"Trading Frequency: 400 trades per day (every 3.6 minutes)")
        print(f"\nTest Sample:")
        print(f"Number of Successful Trades: {results['successful_trades']}")
        print(f"Number of Failed Trades: {results['failed_trades']}")
        
        # Calculate time-based projections
        sample_profit = results['net_profit']
        sample_trades = results['successful_trades'] + results['failed_trades']
        profit_per_trade = sample_profit / sample_trades if sample_trades > 0 else 0
        
        # Daily projections (400 trades)
        daily_profit = profit_per_trade * 400
        daily_volume = self.loan_size * 400
        
        # Weekly projections (400 * 7 trades)
        weekly_profit = daily_profit * 7
        weekly_volume = daily_volume * 7
        
        # Monthly and Annual
        monthly_profit = daily_profit * 30
        annual_profit = daily_profit * 365
        
        print(f"\nProfit Projections:")
        print(f"Daily (400 trades):")
        print(f"  Trading Volume: ${daily_volume:,.2f}")
        print(f"  Net Profit: ${daily_profit:,.2f}")
        print(f"  ROI per day: {(daily_profit / self.loan_size) * 100:.2f}%")
        
        print(f"\nWeekly (2,800 trades):")
        print(f"  Trading Volume: ${weekly_volume:,.2f}")
        print(f"  Net Profit: ${weekly_profit:,.2f}")
        print(f"  ROI per week: {(weekly_profit / self.loan_size) * 100:.2f}%")
        
        print(f"\nMonthly (12,000 trades):")
        print(f"  Net Profit: ${monthly_profit:,.2f}")
        print(f"  ROI per month: {(monthly_profit / self.loan_size) * 100:.2f}%")
        
        print(f"\nAnnual (146,000 trades):")
        print(f"  Net Profit: ${annual_profit:,.2f}")
        print(f"  ROI per year: {(annual_profit / self.loan_size) * 100:.2f}%")
        
        print(f"\nSample Trade Analysis:")
        print(f"Average Profit per Trade: ${profit_per_trade:,.2f}")
        print(f"Average ROI per Trade: {(profit_per_trade / self.loan_size) * 100:.4f}%")
        
        if results['best_trade']:
            print(f"\nBest Trade Sample:")
            print(f"  Pools: {results['best_trade']['pools']}")
            print(f"  Net Profit: ${results['best_trade']['net_profit']:,.2f}")
            print(f"  ROI: {results['best_trade']['roi']:.2f}%")
        
        if results['worst_trade']:
            print(f"\nWorst Successful Trade Sample:")
            print(f"  Pools: {results['worst_trade']['pools']}")
            print(f"  Net Profit: ${results['worst_trade']['net_profit']:,.2f}")
            print(f"  ROI: {results['worst_trade']['roi']:.2f}%")
            
        # Risk metrics
        success_rate = (results['successful_trades'] / sample_trades * 100) if sample_trades > 0 else 0
        print(f"\nRisk Metrics:")
        print(f"Success Rate: {success_rate:.1f}%")
        print(f"Gas Efficiency: {(results['total_profit'] / results['total_gas_cost']):.2f}x gas cost")
        print(f"Average Execution Time: 3.6 minutes per trade")
