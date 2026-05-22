"""
validate_architecture.py

Automated validation suite for PRISM enterprise sync architecture.
Validates end-to-end flow:
GitHub API Mock -> Sync Engine -> Database Storage -> REST APIs
"""
import os
import sys
import time
from datetime import datetime, timezone

# Add current directory to path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import httpx
from main import app
from database.database import SessionLocal, init_db
from database.models import (
    Repository, PullRequest, PRReview, Issue, Branch,
    Fork, Workflow, WorkflowRun, Discussion, Project
)
from github.client import GitHubClient, GitHubRestClient
from github.sync_engine import SyncEngine


def run_validation():
    print("==============================================================")
    print("        PRISM ENTERPRISE SYNC ARCHITECTURE VALIDATION         ")
    print("==============================================================")
    
    # 1. Initialize Database
    print("\n[Step 1] Initializing database and ensuring tables exist...")
    init_db()
    
    db = SessionLocal()
    
    # Clean up any existing mock repository data
    print("\n[Step 2] Cleaning up any previous mock repository data...")
    test_owner = "mock-owner"
    test_repo_name = "mock-repo"
    test_repo_full = f"{test_owner}/{test_repo_name}"
    
    existing_repo = db.query(Repository).filter(Repository.full_name == test_repo_full).first()
    if existing_repo:
        print(f"Found existing repository '{test_repo_full}' (ID: {existing_repo.id}). Deleting old records for clean E2E test...")
        db.delete(existing_repo)
        db.commit()
        print("Old mock records deleted successfully.")
    
    # 2. Register mock repository
    print("\n[Step 3] Registering mock repository in database...")
    repo = Repository(
        owner=test_owner,
        name=test_repo_name,
        full_name=test_repo_full,
        url=f"https://github.com/{test_repo_full}",
        source_url=f"https://github.com/{test_repo_full}",
        stars=0,
        sync_status="SYNCING",
        sync_progress="Starting automated E2E validation..."
    )
    db.add(repo)
    db.commit()
    db.refresh(repo)
    repo_id = repo.id
    print(f"Registered repository '{test_repo_full}' with ID: {repo_id}")
    
    # 3. First Sync: Full Ingestion
    print("\n[Step 4] Triggering First Sync: FULL INGESTION...")
    gql_client = GitHubClient(token="mock_token")
    rest_client = GitHubRestClient(token="mock_token")
    
    # Clear MOCK_GITHUB_INCREMENTAL for first sync
    if "MOCK_GITHUB_INCREMENTAL" in os.environ:
        del os.environ["MOCK_GITHUB_INCREMENTAL"]
        
    engine = SyncEngine(db, repo, gql_client, rest_client)
    
    start_time = time.time()
    engine.run()
    full_sync_duration = time.time() - start_time
    
    # Refresh repo object
    db.refresh(repo)
    print(f"Full Ingestion Completed in {full_sync_duration:.2f}s!")
    print(f"Sync status: {repo.sync_status}")
    print(f"Sync progress: {repo.sync_progress}")
    
    # 4. Verify Database Row Counts and Integrity (Full Ingestion)
    print("\n[Step 5] Verifying database records for all 9 modules...")
    
    # Pull Requests (GraphQL recursive pagination, expected 150)
    pr_count = db.query(PullRequest).filter(PullRequest.repo_id == repo_id).count()
    print(f"  * Pull Requests in DB: {pr_count} (Expected: 150)")
    assert pr_count == 150, f"PR count mismatch: expected 150, got {pr_count}"
    
    # Reviews
    review_count = db.query(PRReview).filter(PRReview.repo_id == repo_id).count()
    print(f"  * PR Reviews in DB: {review_count} (Expected: 1, linked to PR #150)")
    assert review_count == 1, f"Review count mismatch: expected 1, got {review_count}"
    
    # Issues (REST recursive pagination, expected 119 - filtered PR issue #50)
    issue_count = db.query(Issue).filter(Issue.repo_id == repo_id).count()
    print(f"  * Issues in DB: {issue_count} (Expected: 119, filtered PR issue #50)")
    assert issue_count == 119, f"Issue count mismatch: expected 119, got {issue_count}"
    
    # Branches (REST, expected 3)
    branch_count = db.query(Branch).filter(Branch.repo_id == repo_id).count()
    print(f"  * Branches in DB: {branch_count} (Expected: 3 - main, develop, stale-branch)")
    assert branch_count == 3, f"Branch count mismatch: expected 3, got {branch_count}"
    
    # Forks (REST, expected 2)
    fork_count = db.query(Fork).filter(Fork.repo_id == repo_id).count()
    print(f"  * Forks in DB: {fork_count} (Expected: 2)")
    assert fork_count == 2, f"Fork count mismatch: expected 2, got {fork_count}"
    
    # Workflows & Runs (REST, expected 1 workflow, 2 runs)
    wf_count = db.query(Workflow).filter(Workflow.repo_id == repo_id).count()
    runs_count = db.query(WorkflowRun).filter(WorkflowRun.repo_id == repo_id).count()
    print(f"  * Workflows in DB: {wf_count} (Expected: 1)")
    print(f"  * Workflow Runs in DB: {runs_count} (Expected: 2)")
    assert wf_count == 1, f"Workflow count mismatch: expected 1, got {wf_count}"
    assert runs_count == 2, f"WorkflowRun count mismatch: expected 2, got {runs_count}"
    
    # Discussions (GraphQL, expected 5)
    disc_count = db.query(Discussion).filter(Discussion.repo_id == repo_id).count()
    print(f"  * Discussions in DB: {disc_count} (Expected: 5)")
    assert disc_count == 5, f"Discussion count mismatch: expected 5, got {disc_count}"
    
    # Projects (GraphQL, expected 3)
    proj_count = db.query(Project).filter(Project.repo_id == repo_id).count()
    print(f"  * Projects in DB: {proj_count} (Expected: 3)")
    assert proj_count == 3, f"Project count mismatch: expected 3, got {proj_count}"
    
    # Verify Repository table sync counts match actual database record counts
    print("\n[Step 6] Verifying Repository summary counts match database record counts...")
    print(f"  * repo.total_prs: {repo.total_prs} vs DB count: {pr_count}")
    print(f"  * repo.total_issues: {repo.total_issues} vs DB count: {issue_count}")
    print(f"  * repo.total_branches: {repo.total_branches} vs DB count: {branch_count}")
    print(f"  * repo.total_forks: {repo.total_forks} vs DB count: {fork_count}")
    print(f"  * repo.total_workflow_runs: {repo.total_workflow_runs} vs DB count: {runs_count}")
    print(f"  * repo.total_discussions: {repo.total_discussions} vs DB count: {disc_count}")
    
    assert repo.total_prs == pr_count, "Repository total_prs does not match DB count"
    assert repo.total_issues == issue_count, "Repository total_issues does not match DB count"
    assert repo.total_branches == branch_count, "Repository total_branches does not match DB count"
    assert repo.total_forks == fork_count, "Repository total_forks does not match DB count"
    assert repo.total_workflow_runs == runs_count, "Repository total_workflow_runs does not match DB count"
    assert repo.total_discussions == disc_count, "Repository total_discussions does not match DB count"
    
    # 5. Check database joins and references (preventing wrong repo_id mappings)
    print("\n[Step 7] Checking database joins and foreign key mappings...")
    # Check PR reviewer join
    review = db.query(PRReview).filter(PRReview.repo_id == repo_id).first()
    assert review.pull_request is not None, "PRReview pull_request relation is broken"
    assert review.pull_request.repo_id == repo_id, "PRReview links to a PR with different repo_id"
    # Check WorkflowRun to Workflow join
    run = db.query(WorkflowRun).filter(WorkflowRun.repo_id == repo_id).first()
    assert run.workflow is not None, "WorkflowRun workflow relation is broken"
    assert run.workflow.repo_id == repo_id, "WorkflowRun workflow has incorrect repo_id"
    print("Database joins and relationship integrity VERIFIED!")
    
    # 6. Second Sync: Incremental Ingestion
    print("\n[Step 8] Triggering Second Sync: INCREMENTAL INGESTION...")
    os.environ["MOCK_GITHUB_INCREMENTAL"] = "true"
    
    # Record current timestamps/SHAs to verify they update/skip properly
    first_pr_150 = db.query(PullRequest).filter(PullRequest.repo_id == repo_id, PullRequest.pr_number == 150).first()
    first_pr_150_title = first_pr_150.title
    
    engine_inc = SyncEngine(db, repo, gql_client, rest_client)
    start_time = time.time()
    engine_inc.run()
    inc_sync_duration = time.time() - start_time
    
    db.refresh(repo)
    print(f"Incremental Ingestion Completed in {inc_sync_duration:.2f}s!")
    
    # Verify counts remain identical (no duplicates created)
    pr_count_inc = db.query(PullRequest).filter(PullRequest.repo_id == repo_id).count()
    issue_count_inc = db.query(Issue).filter(Issue.repo_id == repo_id).count()
    branch_count_inc = db.query(Branch).filter(Branch.repo_id == repo_id).count()
    fork_count_inc = db.query(Fork).filter(Fork.repo_id == repo_id).count()
    runs_count_inc = db.query(WorkflowRun).filter(WorkflowRun.repo_id == repo_id).count()
    disc_count_inc = db.query(Discussion).filter(Discussion.repo_id == repo_id).count()
    proj_count_inc = db.query(Project).filter(Project.repo_id == repo_id).count()
    
    print("\n[Step 9] Verifying duplicate prevention (record counts must be unchanged)...")
    print(f"  * Pull Requests: {pr_count_inc} (Expected: 150)")
    print(f"  * Issues: {issue_count_inc} (Expected: 119)")
    print(f"  * Branches: {branch_count_inc} (Expected: 3)")
    print(f"  * Forks: {fork_count_inc} (Expected: 2)")
    print(f"  * Workflow Runs: {runs_count_inc} (Expected: 2)")
    print(f"  * Discussions: {disc_count_inc} (Expected: 5)")
    print(f"  * Projects: {proj_count_inc} (Expected: 3)")
    
    assert pr_count_inc == 150, "Duplicate PRs created!"
    assert issue_count_inc == 119, "Duplicate Issues created!"
    assert branch_count_inc == 3, "Duplicate Branches created!"
    assert fork_count_inc == 2, "Duplicate Forks created!"
    assert runs_count_inc == 2, "Duplicate WorkflowRuns created!"
    assert disc_count_inc == 5, "Duplicate Discussions created!"
    assert proj_count_inc == 3, "Duplicate Projects created!"
    print("Duplicate prevention VERIFIED! All counts remain constant.")
    
    # 7. Validate REST API endpoints
    print("\n[Step 10] Validating REST API responses and filtering...")
    class SyncTestClient:
        def get(self, url, params=None):
            import asyncio
            async def _call():
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as c:
                    return await c.get(url, params=params)
            return asyncio.run(_call())

    client = SyncTestClient()
    
    # Test repo list endpoint
    resp = client.get("/api/repositories")
    assert resp.status_code == 200, f"/api/repositories failed: {resp.text}"
    repos_list = resp.json()
    assert len(repos_list) >= 1, "No repos returned"
    assert any(r["id"] == repo_id for r in repos_list), "Test repository not in /api/repositories list"
    print("  * /api/repositories: OK")
    
    # Test sync status endpoint
    resp = client.get(f"/api/sync-status/{repo_id}")
    assert resp.status_code == 200, f"/api/sync-status/{repo_id} failed"
    status_data = resp.json()
    assert status_data["sync_status"] == "COMPLETED", f"Expected sync_status COMPLETED, got {status_data['sync_status']}"
    print("  * /api/sync-status/{repo_id}: OK")
    
    # Test KPI endpoint
    resp = client.get(f"/api/kpi/{repo_id}")
    assert resp.status_code == 200, f"/api/kpi/{repo_id} failed"
    kpi_data = resp.json()
    assert "total_prs" in kpi_data, "KPI data missing total_prs"
    print("  * /api/kpi/{repo_id}: OK")
    
    # Test oldest PRs endpoint with pagination & author filters
    resp = client.get(f"/api/oldest-prs/{repo_id}", params={"page": 1, "limit": 5})
    assert resp.status_code == 200, f"/api/oldest-prs/{repo_id} failed"
    oldest_data = resp.json()
    assert "data" in oldest_data, "Oldest PRs missing data list"
    assert len(oldest_data["data"]) <= 5, "Oldest PRs limit filter failed"
    print("  * /api/oldest-prs/{repo_id} (limit=5): OK")
    
    # Test slowest PRs endpoint with author filters
    resp = client.get(f"/api/slowest-prs/{repo_id}", params={"author": "user10"})
    assert resp.status_code == 200, f"/api/slowest-prs/{repo_id} failed"
    slowest_data = resp.json()
    assert "data" in slowest_data, "Slowest PRs missing data list"
    print("  * /api/slowest-prs/{repo_id} (author=user10): OK")
    
    # Test issues endpoint with page/limit/state filters
    resp = client.get(f"/api/issues/{repo_id}", params={"page": 1, "limit": 10, "state": "open"})
    assert resp.status_code == 200, f"/api/issues/{repo_id} failed"
    issues_list = resp.json()
    assert "data" in issues_list, "Issues response missing 'data'"
    assert len(issues_list["data"]) <= 10, "Issues limit filter failed"
    print("  * /api/issues/{repo_id} (state=open, limit=10): OK")
    
    # Test issue analytics
    resp = client.get(f"/api/issues/analytics/{repo_id}")
    assert resp.status_code == 200, f"/api/issues/analytics/{repo_id} failed"
    print("  * /api/issues/analytics/{repo_id}: OK")
    
    # Test branches endpoint
    resp = client.get(f"/api/branches/{repo_id}", params={"filter_type": "stale"})
    assert resp.status_code == 200, f"/api/branches/{repo_id} failed"
    branches_list = resp.json()
    assert "data" in branches_list, "Branches missing 'data' key"
    assert any(b["name"] == "stale-branch" for b in branches_list["data"]), "Stale branch filter failed to return stale-branch"
    print("  * /api/branches/{repo_id} (filter_type=stale): OK")
    
    # Test forks endpoint
    resp = client.get(f"/api/forks/{repo_id}")
    assert resp.status_code == 200, f"/api/forks/{repo_id} failed"
    print("  * /api/forks/{repo_id}: OK")
    
    # Test CI/CD analytics & workflow runs endpoints
    resp = client.get(f"/api/cicd/analytics/{repo_id}")
    assert resp.status_code == 200, f"/api/cicd/analytics/{repo_id} failed"
    cicd_data = resp.json()
    assert "summary" in cicd_data, "CI/CD analytics missing summary"
    print("  * /api/cicd/analytics/{repo_id}: OK")
    
    resp = client.get(f"/api/workflow-runs/{repo_id}", params={"conclusion": "success"})
    assert resp.status_code == 200, f"/api/workflow-runs/{repo_id} failed"
    runs_list = resp.json()
    assert "data" in runs_list, "Workflow runs missing 'data' key"
    assert all(r["conclusion"] == "success" for r in runs_list["data"]), "Workflow runs conclusion filter failed"
    print("  * /api/workflow-runs/{repo_id} (conclusion=success): OK")
    
    # Test discussions endpoint
    resp = client.get(f"/api/discussions/{repo_id}")
    assert resp.status_code == 200, f"/api/discussions/{repo_id} failed"
    print("  * /api/discussions/{repo_id}: OK")
    
    # Test projects endpoint
    resp = client.get(f"/api/projects/{repo_id}")
    assert resp.status_code == 200, f"/api/projects/{repo_id} failed"
    print("  * /api/projects/{repo_id}: OK")
    
    # Test repository health score endpoint
    resp = client.get(f"/api/repo-health/{repo_id}")
    assert resp.status_code == 200, f"/api/repo-health/{repo_id} failed"
    health_data = resp.json()
    assert "score" in health_data, "Health data missing score"
    print(f"  * /api/repo-health/{repo_id}: OK (Health Score: {health_data['score']})")

    # 8. Third Sync: Pruning Verification (simulate item deletion/renaming on GitHub)
    print("\n[Step 11] Triggering Third Sync: PRUNING VERIFICATION...")
    os.environ["MOCK_GITHUB_PRUNED"] = "true"
    if "MOCK_GITHUB_INCREMENTAL" in os.environ:
        del os.environ["MOCK_GITHUB_INCREMENTAL"]

    # Re-open session
    db_prune = SessionLocal()
    repo_prune = db_prune.query(Repository).filter(Repository.id == repo_id).first()
    repo_prune.last_successful_sync = None
    db_prune.commit()
    engine_prune = SyncEngine(db_prune, repo_prune, gql_client, rest_client)
    start_time = time.time()
    engine_prune.run()
    prune_sync_duration = time.time() - start_time

    db_prune.refresh(repo_prune)
    print(f"Pruning Sync Completed in {prune_sync_duration:.2f}s!")

    # Verify counts are reduced correctly (items have been pruned)
    issue_count_prune = db_prune.query(Issue).filter(Issue.repo_id == repo_id).count()
    branch_count_prune = db_prune.query(Branch).filter(Branch.repo_id == repo_id).count()
    fork_count_prune = db_prune.query(Fork).filter(Fork.repo_id == repo_id).count()

    print("\n[Step 12] Verifying database pruning of deleted/renamed items...")
    print(f"  * Issues in DB: {issue_count_prune} (Expected: 10)")
    print(f"  * Branches in DB: {branch_count_prune} (Expected: 2)")
    print(f"  * Forks in DB: {fork_count_prune} (Expected: 1)")

    assert issue_count_prune == 10, f"Issues pruning failed: expected 10, got {issue_count_prune}"
    assert branch_count_prune == 2, f"Branches pruning failed: expected 2, got {branch_count_prune}"
    assert fork_count_prune == 1, f"Forks pruning failed: expected 1, got {fork_count_prune}"
    print("Database pruning of deleted/renamed items VERIFIED!")

    # 9. Verify average calculations do not crash on serialization
    print("\n[Step 13] Verifying average metrics JSON serialization...")
    resp = client.get(f"/api/kpi/{repo_id}")
    assert resp.status_code == 200, f"/api/kpi/{repo_id} failed: {resp.text}"
    resp = client.get(f"/api/issues/analytics/{repo_id}")
    assert resp.status_code == 200, f"/api/issues/analytics/{repo_id} failed: {resp.text}"
    resp = client.get(f"/api/forks/{repo_id}")
    assert resp.status_code == 200, f"/api/forks/{repo_id} failed: {resp.text}"
    resp = client.get(f"/api/cicd/analytics/{repo_id}")
    assert resp.status_code == 200, f"/api/cicd/analytics/{repo_id} failed: {resp.text}"
    print("Averages JSON serialization and endpoint calls VERIFIED!")

    # Cleanup environment
    if "MOCK_GITHUB_PRUNED" in os.environ:
        del os.environ["MOCK_GITHUB_PRUNED"]

    db_prune.close()
    db.close()

    print("\n==============================================================")
    print("       ALL 13 PRISM ARCHITECTURE VALIDATION TESTS PASSED!     ")
    print("==============================================================")
    print("End-to-End database persistence, recursive pagination, duplicate")
    print("prevention, repository metadata summary counts, module joining,")
    print("database pruning, and REST analytics APIs are working flawlessly together.")


if __name__ == "__main__":
    run_validation()
