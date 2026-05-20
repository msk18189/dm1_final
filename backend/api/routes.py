from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from database.database import get_db
from services.data_processor import DataProcessor
from services.analytics import AnalyticsService
from services.extended_analytics import ExtendedAnalytics
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import Optional
import io

router = APIRouter()

class RepositoryRequest(BaseModel):
    url: str
    github_token: Optional[str] = None

class CompareRequest(BaseModel):
    url_a: str
    url_b: str
    github_token: Optional[str] = None

@router.post("/api/analyze")
def analyze_repository(request: RepositoryRequest, db: Session = Depends(get_db)):
    """Analyze a GitHub repository"""
    try:
        print(f"Analyzing repository: {request.url}")
        processor = DataProcessor(db)
        token = (request.github_token or "").strip() or None
        result = processor.process_repository(request.url, github_token=token)
        print(f"Analysis result: {result}")
        if result.get("error"):
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        error_msg = str(e)
        print(f"Error analyzing repository: {error_msg}")
        
        # Return helpful error message
        if "MAX_NODE_LIMIT_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=400, 
                detail="Repository is too large. Try a smaller repository like facebook/react"
            )
        elif "Bad credentials" in error_msg:
            raise HTTPException(
                status_code=400, 
                detail="GitHub token is invalid or expired. Generate a new token at https://github.com/settings/tokens"
            )
        elif "NOT_FOUND" in error_msg or "Could not resolve to a Repository" in error_msg:
            raise HTTPException(
                status_code=400, 
                detail="Repository not found or is private. Make sure: 1) Repository is public, 2) URL is correct (https://github.com/owner/repo), 3) Token has 'repo' scope for private repos"
            )
        elif "timed out" in error_msg.lower() or "timeout" in error_msg.lower():
            raise HTTPException(
                status_code=400, 
                detail="GitHub API request timed out. Try again in a moment."
            )
        elif "connection" in error_msg.lower() or "premature" in error_msg.lower():
            raise HTTPException(
                status_code=400, 
                detail="Connection issue with GitHub API. Check your internet connection and try again."
            )
        else:
            raise HTTPException(status_code=400, detail=error_msg)

