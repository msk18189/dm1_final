"""
github/sync_engine.py

PRISM Centralized Sync Engine — orchestrates full repository ingestion across all 9 modules.

Features:
- Full recursive pagination (no hardcoded limits)
- Incremental synchronization (only fetches new/updated records)
- ETA/progress tracking with percentage, processed count, discovered total, ETA
- Rate limit awareness with automatic sleep-and-resume
- Module-level error isolation (one module failing doesn't stop others)
- Resumable sync: picks up from last_synced_at per module
- Background-safe: designed to run in daemon threads
- Batch DB commits every SYNC_BATCH_SIZE records
"""
import time
import json
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session

from database.database import SessionLocal
from database.models import Repository


class SyncProgress:
    """
    Thread-safe progress tracker for a single sync job.
    Writes progress updates to the Repository.sync_progress field.
    """

    def __init__(self, db: Session, repo: Repository):
        self.db = db
        self.repo = repo
        self.started_at = time.time()
        self.current_module = ""
        self.modules_completed = []
        self.total_modules = 8  # PRs, Issues, Branches, Forks, Workflows, Discussions, Projects, Metadata
        self.module_counts: Dict[str, int] = {}

        # Per-module progress (for ETA on paginating modules)
        self.module_processed = 0
        self.module_discovered = 0

    def update(self, message: str, module: str = None, processed: int = None,
               discovered: int = None, persist: bool = True):
        """Update progress message and optionally persist to DB."""
        if module:
            self.current_module = module
        if processed is not None:
            self.module_processed = processed
        if discovered is not None:
            self.module_discovered = discovered

        full_msg = self._build_message(message)

        if persist:
            try:
                self.repo.sync_progress = full_msg[:512]
                self.db.commit()
            except Exception:
                try:
                    self.db.rollback()
                except Exception:
                    pass

    def _build_message(self, msg: str) -> str:
        """Build a rich progress string with ETA."""
        elapsed = time.time() - self.started_at
        parts = [msg]

        if self.module_discovered and self.module_processed:
            pct = min(100, int(self.module_processed / self.module_discovered * 100))
            parts.append(f"Progress: {pct}%")
            parts.append(f"Processed: {self.module_processed:,} / {self.module_discovered:,}")

            # ETA calculation
            if self.module_processed > 0:
                rate = self.module_processed / max(elapsed, 1)
                remaining = (self.module_discovered - self.module_processed) / max(rate, 0.001)
                parts.append(f"ETA: {self._fmt_duration(remaining)} remaining")

        return " | ".join(parts)

    @staticmethod
    def _fmt_duration(secs: float) -> str:
        secs = int(secs)
        if secs < 60:
            return f"{secs}s"
        m, s = divmod(secs, 60)
        if m < 60:
            return f"{m}m {s}s"
        h, m = divmod(m, 60)
        return f"{h}h {m}m"

    def mark_module_done(self, module: str, count: int):
        self.modules_completed.append(module)
        self.module_counts[module] = count
        self.module_processed = 0
        self.module_discovered = 0

    def overall_summary(self) -> str:
        parts = [f"{k}: {v:,}" for k, v in self.module_counts.items()]
        return " | ".join(parts) if parts else "Sync completed"


