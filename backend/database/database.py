from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text, inspect
from sqlalchemy.orm import declarative_base
import os
from urllib.parse import quote_plus

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    DB_USER = os.getenv("DB_USER", "root")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "3306")
    DB_NAME = os.getenv("DB_NAME", "github_analytics")

    encoded_password = quote_plus(DB_PASSWORD)

    if DB_PASSWORD:
        SQLALCHEMY_DATABASE_URL = (
            f"mysql+asyncmy://{DB_USER}:{encoded_password}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
        )
    else:
        SQLALCHEMY_DATABASE_URL = (
            f"mysql+asyncmy://{DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
        )
else:
    SQLALCHEMY_DATABASE_URL = DATABASE_URL
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_USER = os.getenv("DB_USER", "root")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_PORT = os.getenv("DB_PORT", "3306")
    DB_NAME = os.getenv("DB_NAME", "github_analytics")

# =========================================================
# Async Engine Configuration
# =========================================================

engine = create_async_engine(
    SQLALCHEMY_DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    pool_recycle=3600,
)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

Base = declarative_base()

async def _create_database_async():
    """
    Create MySQL database if it doesn't exist.
    Called asynchronously during FastAPI startup.
    Must be awaited in an existing event loop.
    """
    try:
        import aiomysql
        
        conn = await aiomysql.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASSWORD or None,
            port=int(DB_PORT),
        )
        
        try:
            async with conn.cursor() as cursor:
                await cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}`")
                await conn.commit()
            print(f"[DB] Verified/created MySQL database '{DB_NAME}'")
        finally:
            conn.close()
            
    except Exception as e:
        print(f"[DB Warning] Could not verify/create database '{DB_NAME}': {e}")


async def init_db():
    """
    Initialize database schema and tables.
    Called during FastAPI startup event.
    
    Flow:
    1. Create database if needed (via _create_database_async)
    2. Create all tables (via SQLAlchemy metadata)
    """
    # Step 1: Create database (async operation)
    await _create_database_async()
    
    # Step 2: Create tables
    from database import models  
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    print("[DB] All tables verified/created successfully.")


async def get_db():
    """Async database session dependency for FastAPI routes."""
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()