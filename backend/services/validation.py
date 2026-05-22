"""
services/validation.py

PRISM Enterprise System — Integrity Verification & Health Diagnostics Service.
Implements runtime validation checks for all 12 modules.
Checks for:
- Orphan records
- Duplicate rows
- Empty synced objects
- Invalid repo mappings
- Incorrect counts (Repository totals vs DB counts)
- Tri-count comparison (GitHub vs Dashboard vs DB)
- Ingestion/sync errors
- REST Endpoint responsiveness
"""
import sys
import asyncio
from datetime import datetime, timezone
from typing import Dict, List, Any
import httpx
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database.models import (
    Repository, PullRequest, PRReview, PRFile, PRCommit,
    Issue, IssueComment, Branch, Fork, Workflow, WorkflowRun,
    WorkflowJob, Discussion, DiscussionComment, Project, ProjectItem,
    Contributor
)

from services.extended_analytics import ExtendedAnalytics
from services.module_analytics import (
    IssueAnalytics, BranchAnalytics, ForkAnalytics,
    CICDAnalytics, DiscussionAnalytics, ProjectAnalytics, RepoHealthAnalytics
)


class SystemIntegrityValidator:
    def __init__(self, db: Session):
        self.db = db

    def validate_all(self, repo_id: int = None) -> Dict[str, Any]:
        """Run all data integrity checks and return a unified report."""
        print("[Validation] Running full system integrity validation suite...")
        
        orphans = self.validate_orphan_records()
        duplicates = self.validate_duplicate_rows()
        empty_objects = self.validate_empty_synced_objects()
        repo_mappings = self.validate_repo_mappings()
        count_consistency = self.validate_counts_consistency(repo_id)
        failed_syncs = self.validate_failed_syncs()
        
        tri_compare = {}
        if repo_id:
            tri_compare = self.compare_tri_counts(repo_id)
        else:
            # Run comparison for first repository if none specified
            first_repo = self.db.query(Repository).first()
            if first_repo:
                tri_compare = self.compare_tri_counts(first_repo.id)

        # Print validation summary to console
        total_orphans = sum(orphans.values())
        total_duplicates = sum(duplicates.values())
        total_empty = sum(empty_objects.values())
        total_invalid_mappings = sum(repo_mappings.values())
        
        print(f"[Validation] Integrity Report Summary:")
        print(f"  * Orphan Records: {total_orphans}")
        print(f"  * Duplicate Rows: {total_duplicates}")
        print(f"  * Empty Objects: {total_empty}")
        print(f"  * Invalid Repo Mappings: {total_invalid_mappings}")
        print(f"  * Failed Sync Repos: {failed_syncs['failed_repos_count']}")

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "healthy" if (total_orphans + total_duplicates + total_empty + total_invalid_mappings + failed_syncs["failed_repos_count"] == 0) else "warnings",
            "orphans": orphans,
            "duplicates": duplicates,
            "empty_objects": empty_objects,
            "repo_mappings": repo_mappings,
            "count_consistency": count_consistency,
            "failed_syncs": failed_syncs,
            "tri_counts_comparison": tri_compare
        }

    def validate_orphan_records(self) -> Dict[str, int]:
        """Detect and count records lacking parents (broken relationship links)."""
        report = {}
        
        # PR Reviews without PullRequests
        report["pr_reviews"] = self.db.query(PRReview).filter(
            ~PRReview.pr_id.in_(self.db.query(PullRequest.id))
        ).count()
        
        # PR Files without PullRequests
        report["pr_files"] = self.db.query(PRFile).filter(
            ~PRFile.pr_id.in_(self.db.query(PullRequest.id))
        ).count()
        
        # PR Commits without PullRequests
        report["pr_commits"] = self.db.query(PRCommit).filter(
            ~PRCommit.pr_id.in_(self.db.query(PullRequest.id))
        ).count()
        
        # Issue Comments without Issues
        report["issue_comments"] = self.db.query(IssueComment).filter(
            ~IssueComment.issue_id.in_(self.db.query(Issue.id))
        ).count()
        
        # Discussion Comments without Discussions
        report["discussion_comments"] = self.db.query(DiscussionComment).filter(
            ~DiscussionComment.discussion_id.in_(self.db.query(Discussion.id))
        ).count()
        
        # Project Items without Projects
        report["project_items"] = self.db.query(ProjectItem).filter(
            ~ProjectItem.project_id.in_(self.db.query(Project.id))
        ).count()
        
        # Workflow Runs without Workflows
        report["workflow_runs"] = self.db.query(WorkflowRun).filter(
            ~WorkflowRun.workflow_id.in_(self.db.query(Workflow.id))
        ).count()
        
        # Workflow Jobs without Workflow Runs
        report["workflow_jobs"] = self.db.query(WorkflowJob).filter(
            ~WorkflowJob.run_id.in_(self.db.query(WorkflowRun.id))
        ).count()
        
        return report

    def validate_duplicate_rows(self) -> Dict[str, int]:
        """Identify duplicate records on unique constraints or logic."""
        report = {}
        
        # 1. Repositories with duplicate full_name
        dup_repos = self.db.query(Repository.full_name).group_by(Repository.full_name).having(func.count(Repository.id) > 1).count()
        report["repositories"] = dup_repos
        
        # 2. Pull Requests with duplicate (repo_id, pr_number)
        dup_prs = self.db.query(PullRequest.repo_id, PullRequest.pr_number).group_by(
            PullRequest.repo_id, PullRequest.pr_number
        ).having(func.count(PullRequest.id) > 1).count()
        report["pull_requests"] = dup_prs
        
        # 3. Issues with duplicate (repo_id, issue_number)
        dup_issues = self.db.query(Issue.repo_id, Issue.issue_number).group_by(
            Issue.repo_id, Issue.issue_number
        ).having(func.count(Issue.id) > 1).count()
        report["issues"] = dup_issues
        
        # 4. Branches with duplicate (repo_id, name)
        dup_branches = self.db.query(Branch.repo_id, Branch.name).group_by(
            Branch.repo_id, Branch.name
        ).having(func.count(Branch.id) > 1).count()
        report["branches"] = dup_branches
        
        # 5. Forks with duplicate (repo_id, github_id)
        dup_forks = self.db.query(Fork.repo_id, Fork.github_id).group_by(
            Fork.repo_id, Fork.github_id
        ).having(func.count(Fork.id) > 1).count()
        report["forks"] = dup_forks
        
        # 6. Discussions with duplicate (repo_id, discussion_number)
        dup_discussions = self.db.query(Discussion.repo_id, Discussion.discussion_number).group_by(
            Discussion.repo_id, Discussion.discussion_number
        ).having(func.count(Discussion.id) > 1).count()
        report["discussions"] = dup_discussions
        
        # 7. Projects with duplicate (repo_id, github_id)
        dup_projects = self.db.query(Project.repo_id, Project.github_id).group_by(
            Project.repo_id, Project.github_id
        ).having(func.count(Project.id) > 1).count()
        report["projects"] = dup_projects
        
        # 8. Workflows with duplicate (repo_id, path)
        dup_workflows = self.db.query(Workflow.repo_id, Workflow.path).group_by(
            Workflow.repo_id, Workflow.path
        ).having(func.count(Workflow.id) > 1).count()
        report["workflows"] = dup_workflows
        
        # 9. Workflow Runs with duplicate (repo_id, github_run_id)
        dup_runs = self.db.query(WorkflowRun.repo_id, WorkflowRun.github_run_id).group_by(
            WorkflowRun.repo_id, WorkflowRun.github_run_id
        ).having(func.count(WorkflowRun.id) > 1).count()
        report["workflow_runs"] = dup_runs
        
        return report

    def validate_empty_synced_objects(self) -> Dict[str, int]:
        """Detect database objects missing critical details (empty or null values)."""
        report = {}
        
        report["repositories_empty_name_or_owner"] = self.db.query(Repository).filter(
            or_(Repository.name == None, Repository.name == "", Repository.owner == None, Repository.owner == "")
        ).count()
        
        report["pull_requests_empty_title"] = self.db.query(PullRequest).filter(
            or_(PullRequest.title == None, PullRequest.title == "")
        ).count()
        
        report["issues_empty_title"] = self.db.query(Issue).filter(
            or_(Issue.title == None, Issue.title == "")
        ).count()
        
        report["branches_empty_name"] = self.db.query(Branch).filter(
            or_(Branch.name == None, Branch.name == "")
        ).count()
        
        report["forks_empty_owner_or_name"] = self.db.query(Fork).filter(
            or_(Fork.owner == None, Fork.owner == "", Fork.name == None, Fork.name == "")
        ).count()
        
        report["workflows_empty_name_or_path"] = self.db.query(Workflow).filter(
            or_(Workflow.name == None, Workflow.name == "", Workflow.path == None, Workflow.path == "")
        ).count()
        
        report["workflow_runs_empty_status"] = self.db.query(WorkflowRun).filter(
            or_(WorkflowRun.status == None, WorkflowRun.status == "")
        ).count()
        
        report["discussions_empty_title"] = self.db.query(Discussion).filter(
            or_(Discussion.title == None, Discussion.title == "")
        ).count()
        
        report["projects_empty_name"] = self.db.query(Project).filter(
            or_(Project.name == None, Project.name == "")
        ).count()
        
        return report

    def validate_repo_mappings(self) -> Dict[str, int]:
        """Ensure records are mapped to existing repos and owners match."""
        report = {}
        valid_repo_ids = self.db.query(Repository.id)
        
        # Mappings pointing to non-existent repositories
        report["orphaned_repo_id_pull_requests"] = self.db.query(PullRequest).filter(~PullRequest.repo_id.in_(valid_repo_ids)).count()
        report["orphaned_repo_id_issues"] = self.db.query(Issue).filter(~Issue.repo_id.in_(valid_repo_ids)).count()
        report["orphaned_repo_id_branches"] = self.db.query(Branch).filter(~Branch.repo_id.in_(valid_repo_ids)).count()
        report["orphaned_repo_id_forks"] = self.db.query(Fork).filter(~Fork.repo_id.in_(valid_repo_ids)).count()
        report["orphaned_repo_id_discussions"] = self.db.query(Discussion).filter(~Discussion.repo_id.in_(valid_repo_ids)).count()
        report["orphaned_repo_id_projects"] = self.db.query(Project).filter(~Project.repo_id.in_(valid_repo_ids)).count()
        report["orphaned_repo_id_workflows"] = self.db.query(Workflow).filter(~Workflow.repo_id.in_(valid_repo_ids)).count()
        report["orphaned_repo_id_contributors"] = self.db.query(Contributor).filter(~Contributor.repo_id.in_(valid_repo_ids)).count()

        # Inconsistent repo_owner or repo_name mapping
        report["inconsistent_owner_or_name_pull_requests"] = self.db.query(PullRequest).join(
            Repository, PullRequest.repo_id == Repository.id
        ).filter(
            or_(PullRequest.repo_owner != Repository.owner, PullRequest.repo_name != Repository.name)
        ).count()
        
        report["inconsistent_owner_or_name_issues"] = self.db.query(Issue).join(
            Repository, Issue.repo_id == Repository.id
        ).filter(
            or_(Issue.repo_owner != Repository.owner, Issue.repo_name != Repository.name)
        ).count()

        report["inconsistent_owner_or_name_branches"] = self.db.query(Branch).join(
            Repository, Branch.repo_id == Repository.id
        ).filter(
            or_(Branch.repo_owner != Repository.owner, Branch.repo_name != Repository.name)
        ).count()

        report["inconsistent_owner_or_name_discussions"] = self.db.query(Discussion).join(
            Repository, Discussion.repo_id == Repository.id
        ).filter(
            or_(Discussion.repo_owner != Repository.owner, Discussion.repo_name != Repository.name)
        ).count()

        return report

    def validate_counts_consistency(self, specific_repo_id: int = None) -> List[Dict[str, Any]]:
        """Verify Repository pre-computed summary totals match actual DB row counts."""
        repos_query = self.db.query(Repository)
        if specific_repo_id:
            repos_query = repos_query.filter(Repository.id == specific_repo_id)
            
        repos = repos_query.all()
        discrepancies = []
        
        for r in repos:
            actual_prs = self.db.query(PullRequest).filter(PullRequest.repo_id == r.id).count()
            actual_issues = self.db.query(Issue).filter(Issue.repo_id == r.id).count()
            actual_branches = self.db.query(Branch).filter(Branch.repo_id == r.id).count()
            actual_forks = self.db.query(Fork).filter(Fork.repo_id == r.id).count()
            actual_workflows = self.db.query(Workflow).filter(Workflow.repo_id == r.id).count()
            actual_runs = self.db.query(WorkflowRun).filter(WorkflowRun.repo_id == r.id).count()
            actual_discussions = self.db.query(Discussion).filter(Discussion.repo_id == r.id).count()
            actual_projects = self.db.query(Project).filter(Project.repo_id == r.id).count()
            
            repo_total_projects = getattr(r, "total_projects", 0) or 0
            
            repo_disc = {}
            if r.total_prs != actual_prs:
                repo_disc["pull_requests"] = {"expected_in_repo": r.total_prs, "actual_db_count": actual_prs}
            if r.total_issues != actual_issues:
                repo_disc["issues"] = {"expected_in_repo": r.total_issues, "actual_db_count": actual_issues}
            if r.total_branches != actual_branches:
                repo_disc["branches"] = {"expected_in_repo": r.total_branches, "actual_db_count": actual_branches}
            if r.total_forks != actual_forks:
                repo_disc["forks"] = {"expected_in_repo": r.total_forks, "actual_db_count": actual_forks}
            if r.total_workflow_runs != actual_runs:
                repo_disc["workflow_runs"] = {"expected_in_repo": r.total_workflow_runs, "actual_db_count": actual_runs}
            if r.total_discussions != actual_discussions:
                repo_disc["discussions"] = {"expected_in_repo": r.total_discussions, "actual_db_count": actual_discussions}
            if repo_total_projects != actual_projects:
                repo_disc["projects"] = {"expected_in_repo": repo_total_projects, "actual_db_count": actual_projects}

            if repo_disc:
                discrepancies.append({
                    "repo_id": r.id,
                    "repo_name": r.full_name,
                    "mismatches": repo_disc
                })
                
        return discrepancies

    def compare_tri_counts(self, repo_id: int) -> Dict[str, Any]:
        """Compare GitHub counts (metadata columns) vs Dashboard counts vs actual DB row counts."""
        repo = self.db.query(Repository).filter(Repository.id == repo_id).first()
        if not repo:
            return {}

        # 1. GitHub Metadata Counts (synced during ingestion features probe)
        gh_counts = {
            "pull_requests": repo.total_prs or 0,
            "issues": repo.total_issues or 0,
            "branches": repo.total_branches or 0,
            "forks": repo.total_forks or 0,
            "workflow_runs": repo.total_workflow_runs or 0,
            "discussions": repo.total_discussions or 0,
            "projects": getattr(repo, "total_projects", 0) or 0
        }

        # 2. Actual Row Counts in DB
        db_counts = {
            "pull_requests": self.db.query(PullRequest).filter(PullRequest.repo_id == repo_id).count(),
            "issues": self.db.query(Issue).filter(Issue.repo_id == repo_id).count(),
            "branches": self.db.query(Branch).filter(Branch.repo_id == repo_id).count(),
            "forks": self.db.query(Fork).filter(Fork.repo_id == repo_id).count(),
            "workflow_runs": self.db.query(WorkflowRun).filter(WorkflowRun.repo_id == repo_id).count(),
            "discussions": self.db.query(Discussion).filter(Discussion.repo_id == repo_id).count(),
            "projects": self.db.query(Project).filter(Project.repo_id == repo_id).count()
        }

        # 3. Dashboard API Returned Counts (via Analytics Services)
        dash_counts = {}
        try:
            kpi = ExtendedAnalytics(self.db).get_kpi_with_duration(repo_id)
            dash_counts["pull_requests"] = kpi.get("total_prs", 0)
        except Exception:
            dash_counts["pull_requests"] = 0

        try:
            iss_summary = IssueAnalytics(self.db).get_summary(repo_id)
            dash_counts["issues"] = iss_summary.get("total_issues", 0)
        except Exception:
            dash_counts["issues"] = 0

        try:
            br_summary = BranchAnalytics(self.db).get_summary(repo_id)
            dash_counts["branches"] = br_summary.get("total_branches", 0)
        except Exception:
            dash_counts["branches"] = 0

        try:
            fork_summary = ForkAnalytics(self.db).get_summary(repo_id)
            dash_counts["forks"] = fork_summary.get("total_forks", 0)
        except Exception:
            dash_counts["forks"] = 0

        try:
            cicd_summary = CICDAnalytics(self.db).get_summary(repo_id)
            dash_counts["workflow_runs"] = cicd_summary.get("total_runs", 0)
        except Exception:
            dash_counts["workflow_runs"] = 0

        try:
            disc_summary = DiscussionAnalytics(self.db).get_summary(repo_id)
            dash_counts["discussions"] = disc_summary.get("total_discussions", 0)
        except Exception:
            dash_counts["discussions"] = 0

        try:
            proj_summary = ProjectAnalytics(self.db).get_summary(repo_id)
            dash_counts["projects"] = proj_summary.get("total_projects", 0)
        except Exception:
            dash_counts["projects"] = 0

        comparison = {}
        for key in gh_counts:
            gh_val = gh_counts[key]
            db_val = db_counts[key]
            dash_val = dash_counts[key]
            consistent = (gh_val == db_val == dash_val)
            comparison[key] = {
                "github_count": gh_val,
                "db_count": db_val,
                "dashboard_count": dash_val,
                "consistent": consistent
            }

        return {
            "repo_id": repo_id,
            "repo_name": repo.full_name,
            "comparison": comparison
        }

    def validate_failed_syncs(self) -> Dict[str, Any]:
        """Check for failed sync states and ingestion error records."""
        failed_repos = self.db.query(Repository).filter(
            or_(Repository.sync_status == "FAILED", Repository.error_message.isnot(None), Repository.sync_error.isnot(None))
        ).all()
        
        details = []
        for r in failed_repos:
            details.append({
                "repo_id": r.id,
                "repo_name": r.full_name,
                "sync_status": r.sync_status,
                "error_message": r.error_message or r.sync_error
            })
            
        return {
            "failed_repos_count": len(failed_repos),
            "failed_repositories": details
        }


