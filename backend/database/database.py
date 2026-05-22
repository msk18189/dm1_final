"""
database.py
Creates the SQLAlchemy engine, SessionLocal and Base declarative class
configured for a MySQL database using PyMySQL. This module centralizes
the DB connection so other modules can import `SessionLocal` and `Base`.

Defaults follow the requested configuration (localhost, port 3306,
user root, empty password, database github_analytics). These values
can be overridden with environment variables.
"""
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker, declarative_base
import os
from dotenv import load_dotenv
from urllib.parse import quote_plus

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

    encoded_password = quote_plus(DB_PASSWORD)
    if DB_PASSWORD:
        SQLALCHEMY_DATABASE_URL = (
            f"mysql+pymysql://{DB_USER}:{encoded_password}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
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
    pool_size=10,
    max_overflow=20,
    pool_recycle=3600,
    echo=False,
    connect_args=connect_args,
)

# Each request should use its own Session instance from this factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for ORM models
Base = declarative_base()


def _add_column_if_missing(conn, table: str, col: str, col_def: str):
    """Helper to add a column to an existing table if it does not already exist."""
    try:
        conn.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {col_def}"))
        try:
            conn.commit()
        except Exception:
            pass
        print(f"[Schema] Added column '{col}' to '{table}'.")
    except Exception as inner:
        # Duplicate column errors are expected when running migrations repeatedly
        msg = str(inner).lower()
        if "duplicate column" in msg or "already exists" in msg:
            pass  # Column already present — no action needed
        else:
            print(f"[Schema Warning] Failed to add column '{col}' to '{table}': {inner}")


def _run_migrations(engine_obj):
    """
    Self-healing migration runner.
    Adds any missing columns to existing tables after CREATE TABLE runs.
    New columns are added without destroying existing data.
    """
    try:
        inspector = inspect(engine_obj)
        existing_tables = set(inspector.get_table_names())

        with engine_obj.connect() as conn:

            # ----------------------------------------------------------------
            # repositories — extended fields
            # ----------------------------------------------------------------
            if "repositories" in existing_tables:
                existing_cols = {c["name"] for c in inspector.get_columns("repositories")}
                new_cols = {
                    "description": "TEXT",
                    "homepage": "VARCHAR(1024)",
                    "language": "VARCHAR(100)",
                    "default_branch": "VARCHAR(255)",
                    "repo_size": "INTEGER DEFAULT 0",
                    "watchers": "INTEGER DEFAULT 0",
                    "forks_count": "INTEGER DEFAULT 0",
                    "visibility": "VARCHAR(50) DEFAULT 'public'",
                    "sync_error": "TEXT",
                    "sync_duration": "FLOAT",
                    "initial_sync_completed": "TINYINT(1) DEFAULT 0",
                    "last_synced_at": "DATETIME",
                    "last_successful_sync": "DATETIME",
                    "last_synced": "DATETIME",
                    "sync_status": "VARCHAR(50) DEFAULT 'IDLE'",
                    "sync_progress": "VARCHAR(512)",
                    "total_prs": "INTEGER DEFAULT 0",
                    "total_issues": "INTEGER DEFAULT 0",
                    "total_branches": "INTEGER DEFAULT 0",
                    "total_forks": "INTEGER DEFAULT 0",
                    "total_workflow_runs": "INTEGER DEFAULT 0",
                    "total_discussions": "INTEGER DEFAULT 0",
                    "total_projects": "INTEGER DEFAULT 0",
                    "error_message": "TEXT",
                    "rate_limit_remaining": "INTEGER",
                    "rate_limit_limit": "INTEGER",
                    "rate_limit_reset": "DATETIME",
                }
                for col, defn in new_cols.items():
                    if col not in existing_cols:
                        _add_column_if_missing(conn, "repositories", col, defn)

            # ----------------------------------------------------------------
            # pull_requests — extended fields
            # ----------------------------------------------------------------
            if "pull_requests" in existing_tables:
                existing_cols = {c["name"] for c in inspector.get_columns("pull_requests")}
                new_cols = {
                    "github_node_id": "VARCHAR(255)",
                    "body": "TEXT",
                    "merge_state": "VARCHAR(100)",
                    "draft": "TINYINT(1) DEFAULT 0",
                    "labels": "TEXT",
                    "base_branch": "VARCHAR(255)",
                    "head_branch": "VARCHAR(255)",
                    "updated_at": "DATETIME",
                    "closed_at": "DATETIME",
                }
                for col, defn in new_cols.items():
                    if col not in existing_cols:
                        _add_column_if_missing(conn, "pull_requests", col, defn)

            # ----------------------------------------------------------------
            # contributors — add unique index guard (non-destructive)
            # ----------------------------------------------------------------
            # No new columns needed; unique index is handled by models

    except Exception as e:
        print(f"[Schema Warning] Error during self-healing migrations: {e}")


def init_db():
    """Create all tables in the database. Safe to call on app startup."""
    # Import all models so SQLAlchemy knows about them before create_all
    from database import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _run_migrations(engine)
    print("[DB] All tables verified/created successfully.")


def get_db():
    """Dependency that yields a database session and ensures it is closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
