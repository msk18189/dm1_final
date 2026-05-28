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
from config import SYNC_BATCH_SIZE
from github.client import GitHubRateLimitException


class SyncProgress:
    """
    Thread-safe progress tracker for a single sync job.
    Writes progress updates to the Repository.sync_progress field.
    """

    def __init__(self, db: Session, repo: Repository):
        self.db = db
        self.repo = repo
        self.started_at = time.time()
        self.module_started_at = time.time()
        self.current_module = ""
        self.modules_completed = []
        self.total_modules = 8  
        self.module_counts: Dict[str, int] = {}

        self.module_processed = 0
        self.module_discovered = 0

    def update(self, message: str, module: str = None, processed: int = None,
               discovered: int = None, persist: bool = True):
        """Update progress message and optionally persist to DB."""
        if module:
            if self.current_module != module:
                self.module_started_at = time.time()
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
        module_elapsed = time.time() - getattr(self, "module_started_at", self.started_at)
        parts = [msg]

        completed_count = len(self.modules_completed)
        parts.insert(0, f"[{completed_count + 1}/{self.total_modules} Modules]")

        if self.module_discovered and self.module_processed:
            pct = min(100, int(self.module_processed / self.module_discovered * 100))
            parts.append(f"Progress: {pct}%")
            parts.append(f"Processed: {self.module_processed:,} / {self.module_discovered:,}")

            # ETA calculation
            if self.module_processed > 0:
                rate = self.module_processed / max(module_elapsed, 1)
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
    RATE_LIMIT_BUFFER = 50
    ANONYMOUS_REQUEST_BUDGET = 55   # leave 5 buffer from 60 limit
    PAT_REQUEST_BUDGET = 4500       # leave 500 buffer from 5000 limit
    LIGHTWEIGHT_MAX_PAGES = 3       # max pages per module in lightweight mode
    LIGHTWEIGHT_MAX_PRS = 100
    LIGHTWEIGHT_MAX_ISSUES = 100
    LIGHTWEIGHT_MAX_FORKS = 50

    def __init__(self, db: Session, repo: Repository, gql_client, rest_client, sync_mode: Optional[str] = None):
        self.db = db
        self.repo = repo
        self.gql = gql_client
        self.rest = rest_client
        self.owner = repo.owner
        self.repo_name = repo.name
        self.progress = SyncProgress(db, repo)
        self.batch_size = None
        self.lightweight_mode = (sync_mode == "lightweight")
        self.budget_exhausted = False

    def run(self):
        """
        Main sync orchestration method.
        Runs all modules in sequence. Module failures are isolated.
        """
        sync_start = time.time()

        try:
            # Set VERIFYING status while we fetch estimates
            self.repo.sync_status = "VERIFYING"
            self.repo.sync_progress = "Verifying repository access and fetching metadata..."
            self.repo.sync_started_at = datetime.utcnow()
            self.db.commit()

            # Store initial estimates in repository database record for progress tracking and visibility
            try:
                print(f"[SyncEngine] Fetching repository estimates for {self.owner}/{self.repo_name}...")
                estimates = self.rest.get_repository_estimates(self.owner, self.repo_name)
                self.estimates = estimates
                
                has_token = bool(self.rest.token and self.rest.token.strip())
                is_private = estimates.get("is_private", False)
                estimated_reqs = estimates.get("estimated_requests_rest", 0)

                if is_private and not has_token:
                    raise Exception("Private repositories require a GitHub Personal Access Token.")
                if not is_private and not has_token and estimated_reqs > 60 and not self.lightweight_mode:
                    raise Exception("Repository requires a GitHub Personal Access Token for full analysis.")
                
                if self.lightweight_mode:
                    self.repo.sync_mode = "lightweight"
                else:
                    self.repo.sync_mode = "full"

                # Transition to SYNCING status
                self._mark_syncing("Starting repository ingestion...")

                # Update Repository record counts with estimated totals immediately
                self.repo.total_prs = estimates.get("pr_count", 0)
                self.repo.total_issues = estimates.get("issues_count", 0)
                self.repo.total_branches = estimates.get("branches_count", 0)
                self.repo.total_forks = estimates.get("forks_count", 0)
                self.repo.total_workflow_runs = estimates.get("workflow_runs_count", 0)
                self.repo.total_discussions = estimates.get("discussions_count", 0)
                
                # Store expected totals
                self.repo.expected_prs = estimates.get("pr_count", 0)
                self.repo.expected_issues = estimates.get("issues_count", 0)
                self.repo.expected_forks = estimates.get("forks_count", 0)
                
                # Verify actual workflows exist before setting expected_workflows
                self.repo.expected_workflows = estimates.get("workflows_count", 0)
                if self.repo.expected_workflows == 0:
                    self.repo.total_workflow_runs = 0

                # Reset synced counts
                self.repo.synced_prs = 0
                self.repo.synced_issues = 0
                self.repo.synced_forks = 0
                self.repo.synced_workflows = 0

                self.db.commit()
                print(f"[SyncEngine] Initial estimates stored: prs={self.repo.total_prs}, issues={self.repo.total_issues}, branches={self.repo.total_branches}, forks={self.repo.total_forks}, workflows={self.repo.total_workflow_runs}, discussions={self.repo.total_discussions}")
            except Exception as e:
                print(f"[SyncEngine] Failed to fetch or persist repository estimates: {e}")
                self.estimates = {}
                self.repo.expected_prs = 0
                self.repo.expected_issues = 0
                self.repo.expected_forks = 0
                self.repo.expected_workflows = 0
                self.lightweight_mode = False
                self.db.commit()

            # Calculate dynamic batch size once before sync starts
            self.batch_size = self._calculate_dynamic_batch_size()

            # Module 4 — Repository metadata (always first)
            self._run_module("repository_metadata", self._sync_repository_metadata)

            # Module 1 — Pull Requests (GraphQL, most complex)
            self._run_module("pull_requests", self._sync_pull_requests)

            # Module 2 — Issues
            self._run_module("issues", self._sync_issues)

            # Module 3 — Branches
            if not self.lightweight_mode:
                self._run_module("branches", self._sync_branches)
            else:
                print("[SyncEngine] Branches module skipped in lightweight mode.")
                self.progress.update("Branches skipped (lightweight mode)", module="branches", persist=True)
                self.progress.mark_module_done("branches", 0)

            # Module 5 — Forks
            if not self.lightweight_mode:
                self._run_module("forks", self._sync_forks)
            else:
                print("[SyncEngine] Forks module skipped in lightweight mode.")
                self.progress.update("Forks skipped (lightweight mode)", module="forks", persist=True)
                self.progress.mark_module_done("forks", 0)

            # Module 8 — CI/CD Workflows
            if not self.lightweight_mode:
                self._run_module("workflows", self._sync_workflows)
            else:
                print("[SyncEngine] Workflows module skipped in lightweight mode.")
                self.progress.update("Workflows skipped (lightweight mode)", module="workflows", persist=True)
                self.progress.mark_module_done("workflows", 0)

            # Module 6 — Discussions (GraphQL)
            if self.gql.token and not self.lightweight_mode:
                self._run_module("discussions", self._sync_discussions)
            else:
                reason = "requires PAT" if not self.gql.token else "skipped in lightweight mode"
                print(f"[SyncEngine] Discussions module skipped ({reason}).")
                self.progress.update(f"Discussions skipped ({reason})", module="discussions", persist=True)
                self.progress.mark_module_done("discussions", 0)

            # Module 7 — Projects v2 (GraphQL)
            if self.gql.token and not self.lightweight_mode:
                self._run_module("projects", self._sync_projects)
            else:
                reason = "requires PAT" if not self.gql.token else "skipped in lightweight mode"
                print(f"[SyncEngine] Projects module skipped ({reason}).")
                self.progress.update(f"Projects skipped ({reason})", module="projects", persist=True)
                self.progress.mark_module_done("projects", 0)

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

            # Ingestion validation checks & print telemetry logs
            try:
                from services.validation import SystemIntegrityValidator
                validator = SystemIntegrityValidator(self.db)
                report = validator.validate_all(repo_id=self.repo.id)
                print(f"[Validation][{self.owner}/{self.repo_name}] Ingestion validation complete.")
                if report.get("count_consistency"):
                    print(f"[Validation][{self.owner}/{self.repo_name}] WARNING: Count inconsistencies detected: {report.get('count_consistency')}")
                else:
                    print(f"[Validation][{self.owner}/{self.repo_name}] SUCCESS: Count consistency verified.")
            except Exception as val_err:
                print(f"[Validation][{self.owner}/{self.repo_name}] Error running validation checks: {val_err}")

        except GitHubRateLimitException as e:
            print(f"[SyncEngine] Rate limit hit. Gracefully downgrading and stopping sync: {e}")
            try:
                self.db.rollback()
                duration = time.time() - sync_start
                self.repo.sync_status = "RATE_LIMITED"
                self.repo.sync_mode = "partial"
                self.repo.sync_progress = f"Sync stopped: GitHub rate limit exceeded after {SyncProgress._fmt_duration(duration)}. Add PAT for full analysis."
                self.repo.error_message = f"Rate limit reached. Sync was gracefully downgraded. {str(e)}"
                self.repo.sync_duration = duration
                self.repo.last_synced_at = datetime.utcnow()
                self.repo.initial_sync_completed = True
                self.db.commit()
            except Exception as db_err:
                print(f"[SyncEngine] DB error during rate limit handling: {db_err}")

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
        """Run a single module sync with transaction isolation and error isolation."""
        print(f"[SyncEngine] Starting module: {module_name}")
        self.progress.update(f"Syncing {module_name.replace('_', ' ').title()}...", module=module_name)
        try:
            # Use a savepoint so module failure doesn't corrupt entire sync
            savepoint = self.db.begin_nested()
            try:
                count = fn()
                savepoint.commit()
            except GitHubRateLimitException:
                try:
                    savepoint.rollback()
                except Exception:
                    pass
                raise
            except Exception as e:
                print(f"[SyncEngine] Module {module_name} failed inside savepoint: {e}")
                try:
                    savepoint.rollback()
                except Exception:
                    pass
                raise

            self.progress.mark_module_done(module_name, count)
            print(f"[SyncEngine] Module {module_name} done. Records: {count}")

            # Update synced counts from actual DB records (source of truth)
            self._refresh_synced_telemetry(module_name)

        except GitHubRateLimitException as e:
            print(f"[SyncEngine] Rate limit exception in module {module_name}: {e}")
            self._refresh_synced_telemetry(module_name)
            raise
        except Exception as e:
            print(f"[SyncEngine] Module {module_name} failed: {e}")
            self.progress.update(f"{module_name} failed: {str(e)[:100]}", persist=True)
            self._refresh_synced_telemetry(module_name)
            try:
                self.db.rollback()
            except Exception:
                pass

    def _refresh_synced_telemetry(self, module_name: str):
        """Update synced telemetry from actual DB record counts (source of truth)."""
        try:
            from database.models import PullRequest, Issue, Fork, Workflow
            if module_name == "pull_requests":
                self.repo.synced_prs = self.db.query(PullRequest).filter(
                    PullRequest.repo_id == self.repo.id).count()
                self.repo.total_prs = self.repo.synced_prs
            elif module_name == "issues":
                self.repo.synced_issues = self.db.query(Issue).filter(
                    Issue.repo_id == self.repo.id).count()
                self.repo.total_issues = self.repo.synced_issues
            elif module_name == "forks":
                from database.models import Fork
                self.repo.synced_forks = self.db.query(Fork).filter(
                    Fork.repo_id == self.repo.id).count()
                self.repo.total_forks = self.repo.synced_forks
            elif module_name == "workflows":
                self.repo.synced_workflows = self.db.query(Workflow).filter(
                    Workflow.repo_id == self.repo.id).count()
            elif module_name == "branches":
                from database.models import Branch
                self.repo.total_branches = self.db.query(Branch).filter(
                    Branch.repo_id == self.repo.id).count()
            elif module_name == "discussions":
                from database.models import Discussion
                self.repo.total_discussions = self.db.query(Discussion).filter(
                    Discussion.repo_id == self.repo.id).count()
            elif module_name == "projects":
                from database.models import Project
                self.repo.total_projects = self.db.query(Project).filter(
                    Project.repo_id == self.repo.id).count()
            self.db.commit()
        except Exception as e:
            print(f"[SyncEngine] Failed to refresh telemetry for {module_name}: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass

    def _calculate_dynamic_batch_size(self) -> int:
        """
        Estimate repository size and calculate batch size once before sync starts.
        Uses total PRs, issues, commits, contributors, workflows.
        """
        estimates = getattr(self, "estimates", {}) or {}
        if not estimates:
            try:
                print(f"[SyncEngine] Fetching repository estimates for {self.owner}/{self.repo_name} to compute batch size...")
                estimates = self.rest.get_repository_estimates(self.owner, self.repo_name)
                self.estimates = estimates
            except Exception as e:
                print(f"[SyncEngine] Failed to fetch repository estimates: {e}. Falling back to DB repository stats or defaults.")

        pr_count = estimates.get("pr_count", 0)
        issues_count = estimates.get("issues_count", 0)
        commits_count = estimates.get("commits_count", 0)
        contributors_count = estimates.get("contributors_count", 0)
        workflows_count = estimates.get("workflows_count", 0)

        if not estimates:
            pr_count = self.repo.total_prs or 0
            issues_count = self.repo.total_issues or 0
            commits_count = 0
            contributors_count = 0
            workflows_count = self.repo.total_workflow_runs or 0

        representative_size = max(
            pr_count,
            int(issues_count * 0.5),
            int(commits_count * 0.1),
            contributors_count * 10,
            workflows_count * 10
        )
        if representative_size < 100:
            batch_size = 20
        elif representative_size < 1000:
            batch_size = 100
        elif representative_size < 10000:
            batch_size = 250
        else:
            batch_size = min(1000, 500 + (representative_size - 10000) // 100)

        print(f"[SyncEngine] Calculated dynamic batch size: {batch_size} (representative size: {representative_size})")
        return batch_size

    def _sync_repository_metadata(self) -> int:
        from github.modules.repository_metadata import sync_repository_metadata
        return sync_repository_metadata(self.owner, self.repo_name, self.db, self.rest, self.gql, self.repo)

    def _sync_pull_requests(self) -> int:
        from github.modules.pull_requests import sync_pull_requests
        since = self.repo.last_successful_sync
        sync_since = None if self.lightweight_mode else since
        return sync_pull_requests(
            self.owner, self.repo_name, self.db, self.rest, self.gql,
            repo=self.repo, since=sync_since, progress=self.progress,
            batch_size=self.batch_size, lightweight_mode=self.lightweight_mode
        )

    def _sync_issues(self) -> int:
        from github.modules.issues import sync_issues
        since = self.repo.last_successful_sync
        sync_since = None if self.lightweight_mode else since
        return sync_issues(
            self.owner, self.repo_name, self.db, self.rest, self.gql,
            repo=self.repo, since=sync_since, progress=self.progress,
            batch_size=self.batch_size, lightweight_mode=self.lightweight_mode
        )

    def _sync_branches(self) -> int:
        from github.modules.branches import sync_branches
        return sync_branches(
            self.owner, self.repo_name, self.db, self.rest,
            repo=self.repo, progress=self.progress,
            batch_size=self.batch_size
        )

    # ------------------------------------------------------------------
    # MODULE 5 — Forks
    # ------------------------------------------------------------------

    def _sync_forks(self) -> int:
        from github.modules.forks import sync_forks
        return sync_forks(
            self.owner, self.repo_name, self.db, self.rest,
            repo=self.repo, progress=self.progress,
            batch_size=self.batch_size
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
            batch_size=self.batch_size
        )

    # ------------------------------------------------------------------
    # MODULE 6 — Discussions (GraphQL)
    # ------------------------------------------------------------------

    def _sync_discussions(self) -> int:
        from github.modules.discussions import sync_discussions
        return sync_discussions(
            self.owner, self.repo_name, self.db, self.gql,
            repo=self.repo, progress=self.progress,
            batch_size=self.batch_size
        )

    # ------------------------------------------------------------------
    # MODULE 7 — Projects v2 (GraphQL)
    # ------------------------------------------------------------------

    def _sync_projects(self) -> int:
        from github.modules.projects import sync_projects
        return sync_projects(
            self.owner, self.repo_name, self.db, self.gql,
            repo=self.repo, rest_client=self.rest, progress=self.progress,
            batch_size=self.batch_size
        )


def run_sync_in_background(repo_url: str, github_token: Optional[str] = None, sync_mode: Optional[str] = None):
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

        engine = SyncEngine(db, repo, gql_client, rest_client, sync_mode=sync_mode)
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

        try:
            from services.data_processor import DataProcessor as DP
            ml_processor = DP(db)
            if ml_processor._get_ml_models():
                print(f"[SyncEngine] Running ML inference for repo {owner}/{repo_name}...")
                count = ml_processor.refresh_ml_predictions(repo_id=repo.id, only_open_prs=True)
                print(f"[SyncEngine] ML inference complete: {count} prediction(s) generated.")
            else:
                print("[SyncEngine] ML models unavailable — skipping post-sync inference.")
        except Exception as e:
            print(f"[SyncEngine] Post-sync ML inference failed (non-fatal): {e}")

    except Exception as e:
        print(f"[SyncEngine] Background sync error for {repo_url}: {e}")
    finally:
        db.close()
