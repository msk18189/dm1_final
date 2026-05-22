"""
api/routes.py

PRISM Enterprise GitHub Intelligence Platform — REST API Routes.

All analytics routes read from MySQL (database-first architecture).
GitHub API is only called during sync operations.

Route groups:
  /api/analyze              — trigger sync
  /api/sync-status          — sync progress + ETA
  /api/repositories         — repo list with module counts
  /api/kpi                  — PR KPIs (module 1)
  /api/issues               — issue analytics (module 2)
  /api/branches             — branch analytics (module 3)
  /api/forks                — fork analytics (module 5)
  /api/cicd                 — CI/CD analytics (module 8)
  /api/discussions          — discussion analytics (module 6)
  /api/projects             — project analytics (module 7)
  /api/repo-health          — aggregate health score (module 9)
  /api/pr-*                 — detailed PR analytics (module 1)
  /api/ml-*                 — ML model management
  /api/export               — CSV/PDF export
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from database.database import get_db, SessionLocal
from database.models import Repository, PullRequest, Contributor
from ml.models import MLModels
from services.data_processor import DataProcessor, parse_github_repo_url, normalize_github_url
from services.extended_analytics import ExtendedAnalytics
from services.module_analytics import (
    IssueAnalytics, BranchAnalytics, ForkAnalytics,
    CICDAnalytics, DiscussionAnalytics, ProjectAnalytics, RepoHealthAnalytics
)
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import Optional
import io
import threading


router = APIRouter()


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class RepositoryRequest(BaseModel):
    url: str
    github_token: Optional[str] = None


class CompareRequest(BaseModel):
    url_a: str
    url_b: str
    github_token: Optional[str] = None


# ---------------------------------------------------------------------------
# Background sync (via SyncEngine)
# ---------------------------------------------------------------------------

def run_background_sync(repo_url: str, github_token: Optional[str]):
    """Launch SyncEngine in background thread."""
    try:
        from github.sync_engine import run_sync_in_background
        run_sync_in_background(repo_url, github_token)
    except Exception as e:
        print(f"[Routes] Background sync error for {repo_url}: {e}")


# ---------------------------------------------------------------------------
# REPOSITORY MANAGEMENT
# ---------------------------------------------------------------------------

@router.post("/api/verify-repo")
def verify_repository(request: RepositoryRequest, db: Session = Depends(get_db)):
    """Verify repository accessibility and fetch basic metadata."""
    try:
        url = request.url.strip()
        owner, repo_name = parse_github_repo_url(url)

        user_token = (request.github_token or "").strip() or None
        token_source = "user" if user_token else ("env" if __import__("os").getenv("GITHUB_TOKEN") else "none")

        from github.client import GitHubClient, GitHubRestClient
        client = GitHubClient(token=user_token)
        result = client.verify_repository_access(owner, repo_name)
        features = client.fetch_repository_module_features(owner, repo_name)
        rest = GitHubRestClient(token=user_token)
        scope_info = rest.get_token_scopes()
        canonical_url = normalize_github_url(result["owner"], result["repo"])

        return {
            "ok": True,
            "owner": result["owner"],
            "repo": result["repo"],
            "is_private": result["is_private"],
            "url": canonical_url,
            "stars": result.get("stars", 0),
            "language": result.get("language"),
            "description": result.get("description"),
            "has_token": (user_token is not None or __import__("os").getenv("GITHUB_TOKEN") is not None),
            "token_source": token_source,
            "discussions_enabled": features.get("discussions_enabled", False),
            "discussions_total": features.get("discussions_total", 0),
            "projects_total": features.get("projects_total", 0),
            "token_scopes": scope_info.get("scopes", []),
            "has_project_scope": scope_info.get("has_project_scope", False),
        }
    except Exception as e:
        error_msg = str(e)
        if "Bad credentials" in error_msg:
            raise HTTPException(status_code=400, detail="GitHub token is invalid or expired.")
        elif "NOT_FOUND" in error_msg or "Could not resolve to a Repository" in error_msg:
            raise HTTPException(status_code=400, detail="Repository not found.")
        raise HTTPException(status_code=400, detail=error_msg)


@router.get("/api/repositories")
def get_repositories(db: Session = Depends(get_db)):
    """List all analyzed repositories with module record counts."""
    try:
        repos = db.query(Repository).all()
        res = []
        for r in repos:
            res.append({
                "id": r.id,
                "owner": r.owner,
                "name": r.name,
                "full_name": r.full_name,
                "url": r.url,
                "description": r.description,
                "language": r.language,
                "stars": r.stars,
                "visibility": r.visibility,
                "sync_status": r.sync_status,
                "initial_sync_completed": r.initial_sync_completed,
                "last_synced_at": r.last_synced_at.isoformat() if r.last_synced_at else None,
                "total_prs": r.total_prs,
                "total_issues": r.total_issues,
                "total_branches": r.total_branches,
                "total_forks": r.total_forks,
                "total_workflow_runs": r.total_workflow_runs,
                "total_discussions": r.total_discussions,
                "total_projects": getattr(r, "total_projects", 0) or 0,
            })
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/analyze")
def analyze_repository(request: RepositoryRequest, db: Session = Depends(get_db)):
    """Trigger full repository ingestion via SyncEngine (background)."""
    try:
        url = request.url.strip()
        owner, repo_name = parse_github_repo_url(url)
        canonical_url = normalize_github_url(owner, repo_name)
        token = (request.github_token or "").strip() or None

        # Create or reset repo record
        repo = db.query(Repository).filter(
            Repository.owner == owner,
            Repository.name == repo_name
        ).first()

        if not repo:
            full_name = f"{owner}/{repo_name}"
            repo = Repository(
                owner=owner,
                name=repo_name,
                full_name=full_name,
                url=canonical_url,
                source_url=url,
                stars=0,
                sync_status="SYNCING",
                sync_progress="Enqueuing background ingestion job...",
            )
            db.add(repo)
            db.commit()
            db.refresh(repo)
        else:
            repo.sync_status = "SYNCING"
            repo.sync_progress = "Enqueuing background ingestion job..."
            db.commit()
            db.refresh(repo)

        # Launch background sync thread
        threading.Thread(
            target=run_background_sync,
            args=(url, token),
            daemon=True
        ).start()

        return {
            "owner": owner,
            "repo": repo_name,
            "repo_id": repo.id,
            "sync_status": repo.sync_status,
            "sync_progress": repo.sync_progress,
            "message": "Full repository ingestion started in background.",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/sync-status/{repo_id}")
def get_sync_status(repo_id: int, db: Session = Depends(get_db)):
    """Get sync status, progress (with ETA), and per-module record counts."""
    repo = db.query(Repository).filter(Repository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    return {
        "id": repo.id,
        "owner": repo.owner,
        "name": repo.name,
        "full_name": repo.full_name,
        "sync_status": repo.sync_status,
        "sync_progress": repo.sync_progress,
        "sync_duration": repo.sync_duration,
        "initial_sync_completed": repo.initial_sync_completed,
        "last_synced_at": repo.last_synced_at.isoformat() if repo.last_synced_at else None,
        "last_successful_sync": repo.last_successful_sync.isoformat() if repo.last_successful_sync else None,
        "error_message": repo.error_message,
        "total_prs": repo.total_prs,
        "total_issues": repo.total_issues,
        "total_branches": repo.total_branches,
        "total_forks": repo.total_forks,
        "total_workflow_runs": repo.total_workflow_runs,
        "total_discussions": repo.total_discussions,
        "total_projects": getattr(repo, "total_projects", 0) or 0,
        "rate_limit_remaining": repo.rate_limit_remaining,
        "rate_limit_limit": repo.rate_limit_limit,
        "rate_limit_reset": repo.rate_limit_reset.isoformat() if repo.rate_limit_reset else None,
    }


# ---------------------------------------------------------------------------
# MODULE 1 — PULL REQUEST INTELLIGENCE
# ---------------------------------------------------------------------------

@router.get("/api/kpi/{repo_id}")
def get_kpi(
    repo_id: int,
    days: Optional[int] = None,
    author: Optional[str] = None,
    state: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """PR KPI summary."""
    ext = ExtendedAnalytics(db)
    return ext.get_kpi_with_duration(repo_id, days, author, state, start_date, end_date)


@router.get("/api/oldest-prs/{repo_id}")
def get_oldest_prs(
    repo_id: int, page: int = 1, limit: int = 10,
    days: Optional[int] = None, author: Optional[str] = None,
    start_date: Optional[str] = None, end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ext = ExtendedAnalytics(db)
    return ext.get_oldest_open_filtered(repo_id, page=page, limit=limit, days=days, author=author,
                                        start_date=start_date, end_date=end_date)


@router.get("/api/slowest-prs/{repo_id}")
def get_slowest_prs(
    repo_id: int, page: int = 1, limit: int = 10,
    days: Optional[int] = None, author: Optional[str] = None,
    start_date: Optional[str] = None, end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ext = ExtendedAnalytics(db)
    return ext.get_slowest_merged_filtered(repo_id, page=page, limit=limit, days=days, author=author,
                                           start_date=start_date, end_date=end_date)


@router.get("/api/contributor-activity/{repo_id}")
def get_contributor_activity(
    repo_id: int, page: int = 1, limit: int = 10,
    days: Optional[int] = None, author: Optional[str] = None,
    state: Optional[str] = None, start_date: Optional[str] = None, end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ext = ExtendedAnalytics(db)
    return ext.get_contributors_filtered(repo_id, page=page, limit=limit, days=days, author=author,
                                         state=state, start_date=start_date, end_date=end_date)


@router.get("/api/monthly-flow/{repo_id}")
def get_monthly_flow(
    repo_id: int, months: int = 6, days: Optional[int] = None,
    author: Optional[str] = None, state: Optional[str] = None,
    start_date: Optional[str] = None, end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ext = ExtendedAnalytics(db)
    return ext.get_monthly_flow_filtered(repo_id, months, days=days, author=author,
                                         state=state, start_date=start_date, end_date=end_date)


@router.get("/api/throughput/{repo_id}")
def get_throughput(
    repo_id: int, weeks: int = 8, days: Optional[int] = None,
    author: Optional[str] = None, state: Optional[str] = None,
    start_date: Optional[str] = None, end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ext = ExtendedAnalytics(db)
    return ext.get_throughput_filtered(repo_id, weeks, days=days, author=author,
                                       state=state, start_date=start_date, end_date=end_date)


@router.get("/api/authors/{repo_id}")
def get_authors(repo_id: int, db: Session = Depends(get_db)):
    ext = ExtendedAnalytics(db)
    return {"authors": ext.get_authors(repo_id)}


@router.get("/api/pr-risk/{repo_id}")
def get_pr_risk(repo_id: int, page: int = 1, limit: int = 15, db: Session = Depends(get_db)):
    ext = ExtendedAnalytics(db)
    return ext.get_pr_risk_panel(repo_id, page=page, limit=limit)


@router.get("/api/stale-alerts/{repo_id}")
def get_stale_alerts(repo_id: int, page: int = 1, limit: int = 10, db: Session = Depends(get_db)):
    ext = ExtendedAnalytics(db)
    return ext.get_stale_recommendations(repo_id, page=page, limit=limit)


# ---------------------------------------------------------------------------
# MODULE 2 — ISSUE INTELLIGENCE
# ---------------------------------------------------------------------------

@router.get("/api/issues/{repo_id}")
def get_issues(
    repo_id: int, page: int = 1, limit: int = 20,
    state: str = "all", label: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Paginated issue list."""
    return IssueAnalytics(db).get_issues_list(repo_id, state=state, page=page, limit=limit, label=label)


