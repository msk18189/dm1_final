"""ORM models for the application.

This file consolidates repository and analysis models and ensures a
single import of `Base` from the canonical `database` module.
"""
from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    Text,
    ForeignKey,
)
from sqlalchemy.orm import relationship

from .database import Base


class Repository(Base):
    __tablename__ = "repositories"

    id = Column(Integer, primary_key=True, index=True)
    owner = Column(String(255), nullable=False, index=True)
    name = Column(String(255), nullable=False, index=True)
    full_name = Column(String(511), unique=True, nullable=False, index=True)
    url = Column(String(1024), unique=True, nullable=True)
    source_url = Column(String(1024), nullable=True)
    stars = Column(Integer, default=0, nullable=False)
    last_synced = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    sync_status = Column(String(50), default="IDLE", nullable=False)
    sync_progress = Column(String(255), nullable=True)
    last_synced_at = Column(DateTime, nullable=True)
    last_successful_sync = Column(DateTime, nullable=True)
    total_prs = Column(Integer, default=0, nullable=False)
    error_message = Column(Text, nullable=True)
    rate_limit_remaining = Column(Integer, nullable=True)
    rate_limit_limit = Column(Integer, nullable=True)
    rate_limit_reset = Column(DateTime, nullable=True)

    analyses = relationship("TotalAnalysis", back_populates="repository")
    pull_requests = relationship("PullRequest", back_populates="repository")


class TotalAnalysis(Base):
    """Aggregated analysis / KPI values for a repository.

    This is intended to store the overall metrics shown on the dashboard
    after a repository analysis completes.
    """
    __tablename__ = "total_analysis"

    id = Column(Integer, primary_key=True)
    repo_id = Column(Integer, ForeignKey("repositories.id"), nullable=False, index=True)
    repo_owner = Column(String(255), nullable=False, index=True)
    repo_name = Column(String(255), nullable=False, index=True)
    total_prs = Column(Integer, default=0)
    open_prs = Column(Integer, default=0)
    merged_prs = Column(Integer, default=0)
    closed_prs = Column(Integer, default=0)
    avg_cycle_time = Column(Float, nullable=True)
    merge_rate = Column(Float, nullable=True)
    avg_review_duration = Column(Float, nullable=True)
    avg_wait_for_review = Column(Float, nullable=True)
    stale_pr_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    repository = relationship("Repository", back_populates="analyses")


class PullRequest(Base):
    __tablename__ = "pull_requests"

    id = Column(Integer, primary_key=True)
    repo_id = Column(Integer, ForeignKey("repositories.id"), nullable=False, index=True)
    repo_owner = Column(String(255), nullable=False, index=True)
    repo_name = Column(String(255), nullable=False, index=True)
    pr_number = Column(Integer)
    title = Column(String(1024))
    state = Column(String(50))
    created_at = Column(DateTime)
    merged_at = Column(DateTime, nullable=True)
    closed_at = Column(DateTime, nullable=True)
    commit_count = Column(Integer, default=0)
    files_changed = Column(Integer, default=0)
    lines_added = Column(Integer, default=0)
    lines_deleted = Column(Integer, default=0)
    review_count = Column(Integer, default=0)
    comment_count = Column(Integer, default=0)
    author = Column(String(255))
    cycle_time_days = Column(Float, nullable=True)
    wait_for_review_hours = Column(Float, nullable=True)
    review_duration_hours = Column(Float, nullable=True)
    updated_at = Column(DateTime, nullable=True, index=True)

    repository = relationship("Repository", back_populates="pull_requests")


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True)
    pr_id = Column(Integer, ForeignKey("pull_requests.id"), nullable=False, index=True)
    repo_owner = Column(String(255), nullable=False, index=True)
    repo_name = Column(String(255), nullable=False, index=True)
    reviewer = Column(String(255))
    state = Column(String(50))
    submitted_at = Column(DateTime)
    comment_count = Column(Integer, default=0)


class Contributor(Base):
    __tablename__ = "contributors"

    id = Column(Integer, primary_key=True)
    repo_id = Column(Integer, ForeignKey("repositories.id"), nullable=False, index=True)
    repo_owner = Column(String(255), nullable=False, index=True)
    repo_name = Column(String(255), nullable=False, index=True)
    username = Column(String(255))
    total_prs = Column(Integer, default=0)
    merged_prs = Column(Integer, default=0)
    avg_cycle_time = Column(Float, default=0)
    avg_review_time = Column(Float, default=0)
    stale_pr_count = Column(Integer, default=0)


class MLPrediction(Base):
    __tablename__ = "ml_predictions"

    id = Column(Integer, primary_key=True)
    pr_id = Column(Integer, ForeignKey("pull_requests.id"), nullable=False, index=True)
    repo_owner = Column(String(255), nullable=False, index=True)
    repo_name = Column(String(255), nullable=False, index=True)
    predicted_delay_days = Column(Float, nullable=True)
    bottleneck_probability = Column(Float, nullable=True)
    risk_score = Column(Float, nullable=True)
    predicted_review_wait = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
