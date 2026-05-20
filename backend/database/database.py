"""
database.py
Creates the SQLAlchemy engine, SessionLocal and Base declarative class
configured for a MySQL database using PyMySQL. This module centralizes
the DB connection so other modules can import `SessionLocal` and `Base`.

Defaults follow the requested configuration (localhost, port 3306,
user root, empty password, database github_analytics). These values
can be overridden with environment variables.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os
from dotenv import load_dotenv

load_dotenv()

# Read connection settings from environment
DATABASE_URL = os.getenv("DATABASE_URL")

# If DATABASE_URL is not set or empty, determine the default (MySQL)
if not DATABASE_URL:
    DB_USER = os.getenv("DB_USER", "root")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "3306")
    DB_NAME = os.getenv("DB_NAME", "github_analytics")

    # Try to automatically create the database if it doesn't exist
    try:
        import pymysql
        conn = pymysql.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASSWORD,
            port=int(DB_PORT)
        )
        with conn.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME}")
        conn.close()
        print(f"Verified/created MySQL database '{DB_NAME}'")
    except Exception as e:
        print(f"Warning: Could not check/create database '{DB_NAME}': {e}")

    if DB_PASSWORD:
        SQLALCHEMY_DATABASE_URL = (
            f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
        )
    else:
        SQLALCHEMY_DATABASE_URL = (
            f"mysql+pymysql://{DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
        )
else:
    SQLALCHEMY_DATABASE_URL = DATABASE_URL

# Configure connection args (needed for SQLite multi-threading if DATABASE_URL is explicitly set to SQLite)
connect_args = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,
    echo=True,
    connect_args=connect_args,
)

# Each request should use its own Session instance from this factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for ORM models
Base = declarative_base()


def init_db():
    """Create all tables in the database. Safe to call on app startup.

    This will issue CREATE TABLE statements for all models that inherit
    from `Base`. If the database does not exist, SQLAlchemy will try to create it.
    """
    Base.metadata.create_all(bind=engine)


def get_db():
    """Dependency that yields a database session and ensures it is closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
