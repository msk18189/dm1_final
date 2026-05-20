from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta, timezone, date
from sqlalchemy.orm import Session
from database.models import PullRequest, Contributor, Repository
from sqlalchemy import func


def _ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _month_key(dt: datetime) -> str:
    return _ensure_utc(dt).strftime("%Y-%m")


def _month_range(months: int) -> List[str]:
    """Last N calendar months including current, oldest first."""
    now = _ensure_utc(datetime.utcnow())
    year, month = now.year, now.month
    keys: List[str] = []
    for _ in range(months):
        keys.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return list(reversed(keys))


def _format_month_label(ym: str) -> str:
    y, m = ym.split("-")
    return datetime(int(y), int(m), 1).strftime("%b %Y")


def _iso_week_key(dt: datetime) -> Tuple[int, int]:
    iso = _ensure_utc(dt).isocalendar()
    return (iso[0], iso[1])


def _week_label(year: int, week: int) -> str:
    monday = date.fromisocalendar(year, week, 1)
    return monday.strftime("%b %d")


def _week_range(weeks: int) -> List[Tuple[int, int]]:
    """Last N ISO weeks ending this week, oldest first."""
    today = _ensure_utc(datetime.utcnow()).date()
    year, week, _ = today.isocalendar()
    keys: List[Tuple[int, int]] = [(year, week)]
    for _ in range(weeks - 1):
        prev_monday = date.fromisocalendar(year, week, 1) - timedelta(days=7)
        year, week, _ = prev_monday.isocalendar()
        keys.append((year, week))
    return list(reversed(keys))


