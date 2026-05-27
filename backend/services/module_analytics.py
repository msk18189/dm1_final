"""
services/module_analytics.py

Analytics queries for all 9 PRISM intelligence modules.
All analytics read from MySQL — never from GitHub API directly.
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import json

from sqlalchemy import func, case, and_, desc, asc
from sqlalchemy.orm import Session

from database.models import (
    Repository, PullRequest, PRReview, Issue, Branch, Fork,
    Workflow, WorkflowRun, Discussion, Project, AnalyticsSnapshot
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_utc():
    return datetime.now(timezone.utc)


def _cutoff(days: int) -> datetime:
    return _now_utc() - timedelta(days=days)


# ---------------------------------------------------------------------------
# MODULE 2 — Issue Analytics
# ---------------------------------------------------------------------------

class IssueAnalytics:

    def __init__(self, db: Session):
        self.db = db

    def get_summary(self, repo_id: int) -> Dict[str, Any]:
        base = self.db.query(Issue).filter(Issue.repo_id == repo_id)
        total = base.count()
        open_count = base.filter(Issue.state == "open").count()
        closed_count = base.filter(Issue.state == "closed").count()
        bug_count = base.filter(Issue.is_bug == True).count()

        stale_cutoff = _cutoff(30)
        stale_count = base.filter(
            Issue.state == "open",
            Issue.created_at < stale_cutoff
        ).count()

        avg_resolution = float(self.db.query(
            func.avg(Issue.resolution_hours)
        ).filter(
            Issue.repo_id == repo_id,
            Issue.resolution_hours.isnot(None),
            Issue.resolution_hours > 0
        ).scalar() or 0.0)

        repo = self.db.query(Repository).filter(Repository.id == repo_id).first()

        return {
            "total_issues": total,
            "open_issues": open_count,
            "closed_issues": closed_count,
            "stale_issues": stale_count,
            "bug_count": bug_count,
            "avg_resolution_hours": round(avg_resolution, 1),
            "avg_resolution_days": round(avg_resolution / 24, 1) if avg_resolution else 0,
            "closure_rate": round((closed_count / total * 100) if total else 0, 1),
            "expected_prs": repo.expected_prs if repo else 0,
            "synced_prs": repo.synced_prs if repo else 0,
            "expected_issues": repo.expected_issues if repo else 0,
            "synced_issues": repo.synced_issues if repo else 0,
            "expected_forks": repo.expected_forks if repo else 0,
            "synced_forks": repo.synced_forks if repo else 0,
            "expected_workflows": repo.expected_workflows if repo else 0,
            "synced_workflows": repo.synced_workflows if repo else 0,
        }

    def get_issues_list(self, repo_id: int, state: str = "all", page: int = 1,
                        limit: int = 20, label: str = None) -> Dict[str, Any]:
        query = self.db.query(Issue).filter(Issue.repo_id == repo_id)
        if state != "all":
            query = query.filter(Issue.state == state)
        if label:
            query = query.filter(Issue.labels.contains(label))

        total = query.count()
        issues = query.order_by(desc(Issue.created_at)).offset((page - 1) * limit).limit(limit).all()

        now = _now_utc()
        data = []
        for iss in issues:
            ca = iss.created_at
            if ca and ca.tzinfo is None:
                ca = ca.replace(tzinfo=timezone.utc)
            age_days = (now - ca).days if ca else 0

            try:
                labels = json.loads(iss.labels) if iss.labels else []
            except Exception:
                labels = []

            data.append({
                "number": iss.issue_number,
                "title": iss.title,
                "state": iss.state,
                "state_reason": iss.state_reason,
                "author": iss.author,
                "labels": labels,
                "is_bug": iss.is_bug,
                "age_days": age_days,
                "created_at": iss.created_at.isoformat() if iss.created_at else None,
                "closed_at": iss.closed_at.isoformat() if iss.closed_at else None,
                "comment_count": iss.comment_count,
                "resolution_hours": round(iss.resolution_hours, 1) if iss.resolution_hours else None,
            })

        return {
            "data": data,
            "total": total,
            "page": page,
            "limit": limit,
            "pages": max(1, (total + limit - 1) // limit),
        }

    def get_resolution_velocity(self, repo_id: int, months: int = 6) -> List[Dict[str, Any]]:
        """Monthly issue opened vs closed trend."""
        cutoff = _cutoff(months * 31)
        issues = self.db.query(Issue).filter(
            Issue.repo_id == repo_id,
            Issue.created_at >= cutoff
        ).all()

        from collections import defaultdict
        opened: Dict[str, int] = defaultdict(int)
        closed: Dict[str, int] = defaultdict(int)

        for iss in issues:
            if iss.created_at:
                key = iss.created_at.strftime("%Y-%m")
                opened[key] += 1
            if iss.closed_at:
                key = iss.closed_at.strftime("%Y-%m")
                closed[key] += 1

        keys = sorted(set(list(opened.keys()) + list(closed.keys())))
        return [{"month": k, "opened": opened[k], "closed": closed[k]} for k in keys]

    def get_stale_issues(self, repo_id: int, stale_days: int = 30, page: int = 1, limit: int = 20) -> Dict[str, Any]:
        cutoff = _cutoff(stale_days)
        query = self.db.query(Issue).filter(
            Issue.repo_id == repo_id,
            Issue.state == "open",
            Issue.created_at < cutoff
        ).order_by(asc(Issue.created_at))

        total = query.count()
        issues = query.offset((page - 1) * limit).limit(limit).all()
        now = _now_utc()
        data = []
        for iss in issues:
            ca = iss.created_at.replace(tzinfo=timezone.utc) if iss.created_at and iss.created_at.tzinfo is None else iss.created_at
            age = (now - ca).days if ca else 0
            data.append({
                "number": iss.issue_number,
                "title": iss.title,
                "author": iss.author,
                "age_days": age,
                "comment_count": iss.comment_count,
                "created_at": iss.created_at.isoformat() if iss.created_at else None,
            })

        return {"data": data, "total": total, "page": page, "limit": limit, "pages": max(1, (total + limit - 1) // limit)}

    def get_heatmap(self, repo_id: int) -> List[int]:
        now = _now_utc()
        end_date = now
        while end_date.weekday() != 5:
            end_date += timedelta(days=1)
            
        start_date = end_date - timedelta(days=370)
        
        issues = self.db.query(Issue.created_at).filter(
            Issue.repo_id == repo_id,
            Issue.created_at >= start_date,
            Issue.created_at <= end_date + timedelta(days=1)
        ).all()
        
        from collections import defaultdict
        daily_counts = defaultdict(int)
        for (created_at,) in issues:
            if created_at:
                daily_counts[created_at.strftime("%Y-%m-%d")] += 1
                
        heatmap = []
        for i in range(371):
            d = start_date + timedelta(days=i)
            count = daily_counts[d.strftime("%Y-%m-%d")]
            if count == 0: level = 0
            elif count <= 1: level = 1
            elif count <= 3: level = 2
            elif count <= 5: level = 3
            else: level = 4
            heatmap.append(level)
            
        return heatmap


# ---------------------------------------------------------------------------
# MODULE 3 — Branch Analytics
# ---------------------------------------------------------------------------

class BranchAnalytics:

    def __init__(self, db: Session):
        self.db = db

    def get_summary(self, repo_id: int) -> Dict[str, Any]:
        base = self.db.query(Branch).filter(Branch.repo_id == repo_id)
        total = base.count()
        protected_count = base.filter(Branch.protected == True).count()
        stale_count = base.filter(Branch.staleness_days > 90).count()
        inactive_count = base.filter(Branch.staleness_days > 30).count()
        active_count = base.filter(Branch.staleness_days <= 7).count()

        return {
            "total_branches": total,
            "protected_branches": protected_count,
            "stale_branches": stale_count,        # 90+ days
            "inactive_branches": inactive_count,   # 30+ days
            "active_branches": active_count,       # <= 7 days
            "stale_rate": round((stale_count / total * 100) if total else 0, 1),
        }

    def get_branches_list(self, repo_id: int, page: int = 1, limit: int = 20,
                          filter_type: str = "all") -> Dict[str, Any]:
        query = self.db.query(Branch).filter(Branch.repo_id == repo_id)
        if filter_type == "stale":
            query = query.filter(Branch.staleness_days > 90)
        elif filter_type == "protected":
            query = query.filter(Branch.protected == True)
        elif filter_type == "active":
            query = query.filter(Branch.staleness_days <= 7)

        total = query.count()
        branches = query.order_by(desc(Branch.last_commit_at)).offset((page - 1) * limit).limit(limit).all()

        data = [{
            "name": b.name,
            "protected": b.protected,
            "last_commit_sha": b.last_commit_sha,
            "last_commit_author": b.last_commit_author,
            "last_commit_message": (b.last_commit_message or "")[:100],
            "last_commit_at": b.last_commit_at.isoformat() if b.last_commit_at else None,
            "staleness_days": b.staleness_days,
            "health": _branch_health(b.staleness_days),
        } for b in branches]

        return {"data": data, "total": total, "page": page, "limit": limit, "pages": max(1, (total + limit - 1) // limit)}


def _branch_health(days: Optional[int]) -> str:
    if days is None:
        return "unknown"
    if days <= 7:
        return "active"
    if days <= 30:
        return "moderate"
    if days <= 90:
        return "inactive"
    return "stale"


# ---------------------------------------------------------------------------
# MODULE 5 — Fork Analytics
# ---------------------------------------------------------------------------

class ForkAnalytics:

    def __init__(self, db: Session):
        self.db = db

    def get_summary(self, repo_id: int) -> Dict[str, Any]:
        base = self.db.query(Fork).filter(Fork.repo_id == repo_id)
        total = base.count()
        active_count = base.filter(Fork.staleness_days <= 30).count()
        stale_count = base.filter(Fork.staleness_days > 90).count()
        starred_forks = base.filter(Fork.stars > 0).count()
        avg_stars = float(self.db.query(func.avg(Fork.stars)).filter(Fork.repo_id == repo_id).scalar() or 0.0)

        repo = self.db.query(Repository).filter(Repository.id == repo_id).first()

        return {
            "total_forks": total,
            "active_forks": active_count,
            "stale_forks": stale_count,
            "starred_forks": starred_forks,
            "avg_fork_stars": round(avg_stars, 1),
            "adoption_rate": round((active_count / total * 100) if total else 0, 1),
            "expected_prs": repo.expected_prs if repo else 0,
            "synced_prs": repo.synced_prs if repo else 0,
            "expected_issues": repo.expected_issues if repo else 0,
            "synced_issues": repo.synced_issues if repo else 0,
            "expected_forks": repo.expected_forks if repo else 0,
            "synced_forks": repo.synced_forks if repo else 0,
            "expected_workflows": repo.expected_workflows if repo else 0,
            "synced_workflows": repo.synced_workflows if repo else 0,
        }

    def get_forks_list(self, repo_id: int, page: int = 1, limit: int = 20,
                       filter_type: str = "all") -> Dict[str, Any]:
        query = self.db.query(Fork).filter(Fork.repo_id == repo_id)
        if filter_type == "active":
            query = query.filter(Fork.staleness_days <= 30)
        elif filter_type == "stale":
            query = query.filter(Fork.staleness_days > 90)

        total = query.count()
        forks = query.order_by(desc(Fork.pushed_at)).offset((page - 1) * limit).limit(limit).all()

        data = [{
            "full_name": f.full_name,
            "owner": f.owner,
            "stars": f.stars,
            "forks": f.forks,
            "language": f.language,
            "description": (f.description or "")[:200],
            "pushed_at": f.pushed_at.isoformat() if f.pushed_at else None,
            "staleness_days": f.staleness_days,
            "activity": "active" if (f.staleness_days or 999) <= 30 else "inactive",
        } for f in forks]

        return {"data": data, "total": total, "page": page, "limit": limit, "pages": max(1, (total + limit - 1) // limit)}

    def get_growth_trend(self, repo_id: int, months: int = 6) -> List[Dict[str, Any]]:
        cutoff = _cutoff(months * 31)
        forks = self.db.query(Fork).filter(
            Fork.repo_id == repo_id,
            Fork.created_at >= cutoff
        ).all()

        from collections import defaultdict
        monthly: Dict[str, int] = defaultdict(int)
        for f in forks:
            if f.created_at:
                monthly[f.created_at.strftime("%Y-%m")] += 1

        return [{"month": k, "new_forks": v} for k, v in sorted(monthly.items())]


# ---------------------------------------------------------------------------
# MODULE 8 — CI/CD Analytics
# ---------------------------------------------------------------------------

class CICDAnalytics:

    def __init__(self, db: Session):
        self.db = db

    def get_summary(self, repo_id: int) -> Dict[str, Any]:
        base = self.db.query(WorkflowRun).filter(WorkflowRun.repo_id == repo_id)
        total_runs = base.count()
        successful = base.filter(WorkflowRun.conclusion == "success").count()
        failed = base.filter(WorkflowRun.conclusion == "failure").count()
        cancelled = base.filter(WorkflowRun.conclusion == "cancelled").count()

        avg_duration = float(self.db.query(
            func.avg(WorkflowRun.duration_seconds)
        ).filter(
            WorkflowRun.repo_id == repo_id,
            WorkflowRun.duration_seconds.isnot(None),
            WorkflowRun.conclusion == "success"
        ).scalar() or 0.0)

        success_rate = round((successful / total_runs * 100) if total_runs else 0, 1)

        # Flaky workflow detection: workflows with >20% failure rate
        workflow_stats = self.db.query(
            WorkflowRun.workflow_id,
            func.count(WorkflowRun.id).label("total"),
            func.sum(case((WorkflowRun.conclusion == "failure", 1), else_=0)).label("failures")
        ).filter(WorkflowRun.repo_id == repo_id).group_by(WorkflowRun.workflow_id).all()

        flaky_workflows = sum(
            1 for ws in workflow_stats
            if ws.total > 5 and (ws.failures / ws.total) > 0.2
        )

        repo = self.db.query(Repository).filter(Repository.id == repo_id).first()

        return {
            "total_runs": total_runs,
            "successful_runs": successful,
            "failed_runs": failed,
            "cancelled_runs": cancelled,
            "success_rate": success_rate,
            "avg_duration_seconds": int(avg_duration),
            "avg_duration_minutes": round(avg_duration / 60, 1) if avg_duration else 0,
            "flaky_workflows": flaky_workflows,
            "expected_prs": repo.expected_prs if repo else 0,
            "synced_prs": repo.synced_prs if repo else 0,
            "expected_issues": repo.expected_issues if repo else 0,
            "synced_issues": repo.synced_issues if repo else 0,
            "expected_forks": repo.expected_forks if repo else 0,
            "synced_forks": repo.synced_forks if repo else 0,
            "expected_workflows": repo.expected_workflows if repo else 0,
            "synced_workflows": repo.synced_workflows if repo else 0,
        }

    def get_runs_list(self, repo_id: int, page: int = 1, limit: int = 20,
                      conclusion: str = None, branch: str = None) -> Dict[str, Any]:
        query = self.db.query(WorkflowRun).filter(WorkflowRun.repo_id == repo_id)
        if conclusion:
            query = query.filter(WorkflowRun.conclusion == conclusion)
        if branch:
            query = query.filter(WorkflowRun.head_branch == branch)

        total = query.count()
        runs = query.order_by(desc(WorkflowRun.created_at)).offset((page - 1) * limit).limit(limit).all()

        data = [{
            "id": r.github_run_id,
            "name": r.name,
            "branch": r.head_branch,
            "event": r.event,
            "status": r.status,
            "conclusion": r.conclusion,
            "actor": r.actor,
            "duration_seconds": r.duration_seconds,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in runs]

        return {"data": data, "total": total, "page": page, "limit": limit, "pages": max(1, (total + limit - 1) // limit)}

    def get_success_trend(self, repo_id: int, days: int = 30) -> List[Dict[str, Any]]:
        """Daily success/failure trend for the last N days."""
        cutoff = _cutoff(days)
        runs = self.db.query(WorkflowRun).filter(
            WorkflowRun.repo_id == repo_id,
            WorkflowRun.created_at >= cutoff,
            WorkflowRun.conclusion.isnot(None)
        ).all()

        from collections import defaultdict
        daily: Dict[str, Dict[str, int]] = defaultdict(lambda: {"success": 0, "failure": 0, "other": 0})
        for r in runs:
            if r.created_at:
                key = r.created_at.strftime("%Y-%m-%d")
                if r.conclusion == "success":
                    daily[key]["success"] += 1
                elif r.conclusion == "failure":
                    daily[key]["failure"] += 1
                else:
                    daily[key]["other"] += 1

        return [{"date": k, **v} for k, v in sorted(daily.items())]

    def get_workflow_breakdown(self, repo_id: int) -> List[Dict[str, Any]]:
        """Per-workflow success/failure breakdown."""
        stats = self.db.query(
            Workflow.name,
            func.count(WorkflowRun.id).label("total"),
            func.sum(case((WorkflowRun.conclusion == "success", 1), else_=0)).label("success"),
            func.sum(case((WorkflowRun.conclusion == "failure", 1), else_=0)).label("failure"),
            func.avg(WorkflowRun.duration_seconds).label("avg_duration"),
        ).join(WorkflowRun, WorkflowRun.workflow_id == Workflow.id, isouter=True)\
         .filter(Workflow.repo_id == repo_id)\
         .group_by(Workflow.id, Workflow.name)\
         .all()

        result = []
        for s in stats:
            total = s.total or 0
            success = int(s.success or 0)
            failure = int(s.failure or 0)
            result.append({
                "name": s.name,
                "total_runs": total,
                "success": success,
                "failure": failure,
                "success_rate": round((success / total * 100) if total else 0, 1),
                "avg_duration_minutes": round(float(s.avg_duration or 0) / 60, 1),
                "is_flaky": total > 5 and failure / total > 0.2 if total else False,
            })

        return sorted(result, key=lambda x: x["total_runs"], reverse=True)


# ---------------------------------------------------------------------------
# MODULE 6 — Discussion Analytics
# ---------------------------------------------------------------------------

class DiscussionAnalytics:

    def __init__(self, db: Session):
        self.db = db

    def get_summary(self, repo_id: int) -> Dict[str, Any]:
        base = self.db.query(Discussion).filter(Discussion.repo_id == repo_id)
        total = base.count()
        open_count = base.filter(Discussion.state == "OPEN").count()
        answered_count = base.filter(Discussion.answer_chosen == True).count()
        avg_comments = float(self.db.query(func.avg(Discussion.comment_count)).filter(Discussion.repo_id == repo_id).scalar() or 0.0)
        avg_reactions = float(self.db.query(func.avg(Discussion.reaction_count)).filter(Discussion.repo_id == repo_id).scalar() or 0.0)

        return {
            "total_discussions": total,
            "open_discussions": open_count,
            "answered_discussions": answered_count,
            "answer_rate": round((answered_count / total * 100) if total else 0, 1),
            "avg_comments": round(avg_comments, 1),
            "avg_reactions": round(avg_reactions, 1),
        }

    def get_discussions_list(self, repo_id: int, page: int = 1, limit: int = 20) -> Dict[str, Any]:
        query = self.db.query(Discussion).filter(Discussion.repo_id == repo_id)
        total = query.count()
        items = query.order_by(desc(Discussion.created_at)).offset((page - 1) * limit).limit(limit).all()

        data = [{
            "number": d.discussion_number,
            "title": d.title,
            "category": d.category,
            "author": d.author,
            "state": d.state,
            "answer_chosen": d.answer_chosen,
            "comment_count": d.comment_count,
            "reaction_count": d.reaction_count,
            "participant_count": d.participant_count,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        } for d in items]

        return {"data": data, "total": total, "page": page, "limit": limit, "pages": max(1, (total + limit - 1) // limit)}


# ---------------------------------------------------------------------------
# MODULE 7 — Project Analytics
# ---------------------------------------------------------------------------

class ProjectAnalytics:

    def __init__(self, db: Session):
        self.db = db

    def get_summary(self, repo_id: int) -> Dict[str, Any]:
        base = self.db.query(Project).filter(Project.repo_id == repo_id)
        total = base.count()
        open_count = base.filter(Project.state == "open").count()
        return {
            "total_projects": total,
            "open_projects": open_count,
            "closed_projects": total - open_count,
        }

    def get_projects_list(self, repo_id: int, page: int = 1, limit: int = 10) -> Dict[str, Any]:
        query = self.db.query(Project).filter(Project.repo_id == repo_id)
        total = query.count()
        items = query.order_by(desc(Project.updated_at)).offset((page - 1) * limit).limit(limit).all()

        data = [{
            "number": p.number,
            "name": p.name,
            "state": p.state,
            "creator": p.creator,
            "project_type": p.project_type,
            "items_count": p.items_count,
            "open_items": p.open_items,
            "closed_items": p.closed_items,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        } for p in items]

        return {"data": data, "total": total, "page": page, "limit": limit, "pages": max(1, (total + limit - 1) // limit)}


# ---------------------------------------------------------------------------
# MODULE 9 — Visibility & Repository Health
# ---------------------------------------------------------------------------

class RepoHealthAnalytics:

    def __init__(self, db: Session):
        self.db = db

    def get_health_score(self, repo_id: int) -> Dict[str, Any]:
        """Compute an aggregate repository health score (0-100) across all modules."""
        repo = self.db.query(Repository).filter(Repository.id == repo_id).first()
        if not repo:
            return {"score": 0, "components": {}}

        scores = {}

        # PR health (20 pts)
        total_prs = db_count_filter(self.db, PullRequest, PullRequest.repo_id == repo_id)
        if total_prs > 0:
            open_prs = db_count_filter(self.db, PullRequest, PullRequest.repo_id == repo_id, PullRequest.state == "OPEN")
            stale_cutoff = _cutoff(30)
            stale_prs = db_count_filter(self.db, PullRequest, PullRequest.repo_id == repo_id,
                                         PullRequest.state == "OPEN", PullRequest.created_at < stale_cutoff)
            stale_rate = stale_prs / max(open_prs, 1)
            pr_score = max(0, 20 - int(stale_rate * 20))
        else:
            pr_score = 10  # neutral
        scores["pull_requests"] = pr_score

        # CI health (25 pts)
        total_runs = db_count_filter(self.db, WorkflowRun, WorkflowRun.repo_id == repo_id)
        if total_runs > 0:
            recent_cutoff = _cutoff(14)
            recent_runs = db_count_filter(self.db, WorkflowRun, WorkflowRun.repo_id == repo_id,
                                           WorkflowRun.created_at >= recent_cutoff)
            successful = db_count_filter(self.db, WorkflowRun, WorkflowRun.repo_id == repo_id,
                                          WorkflowRun.created_at >= recent_cutoff,
                                          WorkflowRun.conclusion == "success")
            success_rate = successful / max(recent_runs, 1)
            ci_score = int(success_rate * 25)
        else:
            ci_score = 10  # neutral
        scores["ci_cd"] = ci_score

        # Branch health (15 pts)
        total_branches = db_count_filter(self.db, Branch, Branch.repo_id == repo_id)
        if total_branches > 0:
            stale_branches = db_count_filter(self.db, Branch, Branch.repo_id == repo_id, Branch.staleness_days > 90)
            stale_rate = stale_branches / total_branches
            branch_score = max(0, 15 - int(stale_rate * 15))
        else:
            branch_score = 8
        scores["branches"] = branch_score

        # Issue health (20 pts)
        total_issues = db_count_filter(self.db, Issue, Issue.repo_id == repo_id)
        if total_issues > 0:
            stale_issues = db_count_filter(self.db, Issue, Issue.repo_id == repo_id,
                                            Issue.state == "open", Issue.created_at < _cutoff(60))
            open_issues = db_count_filter(self.db, Issue, Issue.repo_id == repo_id, Issue.state == "open")
            stale_rate = stale_issues / max(open_issues, 1)
            issue_score = max(0, 20 - int(stale_rate * 20))
        else:
            issue_score = 10
        scores["issues"] = issue_score

        # Community health: discussions + forks (10 pts)
        has_discussions = db_count_filter(self.db, Discussion, Discussion.repo_id == repo_id) > 0
        has_forks = db_count_filter(self.db, Fork, Fork.repo_id == repo_id) > 0
        community_score = (5 if has_discussions else 0) + (5 if has_forks else 0)
        scores["community"] = community_score

        # Visibility (10 pts)
        visibility = repo.visibility or "public"
        scores["visibility"] = 10 if visibility == "public" else 5

        total_score = sum(scores.values())
        grade = _score_grade(total_score)

        return {
            "score": total_score,
            "max_score": 100,
            "grade": grade,
            "components": scores,
            "visibility": repo.visibility,
            "sync_status": repo.sync_status,
            "last_synced": repo.last_synced_at.isoformat() if repo.last_synced_at else None,
        }


def db_count_filter(db, model, *conditions):
    q = db.query(func.count(model.id))
    for cond in conditions:
        q = q.filter(cond)
    return q.scalar() or 0


def _score_grade(score: int) -> str:
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    if score >= 55:
        return "C"
    if score >= 40:
        return "D"
    return "F"
