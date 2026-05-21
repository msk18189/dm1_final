from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router
from database.database import init_db
from config import CORS_ORIGINS, API_HOST, API_PORT, API_RELOAD, API_WORKERS
import os
import sys

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

app = FastAPI(title="GitHub PR Intelligence Dashboard")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database
try:
    init_db()
except Exception as e:
    print(f"Warning: Database initialization issue: {e}")

# Include routes
app.include_router(router)

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root():
    # Simple test route to verify DB connection on startup
    return {"message": "MySQL Connected Successfully"}

if __name__ == "__main__":
    import uvicorn
    print(f"Starting server on {API_HOST}:{API_PORT}")
    uvicorn.run(
        "main:app",
        host=API_HOST,
        port=API_PORT,
        reload=API_RELOAD,
        workers=API_WORKERS,
        loop="asyncio",
        limit_concurrency=100,
        limit_max_requests=1000,
    )
