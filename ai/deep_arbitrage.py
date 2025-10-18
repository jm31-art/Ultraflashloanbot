import tensorflow as tf
from tensorflow.keras.layers import LSTM, Dense, Dropout, Conv1D, MaxPooling1D, Bidirectional
from sklearn.ensemble import GradientBoostingClassifier, RandomForestRegressor
from sklearn.preprocessing import StandardScaler
import numpy as np
from typing import Dict, List, Tuple
import joblib

class DeepArbitrageModel:
    def __init__(self):
        self.price_model = self._build_price_model()
        self.volume_model = self._build_volume_model()
        self.opportunity_model = self._build_opportunity_model()
        self.gbm_model = GradientBoostingClassifier(n_estimators=100)
        self.scaler = StandardScaler()
        self.validation_model = RandomForestRegressor(n_estimators=100)
        
    def _build_price_model(self) -> tf.keras.Model:
        """Build deep learning model for price prediction"""
        model = tf.keras.Sequential([
            # CNN layers for feature extraction
            Conv1D(64, 3, activation='relu', input_shape=(50, 8)),
            MaxPooling1D(2),
            Conv1D(128, 3, activation='relu'),
            MaxPooling1D(2),
            
            # Bidirectional LSTM for sequence processing
            Bidirectional(LSTM(128, return_sequences=True)),
            Dropout(0.3),
            Bidirectional(LSTM(64)),
            Dropout(0.2),
            
            # Dense layers for prediction
            Dense(64, activation='relu'),
            Dropout(0.2),
            Dense(32, activation='relu'),
            Dense(1, activation='linear')
        ])
        
        model.compile(
            optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
            loss='mse',
            metrics=['mae']
        )
        return model
        
    def _build_volume_model(self) -> tf.keras.Model:
        """Build model for volume analysis"""
        model = tf.keras.Sequential([
            LSTM(64, return_sequences=True, input_shape=(30, 5)),
            Dropout(0.2),
            LSTM(32, return_sequences=True),
            Dropout(0.2),
            LSTM(16),
            Dense(8, activation='relu'),
            Dense(1, activation='sigmoid')
        ])
        
        model.compile(
            optimizer='adam',
            loss='binary_crossentropy',
            metrics=['accuracy']
        )
        return model
        
    def _build_opportunity_model(self) -> tf.keras.Model:
        """Build model for arbitrage opportunity detection"""
        # Input branches
        price_input = tf.keras.Input(shape=(50, 8))
        volume_input = tf.keras.Input(shape=(30, 5))
        
        # Price processing branch
        x1 = Conv1D(32, 3, activation='relu')(price_input)
        x1 = MaxPooling1D(2)(x1)
        x1 = LSTM(64, return_sequences=True)(x1)
        x1 = LSTM(32)(x1)
        
        # Volume processing branch
        x2 = LSTM(32, return_sequences=True)(volume_input)
        x2 = LSTM(16)(x2)
        
        # Combine branches
        combined = tf.keras.layers.concatenate([x1, x2])
        
        # Output layers
        x = Dense(32, activation='relu')(combined)
        x = Dropout(0.2)(x)
        x = Dense(16, activation='relu')(x)
        output = Dense(1, activation='sigmoid')(x)
        
        model = tf.keras.Model(inputs=[price_input, volume_input], outputs=output)
        model.compile(
            optimizer='adam',
            loss='binary_crossentropy',
            metrics=['accuracy']
        )
        return model

    def predict_arbitrage_opportunity(self, 
                                    market_data: Dict,
                                    confidence_threshold: float = 0.8) -> Tuple[bool, float, Dict]:
        """Predict arbitrage opportunities using ensemble of models"""
        # Prepare features
        price_features = self._prepare_price_features(market_data)
        volume_features = self._prepare_volume_features(market_data)
        
        # Get predictions from different models
        price_pred = self.price_model.predict(price_features)
        volume_pred = self.volume_model.predict(volume_features)
        opportunity_pred = self.opportunity_model.predict(
            [price_features, volume_features]
        )
        
        # Get GBM prediction for validation
        gbm_features = self._prepare_gbm_features(market_data)
        gbm_pred = self.gbm_model.predict_proba(gbm_features)
        
        # Combine predictions
        ensemble_pred = np.mean([
            price_pred,
            volume_pred,
            opportunity_pred,
            gbm_pred[:, 1].reshape(-1, 1)
        ], axis=0)
        
        # Validate prediction
        validation_score = self.validation_model.predict(gbm_features)
        
        # Calculate confidence
        confidence = self._calculate_confidence(
            ensemble_pred[0][0],
            validation_score[0]
        )
        
        return (
            confidence > confidence_threshold,
            confidence,
            {
                'price_signal': float(price_pred[0][0]),
                'volume_signal': float(volume_pred[0][0]),
                'opportunity_signal': float(opportunity_pred[0][0]),
                'validation_score': float(validation_score[0])
            }
        )

    def _prepare_price_features(self, market_data: Dict) -> np.ndarray:
        """Prepare price features for model input"""
        features = np.array([
            market_data['price_history'],
            market_data['price_volatility'],
            market_data['price_momentum'],
            market_data['moving_averages'],
            market_data['rsi'],
            market_data['macd'],
            market_data['bollinger_bands'],
            market_data['support_resistance']
        ]).T
        
        return self.scaler.fit_transform(features).reshape(1, 50, 8)

    def _prepare_volume_features(self, market_data: Dict) -> np.ndarray:
        """Prepare volume features for model input"""
        features = np.array([
            market_data['volume_history'],
            market_data['volume_ma'],
            market_data['volume_volatility'],
            market_data['buy_sell_ratio'],
            market_data['liquidity_depth']
        ]).T
        
        return self.scaler.fit_transform(features).reshape(1, 30, 5)

    def _prepare_gbm_features(self, market_data: Dict) -> np.ndarray:
        """Prepare features for GBM model"""
        features = np.array([
            market_data['price_latest'],
            market_data['volume_latest'],
            market_data['volatility'],
            market_data['liquidity'],
            market_data['market_depth'],
            market_data['spread'],
            market_data['momentum'],
            market_data['trend']
        ]).reshape(1, -1)
        
        return self.scaler.fit_transform(features)

    def _calculate_confidence(self, 
                            ensemble_pred: float, 
                            validation_score: float) -> float:
        """Calculate confidence score for prediction"""
        # Weight the ensemble prediction and validation score
        confidence = (0.7 * ensemble_pred + 0.3 * validation_score)
        
        # Adjust confidence based on prediction strength
        if confidence > 0.8:
            confidence *= 1.1  # Boost high confidence predictions
        elif confidence < 0.2:
            confidence *= 0.9  # Reduce low confidence predictions
            
        return min(1.0, confidence)
