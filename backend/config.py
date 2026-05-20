import os
from dotenv import load_dotenv

load_dotenv()

# GitHub API
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
GITHUB_API_URL = "https://api.github.com/graphql"

# Database
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./pr_dashboard.db")

# Analytics
STALE_PR_DAYS = 30
PR_FETCH_LIMIT = 100

# ML Models
ML_MODELS_DIR = "ml/trained_models"
ML_CONTAMINATION = 0.1  # For Isolation Forest
ML_KMEANS_CLUSTERS = 3

# API
API_HOST = "0.0.0.0"
API_PORT = 8000
API_RELOAD = True

# CORS — Next.js may use any port 3000–3019 when lower ports are busy
CORS_ORIGINS = [
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in range(3000, 3020)
]