async def test_rest_endpoints_async(repo_id: int) -> Dict[str, Any]:
    """Dynamically make calls to core REST APIs locally to check endpoint integrity."""
    from main import app
    
    routes = {
        "repositories": "/api/repositories",
        "sync_status": f"/api/sync-status/{repo_id}",
        "kpi": f"/api/kpi/{repo_id}",
        "issues_analytics": f"/api/issues/analytics/{repo_id}",
        "branches_analytics": f"/api/branches/analytics/{repo_id}",
        "forks_analytics": f"/api/forks/analytics/{repo_id}",
        "cicd_analytics": f"/api/cicd/analytics/{repo_id}",
        "discussions_analytics": f"/api/discussions/analytics/{repo_id}",
        "projects_analytics": f"/api/projects/analytics/{repo_id}",
        "repo_health": f"/api/repo-health/{repo_id}"
    }
    
    results = {}
    
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        for name, path in routes.items():
            try:
                resp = await client.get(path)
                results[name] = {
                    "path": path,
                    "status_code": resp.status_code,
                    "ok": resp.status_code == 200,
                    "error": None if resp.status_code == 200 else resp.text[:200]
                }
            except Exception as e:
                results[name] = {
                    "path": path,
                    "status_code": 500,
                    "ok": False,
                    "error": str(e)
                }
                
    all_ok = all(r["ok"] for r in results.values())
    return {
        "all_endpoints_ok": all_ok,
        "endpoints": results
    }


def test_rest_endpoints(repo_id: int) -> Dict[str, Any]:
    """Synchronous wrapper to run async REST endpoint validation."""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
    if loop.is_running():
        # Fallback if already running in an event loop
        # Create a task and wait or block
        import nest_asyncio
        nest_asyncio.apply()
        return loop.run_until_complete(test_rest_endpoints_async(repo_id))
    else:
        return loop.run_until_complete(test_rest_endpoints_async(repo_id))
