import os
import warnings
from dotenv import load_dotenv

load_dotenv()

# ── GitHub API URLs (no global token — all access uses user PAT or anonymous) ──
GITHUB_GRAPHQL_URL = "https://api.github.com/graphql"
GITHUB_REST_URL = "https://api.github.com"

DATABASE_URL = os.getenv("DATABASE_URL", "")

SYNC_BATCH_SIZE = int(os.getenv("SYNC_BATCH_SIZE", "300"))   
SYNC_RATE_LIMIT_BUFFER = int(os.getenv("SYNC_RATE_LIMIT_BUFFER", "50")) 
STALE_PR_DAYS = 30
STALE_ISSUE_DAYS = 30
STALE_BRANCH_DAYS = 90

# ML Models
ML_MODELS_DIR = "ml/trained_models"
ML_CONTAMINATION = 0.1
ML_KMEANS_CLUSTERS = 3

API_HOST = "127.0.0.1"
API_PORT = 8000
API_RELOAD = False
API_WORKERS = 1

# ── JWT Authentication ──
JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
    JWT_SECRET = "prism-secure-jwt-secret-key-change-in-prod-123456"
    warnings.warn(
        "JWT_SECRET not set in .env — using insecure default. "
        "Set JWT_SECRET in production!",
        stacklevel=2,
    )

CORS_ORIGINS = [
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in range(3000, 3020)
]
