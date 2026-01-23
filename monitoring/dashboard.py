#!/usr/bin/env python3
"""
MONITORING DASHBOARD FOR ULTRA FLASH LOAN BOT
Real-time web interface for bot performance and metrics
"""

import os
import time
import json
import threading
from datetime import datetime, timedelta
from collections import defaultdict
from flask import Flask, jsonify, render_template
from decimal import Decimal
import psutil
import requests

# Global metrics storage
metrics = {
    'start_time': time.time(),
    'total_profit': Decimal('0'),
    'trades_count': 0,
    'successful_trades': 0,
    'gas_spent': Decimal('0'),
    'last_trade': None,
    'opportunities_detected': 0,
    'edge_performance': defaultdict(lambda: {'trades': 0, 'profit': Decimal('0'), 'errors': 0}),
    'wallet_balances': {},
    'errors_last_hour': 0,
    'alerts': []
}

app = Flask(__name__)

@app.route('/')
def dashboard():
    """Main dashboard page"""
    return render_template('dashboard.html', metrics=get_dashboard_metrics())

@app.route('/api/metrics')
def api_metrics():
    """API endpoint for real-time metrics"""
    return jsonify(get_dashboard_metrics())

@app.route('/api/history')
def api_history():
    """API endpoint for historical data"""
    return jsonify(get_historical_data())

def get_dashboard_metrics():
    """Get current dashboard metrics"""
    current_time = time.time()
    uptime = current_time - metrics['start_time']

    return {
        'uptime': uptime,
        'total_profit_24h': get_profit_period(hours=24),
        'total_profit_7d': get_profit_period(hours=168),
        'total_profit_30d': get_profit_period(hours=720),
        'total_profit_all': metrics['total_profit'],
        'success_rate': (metrics['successful_trades'] / max(metrics['trades_count'], 1)) * 100,
        'avg_profit_per_trade': metrics['total_profit'] / max(metrics['trades_count'], 1),
        'gas_cost_ratio': (metrics['gas_spent'] / max(abs(metrics['total_profit']), 1)) * 100,
        'trades_count': metrics['trades_count'],
        'opportunities_detected': metrics['opportunities_detected'],
        'last_trade': metrics['last_trade'],
        'wallet_balances': metrics['wallet_balances'],
        'edge_performance': dict(metrics['edge_performance']),
        'errors_last_hour': metrics['errors_last_hour'],
        'alerts': metrics['alerts'][-10:],  # Last 10 alerts
        'system_status': get_system_status()
    }

def get_profit_period(hours):
    """Get profit for specified period (simplified - would need historical storage)"""
    # In production, query database for profit in last N hours
    return metrics['total_profit']  # Placeholder

def get_historical_data():
    """Get historical trading data"""
    # In production, return chart data for profits over time
    return {
        'profit_chart': [],
        'gas_chart': [],
        'success_rate_chart': []
    }

def get_system_status():
    """Get system health status"""
    try:
        cpu_percent = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/')

        return {
            'cpu_usage': cpu_percent,
            'memory_usage': memory.percent,
            'disk_usage': disk.percent,
            'status': 'healthy' if cpu_percent < 80 and memory.percent < 80 else 'warning'
        }
    except:
        return {'status': 'unknown'}

def record_trade(edge_name, profit, gas_cost, success=True):
    """Record a completed trade"""
    metrics['trades_count'] += 1
    if success:
        metrics['successful_trades'] += 1
        metrics['total_profit'] += profit

    metrics['gas_spent'] += gas_cost
    metrics['last_trade'] = {
        'timestamp': time.time(),
        'edge': edge_name,
        'profit': float(profit),
        'gas_cost': float(gas_cost),
        'success': success
    }

    # Update edge performance
    edge_metrics = metrics['edge_performance'][edge_name]
    edge_metrics['trades'] += 1
    edge_metrics['profit'] += profit

    # Check for alerts
    check_alerts()

def record_opportunity(edge_name):
    """Record detected opportunity"""
    metrics['opportunities_detected'] += 1

def record_error(edge_name, error_msg):
    """Record an error"""
    metrics['edge_performance'][edge_name]['errors'] += 1
    metrics['errors_last_hour'] += 1

    # Reset error count every hour
    current_hour = int(time.time() / 3600)
    if not hasattr(record_error, 'last_reset_hour'):
        record_error.last_reset_hour = current_hour
    elif current_hour > record_error.last_reset_hour:
        metrics['errors_last_hour'] = 1
        record_error.last_reset_hour = current_hour

