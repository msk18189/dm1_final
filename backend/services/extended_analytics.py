"""Extended analytics: ML panel, stale alerts, compare, export helpers."""
import csv
import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from database.models import MLPrediction, PullRequest, Repository
from services.filters import (
    PRFilterParams,
    ensure_utc,
    format_duration,
    get_filtered_prs,
    list_authors,
    pr_cycle_hours,
)
from services.analytics import AnalyticsService, _ensure_utc, _iso_week_key, _month_key
from services.analytics import _month_range, _format_month_label, _week_range, _week_label
from services.risk_heuristics import scores_for_open_pr


def _pdf_safe(text: Any) -> str:
    """ASCII-safe text for core PDF fonts."""
    if text is None:
        return ""
    s = str(text)
    return s.encode("latin-1", errors="replace").decode("latin-1")


def _pdf_paragraph(pdf, width: float, line_height: float, text: str) -> None:
    """Write wrapped text that always continues from the left margin (fixes clipping / stray columns)."""
    from fpdf.enums import XPos, YPos

    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(
        width,
        line_height,
        _pdf_safe(text),
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )


def _pdf_heading(pdf, title: str, size: int = 12) -> None:
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", size)
    _pdf_paragraph(pdf, pdf.epw, 7, title)
    pdf.set_font("Helvetica", size=8)


def _filters_from_params(
    days: Optional[int] = None,
    author: Optional[str] = None,
    state: Optional[str] = None,
) -> PRFilterParams:
    return PRFilterParams(days=days, author=author, state=state)