@router.get("/api/issues/analytics/{repo_id}")
def get_issues_analytics(repo_id: int, db: Session = Depends(get_db)):
    """Issue analytics summary."""
    ia = IssueAnalytics(db)
    return {
        "summary": ia.get_summary(repo_id),
        "velocity": ia.get_resolution_velocity(repo_id),
    }


@router.get("/api/issues/stale/{repo_id}")
def get_stale_issues(
    repo_id: int, stale_days: int = 30, page: int = 1, limit: int = 20,
    db: Session = Depends(get_db),
):
    return IssueAnalytics(db).get_stale_issues(repo_id, stale_days=stale_days, page=page, limit=limit)


# ---------------------------------------------------------------------------
# MODULE 3 — BRANCH INTELLIGENCE
# ---------------------------------------------------------------------------

@router.get("/api/branches/{repo_id}")
def get_branches(
    repo_id: int, page: int = 1, limit: int = 20,
    filter_type: str = "all",
    db: Session = Depends(get_db),
):
    """Paginated branch list."""
    return BranchAnalytics(db).get_branches_list(repo_id, page=page, limit=limit, filter_type=filter_type)


@router.get("/api/branches/analytics/{repo_id}")
def get_branches_analytics(repo_id: int, db: Session = Depends(get_db)):
    """Branch analytics summary."""
    return BranchAnalytics(db).get_summary(repo_id)


