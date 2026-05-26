"""Celery task for repository synchronization.

Replaces the old threading.Thread approach with a persistent, retryable
background job that:
- Tracks state in the SyncJob table
- Supports retry with exponential backoff
- Survives backend restarts
- Integrates with the existing SyncEngine
"""
from datetime import datetime
from celery import shared_task
from celery.utils.log import get_task_logger

logger = get_task_logger(__name__)


@shared_task(
    bind=True,
    name="tasks.sync_task.run_sync_task",
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
    reject_on_worker_lost=True,
    track_started=True,
)
def run_sync_task(self, repo_url: str, github_token: str = None, user_id: int = None):
    """Run full repository ingestion via SyncEngine.

    This Celery task wraps the same SyncEngine logic previously called by
    threading.Thread in routes.py, but with persistence and retry support.

    Args:
        repo_url: GitHub repository URL
        github_token: Optional user PAT for auth
        user_id: Optional user ID for job tracking
    """
    from database.database import SessionLocal
    from database.models import SyncJob
    from github.sync_engine import run_sync_in_background

    db = SessionLocal()
    sync_job = None

    try:
        # Create SyncJob record
        from services.data_processor import parse_github_repo_url
        from database.models import Repository

        owner, repo_name = parse_github_repo_url(repo_url)
        repo = db.query(Repository).filter(
            Repository.owner == owner,
            Repository.name == repo_name,
        ).first()

        if repo:
            sync_job = SyncJob(
                repo_id=repo.id,
                user_id=user_id,
                celery_task_id=self.request.id,
                status="SYNCING",
                started_at=datetime.utcnow(),
            )
            db.add(sync_job)
            db.commit()

        logger.info(f"[SyncTask] Starting sync for {repo_url} (task_id={self.request.id})")

        # Run the sync (same function as before, uses its own DB session)
        run_sync_in_background(repo_url, github_token)

        # Mark job complete
        if sync_job:
            sync_job.status = "COMPLETED"
            sync_job.completed_at = datetime.utcnow()
            db.commit()

        logger.info(f"[SyncTask] Completed sync for {repo_url}")
        return {"status": "COMPLETED", "repo_url": repo_url}

    except Exception as exc:
        logger.error(f"[SyncTask] Sync failed for {repo_url}: {exc}")

        # Update job status
        if sync_job:
            try:
                sync_job.status = "FAILED"
                sync_job.error_message = str(exc)[:500]
                sync_job.completed_at = datetime.utcnow()
                sync_job.retry_count = self.request.retries
                db.commit()
            except Exception:
                pass

        # Retry with backoff for transient errors
        retryable_errors = (
            "rate limit", "timeout", "connection error",
            "502", "503", "504",
        )
        error_str = str(exc).lower()
        if any(err in error_str for err in retryable_errors):
            if self.request.retries < self.max_retries:
                logger.info(f"[SyncTask] Retrying ({self.request.retries + 1}/{self.max_retries})...")
                raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))

        raise
    finally:
        db.close()