@router.get("/api/kpi/{repo_id}")
def get_kpi(
    repo_id: int,
    days: Optional[int] = None,
    author: Optional[str] = None,
    state: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Get KPI summary for a repository"""
    ext = ExtendedAnalytics(db)
    return ext.get_kpi_with_duration(repo_id, days, author, state)

@router.get("/api/oldest-prs/{repo_id}")
def get_oldest_prs(
    repo_id: int,
    limit: int = 10,
    days: Optional[int] = None,
    author: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Get oldest open PRs"""
    ext = ExtendedAnalytics(db)
    return ext.get_oldest_open_filtered(repo_id, limit, days=days, author=author)

@router.get("/api/slowest-prs/{repo_id}")
def get_slowest_prs(
    repo_id: int,
    limit: int = 10,
    days: Optional[int] = None,
    author: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Get slowest merged PRs"""
    ext = ExtendedAnalytics(db)
    return ext.get_slowest_merged_filtered(repo_id, limit, days=days, author=author)

@router.get("/api/contributor-activity/{repo_id}")
def get_contributor_activity(
    repo_id: int,
    days: Optional[int] = None,
    author: Optional[str] = None,
    state: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Get contributor activity"""
    ext = ExtendedAnalytics(db)
    return ext.get_contributors_filtered(repo_id, days=days, author=author, state=state)

@router.get("/api/monthly-flow/{repo_id}")
def get_monthly_flow(
    repo_id: int,
    months: int = 6,
    days: Optional[int] = None,
    author: Optional[str] = None,
    state: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Get monthly PR flow"""
    ext = ExtendedAnalytics(db)
    return ext.get_monthly_flow_filtered(repo_id, months, days=days, author=author, state=state)

@router.get("/api/throughput/{repo_id}")
def get_throughput(
    repo_id: int,
    weeks: int = 8,
    days: Optional[int] = None,
    author: Optional[str] = None,
    state: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Get PR throughput"""
    ext = ExtendedAnalytics(db)
    return ext.get_throughput_filtered(repo_id, weeks, days=days, author=author, state=state)

@router.get("/api/authors/{repo_id}")
def get_authors(repo_id: int, db: Session = Depends(get_db)):
    """List PR authors for filter dropdown"""
    ext = ExtendedAnalytics(db)
    return {"authors": ext.get_authors(repo_id)}

@router.get("/api/pr-risk/{repo_id}")
def get_pr_risk(repo_id: int, limit: int = 15, db: Session = Depends(get_db)):
    """ML risk & delay predictions for open PRs"""
    ext = ExtendedAnalytics(db)
    return ext.get_pr_risk_panel(repo_id, limit)

@router.get("/api/stale-alerts/{repo_id}")
def get_stale_alerts(repo_id: int, db: Session = Depends(get_db)):
    """Stale PR alerts with recommendations"""
    ext = ExtendedAnalytics(db)
    return ext.get_stale_recommendations(repo_id)

@router.post("/api/compare")
def compare_repositories(request: CompareRequest, db: Session = Depends(get_db)):
    """Compare two repositories side by side"""
    try:
        processor = DataProcessor(db)
        token = (request.github_token or "").strip() or None
        result_a = processor.process_repository(request.url_a, github_token=token)
        result_b = processor.process_repository(request.url_b, github_token=token)
        if result_a.get("error"):
            raise HTTPException(status_code=400, detail=f"Repo A: {result_a['error']}")
        if result_b.get("error"):
            raise HTTPException(status_code=400, detail=f"Repo B: {result_b['error']}")
        ext = ExtendedAnalytics(db)
        return ext.compare_repos(result_a["repo_id"], result_b["repo_id"])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/api/export/{repo_id}")
def export_report(
    repo_id: int,
    days: Optional[int] = None,
    author: Optional[str] = None,
    state: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Export dashboard data as CSV"""
    try:
        ext = ExtendedAnalytics(db)
        csv_content = ext.build_export_csv(repo_id, days, author, state)
        return StreamingResponse(
            io.StringIO(csv_content),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=pr_report_{repo_id}.csv"},
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/api/export-pdf/{repo_id}")
def export_report_pdf(
    repo_id: int,
    days: Optional[int] = None,
    author: Optional[str] = None,
    state: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Export dashboard data as PDF"""
    try:
        ext = ExtendedAnalytics(db)
        pdf_bytes = ext.build_export_pdf(repo_id, days, author, state)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=pr_report_{repo_id}.pdf"},
        )
    except ValueError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e))

@router.get("/api/features")
def get_all_features():
    """Get all available features and metrics"""
    return {
        "dashboard_name": "GitHub PR Intelligence Dashboard",
        "version": "1.0.0",
        "features": {
            "data_extraction": {
                "description": "Extracts comprehensive GitHub PR data",
                "items": [
                    "Pull Requests (title, state, dates, metrics)",
                    "Reviews (reviewer, state, timestamps)",
                    "Commits (count per PR)",
                    "Contributors (activity, merge rates)",
                    "File changes (additions, deletions)",
                    "Comments and labels"
                ]
            },
            "analytics_metrics": {
                "description": "20+ calculated metrics without ML",
                "kpi_cards": [
                    {
                        "name": "Open PRs",
                        "description": "Count of currently open pull requests",
                        "unit": "count"
                    },
                    {
                        "name": "Stale PRs",
                        "description": "PRs open for 30+ days",
                        "unit": "count"
                    },
                    {
                        "name": "Avg Cycle Time",
                        "description": "Average days from creation to merge",
                        "unit": "days"
                    },
                    {
                        "name": "Merge Rate",
                        "description": "Percentage of merged vs closed PRs",
                        "unit": "%"
                    },
                    {
                        "name": "Avg Review Duration",
                        "description": "Average review process time",
                        "unit": "days"
                    },
                    {
                        "name": "Avg Wait for Review",
                        "description": "Average time until first review",
                        "unit": "days"
                    }
                ],
                "additional_metrics": [
                    "PR Throughput (weekly)",
                    "Monthly PR Flow (created vs merged vs closed)",
                    "Contributor Activity",
                    "Oldest Open PRs",
                    "Slowest Merged PRs",
                    "Median Cycle Time"
                ]
            },
            "charts": {
                "description": "Interactive data visualizations",
                "types": [
                    {
                        "name": "Monthly PR Flow",
                        "type": "Stacked Bar Chart",
                        "shows": "Created vs Merged vs Closed PRs by month"
                    },
                    {
                        "name": "PR Throughput",
                        "type": "Line Chart",
                        "shows": "Weekly PR merge trends"
                    },
                    {
                        "name": "Contributor Activity",
                        "type": "Bar Chart",
                        "shows": "Total and merged PRs per contributor"
                    }
                ]
            },
            "tables": {
                "description": "Detailed data tables",
                "types": [
                    {
                        "name": "Oldest Open PRs",
                        "columns": ["#", "Title", "Age (days)", "Author", "Reviews"]
                    },
                    {
                        "name": "Slowest Merged PRs",
                        "columns": ["#", "Title", "Cycle Time (days)", "Author", "Files Changed"]
                    },
                    {
                        "name": "Contributor Activity",
                        "columns": ["Username", "Total PRs", "Merged", "Avg Cycle Time", "Merge Rate %"]
                    }
                ]
            },
            "ml_models": {
                "description": "5 ML models for predictions",
                "models": [
                    {
                        "name": "Delay Prediction",
                        "algorithm": "Gradient Boosting Regressor",
                        "purpose": "Predict PR merge delay in days",
                        "features": ["files_changed", "commit_count", "review_count", "lines_added", "lines_deleted", "reviewer_count"]
                    },
                    {
                        "name": "Bottleneck Detection",
                        "algorithm": "Isolation Forest",
                        "purpose": "Identify stuck PRs",
                        "features": ["wait_for_review_hours", "review_duration_hours", "comment_count", "commit_count", "age_days"]
                    },
                    {
                        "name": "Risk Scoring",
                        "algorithm": "Logistic Regression",
                        "purpose": "Estimate PR risk level (0-1)",
                        "features": ["change_requests", "review_comments", "files_changed", "lines_changed", "author_merge_rate"]
                    },
                    {
                        "name": "Review Wait Prediction",
                        "algorithm": "Random Forest Regressor",
                        "purpose": "Predict review waiting time in hours",
                        "features": ["reviewer_count", "contributor_activity", "files_changed", "labels", "weekly_activity"]
                    },
                    {
                        "name": "Contributor Segmentation",
                        "algorithm": "K-Means Clustering",
                        "purpose": "Group contributors by activity patterns",
                        "features": ["merged_prs", "avg_cycle_time", "review_activity", "stale_pr_count"]
                    }
                ]
            }
        },
        "api_endpoints": {
            "analysis": {
                "POST /api/analyze": "Analyze a GitHub repository",
                "parameters": {
                    "url": "GitHub repository URL (e.g., https://github.com/owner/repo)",
                    "github_token": "Optional - for private repos or higher rate limits"
                }
            },
            "metrics": {
                "GET /api/kpi/{repo_id}": "Get KPI summary",
                "GET /api/oldest-prs/{repo_id}": "Get oldest open PRs",
                "GET /api/slowest-prs/{repo_id}": "Get slowest merged PRs",
                "GET /api/contributor-activity/{repo_id}": "Get contributor stats",
                "GET /api/monthly-flow/{repo_id}": "Get monthly PR flow",
                "GET /api/throughput/{repo_id}": "Get PR throughput"
            },
            "info": {
                "GET /api/features": "Get all features and metrics",
                "GET /api/health": "Health check",
                "GET /api/system-status": "System status and diagnostics"
            }
        },
        "health_checks": {
            "database": "SQLite connection and schema",
            "github_api": "GitHub GraphQL API connectivity",
            "ml_models": "ML model availability",
            "data_integrity": "PR data consistency"
        },
        "supported_repositories": {
            "public": "All public repositories",
            "private": "Private repositories (requires token with 'repo' scope)",
            "requirements": [
                "Repository must be accessible with provided token",
                "Token must have 'public_repo' scope for public repos",
                "Token must have 'repo' scope for private repos"
            ]
        },
        "limitations": {
            "pr_limit": "50 PRs per analysis (optimized for performance)",
            "rate_limit": "60 requests/hour without token, 5000 with token",
            "response_time": "5-15 seconds per repository",
            "data_retention": "Stored in SQLite database"
        },
        "tech_stack": {
            "backend": "FastAPI, SQLAlchemy, Python",
            "frontend": "Next.js, TypeScript, Tailwind CSS, Recharts",
            "database": "SQLite",
            "ml": "scikit-learn, XGBoost, LightGBM"
        }
    }

@router.get("/api/system-status")
def get_system_status(db: Session = Depends(get_db)):
    """Get system status and diagnostics"""
    from database.models import Repository, PullRequest, Contributor
    
    try:
        # Count data
        repo_count = db.query(Repository).count()
        pr_count = db.query(PullRequest).count()
        contributor_count = db.query(Contributor).count()
        
        # Check database
        db_status = "✅ Connected"
        
        # Check GitHub API
        try:
            from github.client import GitHubClient
            client = GitHubClient()
            github_status = "✅ Available"
        except Exception as e:
            github_status = f"⚠️ Error: {str(e)}"
        
        # Check ML models
        try:
            from ml.models import MLModels
            ml_models = MLModels()
            ml_status = "✅ Available"
        except Exception as e:
            ml_status = f"⚠️ Error: {str(e)}"
        
        return {
            "status": "healthy",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "database": {
                "status": db_status,
                "repositories": repo_count,
                "pull_requests": pr_count,
                "contributors": contributor_count
            },
            "services": {
                "github_api": github_status,
                "ml_models": ml_status,
                "database": db_status
            },
            "health_checks": {
                "database_connection": "✅ Pass" if db_status == "✅ Connected" else "❌ Fail",
                "github_api_access": "✅ Pass" if "✅" in github_status else "❌ Fail",
                "ml_models_loaded": "✅ Pass" if "✅" in ml_status else "⚠️ Warning",
                "data_integrity": "✅ Pass" if pr_count > 0 else "⚠️ No data"
            },
            "recommendations": [
                "Analyze more repositories to build better ML models" if pr_count < 100 else "Good data volume for ML",
                "Check GitHub token if API access fails" if "Error" in github_status else "GitHub API working",
                "Install ML dependencies if models unavailable" if "Error" in ml_status else "ML models ready"
            ]
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