# ---------------------------------------------------------------------------
# MODULE 5 — FORK ANALYTICS
# ---------------------------------------------------------------------------

@router.get("/api/forks/{repo_id}")
def get_forks(
    repo_id: int, page: int = 1, limit: int = 20,
    filter_type: str = "all",
    db: Session = Depends(get_db),
):
    """Paginated fork list."""
    return ForkAnalytics(db).get_forks_list(repo_id, page=page, limit=limit, filter_type=filter_type)


@router.get("/api/forks/analytics/{repo_id}")
def get_forks_analytics(repo_id: int, db: Session = Depends(get_db)):
    """Fork analytics summary."""
    fa = ForkAnalytics(db)
    return {
        "summary": fa.get_summary(repo_id),
        "growth_trend": fa.get_growth_trend(repo_id),
    }


# ---------------------------------------------------------------------------
# MODULE 8 — CI/CD INTELLIGENCE
# ---------------------------------------------------------------------------

@router.get("/api/cicd/analytics/{repo_id}")
def get_cicd_analytics(repo_id: int, db: Session = Depends(get_db)):
    """CI/CD analytics summary."""
    ca = CICDAnalytics(db)
    return {
        "summary": ca.get_summary(repo_id),
        "workflow_breakdown": ca.get_workflow_breakdown(repo_id),
        "success_trend": ca.get_success_trend(repo_id, days=30),
    }