class SyncEngine:
    """
    Orchestrates full repository ingestion across all modules.

    Usage:
        engine = SyncEngine(db, repo, gql_client, rest_client)
        engine.run()
    """

    SYNC_BATCH_SIZE = 500  # DB commit interval
    RATE_LIMIT_BUFFER = 50  # REST: pause when remaining < this

    def __init__(self, db: Session, repo: Repository, gql_client, rest_client):
        self.db = db
        self.repo = repo
        self.gql = gql_client
        self.rest = rest_client
        self.owner = repo.owner
        self.repo_name = repo.name
        self.progress = SyncProgress(db, repo)

    def run(self):
        """
        Main sync orchestration method.
        Runs all modules in sequence. Module failures are isolated.
        """
        sync_start = time.time()

        try:
            self._mark_syncing("Starting full repository ingestion...")

            # Module 4 — Repository metadata (always first)
            self._run_module("repository_metadata", self._sync_repository_metadata)

            # Module 1 — Pull Requests (GraphQL, most complex)
            self._run_module("pull_requests", self._sync_pull_requests)

            # Module 2 — Issues
            self._run_module("issues", self._sync_issues)

            # Module 3 — Branches
            self._run_module("branches", self._sync_branches)

            # Module 5 — Forks
            self._run_module("forks", self._sync_forks)

            # Module 8 — CI/CD Workflows
            self._run_module("workflows", self._sync_workflows)

            # Module 6 — Discussions (GraphQL)
            self._run_module("discussions", self._sync_discussions)

            # Module 7 — Projects v2 (GraphQL)
            self._run_module("projects", self._sync_projects)

            # Finalize
            duration = time.time() - sync_start
            summary = self.progress.overall_summary()

            self.repo.sync_status = "COMPLETED"
            self.repo.sync_progress = f"Sync completed in {SyncProgress._fmt_duration(duration)}. {summary}"
            self.repo.sync_duration = duration
            self.repo.last_synced_at = datetime.utcnow()
            self.repo.last_successful_sync = datetime.utcnow()
            self.repo.initial_sync_completed = True
            self.repo.error_message = None
            self.db.commit()
            print(f"[SyncEngine] Completed {self.owner}/{self.repo_name} in {SyncProgress._fmt_duration(duration)}")

        except Exception as e:
            error_msg = str(e)
            print(f"[SyncEngine] Fatal error: {error_msg}")
            try:
                self.db.rollback()
                self.repo.sync_status = "FAILED"
                self.repo.sync_error = error_msg
                self.repo.error_message = error_msg
                self.repo.sync_progress = f"Sync failed: {error_msg[:200]}"
                self.db.commit()
            except Exception:
                pass
            raise

    def _mark_syncing(self, msg: str):
        self.repo.sync_status = "SYNCING"
        self.repo.sync_progress = msg
        self.db.commit()

    def _run_module(self, module_name: str, fn):
        """Run a single module sync with error isolation."""
        print(f"[SyncEngine] Starting module: {module_name}")
        self.progress.update(f"Syncing {module_name.replace('_', ' ').title()}...", module=module_name)
        try:
            count = fn()
            self.progress.mark_module_done(module_name, count)
            print(f"[SyncEngine] Module {module_name} done. Records: {count}")
        except Exception as e:
            print(f"[SyncEngine] Module {module_name} failed: {e}")
            self.progress.update(f"{module_name} failed: {str(e)[:100]}", persist=True)
            try:
                self.db.rollback()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # MODULE 4 — Repository Metadata
    # ------------------------------------------------------------------

    def _sync_repository_metadata(self) -> int:
        from github.modules.repository_metadata import sync_repository_metadata
        return sync_repository_metadata(self.owner, self.repo_name, self.db, self.rest, self.gql, self.repo)

    # ------------------------------------------------------------------
    # MODULE 1 — Pull Requests (GraphQL paginated)
    # ------------------------------------------------------------------

    def _sync_pull_requests(self) -> int:
        from github.modules.pull_requests import sync_pull_requests
        since = self.repo.last_successful_sync
        return sync_pull_requests(
            self.owner, self.repo_name, self.db, self.rest, self.gql,
            repo=self.repo, since=since, progress=self.progress,
            batch_size=self.SYNC_BATCH_SIZE
        )

    # ------------------------------------------------------------------
    # MODULE 2 — Issues
    # ------------------------------------------------------------------

    def _sync_issues(self) -> int:
        from github.modules.issues import sync_issues
        since = self.repo.last_successful_sync
        return sync_issues(
            self.owner, self.repo_name, self.db, self.rest, self.gql,
            repo=self.repo, since=since, progress=self.progress,
            batch_size=self.SYNC_BATCH_SIZE
        )

    # ------------------------------------------------------------------
    # MODULE 3 — Branches
    # ------------------------------------------------------------------

    def _sync_branches(self) -> int:
        from github.modules.branches import sync_branches
        return sync_branches(
            self.owner, self.repo_name, self.db, self.rest,
            repo=self.repo, progress=self.progress,
            batch_size=self.SYNC_BATCH_SIZE
        )

    # ------------------------------------------------------------------
    # MODULE 5 — Forks
    # ------------------------------------------------------------------

    def _sync_forks(self) -> int:
        from github.modules.forks import sync_forks
        return sync_forks(
            self.owner, self.repo_name, self.db, self.rest,
            repo=self.repo, progress=self.progress,
            batch_size=self.SYNC_BATCH_SIZE
        )

    # ------------------------------------------------------------------
    # MODULE 8 — CI/CD Workflows
    # ------------------------------------------------------------------

    def _sync_workflows(self) -> int:
        from github.modules.workflows import sync_workflows
        since = self.repo.last_successful_sync
        return sync_workflows(
            self.owner, self.repo_name, self.db, self.rest,
            repo=self.repo, since=since, progress=self.progress,
            batch_size=self.SYNC_BATCH_SIZE
        )

    # ------------------------------------------------------------------
    # MODULE 6 — Discussions (GraphQL)
    # ------------------------------------------------------------------

    def _sync_discussions(self) -> int:
        from github.modules.discussions import sync_discussions
        return sync_discussions(
            self.owner, self.repo_name, self.db, self.gql,
            repo=self.repo, progress=self.progress,
            batch_size=self.SYNC_BATCH_SIZE
        )

    # ------------------------------------------------------------------
    # MODULE 7 — Projects v2 (GraphQL)
    # ------------------------------------------------------------------

    def _sync_projects(self) -> int:
        from github.modules.projects import sync_projects
        return sync_projects(
            self.owner, self.repo_name, self.db, self.gql,
            repo=self.repo, rest_client=self.rest, progress=self.progress,
            batch_size=self.SYNC_BATCH_SIZE
        )


def run_sync_in_background(repo_url: str, github_token: Optional[str] = None):
    """
    Entry point for background thread execution.
    Creates its own DB session, runs the full sync engine, cleans up.
    """
    from services.data_processor import parse_github_repo_url
    from github.client import GitHubClient, GitHubRestClient

    db = SessionLocal()
    try:
        owner, repo_name = parse_github_repo_url(repo_url)
        token = (github_token or "").strip() or None

        repo = db.query(Repository).filter(
            Repository.owner == owner,
            Repository.name == repo_name
        ).first()

        if not repo:
            print(f"[SyncEngine] Repository {owner}/{repo_name} not found in DB. Aborting.")
            return

        gql_client = GitHubClient(token=token)
        rest_client = GitHubRestClient(token=token)

        engine = SyncEngine(db, repo, gql_client, rest_client)
        engine.run()

        # After sync: update contributor stats and total analysis
        try:
            from services.data_processor import DataProcessor
            processor = DataProcessor(db)
            processor._update_contributor_stats(repo.id, repo)
            processor._update_total_analysis(repo)
            db.commit()
        except Exception as e:
            print(f"[SyncEngine] Post-sync analytics update failed: {e}")

    except Exception as e:
        print(f"[SyncEngine] Background sync error for {repo_url}: {e}")
    finally:
        db.close()