def update_wallet_balance(token, balance):
    """Update wallet balance for a token"""
    metrics['wallet_balances'][token] = float(balance)

def check_alerts():
    """Check for alert conditions"""
    alerts = []

    # Profit alert
    if metrics['total_profit'] > 100:
        alerts.append({
            'type': 'success',
            'message': f"High profit achieved: ${metrics['total_profit']:.2f}",
            'timestamp': time.time()
        })

    # Success rate alert
    success_rate = (metrics['successful_trades'] / max(metrics['trades_count'], 1)) * 100
    if success_rate < 50 and metrics['trades_count'] > 10:
        alerts.append({
            'type': 'warning',
            'message': f"Low success rate: {success_rate:.1f}%",
            'timestamp': time.time()
        })

    # Wallet balance alert
    bnb_balance = metrics['wallet_balances'].get('BNB', 0)
    if bnb_balance < 0.5:
        alerts.append({
            'type': 'danger',
            'message': f"Low BNB balance: {bnb_balance:.3f} BNB",
            'timestamp': time.time()
        })

    # Error rate alert
    if metrics['errors_last_hour'] > 10:
        alerts.append({
            'type': 'danger',
            'message': f"High error rate: {metrics['errors_last_hour']} errors/hour",
            'timestamp': time.time()
        })

    # No trades alert
    if metrics['last_trade'] and time.time() - metrics['last_trade']['timestamp'] > 3600:
        alerts.append({
            'type': 'warning',
            'message': "No trades in the last hour",
            'timestamp': time.time()
        })

    metrics['alerts'].extend(alerts)

def start_dashboard(host='0.0.0.0', port=5000):
    """Start the dashboard server"""
    def run_app():
        app.run(host=host, port=port, debug=False)

    thread = threading.Thread(target=run_app, daemon=True)
    thread.start()
    print(f"📊 Dashboard started at http://{host}:{port}")

# Template for dashboard.html (would be in templates/ folder)
DASHBOARD_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>Ultra Flash Loan Bot Dashboard</title>
    <meta http-equiv="refresh" content="10">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .metric { background: #f0f0f0; padding: 10px; margin: 10px; border-radius: 5px; }
        .alert { padding: 10px; margin: 10px; border-radius: 5px; }
        .alert-success { background: #d4edda; color: #155724; }
        .alert-warning { background: #fff3cd; color: #856404; }
        .alert-danger { background: #f8d7da; color: #721c24; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    </style>
</head>
<body>
    <h1>🚀 Ultra Flash Loan Bot Dashboard</h1>

    <div class="grid">
        <div class="metric">
            <h3>Total Profit</h3>
            <p>24h: ${{ total_profit_24h|round(2) }}</p>
            <p>7d: ${{ total_profit_7d|round(2) }}</p>
            <p>All-time: ${{ total_profit_all|round(2) }}</p>
        </div>

        <div class="metric">
            <h3>Performance</h3>
            <p>Success Rate: {{ success_rate|round(1) }}%</p>
            <p>Avg Profit/Trade: ${{ avg_profit_per_trade|round(2) }}</p>
            <p>Gas Cost Ratio: {{ gas_cost_ratio|round(1) }}%</p>
        </div>

        <div class="metric">
            <h3>Activity</h3>
            <p>Trades: {{ trades_count }}</p>
            <p>Opportunities: {{ opportunities_detected }}</p>
            <p>Errors/Hour: {{ errors_last_hour }}</p>
        </div>

        <div class="metric">
            <h3>System Status</h3>
            <p>Status: {{ system_status.status }}</p>
            <p>CPU: {{ system_status.cpu_usage|round(1) }}%</p>
            <p>Memory: {{ system_status.memory_usage|round(1) }}%</p>
        </div>
    </div>

    <h2>Recent Alerts</h2>
    {% for alert in alerts %}
    <div class="alert alert-{{ alert.type }}">
        {{ alert.message }}
    </div>
    {% endfor %}

    <h2>Edge Performance</h2>
    <table border="1">
        <tr><th>Edge</th><th>Trades</th><th>Profit</th><th>Errors</th></tr>
        {% for edge, data in edge_performance.items() %}
        <tr>
            <td>{{ edge }}</td>
            <td>{{ data.trades }}</td>
            <td>${{ data.profit|round(2) }}</td>
            <td>{{ data.errors }}</td>
        </tr>
        {% endfor %}
    </table>
</body>
</html>
"""

if __name__ == "__main__":
    start_dashboard()
    # Keep main thread alive
    while True:
        time.sleep(1)