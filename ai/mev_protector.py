#!/usr/bin/env python3
"""
AI-Powered MEV Protector for Arbitrage Bot
Implements machine learning models for MEV detection and gas price prediction
"""

import sys
import json
import time
import asyncio
import threading
from datetime import datetime, timedelta
from collections import deque
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import joblib
import os

class MEVProtectorAI:
    def __init__(self):
        self.gas_price_model = None
        self.mev_detector = None
        self.scaler = StandardScaler()
        self.gas_history = deque(maxlen=1000)
        self.transaction_patterns = deque(maxlen=5000)
        self.mev_alerts = []
        self.is_initialized = False

        # Model file paths
        self.models_dir = os.path.join(os.path.dirname(__file__), 'models')
        self.gas_model_path = os.path.join(self.models_dir, 'gas_price_predictor.pkl')
        self.mev_model_path = os.path.join(self.models_dir, 'mev_detector.pkl')
        self.manifest_path = os.path.join(self.models_dir, 'manifest.json')

        # Create models directory if it doesn't exist
        os.makedirs(self.models_dir, exist_ok=True)

    def _compute_sha256(self, path):
        """Compute SHA256 checksum of a file in a streaming manner."""
        import hashlib
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()

    def _is_within_models_dir(self, path):
        """Ensure the provided path is inside the dedicated models directory."""
        try:
            return os.path.commonpath([os.path.realpath(path), os.path.realpath(self.models_dir)]) == os.path.realpath(self.models_dir)
        except Exception:
            return False

    def _load_manifest(self):
        """Load the manifest (allowlist) of approved model checksums.

        The manifest is expected to be a JSON mapping of "filename" -> "sha256".
        If the manifest is missing or invalid, an empty dict is returned.
        """
        if not os.path.exists(self.manifest_path):
            return {}
        try:
            with open(self.manifest_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"ERROR loading model manifest: {e}")
            return {}

    def _update_manifest_entry(self, model_name, sha256_value):
        """Update or create the manifest entry for a model and save to disk."""
        manifest = self._load_manifest()
        manifest[model_name] = sha256_value
        try:
            with open(self.manifest_path, 'w') as f:
                json.dump(manifest, f, indent=2)
            # Restrict permissions to owner read/write only
            try:
                os.chmod(self.manifest_path, 0o600)
            except Exception:
                pass
        except Exception as e:
            print(f"ERROR saving model manifest: {e}")

    def load_secure_model(self, model_path, model_name):
        """Validate model artifact against manifest before deserialization.

        This performs three checks in order:
        1) File exists and is within the configured models directory.
        2) The manifest contains a SHA256 checksum for the model.
        3) The computed checksum matches the manifest entry.

        Only after these checks succeed will the model be deserialized.
        """
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model file not found: {model_path}")

        if not self._is_within_models_dir(model_path):
            raise PermissionError("Model path is outside of allowed models directory")

        manifest = self._load_manifest()
        expected = manifest.get(model_name)
        if not expected:
            raise ValueError(f"No manifest entry for model: {model_name}")

        actual = self._compute_sha256(model_path)
        if actual != expected:
            raise ValueError(f"Model checksum mismatch for {model_name}: expected {expected}, got {actual}")

        # At this point the artifact provenance and integrity have been verified.
        print(f"Verified model {model_name} checksum {actual}")
        # Safe to deserialize
        return joblib.load(model_path)

    def initialize(self):
        """Initialize AI models and training data"""
        try:
            print("AI Initializing AI MEV Protector...")

            # Load or train gas price prediction model
            if os.path.exists(self.gas_model_path):
                self.gas_price_model = self.load_secure_model(self.gas_model_path, os.path.basename(self.gas_model_path))
                print("OK Loaded existing gas price prediction model")
            else:
                self._train_gas_price_model()
                print("OK Trained new gas price prediction model")

            # Load or train MEV detection model
            if os.path.exists(self.mev_model_path):
                self.mev_detector = self.load_secure_model(self.mev_model_path, os.path.basename(self.mev_model_path))
                print("OK Loaded existing MEV detection model")
            else:
                self._train_mev_detector()
                print("OK Trained new MEV detection model")

            self.is_initialized = True
            print("AI AI MEV Protector ready!")
            return True

        except Exception as e:
            print(f"ERROR AI initialization failed: {e}")
            return False

    def _train_gas_price_model(self):
        """Train gas price prediction model using historical data"""
        # Generate synthetic training data based on typical BSC gas patterns
        np.random.seed(42)

        # Features: hour_of_day, network_congestion, recent_tx_count, bnb_price
        n_samples = 10000
        hours = np.random.randint(0, 24, n_samples)
        congestion = np.random.uniform(0, 1, n_samples)
        tx_count = np.random.randint(10, 500, n_samples)
        bnb_price = np.random.uniform(200, 600, n_samples)

        # Gas price influenced by these factors
        base_gas = 5  # Base 5 gwei
        hour_multiplier = 1 + 0.3 * np.sin(2 * np.pi * hours / 24)  # Daily cycle
        congestion_multiplier = 1 + 2 * congestion  # Congestion impact
        tx_multiplier = 1 + 0.001 * tx_count  # Transaction volume impact

        gas_prices = base_gas * hour_multiplier * congestion_multiplier * tx_multiplier
        gas_prices += np.random.normal(0, 0.5, n_samples)  # Add noise

        X = np.column_stack([hours, congestion, tx_count, bnb_price])
        y = gas_prices

        # Train model
        self.gas_price_model = RandomForestRegressor(
            n_estimators=100,
            max_depth=10,
            random_state=42
        )
        self.gas_price_model.fit(X, y)

        # Save model
        joblib.dump(self.gas_price_model, self.gas_model_path)
        try:
            sha = self._compute_sha256(self.gas_model_path)
            self._update_manifest_entry(os.path.basename(self.gas_model_path), sha)
            print(f"Saved gas model and updated manifest with sha256 {sha}")
        except Exception as e:
            print(f"Warning: failed to update manifest for gas model: {e}")

    def _train_mev_detector(self):
        """Train MEV detection model using transaction pattern analysis"""
        # Generate synthetic MEV patterns
        np.random.seed(42)

        n_samples = 5000
        features = []

        for _ in range(n_samples):
            # Normal transaction features
            gas_price = np.random.uniform(5, 50)
            gas_limit = np.random.uniform(21000, 500000)
            value = np.random.uniform(0, 10)  # ETH value
            nonce = np.random.randint(0, 100)
            to_address = np.random.randint(0, 1000)  # Simulated address clustering

            # MEV indicators
            front_running = np.random.choice([0, 1], p=[0.95, 0.05])
            sandwich_attack = np.random.choice([0, 1], p=[0.98, 0.02])
            back_running = np.random.choice([0, 1], p=[0.97, 0.03])

            # Modify features for MEV transactions
            if front_running or sandwich_attack or back_running:
                gas_price *= np.random.uniform(1.5, 3.0)  # Higher gas price
                gas_limit *= np.random.uniform(1.2, 2.0)  # Higher gas limit

            features.append([
                gas_price, gas_limit, value, nonce, to_address,
                front_running, sandwich_attack, back_running
            ])

        X = np.array(features)

        # Train isolation forest for anomaly detection
        self.mev_detector = IsolationForest(
            contamination=0.05,  # Expected 5% MEV transactions
            random_state=42
        )
        self.mev_detector.fit(X)

        # Save model
        joblib.dump(self.mev_detector, self.mev_model_path)
        try:
            sha = self._compute_sha256(self.mev_model_path)
            self._update_manifest_entry(os.path.basename(self.mev_model_path), sha)
            print(f"Saved MEV detector model and updated manifest with sha256 {sha}")
        except Exception as e:
            print(f"Warning: failed to update manifest for MEV model: {e}")

    def predict_gas_price(self, features):
        """Predict optimal gas price using AI model"""
        if not self.is_initialized or not self.gas_price_model:
            return 10  # Fallback 10 gwei

        try:
            # Extract features: [hour_of_day, network_congestion, recent_tx_count, bnb_price]
            hour = datetime.now().hour
            congestion = min(len(self.gas_history) / 100, 1.0) if self.gas_history else 0.5
            tx_count = len([g for g in self.gas_history if g > datetime.now().timestamp() - 60])  # Last minute
            bnb_price = 300  # Placeholder - would get from price feed

            X = np.array([[hour, congestion, tx_count, bnb_price]])
            predicted_gas = self.gas_price_model.predict(X)[0]

            # Add safety buffer
            safe_gas = predicted_gas * 1.2

            # Store in history
            self.gas_history.append(datetime.now().timestamp())

            return max(safe_gas, 5)  # Minimum 5 gwei

        except Exception as e:
            print(f"Gas prediction error: {e}")
            return 10

    def analyze_transaction(self, transaction_data):
        """Analyze transaction for MEV patterns"""
        if not self.is_initialized or not self.mev_detector:
            return {"mev_risk": "unknown", "confidence": 0}

        try:
            # Extract features from transaction
            gas_price = transaction_data.get('gasPrice', 10)
            gas_limit = transaction_data.get('gasLimit', 21000)
            value = transaction_data.get('value', 0)
            nonce = transaction_data.get('nonce', 0)
            to_address = hash(transaction_data.get('to', '0x0')) % 1000  # Simple address clustering

            # MEV indicators (would be detected from mempool analysis)
            front_running = 0
            sandwich_attack = 0
            back_running = 0

            features = np.array([[
                gas_price, gas_limit, value, nonce, to_address,
                front_running, sandwich_attack, back_running
            ]])

            # Get anomaly score (-1 to 1, where -1 is most anomalous)
            score = self.mev_detector.decision_function(features)[0]

            # Convert to risk assessment
            if score < -0.5:
                risk_level = "HIGH"
                confidence = 0.9
            elif score < -0.2:
                risk_level = "MEDIUM"
                confidence = 0.7
            else:
                risk_level = "LOW"
                confidence = 0.5

            return {
                "mev_risk": risk_level,
                "confidence": confidence,
                "anomaly_score": score
            }

        except Exception as e:
            print(f"Transaction analysis error: {e}")
            return {"mev_risk": "unknown", "confidence": 0}

    def get_protection_strategy(self, transaction_data, mev_analysis):
        """Recommend protection strategy based on AI analysis"""
        risk = mev_analysis.get('mev_risk', 'LOW')

        strategies = {
            "HIGH": {
                "method": "flashbots",
                "gas_multiplier": 1.5,
                "delay_ms": 2000,
                "reason": "High MEV risk detected - using private mempool"
            },
            "MEDIUM": {
                "method": "timed",
                "gas_multiplier": 1.3,
                "delay_ms": 1000,
                "reason": "Medium MEV risk - using timed execution"
            },
            "LOW": {
                "method": "standard",
                "gas_multiplier": 1.1,
                "delay_ms": 0,
                "reason": "Low MEV risk - standard execution"
            }
        }

        return strategies.get(risk, strategies["LOW"])

    def update_models(self, new_data):
        """Update AI models with new data"""
        # This would be called periodically to retrain models
        # For now, just log that we'd update
        print(f"DATA Would update AI models with {len(new_data)} new data points")