@router.get("/api/workflow-runs/{repo_id}")
def get_workflow_runs(
    repo_id: int, page: int = 1, limit: int = 20,
    conclusion: Optional[str] = None, branch: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Paginated workflow runs."""
    return CICDAnalytics(db).get_runs_list(repo_id, page=page, limit=limit,
                                           conclusion=conclusion, branch=branch)


# ---------------------------------------------------------------------------
# MODULE 6 — DISCUSSION ANALYTICS
# ---------------------------------------------------------------------------

@router.get("/api/discussions/{repo_id}")
def get_discussions(repo_id: int, page: int = 1, limit: int = 20, db: Session = Depends(get_db)):
    """Paginated discussions list."""
    return DiscussionAnalytics(db).get_discussions_list(repo_id, page=page, limit=limit)


@router.get("/api/discussions/analytics/{repo_id}")
def get_discussions_analytics(repo_id: int, db: Session = Depends(get_db)):
    """Discussion analytics summary."""
    return DiscussionAnalytics(db).get_summary(repo_id)


# ---------------------------------------------------------------------------
# MODULE 7 — PROJECT ANALYTICS
# ---------------------------------------------------------------------------

@router.get("/api/projects/{repo_id}")
def get_projects(repo_id: int, page: int = 1, limit: int = 10, db: Session = Depends(get_db)):
    """Paginated projects list."""
    return ProjectAnalytics(db).get_projects_list(repo_id, page=page, limit=limit)


@router.get("/api/projects/analytics/{repo_id}")
def get_projects_analytics(repo_id: int, db: Session = Depends(get_db)):
    """Project analytics summary."""
    return ProjectAnalytics(db).get_summary(repo_id)


# ---------------------------------------------------------------------------
# MODULE 9 — REPOSITORY HEALTH
# ---------------------------------------------------------------------------

@router.get("/api/repo-health/{repo_id}")
def get_repo_health(repo_id: int, db: Session = Depends(get_db)):
    """Aggregate repository health score across all modules."""
    return RepoHealthAnalytics(db).get_health_score(repo_id)


# ---------------------------------------------------------------------------
# ML MODELS
# ---------------------------------------------------------------------------

@router.get("/api/ml-status")
def get_ml_status(db: Session = Depends(get_db)):
    ml_models = MLModels()
    return {
        "models_exist": ml_models.models_exist(),
        "model_files": [str(p.name) for p in ml_models.models_dir.glob("*.pkl")],
        "models_dir": str(ml_models.models_dir),
    }


@router.post("/api/train-ml")
def train_ml_models(db: Session = Depends(get_db)):
    try:
        ml_models = MLModels()
        result = ml_models.train_from_db(db)
        prediction_refresh_count = 0
        if result.get("trained"):
            processor = DataProcessor(db)
            prediction_refresh_count = processor.refresh_ml_predictions(only_open_prs=False)
        return {
            "trained": result.get("trained", False),
            "summary": result.get("summary", []),
            "models": result.get("models", {}),
            "predictions_refreshed": prediction_refresh_count,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# EXPORT
# ---------------------------------------------------------------------------

@router.get("/api/export/{repo_id}")
def export_report(
    repo_id: int, days: Optional[int] = None, author: Optional[str] = None,
    state: Optional[str] = None, start_date: Optional[str] = None, end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    try:
        ext = ExtendedAnalytics(db)
        csv_content = ext.build_export_csv(repo_id, days, author, state, start_date, end_date)
        return StreamingResponse(
            io.StringIO(csv_content),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=prism_report_{repo_id}.csv"},
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/api/export-pdf/{repo_id}")
def export_report_pdf(
    repo_id: int, days: Optional[int] = None, author: Optional[str] = None,
    state: Optional[str] = None, start_date: Optional[str] = None, end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    try:
        ext = ExtendedAnalytics(db)
        pdf_bytes = ext.build_export_pdf(repo_id, days, author, state, start_date, end_date)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=prism_report_{repo_id}.pdf"},
        )
    except ValueError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e))


# ---------------------------------------------------------------------------
# SYSTEM STATUS
# ---------------------------------------------------------------------------

@router.get("/api/system-status")
def get_system_status(db: Session = Depends(get_db)):
    try:
        repo_count = db.query(Repository).count()
        pr_count = db.query(PullRequest).count()
        contributor_count = db.query(Contributor).count()

        return {
            "status": "healthy",
            "platform": "PRISM — GitHub Engineering Intelligence",
            "version": "2.0.0",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "database": {
                "status": "connected",
                "repositories": repo_count,
                "pull_requests": pr_count,
                "contributors": contributor_count,
            },
            "modules": [
                "pull_requests", "issues", "branches", "repository_metadata",
                "forks", "discussions", "projects", "cicd", "visibility"
            ],
        }
    except Exception as e:
        return {"status": "error", "error": str(e), "timestamp": datetime.now(timezone.utc).isoformat()}


@router.get("/api/compare")
def compare_repositories_get(
    url_a: str, url_b: str, github_token: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Compare two repositories side by side."""
    try:
        processor = DataProcessor(db)
        token = (github_token or "").strip() or None
        result_a = processor.process_repository(url_a, github_token=token)
        result_b = processor.process_repository(url_b, github_token=token)
        ext = ExtendedAnalytics(db)
        return ext.compare_repos(result_a["repo_id"], result_b["repo_id"])
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
