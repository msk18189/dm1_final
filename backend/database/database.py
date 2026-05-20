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

# Read connection settings from environment with sensible defaults
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")  # empty by default
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "github_analytics")

# Build the SQLAlchemy database URL for PyMySQL. If password is empty,
# we omit the colon to keep the URL valid (e.g. root@host/...)
if DB_PASSWORD:
    SQLALCHEMY_DATABASE_URL = (
        f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    )
else:
    SQLALCHEMY_DATABASE_URL = (
        f"mysql+pymysql://{DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    )

# Create the SQLAlchemy engine. `pool_pre_ping=True` helps with dropped
# connections when using long-running web servers.
# Enable SQL echo temporarily to capture generated SQL for debugging.
# WARNING: echo=True can be verbose; revert to False after debugging.
engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True, echo=True)

# Each request should use its own Session instance from this factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for ORM models
Base = declarative_base()


def init_db():
    """Create all tables in the database. Safe to call on app startup.

    This will issue CREATE TABLE statements for all models that inherit
    from `Base`. If the `github_analytics` database does not exist this
    will raise an error — ensure the DB exists or create it beforehand.
    """
    Base.metadata.create_all(bind=engine)


def get_db():
    """Dependency that yields a database session and ensures it is closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
