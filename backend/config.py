import os
from dotenv import load_dotenv

load_dotenv()

# GitHub API
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
GITHUB_GRAPHQL_URL = "https://api.github.com/graphql"
GITHUB_REST_URL = "https://api.github.com"

# Database
DATABASE_URL = os.getenv("DATABASE_URL", "")

# Sync Engine — no hardcoded fetch limits; full recursive pagination by default
SYNC_BATCH_SIZE = int(os.getenv("SYNC_BATCH_SIZE", "500"))   # DB commit interval
SYNC_RATE_LIMIT_BUFFER = int(os.getenv("SYNC_RATE_LIMIT_BUFFER", "50"))  # pause when remaining < this

# Analytics
STALE_PR_DAYS = 30
STALE_ISSUE_DAYS = 30
STALE_BRANCH_DAYS = 90

# ML Models
ML_MODELS_DIR = "ml/trained_models"
ML_CONTAMINATION = 0.1
ML_KMEANS_CLUSTERS = 3

# API Server
API_HOST = "127.0.0.1"
API_PORT = 8000
API_RELOAD = False
API_WORKERS = 1

# CORS — Next.js may use any port 3000–3019
CORS_ORIGINS = [
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in range(3000, 3020)
]