class ExtendedAnalytics:
    def __init__(self, db: Session):
        self.db = db
        self.base = AnalyticsService(db)

    def get_kpi_with_duration(
        self,
        repo_id: int,
        days: Optional[int] = None,
        author: Optional[str] = None,
        state: Optional[str] = None,
    ) -> Dict[str, Any]:
        filters = _filters_from_params(days, author, state)
        prs = get_filtered_prs(self.db, repo_id, filters)
        now = ensure_utc(datetime.utcnow())

        open_prs = [p for p in prs if p.state == "OPEN"]
        stale_prs = [
            p for p in open_prs
            if p.created_at and (now - ensure_utc(p.created_at)).days > 30
        ]

        merged = [p for p in prs if p.state == "MERGED"]
        closed = [p for p in prs if p.state in ("MERGED", "CLOSED")]

        cycle_hours = [h for p in merged if (h := pr_cycle_hours(p)) is not None]
        wait_hours = [
            p.wait_for_review_hours for p in prs
            if p.wait_for_review_hours is not None and p.wait_for_review_hours >= 0
        ]
        review_hours = [
            p.review_duration_hours for p in prs
            if p.review_duration_hours is not None and p.review_duration_hours >= 0
        ]

        avg_cycle = sum(cycle_hours) / len(cycle_hours) if cycle_hours else 0
        median_cycle = 0.0
        if cycle_hours:
            sorted_h = sorted(cycle_hours)
            n = len(sorted_h)
            median_cycle = (
                sorted_h[n // 2]
                if n % 2 == 1
                else (sorted_h[n // 2 - 1] + sorted_h[n // 2]) / 2
            )

        avg_wait = sum(wait_hours) / len(wait_hours) if wait_hours else 0
        avg_review = sum(review_hours) / len(review_hours) if review_hours else 0
        merge_rate = round((len(merged) / len(closed) * 100) if closed else 0, 2)
        avg_reviews = (
            sum(p.review_count or 0 for p in prs) / len(prs) if prs else 0
        )

        return {
            "open_prs": len(open_prs),
            "stale_prs": len(stale_prs),
            "avg_cycle_time": round(avg_cycle / 24, 2) if avg_cycle else 0,
            "median_cycle_time": round(median_cycle / 24, 1) if median_cycle else 0,
            "avg_wait_for_review": round(avg_wait / 24, 2) if avg_wait else 0,
            "avg_review_duration": round(avg_review / 24, 2) if avg_review else 0,
            "merge_rate": merge_rate,
            "avg_reviews_per_pr": round(avg_reviews, 1),
            "avg_cycle_time_display": format_duration(avg_cycle),
            "median_cycle_time_display": format_duration(median_cycle),
            "avg_wait_for_review_display": format_duration(avg_wait),
            "avg_review_duration_display": format_duration(avg_review),
        }

    def get_monthly_flow_filtered(
        self, repo_id: int, months: int = 6, **filter_kw
    ) -> List[Dict[str, Any]]:
        filters = _filters_from_params(**filter_kw)
        prs = get_filtered_prs(self.db, repo_id, filters)
        month_keys = _month_range(months)
        flow = {
            ym: {"month": _format_month_label(ym), "created": 0, "merged": 0, "closed": 0}
            for ym in month_keys
        }
        for pr in prs:
            if pr.created_at:
                m = _month_key(pr.created_at)
                if m in flow:
                    flow[m]["created"] += 1
            if pr.merged_at:
                m = _month_key(pr.merged_at)
                if m in flow:
                    flow[m]["merged"] += 1
            if pr.state == "CLOSED" and pr.closed_at:
                m = _month_key(pr.closed_at)
                if m in flow:
                    flow[m]["closed"] += 1
        return [flow[ym] for ym in month_keys]

    def get_throughput_filtered(
        self, repo_id: int, weeks: int = 8, **filter_kw
    ) -> List[Dict[str, Any]]:
        filters = _filters_from_params(**filter_kw)
        prs = get_filtered_prs(self.db, repo_id, filters)
        week_keys = _week_range(weeks)
        counts = {k: 0 for k in week_keys}
        for pr in prs:
            if pr.merged_at:
                key = _iso_week_key(pr.merged_at)
                if key in counts:
                    counts[key] += 1
        return [{"week": _week_label(y, w), "prs": counts[(y, w)]} for y, w in week_keys]

    def get_contributors_filtered(self, repo_id: int, limit: int = 15, **filter_kw) -> List[Dict]:
        filters = _filters_from_params(**filter_kw)
        prs = get_filtered_prs(self.db, repo_id, filters)
        now = ensure_utc(datetime.utcnow())
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
                h = pr_cycle_hours(pr)
                if h is not None:
                    entry["cycle_times"].append(h)
            elif pr.state == "OPEN":
                entry["open_prs"] += 1
                if pr.created_at and (now - ensure_utc(pr.created_at)).days > 30:
                    entry["stale_pr_count"] += 1
            if pr.wait_for_review_hours is not None and pr.wait_for_review_hours >= 0:
                entry["wait_hours"].append(pr.wait_for_review_hours)

        result = []
        for entry in stats.values():
            total = entry["total_prs"]
            avg_cycle_h = (
                sum(entry["cycle_times"]) / len(entry["cycle_times"])
                if entry["cycle_times"] else 0
            )
            avg_wait_h = (
                sum(entry["wait_hours"]) / len(entry["wait_hours"])
                if entry["wait_hours"] else 0
            )
            result.append({
                "username": entry["username"],
                "total_prs": total,
                "merged_prs": entry["merged_prs"],
                "open_prs": entry["open_prs"],
                "avg_cycle_time": round(avg_cycle_h / 24, 2) if avg_cycle_h else 0,
                "avg_cycle_time_display": format_duration(avg_cycle_h),
                "avg_wait_for_review": round(avg_wait_h / 24, 2) if avg_wait_h else 0,
                "merge_rate": round((entry["merged_prs"] / total * 100) if total else 0, 2),
                "stale_pr_count": entry["stale_pr_count"],
            })
        result.sort(key=lambda x: x["total_prs"], reverse=True)
        return result[:limit]

    def get_oldest_open_filtered(self, repo_id: int, limit: int = 10, **filter_kw) -> List[Dict]:
        filters = _filters_from_params(**filter_kw)
        filters.state = "OPEN"
        prs = get_filtered_prs(self.db, repo_id, filters)
        prs.sort(key=lambda p: p.created_at or datetime.min.replace(tzinfo=timezone.utc))
        now = ensure_utc(datetime.utcnow())
        return [
            {
                "number": pr.pr_number,
                "title": pr.title,
                "created_at": pr.created_at.isoformat() if pr.created_at else None,
                "age_days": (now - ensure_utc(pr.created_at)).days if pr.created_at else 0,
                "author": pr.author,
                "review_count": pr.review_count,
            }
            for pr in prs[:limit]
        ]

    def get_slowest_merged_filtered(self, repo_id: int, limit: int = 10, **filter_kw) -> List[Dict]:
        filters = _filters_from_params(**filter_kw)
        filters.state = "MERGED"
        prs = get_filtered_prs(self.db, repo_id, filters)
        prs = [p for p in prs if pr_cycle_hours(p) is not None]
        prs.sort(key=lambda p: pr_cycle_hours(p) or 0, reverse=True)
        return [
            {
                "number": pr.pr_number,
                "title": pr.title,
                "cycle_time_days": round((pr_cycle_hours(pr) or 0) / 24, 2),
                "cycle_time_display": format_duration(pr_cycle_hours(pr)),
                "merged_at": pr.merged_at.isoformat() if pr.merged_at else None,
                "author": pr.author,
                "review_count": pr.review_count,
                "files_changed": pr.files_changed,
            }
            for pr in prs[:limit]
        ]

    def get_authors(self, repo_id: int) -> List[str]:
        return list_authors(self.db, repo_id)

    def get_pr_risk_panel(self, repo_id: int, limit: int = 15) -> List[Dict[str, Any]]:
        open_prs = (
            self.db.query(PullRequest)
            .filter(PullRequest.repo_id == repo_id, PullRequest.state == "OPEN")
            .all()
        )
        now = ensure_utc(datetime.utcnow())
        results = []
        uses_heuristic = False
        for pr in open_prs:
            pred = (
                self.db.query(MLPrediction)
                .filter(MLPrediction.pr_id == pr.id)
                .order_by(MLPrediction.created_at.desc())
                .first()
            )
            scores = scores_for_open_pr(pr, pred, now)
            if scores.get("source") == "heuristic":
                uses_heuristic = True
            results.append({
                "number": pr.pr_number,
                "title": pr.title,
                "author": pr.author,
                "review_count": pr.review_count or 0,
                "files_changed": pr.files_changed or 0,
                "predicted_delay_days": scores.get("predicted_delay_days"),
                "predicted_delay_display": scores.get("predicted_delay_display"),
                "bottleneck_probability": scores.get("bottleneck_probability", 0),
                "risk_score": scores.get("risk_score", 0),
                "predicted_review_wait_hours": scores.get("predicted_review_wait_hours"),
                "score_source": scores.get("source", "heuristic"),
            })
        results.sort(key=lambda x: x["risk_score"], reverse=True)
        if results and uses_heuristic:
            results[0]["_panel_note"] = (
                "Scores are rule-based estimates (ML models not trained yet). "
                "Re-analyze after training models for ML predictions."
            )
        return results[:limit]

    def get_stale_recommendations(self, repo_id: int, stale_days: int = 30) -> List[Dict[str, Any]]:
        now = ensure_utc(datetime.utcnow())
        open_prs = (
            self.db.query(PullRequest)
            .filter(PullRequest.repo_id == repo_id, PullRequest.state == "OPEN")
            .all()
        )
        alerts = []
        for pr in open_prs:
            if not pr.created_at:
                continue
            age_days = (now - ensure_utc(pr.created_at)).days
            reasons: List[str] = []
            actions: List[str] = []
            severity = "low"

            if age_days >= stale_days:
                reasons.append(f"Open for {age_days} days (stale threshold: {stale_days}d)")
                actions.append("Prioritize review or close if no longer needed")
                severity = "high"
            elif age_days >= 14:
                reasons.append(f"Open for {age_days} days")
                actions.append("Schedule review this week")
                severity = "medium"

            if (pr.review_count or 0) == 0:
                reasons.append("No reviews yet")
                actions.append("Assign a reviewer")
                severity = "high" if severity != "high" else severity

            if (pr.files_changed or 0) > 20:
                reasons.append(f"Large change set ({pr.files_changed} files)")
                actions.append("Split into smaller PRs for faster review")
                if severity == "low":
                    severity = "medium"

            if (pr.comment_count or 0) > 10 and (pr.review_count or 0) < 2:
                reasons.append("High discussion but few formal reviews")
                actions.append("Request explicit approval from maintainers")

            if not reasons:
                continue

            alerts.append({
                "number": pr.pr_number,
                "title": pr.title,
                "author": pr.author,
                "age_days": age_days,
                "review_count": pr.review_count or 0,
                "files_changed": pr.files_changed or 0,
                "severity": severity,
                "reasons": reasons,
                "recommended_actions": actions,
            })

        order = {"high": 0, "medium": 1, "low": 2}
        alerts.sort(key=lambda x: (order.get(x["severity"], 3), -x["age_days"]))
        return alerts

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
    ) -> str:
        repo = self.db.query(Repository).filter(Repository.id == repo_id).first()
        if not repo:
            raise ValueError("Repository not found")

        kpi = self.get_kpi_with_duration(repo_id, days, author, state)
        contributors = self.get_contributors_filtered(repo_id, limit=50, days=days, author=author, state=state)
        oldest = self.get_oldest_open_filtered(repo_id, limit=20, days=days, author=author, state=state)
        stale = self.get_stale_recommendations(repo_id)
        risks = self.get_pr_risk_panel(repo_id, limit=20)

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

    def build_export_pdf(
        self,
        repo_id: int,
        days: Optional[int] = None,
        author: Optional[str] = None,
        state: Optional[str] = None,
    ) -> bytes:
        """Build PDF report (requires fpdf2). Includes full analysis sections."""
        try:
            from fpdf import FPDF
        except ImportError as e:
            raise ValueError(
                "PDF export requires fpdf2. Install with: pip install fpdf2"
            ) from e

        repo = self.db.query(Repository).filter(Repository.id == repo_id).first()
        if not repo:
            raise ValueError("Repository not found")

        kpi = self.get_kpi_with_duration(repo_id, days, author, state)
        monthly = self.get_monthly_flow_filtered(
            repo_id, months=6, days=days, author=author, state=state
        )
        throughput = self.get_throughput_filtered(
            repo_id, weeks=8, days=days, author=author, state=state
        )
        contributors = self.get_contributors_filtered(
            repo_id, limit=100, days=days, author=author, state=state
        )
        oldest = self.get_oldest_open_filtered(
            repo_id, limit=50, days=days, author=author, state=state
        )
        slowest = self.get_slowest_merged_filtered(
            repo_id, limit=30, days=days, author=author, state=state
        )
        stale = self.get_stale_recommendations(repo_id)
        risks = self.get_pr_risk_panel(repo_id, limit=200)

        total_prs = self.db.query(PullRequest).filter(
            PullRequest.repo_id == repo_id
        ).count()

        pdf = FPDF()
        pdf.set_margins(12, 12, 12)
        pdf.set_auto_page_break(auto=True, margin=14)
        pdf.add_page()
        w = pdf.epw

        pdf.set_font("Helvetica", "B", 15)
        _pdf_paragraph(pdf, w, 8, "GitHub PR Intelligence Report")
        pdf.set_font("Helvetica", size=10)
        _pdf_paragraph(pdf, w, 5, f"Repository: {repo.owner}/{repo.name}")
        _pdf_paragraph(pdf, w, 5, f"Generated (UTC): {datetime.now(timezone.utc).isoformat()}")
        if days or (author and author != "all") or (state and state != "ALL"):
            filt = f"Filters: days={days or 'all'} author={author or 'all'} state={state or 'ALL'}"
            _pdf_paragraph(pdf, w, 5, filt)
        _pdf_paragraph(pdf, w, 5, f"Total PRs in database for this repo: {total_prs}")

        _pdf_heading(pdf, "KPI Summary", 11)
        kpi_order = [
            "open_prs",
            "stale_prs",
            "avg_cycle_time",
            "median_cycle_time",
            "avg_wait_for_review",
            "avg_review_duration",
            "merge_rate",
            "avg_reviews_per_pr",
        ]
        shown: set[str] = set()
        for key in kpi_order:
            if key in kpi:
                _pdf_paragraph(pdf, w, 4, f"{key}: {kpi[key]}")
                shown.add(key)
        for key, val in sorted(kpi.items()):
            if key in shown or key.endswith("_display"):
                continue
            _pdf_paragraph(pdf, w, 4, f"{key}: {val}")
            shown.add(key)
        for key, val in kpi.items():
            if key.endswith("_display") and isinstance(val, dict):
                _pdf_paragraph(
                    pdf,
                    w,
                    4,
                    f"{key}: {val.get('value')} {val.get('unit', '')}",
                )

        _pdf_heading(pdf, "Monthly PR flow (last 6 months)", 11)
        for row in monthly:
            m = row.get("month", "")
            _pdf_paragraph(
                pdf,
                w,
                4,
                f"{m} | created={row.get('created', 0)} merged={row.get('merged', 0)} closed={row.get('closed', 0)}",
            )

        _pdf_heading(pdf, "Weekly throughput (merged PRs)", 11)
        for row in throughput:
            _pdf_paragraph(
                pdf,
                w,
                4,
                f"{row.get('week', '')}: {row.get('prs', 0)} merged",
            )

        _pdf_heading(pdf, f"Contributors ({len(contributors)} listed)", 11)
        for c in contributors:
            _pdf_paragraph(
                pdf,
                w,
                4,
                f"{c.get('username', '')} | total={c.get('total_prs')} merged={c.get('merged_prs')} "
                f"open={c.get('open_prs', 0)} merge%={c.get('merge_rate')} stale={c.get('stale_pr_count', 0)}",
            )

        _pdf_heading(pdf, f"Stale PR alerts ({len(stale)})", 11)
        if not stale:
            _pdf_paragraph(pdf, w, 4, "(none)")
        for s in stale:
            reasons = "; ".join(s.get("reasons", []) or [])
            actions = "; ".join(s.get("recommended_actions", []) or [])
            title = (s.get("title") or "")[:120]
            _pdf_paragraph(
                pdf,
                w,
                4,
                f"#{s.get('number')} [{s.get('severity')}] age={s.get('age_days')}d | {title}",
            )
            _pdf_paragraph(pdf, w, 4, f"   Reasons: {reasons}")
            _pdf_paragraph(pdf, w, 4, f"   Actions: {actions}")

        _pdf_heading(pdf, f"PR risk & delay — open PRs ({len(risks)})", 11)
        if not risks:
            _pdf_paragraph(pdf, w, 4, "(no open PRs)")
        for r in risks:
            title = (r.get("title") or "")[:120]
            delay = r.get("predicted_delay_days")
            delay_s = f"{delay}d" if delay is not None else "n/a"
            _pdf_paragraph(
                pdf,
                w,
                4,
                f"#{r.get('number')} risk={r.get('risk_score')}% bottleneck={r.get('bottleneck_probability')}% "
                f"est_delay={delay_s} est_review_h={r.get('predicted_review_wait_hours')}",
            )
            _pdf_paragraph(pdf, w, 4, f"   {title} | author={r.get('author')}")

        _pdf_heading(pdf, f"Oldest open PRs ({len(oldest)})", 11)
        for o in oldest:
            title = (o.get("title") or "")[:120]
            _pdf_paragraph(
                pdf,
                w,
                4,
                f"#{o.get('number')} age={o.get('age_days')}d reviews={o.get('review_count')} | {title}",
            )

        _pdf_heading(pdf, f"Slowest merged PRs ({len(slowest)})", 11)
        for s in slowest:
            title = (s.get("title") or "")[:120]
            ctd = s.get("cycle_time_days")
            _pdf_paragraph(
                pdf,
                w,
                4,
                f"#{s.get('number')} cycle~{ctd}d | files={s.get('files_changed')} | {title}",
            )

        out = pdf.output()
        return bytes(out) if isinstance(out, (bytes, bytearray)) else str(out).encode("latin-1")
