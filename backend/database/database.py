from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text, inspect
from sqlalchemy.orm import declarative_base
import os
from dotenv import load_dotenv
from urllib.parse import quote_plus

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:

    DB_USER = os.getenv("DB_USER", "root")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "3306")
    DB_NAME = os.getenv("DB_NAME", "github_analytics")

    try:
        import aiomysql
        import asyncio
        
        # For synchronous database creation at startup, we use aiomysql with asyncio
        async def _create_database():
            conn = await aiomysql.connect(
                host=DB_HOST,
                user=DB_USER,
                password=DB_PASSWORD,
                port=int(DB_PORT)
            )
            async with conn.cursor() as cursor:
                await cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME}")
            await conn.ensure_closed()
            print(f"[DB] Verified/created MySQL database '{DB_NAME}'")

        # Run the async database creation
        try:
            asyncio.run(_create_database())
        except Exception as e:
            print(f"[DB Warning] Could not create database '{DB_NAME}': {e}")

    except ImportError:
        print("[DB Warning] aiomysql not available for database creation check")
    except Exception as e:
        print(f"[DB Warning] Could not create database '{DB_NAME}': {e}")

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

# Async Session Factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


# =========================================================
# Declarative Base
# =========================================================

Base = declarative_base()

# =========================================================
# Async Database Initialization
# =========================================================

async def init_db():
    """Initialize database schema (creates tables and runs migrations)."""
    from database import models  
    
    async with engine.begin() as conn:
        # Create all tables defined in models
        await conn.run_sync(Base.metadata.create_all)
    
    print("[DB] All tables verified/created successfully.")


async def get_db():
    """Async database session dependency for FastAPI routes."""
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()