class AnalyticsService:
    def __init__(self, db: Session):
        self.db = db
    
    def get_open_pr_count(self, repo_id: int) -> int:
        return self.db.query(PullRequest).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.state == "OPEN"
        ).count()
    
    def get_stale_pr_count(self, repo_id: int, days: int = 30) -> int:
        cutoff_date = _ensure_utc(datetime.utcnow()) - timedelta(days=days)
        open_prs = self.db.query(PullRequest).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.state == "OPEN",
        ).all()
        return sum(
            1
            for pr in open_prs
            if pr.created_at and _ensure_utc(pr.created_at) < cutoff_date
        )
    
    def get_avg_cycle_time(self, repo_id: int) -> float:
        result = self.db.query(func.avg(PullRequest.cycle_time_days)).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.cycle_time_days.isnot(None)
        ).scalar()
        return round(result or 0, 2)
    
    def get_median_cycle_time(self, repo_id: int) -> float:
        prs = self.db.query(PullRequest.cycle_time_days).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.cycle_time_days.isnot(None)
        ).all()
        
        if not prs:
            return 0
        
        values = sorted([p[0] for p in prs])
        n = len(values)
        return values[n // 2] if n % 2 == 1 else (values[n // 2 - 1] + values[n // 2]) / 2
    
    def get_merge_rate(self, repo_id: int) -> float:
        merged = self.db.query(PullRequest).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.state == "MERGED"
        ).count()
        
        closed = self.db.query(PullRequest).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.state.in_(["MERGED", "CLOSED"])
        ).count()
        
        return round((merged / closed * 100) if closed > 0 else 0, 2)
    
    def get_avg_review_duration(self, repo_id: int) -> float:
        result = self.db.query(func.avg(PullRequest.review_duration_hours)).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.review_duration_hours.isnot(None)
        ).scalar()
        return round((result or 0) / 24, 2)  # Convert to days
    
    def get_avg_wait_for_review(self, repo_id: int) -> float:
        result = self.db.query(func.avg(PullRequest.wait_for_review_hours)).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.wait_for_review_hours.isnot(None)
        ).scalar()
        return round((result or 0) / 24, 2)  # Convert to days
    
    def get_pr_throughput(self, repo_id: int, weeks: int = 8) -> List[Dict[str, Any]]:
        """PRs merged per ISO week (chronological, zero-filled)."""
        week_keys = _week_range(weeks)
        counts = {k: 0 for k in week_keys}

        prs = self.db.query(PullRequest).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.merged_at.isnot(None),
        ).all()

        for pr in prs:
            key = _iso_week_key(pr.merged_at)
            if key in counts:
                counts[key] += 1

        return [
            {"week": _week_label(y, w), "prs": counts[(y, w)]}
            for y, w in week_keys
        ]

    def get_monthly_pr_flow(self, repo_id: int, months: int = 6) -> List[Dict[str, Any]]:
        """Created / merged / closed counts by the month each event occurred."""
        month_keys = _month_range(months)
        flow = {
            ym: {"month": _format_month_label(ym), "created": 0, "merged": 0, "closed": 0}
            for ym in month_keys
        }

        prs = self.db.query(PullRequest).filter(
            PullRequest.repo_id == repo_id,
        ).all()

        for pr in prs:
            if pr.created_at:
                created_month = _month_key(pr.created_at)
                if created_month in flow:
                    flow[created_month]["created"] += 1

            if pr.merged_at:
                merged_month = _month_key(pr.merged_at)
                if merged_month in flow:
                    flow[merged_month]["merged"] += 1

            if pr.state == "CLOSED" and pr.closed_at:
                closed_month = _month_key(pr.closed_at)
                if closed_month in flow:
                    flow[closed_month]["closed"] += 1

        return [flow[ym] for ym in month_keys]
    
    def get_oldest_open_prs(self, repo_id: int, limit: int = 10) -> List[Dict]:
        prs = self.db.query(PullRequest).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.state == "OPEN"
        ).order_by(PullRequest.created_at.asc()).limit(limit).all()
        
        return [
            {
                "number": pr.pr_number,
                "title": pr.title,
                "created_at": pr.created_at.isoformat() if pr.created_at else None,
                "age_days": (datetime.utcnow() - pr.created_at).days if pr.created_at else 0,
                "author": pr.author,
                "review_count": pr.review_count
            }
            for pr in prs
        ]
    
    def get_slowest_merged_prs(self, repo_id: int, limit: int = 10) -> List[Dict]:
        prs = self.db.query(PullRequest).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.state == "MERGED",
            PullRequest.cycle_time_days.isnot(None)
        ).order_by(PullRequest.cycle_time_days.desc()).limit(limit).all()
        
        return [
            {
                "number": pr.pr_number,
                "title": pr.title,
                "cycle_time_days": pr.cycle_time_days,
                "merged_at": pr.merged_at.isoformat() if pr.merged_at else None,
                "author": pr.author,
                "review_count": pr.review_count,
                "files_changed": pr.files_changed
            }
            for pr in prs
        ]
    
    def get_contributor_activity(self, repo_id: int, limit: int = 15) -> List[Dict]:
        """Aggregate contributor stats from pull requests (source of truth)."""
        prs = self.db.query(PullRequest).filter(
            PullRequest.repo_id == repo_id,
        ).all()

        now = _ensure_utc(datetime.utcnow())
        stats: Dict[str, Dict[str, Any]] = {}

        for pr in prs:
            if not pr.author:
                continue

            if pr.author not in stats:
                stats[pr.author] = {
                    "username": pr.author,
                    "total_prs": 0,
                    "merged_prs": 0,
                    "open_prs": 0,
                    "cycle_times": [],
                    "wait_hours": [],
                    "stale_pr_count": 0,
                }

            entry = stats[pr.author]
            entry["total_prs"] += 1

            if pr.state == "MERGED":
                entry["merged_prs"] += 1
                if pr.cycle_time_days is not None and pr.cycle_time_days >= 0:
                    entry["cycle_times"].append(pr.cycle_time_days)
            elif pr.state == "OPEN":
                entry["open_prs"] += 1
                if pr.created_at:
                    age_days = (now - _ensure_utc(pr.created_at)).days
                    if age_days > 30:
                        entry["stale_pr_count"] += 1

            if pr.wait_for_review_hours is not None and pr.wait_for_review_hours >= 0:
                entry["wait_hours"].append(pr.wait_for_review_hours)

        result = []
        for entry in stats.values():
            total = entry["total_prs"]
            result.append({
                "username": entry["username"],
                "total_prs": total,
                "merged_prs": entry["merged_prs"],
                "open_prs": entry["open_prs"],
                "avg_cycle_time": round(
                    sum(entry["cycle_times"]) / len(entry["cycle_times"]), 2
                ) if entry["cycle_times"] else 0,
                "avg_wait_for_review": round(
                    (sum(entry["wait_hours"]) / len(entry["wait_hours"])) / 24, 2
                ) if entry["wait_hours"] else 0,
                "merge_rate": round((entry["merged_prs"] / total * 100) if total > 0 else 0, 2),
                "stale_pr_count": entry["stale_pr_count"],
            })

        result.sort(key=lambda x: x["total_prs"], reverse=True)
        return result[:limit]
    
    def get_median_cycle_time_rounded(self, repo_id: int) -> float:
        """Get median cycle time rounded to 1 decimal"""
        return round(self.get_median_cycle_time(repo_id), 1)
    
    def get_avg_reviews_per_pr(self, repo_id: int) -> float:
        """Average number of reviews per PR"""
        result = self.db.query(func.avg(PullRequest.review_count)).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.review_count.isnot(None)
        ).scalar()
        return round(result or 0, 1)
    
    def get_kpi_summary(self, repo_id: int) -> Dict[str, Any]:
        return {
            "open_prs": self.get_open_pr_count(repo_id),
            "stale_prs": self.get_stale_pr_count(repo_id),
            "avg_cycle_time": self.get_avg_cycle_time(repo_id),
            "median_cycle_time": self.get_median_cycle_time_rounded(repo_id),
            "avg_wait_for_review": self.get_avg_wait_for_review(repo_id),
            "avg_review_duration": self.get_avg_review_duration(repo_id),
            "merge_rate": self.get_merge_rate(repo_id),
            "avg_reviews_per_pr": self.get_avg_reviews_per_pr(repo_id),
        }
