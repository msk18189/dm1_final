import csv
import io
from datetime import datetime, timezone,timedelta
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy import func, case, and_, or_
from sqlalchemy.orm import Session

from database.models import MLPrediction, PullRequest, Repository, PRReview, PRCommit
from services.filters import (
    PRFilterParams,
    ensure_utc,
    format_duration,
    get_filtered_prs,
    get_filtered_prs_query,
    list_authors,
    pr_cycle_hours,
)
from services.analytics import AnalyticsService, _ensure_utc, _iso_week_key, _month_key
from services.analytics import _month_range, _format_month_label, _week_range, _week_label

def _filters_from_params(
    days: Optional[int] = None,
    author: Optional[str] = None,
    state: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> PRFilterParams:
    return PRFilterParams(days=days, author=author, state=state, start_date=start_date, end_date=end_date)


class ExtendedAnalytics:
    def __init__(self, db: Session):
        self.db = db
        self.base = AnalyticsService(db)

    def _get_latest_activity_timestamp(self, pr: PullRequest) -> Optional[datetime]:
        """
        Get the latest activity timestamp for a PR based on:
        1. Latest review submission
        2. Latest commit
        3. PR updated_at
        4. PR created_at (fallback)
        
        This is the true last activity timestamp, not the creation date.
        """
        timestamps = []
        
        if pr.updated_at:
            timestamps.append(ensure_utc(pr.updated_at))
        
        # Get latest review timestamp for this PR
        latest_review = self.db.query(func.max(PRReview.submitted_at)).filter(
            PRReview.pr_id == pr.id
        ).scalar()
        if latest_review:
            timestamps.append(ensure_utc(latest_review))
        
        # Get latest commit timestamp for this PR
        latest_commit = self.db.query(func.max(PRCommit.committed_at)).filter(
            PRCommit.pr_id == pr.id
        ).scalar()
        if latest_commit:
            timestamps.append(ensure_utc(latest_commit))
        
        # If no other activity, use created_at
        if pr.created_at:
            timestamps.append(ensure_utc(pr.created_at))
        
        return max(timestamps) if timestamps else None

    def _get_inactivity_days(self, pr: PullRequest) -> int:
        """Calculate days since last activity on a PR."""
        latest_activity = self._get_latest_activity_timestamp(pr)
        if not latest_activity:
            return 0
        now = ensure_utc(datetime.utcnow())
        return (now - latest_activity).days

    def _get_stale_severity(self, inactivity_days: int) -> str:
        """
        Classify PR inactivity into operational tiers:
        - healthy: 0-7 days inactive
        - warning: 7-30 days inactive
        - stale: 30-60 days inactive
        - critical: 60+ days inactive
        """
        if inactivity_days < 7:
            return "healthy"
        elif inactivity_days < 30:
            return "warning"
        elif inactivity_days < 60:
            return "stale"
        else:
            return "critical"

    def get_kpi_with_duration(
        self,
        repo_id: int,
        days: Optional[int] = None,
        author: Optional[str] = None,
        state: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        filters = _filters_from_params(days, author, state, start_date, end_date)
        query = get_filtered_prs_query(self.db, repo_id, filters)
        
        # Build subquery for aggregations
        subq = query.subquery()
        
        # 1. counts
        total_count = self.db.query(func.count(subq.c.id)).scalar() or 0
        open_count = self.db.query(func.count(subq.c.id)).filter(subq.c.state == "OPEN").scalar() or 0
        
        open_prs = query.filter(PullRequest.state == "OPEN").all()
        stale_count = 0
        for pr in open_prs:
            inactivity_days = self._get_inactivity_days(pr)
            if inactivity_days >= 30:
                stale_count += 1
        
        merged_count = self.db.query(func.count(subq.c.id)).filter(subq.c.state == "MERGED").scalar() or 0
        closed_count = self.db.query(func.count(subq.c.id)).filter(subq.c.state.in_(["MERGED", "CLOSED"])).scalar() or 0

        # 2. averages
        avg_cycle_days_result = self.db.query(func.avg(subq.c.cycle_time_days)).filter(subq.c.state == "MERGED").scalar()
        avg_cycle = float(avg_cycle_days_result) * 24 if avg_cycle_days_result is not None else None

        # For median cycle time:
        cycle_times = [float(r[0]) for r in self.db.query(subq.c.cycle_time_days).filter(subq.c.state == "MERGED", subq.c.cycle_time_days.isnot(None)).order_by(subq.c.cycle_time_days).all()]
        if cycle_times:
            n = len(cycle_times)
            median_cycle = (cycle_times[n // 2] if n % 2 == 1 else (cycle_times[n // 2 - 1] + cycle_times[n // 2]) / 2) * 24
        else:
            median_cycle = None

        avg_wait_result = self.db.query(func.avg(subq.c.wait_for_review_hours)).filter(subq.c.wait_for_review_hours.isnot(None), subq.c.wait_for_review_hours >= 0).scalar()
        avg_wait = float(avg_wait_result) if avg_wait_result is not None else None
        
        avg_review_result = self.db.query(func.avg(subq.c.review_duration_hours)).filter(subq.c.review_duration_hours.isnot(None), subq.c.review_duration_hours >= 0).scalar()
        avg_review = float(avg_review_result) if avg_review_result is not None else None

        merge_rate = round((merged_count / closed_count * 100) if closed_count else 0, 2)
        avg_reviews = float(self.db.query(func.avg(subq.c.review_count)).scalar() or 0.0)

        repo = self.db.query(Repository).filter(Repository.id == repo_id).first()

        # closed_not_merged_prs = PRs with state CLOSED (not merged)
        closed_not_merged_count = self.db.query(func.count(subq.c.id)).filter(subq.c.state == "CLOSED").scalar() or 0

        return {
            "total_prs": total_count,
            "open_prs": open_count,
            "merged_prs": merged_count,
            "closed_not_merged_prs": closed_not_merged_count,
            "stale_prs": stale_count,
            "avg_cycle_time": round(avg_cycle / 24, 2) if avg_cycle is not None else None,
            "median_cycle_time": round(median_cycle / 24, 1) if median_cycle is not None else None,
            "avg_wait_for_review": round(avg_wait / 24, 2) if avg_wait is not None else None,
            "avg_review_duration": round(avg_review / 24, 2) if avg_review is not None else None,
            "merge_rate": merge_rate,
            "avg_reviews_per_pr": round(avg_reviews, 1),
            "avg_cycle_time_display": format_duration(avg_cycle),
            "median_cycle_time_display": format_duration(median_cycle),
            "avg_wait_for_review_display": format_duration(avg_wait),
            "avg_review_duration_display": format_duration(avg_review),
            "expected_prs": repo.expected_prs if repo else 0,
            "synced_prs": repo.synced_prs if repo else 0,
            "expected_issues": repo.expected_issues if repo else 0,
            "synced_issues": repo.synced_issues if repo else 0,
            "expected_forks": repo.expected_forks if repo else 0,
            "synced_forks": repo.synced_forks if repo else 0,
            "expected_workflows": repo.expected_workflows if repo else 0,
            "synced_workflows": repo.synced_workflows if repo else 0,
        }


    def get_monthly_flow_filtered(
        self, repo_id: int, months: int = 6, **filter_kw
    ) -> List[Dict[str, Any]]:
        filters = _filters_from_params(**filter_kw)
        query = get_filtered_prs_query(self.db, repo_id, filters)
        month_keys = _month_range(months)
        flow = {
            ym: {"month": _format_month_label(ym), "created": 0, "merged": 0, "closed": 0, "open_at_end": 0}
            for ym in month_keys
        }
        
        # Select only required columns to avoid full ORM object overhead
        rows = query.with_entities(
            PullRequest.created_at,
            PullRequest.merged_at,
            PullRequest.closed_at,
            PullRequest.state
        ).all()
        
        for created_at, merged_at, closed_at, state in rows:
            if created_at:
                m = _month_key(created_at)
                if m in flow:
                    flow[m]["created"] += 1
            if merged_at:
                m = _month_key(merged_at)
                if m in flow:
                    flow[m]["merged"] += 1
            if state == "CLOSED" and closed_at:
                m = _month_key(closed_at)
                if m in flow:
                    flow[m]["closed"] += 1
                    
        # Calculate open_at_end for each month in month_keys
        for ym in month_keys:
            y, m_ = map(int, ym.split("-"))
            if m_ == 12:
                next_y, next_m = y + 1, 1
            else:
                next_y, next_m = y, m_ + 1
            end_of_month = datetime(next_y, next_m, 1)
            
            open_count = 0
            for created_at, merged_at, closed_at, state in rows:
                if not created_at:
                    continue
                c_at = created_at.replace(tzinfo=None) if created_at.tzinfo else created_at
                m_at = merged_at.replace(tzinfo=None) if merged_at and merged_at.tzinfo else merged_at
                cl_at = closed_at.replace(tzinfo=None) if closed_at and closed_at.tzinfo else closed_at
                
                if c_at < end_of_month:
                    is_merged_before = m_at and m_at < end_of_month
                    is_closed_before = cl_at and cl_at < end_of_month and state == "CLOSED"
                    
                    if not is_merged_before and not is_closed_before:
                        open_count += 1
            flow[ym]["open_at_end"] = open_count
            
        return [flow[ym] for ym in month_keys]

    def get_throughput_filtered(
        self, repo_id: int, weeks: int = 8, **filter_kw
    ) -> List[Dict[str, Any]]:
        filters = _filters_from_params(**filter_kw)
        query = get_filtered_prs_query(self.db, repo_id, filters)
        week_keys = _week_range(weeks)
        counts = {k: 0 for k in week_keys}
        
        # Select only merged_at to avoid full ORM overhead
        rows = query.filter(PullRequest.state == "MERGED", PullRequest.merged_at.isnot(None))\
            .with_entities(PullRequest.merged_at).all()
            
        for (merged_at,) in rows:
            key = _iso_week_key(merged_at)
            if key in counts:
                counts[key] += 1
        return [{"week": _week_label(y, w), "prs": counts[(y, w)]} for y, w in week_keys]

    def get_contributors_filtered(self, repo_id: int, page: int = 1, limit: int = 10, **filter_kw) -> Dict[str, Any]:
        filters = _filters_from_params(**filter_kw)

        # We start from the filtered query
        query = get_filtered_prs_query(self.db, repo_id, filters)
        all_prs = query.all()
        
        # Group PRs by author and calculate stats
        author_stats: Dict[str, Dict[str, Any]] = {}
        
        for pr in all_prs:
            author = pr.author
            if not author:
                continue
            
            if author not in author_stats:
                author_stats[author] = {
                    "total_prs": 0,
                    "merged_prs": 0,
                    "open_prs": 0,
                    "stale_prs": 0,
                    "cycle_times": [],
                    "wait_times": [],
                }
            
            author_stats[author]["total_prs"] += 1
            
            if pr.state == "MERGED":
                author_stats[author]["merged_prs"] += 1
                if pr.cycle_time_days is not None:
                    author_stats[author]["cycle_times"].append(pr.cycle_time_days)
            elif pr.state == "OPEN":
                author_stats[author]["open_prs"] += 1
                # Calculate stale status based on inactivity (not created_at)
                inactivity_days = self._get_inactivity_days(pr)
                if inactivity_days >= 30:
                    author_stats[author]["stale_prs"] += 1
            
            if pr.wait_for_review_hours is not None and pr.wait_for_review_hours >= 0:
                author_stats[author]["wait_times"].append(pr.wait_for_review_hours)
        
        # Calculate averages and format
        formatted_results = []
        for author, stats in author_stats.items():
            total_prs = stats["total_prs"]
            merged_prs = stats["merged_prs"]
            open_prs = stats["open_prs"]
            stale_prs = stats["stale_prs"]
            
            # Average cycle time (in days)
            avg_cycle_days = (sum(stats["cycle_times"]) / len(stats["cycle_times"])) if stats["cycle_times"] else None
            avg_cycle_h = avg_cycle_days * 24 if avg_cycle_days is not None else None
            
            # Average wait time (in hours)
            avg_wait_h = (sum(stats["wait_times"]) / len(stats["wait_times"])) if stats["wait_times"] else None
            
            formatted_results.append({
                "username": author,
                "total_prs": total_prs,
                "merged_prs": merged_prs,
                "open_prs": open_prs,
                "stale_prs": stale_prs,
                "avg_cycle_time": round(avg_cycle_days, 2) if avg_cycle_days is not None else None,
                "avg_cycle_time_display": format_duration(avg_cycle_h),
                "avg_wait_for_review": round(avg_wait_h / 24, 2) if avg_wait_h is not None else None,
                "merge_rate": round((merged_prs / total_prs * 100) if total_prs else 0, 2),
            })
        
        # Sort by total PRs (most productive contributors first)
        formatted_results.sort(key=lambda x: x["total_prs"], reverse=True)
        
        # Get total number of unique authors
        total_contributors = len(author_stats)
        
        # Paginate
        offset = (page - 1) * limit
        paginated_results = formatted_results[offset:offset+limit]
            
        return {
            "data": paginated_results,
            "total": total_contributors,
            "page": page,
            "limit": limit,
            "pages": (total_contributors + limit - 1) // limit if limit else 1
        }

    def get_oldest_open_filtered(self, repo_id: int, page: int = 1, limit: int = 10, **filter_kw) -> Dict[str, Any]:
        filters = _filters_from_params(**filter_kw)
        filters.state = "OPEN"
        query = get_filtered_prs_query(self.db, repo_id, filters)
        
        # Order by created_at ascending
        query = query.order_by(PullRequest.created_at.asc())
        
        total = query.count()
        offset = (page - 1) * limit
        prs = query.offset(offset).limit(limit).all()
        
        now = ensure_utc(datetime.utcnow())
        data = [
            {
                "number": pr.pr_number,
                "title": pr.title,
                "created_at": pr.created_at.isoformat() if pr.created_at else None,
                "age_days": (now - ensure_utc(pr.created_at)).days if pr.created_at else 0,
                "author": pr.author,
                "review_count": pr.review_count,
            }
            for pr in prs
        ]
        return {
            "data": data,
            "total": total,
            "page": page,
            "limit": limit,
            "pages": (total + limit - 1) // limit if limit else 1
        }

    def get_slowest_merged_filtered(self, repo_id: int, page: int = 1, limit: int = 10, **filter_kw) -> Dict[str, Any]:
        filters = _filters_from_params(**filter_kw)
        filters.state = "MERGED"
        query = get_filtered_prs_query(self.db, repo_id, filters)
        
        # Order by cycle_time_days descending
        query = query.filter(PullRequest.cycle_time_days.isnot(None))\
            .order_by(PullRequest.cycle_time_days.desc())
            
        total = query.count()
        offset = (page - 1) * limit
        prs = query.offset(offset).limit(limit).all()
        
        data = [
            {
                "number": pr.pr_number,
                "title": pr.title,
                "cycle_time_days": round(pr.cycle_time_days, 2) if pr.cycle_time_days is not None else None,
                "cycle_time_display": format_duration(pr.cycle_time_days * 24 if pr.cycle_time_days is not None else None),
                "merged_at": pr.merged_at.isoformat() if pr.merged_at else None,
                "author": pr.author,
                "review_count": pr.review_count,
                "files_changed": pr.files_changed,
            }
            for pr in prs
        ]
        return {
            "data": data,
            "total": total,
            "page": page,
            "limit": limit,
            "pages": (total + limit - 1) // limit if limit else 1
        }

    def get_authors(self, repo_id: int) -> List[str]:
        return list_authors(self.db, repo_id)

    def get_pr_risk_panel(self, repo_id: int, page: int = 1, limit: int = 15) -> Dict[str, Any]:
        open_prs_query = self.db.query(PullRequest)\
            .filter(PullRequest.repo_id == repo_id, PullRequest.state == "OPEN")
            
        total = open_prs_query.count()
        

        query = self.db.query(PullRequest, MLPrediction)\
            .outerjoin(MLPrediction, PullRequest.id == MLPrediction.pr_id)\
            .filter(
                PullRequest.repo_id == repo_id,
                PullRequest.state == "OPEN"
            )\
            .order_by(
                case(
                    (MLPrediction.risk_score == None, 1),
                    else_=0
                ),
                MLPrediction.risk_score.desc(),
                PullRequest.created_at.asc()
            )
        offset = (page - 1) * limit
        results = query.offset(offset).limit(limit).all()
        
        data = []
        for pr, pred in results:
            if pred:
                score_source = "ml"
                risk_score = round((pred.risk_score or 0) * 100, 1)
                bottleneck_probability = round((pred.bottleneck_probability or 0) * 100, 1)
                predicted_delay_days = pred.predicted_delay_days
                predicted_delay_display = (
                    format_duration(predicted_delay_days * 24)
                    if predicted_delay_days is not None
                    else None
                )
                predicted_review_wait_hours = (
                    round(pred.predicted_review_wait, 1)
                    if pred.predicted_review_wait is not None
                    else None
                )
            else:
                # Calculate age in days
                now = ensure_utc(datetime.utcnow())
                pr_created = ensure_utc(pr.created_at) if pr.created_at else now
                age_days = (now - pr_created).days

                score_source = "heuristic"
                
                # Heuristic Risk Score (0-100)
                # Size component (max 40)
                files_cnt = pr.files_changed or 0
                lines_added = pr.lines_added or 0
                lines_deleted = pr.lines_deleted or 0
                total_lines = lines_added + lines_deleted
                size_risk = min(40, (files_cnt * 2) + int(total_lines * 0.04))
                
                # Age component (max 30)
                age_risk = min(30, age_days * 1.5)
                
                # Discussion/Review activity component (max 30)
                comment_cnt = pr.comment_count or 0
                rev_cnt = pr.review_count or 0
                activity_risk = 0
                if rev_cnt == 0:
                    activity_risk += 20
                elif comment_cnt > 10 and rev_cnt < 2:
                    activity_risk += 15
                activity_risk = min(30, activity_risk + min(10, comment_cnt * 1))
                
                risk_score = float(size_risk + age_risk + activity_risk)
                
                # Heuristic Bottleneck Probability (0-100)
                base_bottleneck = 0
                if rev_cnt == 0:
                    if age_days > 14:
                        base_bottleneck = 70.0
                    elif age_days > 7:
                        base_bottleneck = 50.0
                    elif age_days > 3:
                        base_bottleneck = 30.0
                    else:
                        base_bottleneck = 15.0
                else:
                    if age_days > 30:
                        base_bottleneck = 60.0
                    elif age_days > 14:
                        base_bottleneck = 40.0
                    elif age_days > 7:
                        base_bottleneck = 20.0
                    else:
                        base_bottleneck = 5.0
                        
                size_factor = min(30.0, files_cnt * 1.5)
                bottleneck_probability = round(min(100.0, base_bottleneck + size_factor), 1)
                
                # Heuristic Delay Days
                predicted_delay_days = max(1.0, float(files_cnt * 0.2 + total_lines * 0.005 + age_days * 0.1))
                predicted_delay_display = format_duration(predicted_delay_days * 24)
                
                # Heuristic Review Wait Hours
                if rev_cnt == 0:
                    predicted_review_wait_hours = float(max(24.0, age_days * 24.0))
                else:
                    predicted_review_wait_hours = 12.0
                
            data.append({
                "number": pr.pr_number,
                "title": pr.title,
                "author": pr.author,
                "review_count": pr.review_count or 0,
                "files_changed": pr.files_changed or 0,
                "predicted_delay_days": predicted_delay_days,
                "predicted_delay_display": predicted_delay_display,
                "bottleneck_probability": bottleneck_probability,
                "risk_score": risk_score,
                "predicted_review_wait_hours": predicted_review_wait_hours,
                "score_source": score_source,
            })
            
        return {
            "data": data,
            "total": total,
            "page": page,
            "limit": limit,
            "pages": (total + limit - 1) // limit if limit else 1
        }

    def get_stale_recommendations(self, repo_id: int, page: int = 1, limit: int = 10, stale_days: int = 30) -> Dict[str, Any]:
        """
        Detect stale PRs based on inactivity duration.
        
        A PR is STALE when:
        - State = OPEN (excluding merged/closed/draft)
        - No activity for X days (default 30)
        - Where "activity" = max(updated_at, latest_commit, latest_review)
        
        Returns PRs with operational severity tiers:
        - healthy: 0-7 days inactive
        - warning: 7-30 days inactive
        - stale: 30-60 days inactive
        - critical: 60+ days inactive
        """
        now = ensure_utc(datetime.utcnow())
        
        # Get all OPEN, non-draft PRs for this repo
        open_prs = self.db.query(PullRequest).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.state == "OPEN",
            PullRequest.draft == False
        ).all()
        
        stale_alerts = []
        
        for pr in open_prs:
            # Calculate true inactivity (days since last activity)
            inactivity_days = self._get_inactivity_days(pr)
            severity = self._get_stale_severity(inactivity_days)
            
            # Only include PRs that are at least in "warning" state (7+ days inactive)
            # This filters out healthy PRs and focuses on those needing attention
            if severity not in ["warning", "stale", "critical"]:
                continue
            
            # Build operational reasons based on inactivity
            reasons: List[str] = []
            actions: List[str] = []
            
            if inactivity_days >= 60:
                reasons.append(f"No activity for {inactivity_days} days (CRITICAL)")
                actions.append("Prioritize review immediately or close if abandoned")
                actions.append("Consider reaching out to author for status")
            elif inactivity_days >= 30:
                reasons.append(f"No activity for {inactivity_days} days (STALE)")
                actions.append("Review or close PR to reduce technical debt")
                actions.append("Ping author if PR is still relevant")
            elif inactivity_days >= 7:
                reasons.append(f"No activity for {inactivity_days} days (WARNING)")
                actions.append("Monitor progress and request review if needed")
            
            # Add operational intelligence
            if pr.review_count == 0:
                reasons.append("No reviews received yet")
                actions.append("Assign reviewer or request feedback")
            elif pr.review_count > 0 and inactivity_days > 14:
                reasons.append(f"Received {pr.review_count} review(s) but stalled")
                actions.append("Address review feedback or discuss blockers")
            
            if pr.files_changed and pr.files_changed > 30:
                reasons.append(f"Large changeset ({pr.files_changed} files) may be complex")
                actions.append("Consider breaking into smaller PRs for faster review")
            
            # Ensure we have reasons and actions
            if not reasons:
                reasons.append(f"Inactive for {inactivity_days} days")
                actions.append("Review PR status and current relevance")
            
            stale_alerts.append({
                "number": pr.pr_number,
                "title": pr.title,
                "author": pr.author,
                "age_days": inactivity_days,  # True inactivity days
                "severity": severity,
                "reasons": reasons,
                "recommended_actions": actions,
            })
        
        # Sort by severity (critical > stale > warning) then by inactivity age
        severity_order = {"critical": 0, "stale": 1, "warning": 2}
        stale_alerts.sort(
            key=lambda x: (
                severity_order.get(x["severity"], 3),
                -x["age_days"]  # Oldest first within same severity
            )
        )
        
        # Paginate results
        offset = (page - 1) * limit
        paginated_alerts = stale_alerts[offset:offset+limit]
        
        return {
            "data": paginated_alerts,
            "total": len(stale_alerts),
            "page": page,
            "limit": limit,
            "pages": (len(stale_alerts) + limit - 1) // limit if limit else 1
        }

    def compare_repos(self, repo_id_a: int, repo_id_b: int) -> Dict[str, Any]:
        repo_a = self.db.query(Repository).filter(Repository.id == repo_id_a).first()
        repo_b = self.db.query(Repository).filter(Repository.id == repo_id_b).first()
        if not repo_a or not repo_b:
            raise ValueError("One or both repositories not found")

        kpi_a = self.get_kpi_with_duration(repo_id_a)
        kpi_b = self.get_kpi_with_duration(repo_id_b)

        def delta(key: str) -> Optional[float]:
            a, b = kpi_a.get(key), kpi_b.get(key)
            if isinstance(a, (int, float)) and isinstance(b, (int, float)):
                return round(b - a, 2)
            return None

        return {
            "repo_a": {
                "repo_id": repo_id_a,
                "owner": repo_a.owner,
                "name": repo_a.name,
                "kpi": kpi_a,
            },
            "repo_b": {
                "repo_id": repo_id_b,
                "owner": repo_b.owner,
                "name": repo_b.name,
                "kpi": kpi_b,
            },
            "comparison": {
                "open_prs_delta": delta("open_prs"),
                "merge_rate_delta": delta("merge_rate"),
                "avg_cycle_time_delta": delta("avg_cycle_time"),
                "stale_prs_delta": delta("stale_prs"),
            },
        }

    def build_export_csv(
        self,
        repo_id: int,
        days: Optional[int] = None,
        author: Optional[str] = None,
        state: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> str:
        repo = self.db.query(Repository).filter(Repository.id == repo_id).first()
        if not repo:
            raise ValueError("Repository not found")

        kpi = self.get_kpi_with_duration(repo_id, days, author, state, start_date, end_date)
        contributors = self.get_contributors_filtered(repo_id, limit=50, days=days, author=author, state=state, start_date=start_date, end_date=end_date)["data"]
        oldest = self.get_oldest_open_filtered(repo_id, limit=20, days=days, author=author, state=state, start_date=start_date, end_date=end_date)["data"]
        stale = self.get_stale_recommendations(repo_id)["data"]
        risks = self.get_pr_risk_panel(repo_id, limit=20)["data"]

        buf = io.StringIO()
        w = csv.writer(buf)

        w.writerow(["GitHub PR Intelligence Report"])
        w.writerow(["Repository", f"{repo.owner}/{repo.name}"])
        w.writerow(["Generated", datetime.now(timezone.utc).isoformat()])
        w.writerow([])

        w.writerow(["KPI Summary"])
        for key, val in kpi.items():
            if not key.endswith("_display"):
                w.writerow([key, val])
        w.writerow([])

        w.writerow(["Contributors"])
        w.writerow(["username", "total_prs", "merged_prs", "merge_rate", "avg_cycle_time"])
        for c in contributors:
            w.writerow([c["username"], c["total_prs"], c["merged_prs"], c["merge_rate"], c["avg_cycle_time"]])
        w.writerow([])

        w.writerow(["Stale PR Alerts"])
        w.writerow(["number", "title", "author", "age_days", "severity", "actions"])
        for s in stale:
            w.writerow([s["number"], s["title"], s["author"], s["age_days"], s["severity"], "; ".join(s["recommended_actions"])])
        w.writerow([])

        w.writerow(["PR Risk Panel"])
        w.writerow(["number", "title", "author", "risk_score", "bottleneck_probability", "predicted_delay_days"])
        for r in risks:
            w.writerow([r["number"], r["title"], r["author"], r["risk_score"], r["bottleneck_probability"], r["predicted_delay_days"]])
        w.writerow([])

        w.writerow(["Oldest Open PRs"])
        w.writerow(["number", "title", "author", "age_days", "review_count"])
        for o in oldest:
            w.writerow([o["number"], o["title"], o["author"], o["age_days"], o["review_count"]])

        return buf.getvalue()