# Global AI instance
ai_protector = MEVProtectorAI()

def handle_message(message):
    """Handle messages from Node.js parent process"""
    try:
        data = json.loads(message.strip())

        if data.get('action') == 'initialize':
            success = ai_protector.initialize()
            response = {"status": "initialized" if success else "failed"}

        elif data.get('action') == 'predict_gas':
            gas_price = ai_protector.predict_gas_price(data.get('features', {}))
            response = {"gas_price": gas_price}

        elif data.get('action') == 'analyze_transaction':
            analysis = ai_protector.analyze_transaction(data.get('transaction', {}))
            response = analysis

        elif data.get('action') == 'get_protection_strategy':
            analysis = ai_protector.analyze_transaction(data.get('transaction', {}))
            strategy = ai_protector.get_protection_strategy(data.get('transaction', {}), analysis)
            response = {"strategy": strategy, "analysis": analysis}

        else:
            response = {"error": "Unknown action"}

        # Send response back to Node.js
        print(json.dumps(response))
        sys.stdout.flush()

    except Exception as e:
        error_response = {"error": str(e)}
        print(json.dumps(error_response))
        sys.stdout.flush()

def main():
    """Main AI process loop"""
    print("AI MEV Protector process started")
    sys.stdout.flush()

    # Initialize AI
    if not ai_protector.initialize():
        print(json.dumps({"error": "AI initialization failed"}))
        sys.stdout.flush()
        return

    # Signal ready
    print(json.dumps({"status": "ready"}))
    sys.stdout.flush()

    # Process messages from Node.js
    try:
        for line in sys.stdin:
            if line.strip():
                handle_message(line)
    except KeyboardInterrupt:
        print("AI process shutting down...")
    except Exception as e:
        print(f"AI process error: {e}")

if __name__ == "__main__":
    main()
