import numpy as np
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor, IsolationForest
from sklearn.linear_model import LogisticRegression
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from typing import List, Dict, Tuple
import pickle
import os

class MLModels:
    def __init__(self):
        self.models_dir = "ml/trained_models"
        os.makedirs(self.models_dir, exist_ok=True)
        
        self.delay_model = None
        self.bottleneck_model = None
        self.risk_model = None
        self.review_wait_model = None
        self.contributor_kmeans = None
        self.scaler = StandardScaler()
    
    def train_delay_prediction(self, X: np.ndarray, y: np.ndarray):
        """Train PR delay prediction model"""
        self.delay_model = GradientBoostingRegressor(n_estimators=100, random_state=42)
        self.delay_model.fit(X, y)
        self._save_model(self.delay_model, "delay_model.pkl")
    
    def predict_delay(self, features: List[float]) -> float:
        """Predict PR merge delay in days"""
        if self.delay_model is None:
            self.delay_model = self._load_model("delay_model.pkl")
        
        if self.delay_model is None:
            return 0.0
        
        X = np.array(features).reshape(1, -1)
        return max(0, float(self.delay_model.predict(X)[0]))
    
    def train_bottleneck_detection(self, X: np.ndarray):
        """Train bottleneck detection model"""
        self.bottleneck_model = IsolationForest(contamination=0.1, random_state=42)
        self.bottleneck_model.fit(X)
        self._save_model(self.bottleneck_model, "bottleneck_model.pkl")
    
    def predict_bottleneck(self, features: List[float]) -> float:
        """Predict bottleneck probability (0-1)"""
        if self.bottleneck_model is None:
            self.bottleneck_model = self._load_model("bottleneck_model.pkl")
        
        if self.bottleneck_model is None:
            return 0.0
        
        X = np.array(features).reshape(1, -1)
        anomaly_score = self.bottleneck_model.score_samples(X)[0]
        # Convert to probability
        probability = 1 / (1 + np.exp(anomaly_score))
        return float(probability)
    
    def train_risk_score(self, X: np.ndarray, y: np.ndarray):
        """Train PR risk score model"""
        self.risk_model = LogisticRegression(random_state=42, max_iter=1000)
        self.risk_model.fit(X, y)
        self._save_model(self.risk_model, "risk_model.pkl")
    
    def predict_risk(self, features: List[float]) -> float:
        """Predict PR risk score (0-1)"""
        if self.risk_model is None:
            self.risk_model = self._load_model("risk_model.pkl")
        
        if self.risk_model is None:
            return 0.0
        
        X = np.array(features).reshape(1, -1)
        return float(self.risk_model.predict_proba(X)[0][1])
    
    def train_review_wait_prediction(self, X: np.ndarray, y: np.ndarray):
        """Train review wait time prediction model"""
        self.review_wait_model = RandomForestRegressor(n_estimators=100, random_state=42)
        self.review_wait_model.fit(X, y)
        self._save_model(self.review_wait_model, "review_wait_model.pkl")
    
    def predict_review_wait(self, features: List[float]) -> float:
        """Predict review wait time in hours"""
        if self.review_wait_model is None:
            self.review_wait_model = self._load_model("review_wait_model.pkl")
        
        if self.review_wait_model is None:
            return 0.0
        
        X = np.array(features).reshape(1, -1)
        return max(0, float(self.review_wait_model.predict(X)[0]))
    
    def train_contributor_segmentation(self, X: np.ndarray, n_clusters: int = 3):
        """Train contributor segmentation model"""
        X_scaled = self.scaler.fit_transform(X)
        self.contributor_kmeans = KMeans(n_clusters=n_clusters, random_state=42)
        self.contributor_kmeans.fit(X_scaled)
        self._save_model(self.contributor_kmeans, "contributor_kmeans.pkl")
        self._save_model(self.scaler, "scaler.pkl")
    
    def predict_contributor_segment(self, features: List[float]) -> int:
        """Predict contributor segment"""
        if self.contributor_kmeans is None:
            self.contributor_kmeans = self._load_model("contributor_kmeans.pkl")
            self.scaler = self._load_model("scaler.pkl")
        
        if self.contributor_kmeans is None:
            return 0
        
        X = np.array(features).reshape(1, -1)
        X_scaled = self.scaler.transform(X)
        return int(self.contributor_kmeans.predict(X_scaled)[0])
    
    def _save_model(self, model, filename: str):
        """Save model to disk"""
        path = os.path.join(self.models_dir, filename)
        with open(path, 'wb') as f:
            pickle.dump(model, f)
    
    def _load_model(self, filename: str):
        """Load model from disk"""
        path = os.path.join(self.models_dir, filename)
        if os.path.exists(path):
            with open(path, 'rb') as f:
                return pickle.load(f)
        return None
