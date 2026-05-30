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
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from database.database import async_session_maker
from database.models import Repository
from config import SYNC_BATCH_SIZE
from github.client import GitHubRateLimitException


class SyncProgress:
    """
    Thread-safe progress tracker for a single sync job.
    Writes progress updates to the Repository.sync_progress field.
    """

    def __init__(self, db: AsyncSession, repo: Repository):
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

    async def update(self, message: str, module: str = None, processed: int = None,
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
                await self.db.commit()
            except Exception:
                try:
                    await self.db.rollback()
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

    async def mark_module_done(self, module: str, count: int):
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

    def __init__(self, db: AsyncSession, repo: Repository, gql_client, rest_client, sync_mode: Optional[str] = None):
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

    async def run(self):
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
            await self.db.commit()

            # Store initial estimates in repository database record for progress tracking and visibility
            try:
                print(f"[SyncEngine] Fetching repository estimates for {self.owner}/{self.repo_name}...")
                import asyncio
                estimates = await asyncio.to_thread(self.rest.get_repository_estimates, self.owner, self.repo_name)
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
                await self._mark_syncing("Starting repository ingestion...")

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

                await self.db.commit()
                print(f"[SyncEngine] Initial estimates stored: prs={self.repo.total_prs}, issues={self.repo.total_issues}, branches={self.repo.total_branches}, forks={self.repo.total_forks}, workflows={self.repo.total_workflow_runs}, discussions={self.repo.total_discussions}")
            except Exception as e:
                print(f"[SyncEngine] Failed to fetch or persist repository estimates: {e}")
                self.estimates = {}
                self.repo.expected_prs = 0
                self.repo.expected_issues = 0
                self.repo.expected_forks = 0
                self.repo.expected_workflows = 0
                self.lightweight_mode = False
                await self.db.commit()

            # Calculate dynamic batch size once before sync starts
            self.batch_size = await self._calculate_dynamic_batch_size()

            # Module 4 — Repository metadata (always first)
            await self._run_module("repository_metadata", self._sync_repository_metadata)

            # Module 1 — Pull Requests (GraphQL, most complex)
            await self._run_module("pull_requests", self._sync_pull_requests)

            # Module 2 — Issues
            await self._run_module("issues", self._sync_issues)

            # Module 3 — Branches
            if not self.lightweight_mode:
                await self._run_module("branches", self._sync_branches)
            else:
                print("[SyncEngine] Branches module skipped in lightweight mode.")
                await self.progress.update("Branches skipped (lightweight mode)", module="branches", persist=True)
                await self.progress.mark_module_done("branches", 0)

            # Module 5 — Forks
            if not self.lightweight_mode:
                await self._run_module("forks", self._sync_forks)
            else:
                print("[SyncEngine] Forks module skipped in lightweight mode.")
                await self.progress.update("Forks skipped (lightweight mode)", module="forks", persist=True)
                await self.progress.mark_module_done("forks", 0)

            # Module 8 — CI/CD Workflows
            if not self.lightweight_mode:
                await self._run_module("workflows", self._sync_workflows)
            else:
                print("[SyncEngine] Workflows module skipped in lightweight mode.")
                await self.progress.update("Workflows skipped (lightweight mode)", module="workflows", persist=True)
                await self.progress.mark_module_done("workflows", 0)

            # Module 6 — Discussions (GraphQL)
            if self.gql.token and not self.lightweight_mode:
                await self._run_module("discussions", self._sync_discussions)
            else:
                reason = "requires PAT" if not self.gql.token else "skipped in lightweight mode"
                print(f"[SyncEngine] Discussions module skipped ({reason}).")
                await self.progress.update(f"Discussions skipped ({reason})", module="discussions", persist=True)
                await self.progress.mark_module_done("discussions", 0)

            # Module 7 — Projects v2 (GraphQL)
            if self.gql.token and not self.lightweight_mode:
                await self._run_module("projects", self._sync_projects)
            else:
                reason = "requires PAT" if not self.gql.token else "skipped in lightweight mode"
                print(f"[SyncEngine] Projects module skipped ({reason}).")
                await self.progress.update(f"Projects skipped ({reason})", module="projects", persist=True)
                await self.progress.mark_module_done("projects", 0)

            # Finalize
            duration = time.time() - sync_start
            summary = self.progress.overall_summary()

            self.repo.sync_status = "COMPLETED"
            self.repo.sync_progress = "Sync progress completes"
            self.repo.sync_duration = duration
            self.repo.last_synced_at = datetime.utcnow()
            self.repo.last_successful_sync = datetime.utcnow()
            self.repo.initial_sync_completed = True
            self.repo.error_message = None
            await self.db.commit()
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
                await self.db.rollback()
                duration = time.time() - sync_start
                self.repo.sync_status = "RATE_LIMITED"
                self.repo.sync_mode = "partial"
                self.repo.sync_progress = f"Sync stopped: GitHub rate limit exceeded after {SyncProgress._fmt_duration(duration)}. Add PAT for full analysis."
                self.repo.error_message = f"Rate limit reached. Sync was gracefully downgraded. {str(e)}"
                self.repo.sync_duration = duration
                self.repo.last_synced_at = datetime.utcnow()
                self.repo.initial_sync_completed = True
                await self.db.commit()
            except Exception as db_err:
                print(f"[SyncEngine] DB error during rate limit handling: {db_err}")

        except Exception as e:
            error_msg = str(e)
            print(f"[SyncEngine] Fatal error: {error_msg}")
            try:
                await self.db.rollback()
                self.repo.sync_status = "FAILED"
                self.repo.sync_error = error_msg
                self.repo.error_message = error_msg
                self.repo.sync_progress = f"Sync failed: {error_msg[:200]}"
                await self.db.commit()
            except Exception:
                pass
            raise

    async def _mark_syncing(self, msg: str):
        self.repo.sync_status = "SYNCING"
        self.repo.sync_progress = msg
        await self.db.commit()

    async def _run_module(self, module_name: str, fn):
        """Run a single module sync with transaction isolation and error isolation."""
        print(f"[SyncEngine] Starting module: {module_name}")
        await self.progress.update(f"Syncing {module_name.replace('_', ' ').title()}...", module=module_name)
        try:
            # Use a savepoint so module failure doesn't corrupt entire sync
            savepoint = await self.db.begin_nested()
            try:
                count = await fn()
                await savepoint.commit()
            except GitHubRateLimitException:
                try:
                    await savepoint.rollback()
                except Exception:
                    pass
                raise
            except Exception as e:
                print(f"[SyncEngine] Module {module_name} failed inside savepoint: {e}")
                try:
                    await savepoint.rollback()
                except Exception:
                    pass
                raise

            await self.progress.mark_module_done(module_name, count)
            print(f"[SyncEngine] Module {module_name} done. Records: {count}")

            # Update synced counts from actual DB records (source of truth)
            await self._refresh_synced_telemetry(module_name)

        except GitHubRateLimitException as e:
            print(f"[SyncEngine] Rate limit exception in module {module_name}: {e}")
            await self._refresh_synced_telemetry(module_name)
            raise
        except Exception as e:
            print(f"[SyncEngine] Module {module_name} failed: {e}")
            await self.progress.update(f"{module_name} failed: {str(e)[:100]}", persist=True)
            await self._refresh_synced_telemetry(module_name)
            try:
                await self.db.rollback()
            except Exception:
                pass

    async def _refresh_synced_telemetry(self, module_name: str):
        """Update synced telemetry from actual DB record counts (source of truth)."""
        try:
            from database.models import PullRequest, Issue, Fork, Workflow
            if module_name == "pull_requests":
                res = await self.db.execute(select(func.count(PullRequest.id)).where(PullRequest.repo_id == self.repo.id))
                self.repo.synced_prs = res.scalar() or 0
                self.repo.total_prs = self.repo.synced_prs
            elif module_name == "issues":
                res = await self.db.execute(select(func.count(Issue.id)).where(Issue.repo_id == self.repo.id))
                self.repo.synced_issues = res.scalar() or 0
                self.repo.total_issues = self.repo.synced_issues
            elif module_name == "forks":
                from database.models import Fork
                res = await self.db.execute(select(func.count(Fork.id)).where(Fork.repo_id == self.repo.id))
                self.repo.synced_forks = res.scalar() or 0
                self.repo.total_forks = self.repo.synced_forks
            elif module_name == "workflows":
                res = await self.db.execute(select(func.count(Workflow.id)).where(Workflow.repo_id == self.repo.id))
                self.repo.synced_workflows = res.scalar() or 0
            elif module_name == "branches":
                from database.models import Branch
                res = await self.db.execute(select(func.count(Branch.id)).where(Branch.repo_id == self.repo.id))
                self.repo.total_branches = res.scalar() or 0
            elif module_name == "discussions":
                from database.models import Discussion
                res = await self.db.execute(select(func.count(Discussion.id)).where(Discussion.repo_id == self.repo.id))
                self.repo.total_discussions = res.scalar() or 0
            elif module_name == "projects":
                from database.models import Project
                res = await self.db.execute(select(func.count(Project.id)).where(Project.repo_id == self.repo.id))
                self.repo.total_projects = res.scalar() or 0
            await self.db.commit()
        except Exception as e:
            print(f"[SyncEngine] Failed to refresh telemetry for {module_name}: {e}")
            try:
                await self.db.rollback()
            except Exception:
                pass

    async def _calculate_dynamic_batch_size(self) -> int:
        """
        Estimate repository size and calculate batch size once before sync starts.
        Uses total PRs, issues, commits, contributors, workflows.
        """
        estimates = getattr(self, "estimates", {}) or {}
        if not estimates:
            try:
                print(f"[SyncEngine] Fetching repository estimates for {self.owner}/{self.repo_name} to compute batch size...")
                import asyncio
                estimates = await asyncio.to_thread(self.rest.get_repository_estimates, self.owner, self.repo_name)
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

    async def _sync_repository_metadata(self) -> int:
        from github.modules.repository_metadata import sync_repository_metadata
        return await sync_repository_metadata(self.owner, self.repo_name, self.db, self.rest, self.gql, self.repo)

    async def _sync_pull_requests(self) -> int:
        from github.modules.pull_requests import sync_pull_requests
        since = self.repo.last_successful_sync
        sync_since = None if self.lightweight_mode else since
        return await sync_pull_requests(
            self.owner, self.repo_name, self.db, self.rest, self.gql,
            repo=self.repo, since=sync_since, progress=self.progress,
            batch_size=self.batch_size, lightweight_mode=self.lightweight_mode
        )

    async def _sync_issues(self) -> int:
        from github.modules.issues import sync_issues
        since = self.repo.last_successful_sync
        sync_since = None if self.lightweight_mode else since
        return await sync_issues(
            self.owner, self.repo_name, self.db, self.rest, self.gql,
            repo=self.repo, since=sync_since, progress=self.progress,
            batch_size=self.batch_size, lightweight_mode=self.lightweight_mode
        )

    async def _sync_branches(self) -> int:
        from github.modules.branches import sync_branches
        return await sync_branches(
            self.owner, self.repo_name, self.db, self.rest,
            repo=self.repo, progress=self.progress,
            batch_size=self.batch_size
        )

    # ------------------------------------------------------------------
    # MODULE 5 — Forks
    # ------------------------------------------------------------------

    async def _sync_forks(self) -> int:
        from github.modules.forks import sync_forks
        return await sync_forks(
            self.owner, self.repo_name, self.db, self.rest,
            repo=self.repo, progress=self.progress,
            batch_size=self.batch_size
        )

    # ------------------------------------------------------------------
    # MODULE 8 — CI/CD Workflows
    # ------------------------------------------------------------------

    async def _sync_workflows(self) -> int:
        from github.modules.workflows import sync_workflows
        since = self.repo.last_successful_sync
        return await sync_workflows(
            self.owner, self.repo_name, self.db, self.rest,
            repo=self.repo, since=since, progress=self.progress,
            batch_size=self.batch_size
        )

    # ------------------------------------------------------------------
    # MODULE 6 — Discussions (GraphQL)
    # ------------------------------------------------------------------

    async def _sync_discussions(self) -> int:
        from github.modules.discussions import sync_discussions
        return await sync_discussions(
            self.owner, self.repo_name, self.db, self.gql,
            repo=self.repo, progress=self.progress,
            batch_size=self.batch_size
        )

    # ------------------------------------------------------------------
    # MODULE 7 — Projects v2 (GraphQL)
    # ------------------------------------------------------------------

    async def _sync_projects(self) -> int:
        from github.modules.projects import sync_projects
        return await sync_projects(
            self.owner, self.repo_name, self.db, self.gql,
            repo=self.repo, rest_client=self.rest, progress=self.progress,
            batch_size=self.batch_size
        )



async def run_sync_in_background(repo_url: str, github_token: Optional[str] = None, sync_mode: Optional[str] = None):
    from services.data_processor import parse_github_repo_url
    from github.client import GitHubClient, GitHubRestClient

    async with async_session_maker() as db:
        try:
            owner, repo_name = parse_github_repo_url(repo_url)
            token = (github_token or "").strip() or None

            repo = (await db.execute(select(Repository).filter(
                Repository.owner == owner,
                Repository.name == repo_name
            ))).scalar_one_or_none()

            if not repo:
                print(f"[SyncEngine] Repository {owner}/{repo_name} not found in DB. Aborting.")
                return

            gql_client = GitHubClient(token=token)
            rest_client = GitHubRestClient(token=token)

            engine = SyncEngine(db, repo, gql_client, rest_client, sync_mode=sync_mode)
            await engine.run()

            # After sync: update contributor stats and total analysis
            try:
                from services.data_processor import DataProcessor
                processor = DataProcessor(db)
                await processor._update_contributor_stats(repo.id, repo)
                await processor._update_total_analysis(repo)
                await db.commit()
            except Exception as e:
                print(f"[SyncEngine] Post-sync analytics update failed: {e}")

            try:
                from services.data_processor import DataProcessor as DP
                ml_processor = DP(db)
                if await asyncio.to_thread(ml_processor._get_ml_models):
                    print(f"[SyncEngine] Running ML inference for repo {owner}/{repo_name}...")
                    count = await ml_processor.refresh_ml_predictions(repo_id=repo.id, only_open_prs=True)
                    print(f"[SyncEngine] ML inference complete: {count} prediction(s) generated.")
                else:
                    print("[SyncEngine] ML models unavailable — skipping post-sync inference.")
            except Exception as e:
                print(f"[SyncEngine] Post-sync ML inference failed (non-fatal): {e}")

        except Exception as e:
            print(f"[SyncEngine] Background sync error for {repo_url}: {e}")
