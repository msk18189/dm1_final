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


def _pdf_reset_cursor(pdf) -> None:
    """Align all content to the left margin."""
    pdf.set_x(pdf.l_margin)


def _pdf_normalize_widths(total: float, ratios: List[float]) -> List[float]:
    """Column widths that sum exactly to total (avoids table drift)."""
    if not ratios:
        return []
    widths = [round(total * r, 2) for r in ratios[:-1]]
    widths.append(round(total - sum(widths), 2))
    return widths


def _pdf_paragraph(pdf, width: float, line_height: float, text: str) -> None:
    """Write wrapped text from the left margin."""
    from fpdf.enums import XPos, YPos

    _pdf_reset_cursor(pdf)
    pdf.multi_cell(
        width,
        line_height,
        _pdf_safe(text),
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )
    _pdf_reset_cursor(pdf)


def _pdf_section(pdf, title: str, subtitle: str = "") -> None:
    """Full-width section heading — same left edge as tables and charts."""
    from fpdf.enums import XPos, YPos

    _pdf_ensure_space(pdf, 14)
    _pdf_reset_cursor(pdf)
    pdf.ln(5)

    pdf.set_fill_color(241, 245, 249)
    pdf.set_draw_color(148, 163, 184)
    pdf.set_text_color(30, 41, 59)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(
        pdf.epw,
        8,
        _pdf_safe(title),
        border="B",
        fill=True,
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )

    if subtitle:
        _pdf_reset_cursor(pdf)
        pdf.set_font("Helvetica", size=7)
        pdf.set_text_color(100, 116, 139)
        pdf.multi_cell(
            pdf.epw,
            4,
            _pdf_safe(subtitle),
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )

    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", size=8)
    _pdf_reset_cursor(pdf)
    pdf.ln(3)


def _pdf_truncate(text: Any, max_len: int) -> str:
    s = _pdf_safe(text)
    if len(s) <= max_len:
        return s
    return s[: max_len - 3] + "..."


def _pdf_ensure_space(pdf, needed_mm: float) -> None:
    """Start a new page if there is not enough vertical space."""
    if pdf.get_y() + needed_mm > pdf.h - pdf.b_margin:
        pdf.add_page()


def _pdf_draw_table(
    pdf,
    headers: List[str],
    rows: List[List[Any]],
    col_widths: List[float],
    row_height: float = 6,
) -> None:
    """Draw a bordered table aligned to the left margin."""
    if not headers:
        return

    x0 = pdf.l_margin
    widths = col_widths
    if abs(sum(widths) - pdf.epw) > 0.1:
        widths = _pdf_normalize_widths(
            pdf.epw, [w / sum(col_widths) for w in col_widths]
        )

    def draw_row(cells: List[str], header: bool = False) -> None:
        _pdf_ensure_space(pdf, row_height + 2)
        y0 = pdf.get_y()
        if header:
            pdf.set_fill_color(55, 65, 81)
            pdf.set_text_color(255, 255, 255)
            pdf.set_font("Helvetica", "B", 8)
        else:
            pdf.set_fill_color(248, 250, 252)
            pdf.set_text_color(30, 30, 30)
            pdf.set_font("Helvetica", size=7)

        x = x0
        for i, cell in enumerate(cells):
            cw = widths[i] if i < len(widths) else widths[-1]
            pdf.set_xy(x, y0)
            pdf.cell(cw, row_height, cell, border=1, fill=True, align="L")
            x += cw

        pdf.set_text_color(0, 0, 0)
        pdf.set_xy(x0, y0 + row_height)

    draw_row([_pdf_safe(h) for h in headers], header=True)
    for row in rows:
        cells = [_pdf_truncate(c, 80) for c in row]
        while len(cells) < len(headers):
            cells.append("")
        draw_row(cells[: len(headers)])

    _pdf_reset_cursor(pdf)
    pdf.ln(4)


def _pdf_add_chart_image(
    pdf,
    fig,
    width_mm: float | None = None,
    max_height_mm: float = 115,
) -> None:
    """Embed chart PNG in PDF preserving aspect ratio (no stretch/squash)."""
    import matplotlib.pyplot as plt
    from PIL import Image

    buf = io.BytesIO()
    fig.savefig(
        buf,
        format="png",
        dpi=150,
        bbox_inches="tight",
        facecolor="white",
        edgecolor="none",
        pad_inches=0.25,
    )
    plt.close(fig)
    buf.seek(0)

    with Image.open(buf) as im:
        px_w, px_h = im.size
    buf.seek(0)

    target_w = width_mm or pdf.epw
    target_h = target_w * (px_h / px_w)

    if target_h > max_height_mm:
        target_h = max_height_mm
        target_w = target_h * (px_w / px_h)

    _pdf_ensure_space(pdf, target_h + 6)
    _pdf_reset_cursor(pdf)
    y0 = pdf.get_y()
    pdf.image(buf, x=pdf.l_margin, y=y0, w=target_w, h=target_h)
    pdf.set_y(y0 + target_h + 6)
    _pdf_reset_cursor(pdf)


def _pdf_chart_layout(fig, *, left: float = 0.12, bottom: float = 0.14) -> None:
    """Consistent margins so labels and legends are not clipped."""
    fig.subplots_adjust(left=left, right=0.97, top=0.90, bottom=bottom)


def _pdf_duration_str(display: Any, fallback_days: float = 0) -> str:
    """Match dashboard duration display (value + unit)."""
    if isinstance(display, dict):
        return f"{display.get('value', 0)} {display.get('unit', '')}".strip()
    if fallback_days:
        d = format_duration(fallback_days * 24)
        return f"{d['value']} {d['unit']}"
    return "0 hrs"


def _pdf_short_date(iso: Optional[str]) -> str:
    if not iso:
        return "-"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%b %d, %y")
    except (ValueError, TypeError):
        return "-"


def _pdf_chart_monthly_flow(monthly: List[Dict[str, Any]]):
    """Monthly PR Flow — grouped vertical bars."""
    import matplotlib.pyplot as plt

    if not monthly:
        return None

    labels = [str(r.get("month", "")) for r in monthly]
    created = [r.get("created", 0) for r in monthly]
    merged = [r.get("merged", 0) for r in monthly]
    closed = [r.get("closed", 0) for r in monthly]

    x = list(range(len(labels)))
    bar_w = 0.24
    fig, ax = plt.subplots(figsize=(7.0, 3.4))
    ax.bar([i - bar_w for i in x], created, bar_w, label="Created", color="#667eea")
    ax.bar(x, merged, bar_w, label="Merged", color="#10b981")
    ax.bar([i + bar_w for i in x], closed, bar_w, label="Closed (unmerged)", color="#ef4444")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=28, ha="right", fontsize=8)
    ax.set_ylabel("PR count", fontsize=9)
    ax.legend(fontsize=8, loc="upper right", framealpha=0.9)
    ax.grid(axis="y", alpha=0.25, linestyle="--")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    _pdf_chart_layout(fig, bottom=0.22)
    return fig


def _pdf_chart_throughput(throughput: List[Dict[str, Any]]):
    """PR Throughput (Weekly) — line chart."""
    import matplotlib.pyplot as plt

    if not throughput:
        return None

    labels = [str(r.get("week", "")) for r in throughput]
    values = [r.get("prs", 0) for r in throughput]
    x = list(range(len(labels)))

    fig, ax = plt.subplots(figsize=(7.0, 3.2))
    ax.plot(x, values, marker="o", color="#667eea", linewidth=2, markersize=5)
    ax.fill_between(x, values, alpha=0.12, color="#667eea")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=32, ha="right", fontsize=7)
    ax.set_ylabel("Merged PRs", fontsize=9)
    ax.grid(axis="y", alpha=0.25, linestyle="--")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    _pdf_chart_layout(fig, bottom=0.24)
    return fig


def _pdf_chart_contributors(contributors: List[Dict[str, Any]]):
    """Contributor Activity — horizontal grouped bars (dashboard style)."""
    import matplotlib.pyplot as plt

    if not contributors:
        return None

    sorted_c = sorted(contributors, key=lambda c: c.get("total_prs", 0), reverse=True)
    labels = [(c.get("username") or "unknown")[:18] for c in sorted_c]
    total = [c.get("total_prs", 0) for c in sorted_c]
    merged = [c.get("merged_prs", 0) for c in sorted_c]

    n = len(labels)
    fig_h = max(4.5, n * 0.48 + 2.2)
    fig, ax = plt.subplots(figsize=(7.0, fig_h))
    y = list(range(n))
    bar_h = 0.34
    ax.barh([i - bar_h / 2 for i in y], total, height=bar_h, label="Total PRs", color="#667eea")
    ax.barh([i + bar_h / 2 for i in y], merged, height=bar_h, label="Merged", color="#10b981")
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel("PR count", fontsize=9)
    xmax = max(total + [1])
    ax.set_xlim(0, xmax * 1.08)
    ax.legend(
        fontsize=8,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.04),
        ncol=2,
        frameon=False,
    )
    ax.grid(axis="x", alpha=0.25, linestyle="--")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    _pdf_chart_layout(fig, left=0.22, bottom=0.12)
    return fig


def _pdf_chart_review_turnaround(contributors: List[Dict[str, Any]]):
    """Review Turnaround — horizontal bars colored by wait time."""
    import matplotlib.pyplot as plt

    items = [
        {
            "username": c.get("username", ""),
            "hours": (c.get("avg_wait_for_review") or 0) * 24,
        }
        for c in contributors
        if c.get("username")
    ]
    if not items:
        return None

    items.sort(key=lambda x: x["hours"], reverse=True)
    labels = [i["username"][:18] for i in items]
    hours = [i["hours"] for i in items]
    colors = [
        "#16a34a" if h < 24 else "#ca8a04" if h < 48 else "#dc2626"
        for h in hours
    ]

    n = len(labels)
    fig_h = max(4.5, n * 0.48 + 2.0)
    fig, ax = plt.subplots(figsize=(7.0, fig_h))
    y = list(range(n))
    ax.barh(y, hours, height=0.55, color=colors)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel("Avg wait (hours)", fontsize=9)
    xmax = max(hours + [1])
    ax.set_xlim(0, xmax * 1.08)
    ax.grid(axis="x", alpha=0.25, linestyle="--")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    _pdf_chart_layout(fig, left=0.22, bottom=0.10)
    return fig


def _pdf_stale_alerts_section(pdf, stale: List[Dict[str, Any]], w: float) -> None:
    """Stale PR Alerts & Recommendations — same layout as dashboard cards."""
    _pdf_section(pdf, "Stale PR Alerts & Recommendations")
    if not stale:
        _pdf_paragraph(pdf, w, 5, "No PRs need attention right now.")
        return

    for alert in stale:
        _pdf_ensure_space(pdf, 28)
        _pdf_reset_cursor(pdf)
        pdf.set_font("Helvetica", "B", 9)
        title = f"#{alert.get('number')} - {alert.get('title', '')}"
        _pdf_paragraph(pdf, w, 5, title)
        pdf.set_font("Helvetica", size=7)
        meta = (
            f"{alert.get('author', '')} | {alert.get('age_days', 0)} days open | "
            f"{alert.get('severity', '')} priority"
        )
        _pdf_paragraph(pdf, w, 4, meta)

        reasons = alert.get("reasons") or []
        actions = alert.get("recommended_actions") or []
        pdf.set_font("Helvetica", "B", 7)
        _pdf_paragraph(pdf, w, 4, "Why flagged")
        pdf.set_font("Helvetica", size=7)
        for r in reasons:
            _pdf_paragraph(pdf, w, 4, f"  - {r}")
        pdf.set_font("Helvetica", "B", 7)
        _pdf_paragraph(pdf, w, 4, "Recommended actions")
        pdf.set_font("Helvetica", size=7)
        for a in actions:
            _pdf_paragraph(pdf, w, 4, f"  > {a}")
        pdf.ln(3)


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
        """PDF mirrors dashboard page layout (KPIs, alerts, charts, tables). No filter/input UI."""
        try:
            from fpdf import FPDF
        except ImportError as e:
            raise ValueError(
                "PDF export requires fpdf2. Install with: pip install fpdf2"
            ) from e

        try:
            import matplotlib  # noqa: F401

            matplotlib.use("Agg")
        except ImportError as e:
            raise ValueError(
                "PDF charts require matplotlib. Install with: pip install matplotlib"
            ) from e

        repo = self.db.query(Repository).filter(Repository.id == repo_id).first()
        if not repo:
            raise ValueError("Repository not found")

        # Same data + filters as the dashboard (filters affect metrics, not shown in PDF)
        kpi = self.get_kpi_with_duration(repo_id, days, author, state)
        monthly = self.get_monthly_flow_filtered(
            repo_id, months=6, days=days, author=author, state=state
        )
        throughput = self.get_throughput_filtered(
            repo_id, weeks=8, days=days, author=author, state=state
        )
        contributors = self.get_contributors_filtered(
            repo_id, limit=15, days=days, author=author, state=state
        )
        oldest = self.get_oldest_open_filtered(
            repo_id, limit=10, days=days, author=author, state=state
        )
        slowest = self.get_slowest_merged_filtered(
            repo_id, limit=10, days=days, author=author, state=state
        )
        stale = self.get_stale_recommendations(repo_id)
        risks = self.get_pr_risk_panel(repo_id, limit=15)

        pdf = FPDF()
        pdf.set_margins(12, 12, 12)
        pdf.set_auto_page_break(auto=True, margin=14)
        pdf.add_page()
        w = pdf.epw

        # --- Report header ---
        from fpdf.enums import XPos, YPos

        _pdf_reset_cursor(pdf)
        pdf.set_font("Helvetica", "B", 16)
        pdf.set_text_color(30, 41, 59)
        pdf.cell(
            w,
            10,
            "PR Intelligence Dashboard",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
        pdf.set_font("Helvetica", size=9)
        pdf.set_text_color(100, 116, 139)
        _pdf_paragraph(pdf, w, 5, "Analyze GitHub repository health and PR metrics")
        pdf.set_font("Helvetica", size=10)
        pdf.set_text_color(0, 0, 0)
        _pdf_paragraph(pdf, w, 5, f"Repository: {repo.owner}/{repo.name}")
        _pdf_paragraph(
            pdf,
            w,
            5,
            f"Report generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        )
        pdf.ln(4)

        # --- 1. KPI summary ---
        _pdf_section(pdf, "Key metrics")
        kpi_cards = [
            ("Open PRs", kpi.get("open_prs", 0), "currently open"),
            ("Stale Open (>30D)", kpi.get("stale_prs", 0), "need attention"),
            (
                "Avg Cycle Time",
                _pdf_duration_str(
                    kpi.get("avg_cycle_time_display"), kpi.get("avg_cycle_time", 0)
                ),
                "",
            ),
            (
                "Median Cycle Time",
                _pdf_duration_str(
                    kpi.get("median_cycle_time_display"), kpi.get("median_cycle_time", 0)
                ),
                "",
            ),
            (
                "Avg Wait for Review",
                _pdf_duration_str(
                    kpi.get("avg_wait_for_review_display"),
                    kpi.get("avg_wait_for_review", 0),
                ),
                "",
            ),
            (
                "Avg Review Duration",
                _pdf_duration_str(
                    kpi.get("avg_review_duration_display"),
                    kpi.get("avg_review_duration", 0),
                ),
                "",
            ),
            ("Merge Rate", kpi.get("merge_rate", 0), "%"),
            ("Avg Reviews / PR", kpi.get("avg_reviews_per_pr", 0), ""),
        ]
        _pdf_draw_table(
            pdf,
            ["Metric", "Value", "Unit / note"],
            [[t, v, u] for t, v, u in kpi_cards],
            col_widths=_pdf_normalize_widths(w, [0.42, 0.28, 0.30]),
        )

        # --- 2. Stale PR Alerts & Recommendations ---
        _pdf_stale_alerts_section(pdf, stale, w)

        # --- 3. PR Risk & Delay Predictions ---
        _pdf_section(pdf, "PR Risk & Delay Predictions")
        if not risks:
            _pdf_paragraph(pdf, w, 5, "No open PRs with ML predictions yet.")
        else:
            note = risks[0].get("_panel_note") or (
                "Rule-based risk estimates from PR age, reviews, and size."
                if risks[0].get("score_source") == "heuristic"
                else "ML-powered risk scores for open PRs."
            )
            pdf.set_font("Helvetica", size=7)
            _pdf_paragraph(pdf, w, 4, note)
            _pdf_draw_table(
                pdf,
                ["#", "Title", "Author", "Risk", "Bottleneck", "Est. delay", "Est. review wait"],
                [
                    [
                        r.get("number", ""),
                        r.get("title", ""),
                        r.get("author", ""),
                        f"{r.get('risk_score', 0)}%",
                        f"{r.get('bottleneck_probability', 0)}%",
                        _pdf_duration_str(
                            r.get("predicted_delay_display"),
                            r.get("predicted_delay_days") or 0,
                        )
                        if r.get("predicted_delay_days") is not None
                        or r.get("predicted_delay_display")
                        else "-",
                        (
                            f"{r.get('predicted_review_wait_hours')} hrs"
                            if r.get("predicted_review_wait_hours") is not None
                            else "-"
                        ),
                    ]
                    for r in risks
                ],
                col_widths=_pdf_normalize_widths(
                    w, [0.06, 0.28, 0.14, 0.09, 0.11, 0.14, 0.18]
                ),
                row_height=7,
            )

        # --- 4. Monthly PR Flow chart ---
        _pdf_section(
            pdf,
            "Monthly PR Flow",
            "Created, merged, and closed counts by month (when each event happened)",
        )
        flow_fig = _pdf_chart_monthly_flow(monthly)
        if flow_fig:
            _pdf_add_chart_image(pdf, flow_fig, max_height_mm=72)
        else:
            _pdf_paragraph(pdf, w, 5, "No PR activity in the selected period.")

        # --- 5. PR Throughput (Weekly) chart ---
        _pdf_section(
            pdf,
            "PR Throughput (Weekly)",
            "Merged PRs per week (ISO week, Mon-Sun)",
        )
        tp_fig = _pdf_chart_throughput(throughput)
        if tp_fig:
            _pdf_add_chart_image(pdf, tp_fig, max_height_mm=68)
        else:
            _pdf_paragraph(pdf, w, 5, "No merged PRs in the last 8 weeks.")

        # --- 6. Contributor Activity chart ---
        _pdf_section(
            pdf,
            "Contributor Activity",
            "Top contributors by PRs opened vs merged (from fetched pull requests)",
        )
        contrib_fig = _pdf_chart_contributors(contributors)
        if contrib_fig:
            _pdf_add_chart_image(pdf, contrib_fig, max_height_mm=155)
        else:
            _pdf_paragraph(pdf, w, 5, "No contributor data yet.")

        # --- 7. Review Turnaround chart ---
        _pdf_section(
            pdf,
            "Review Turnaround - Avg Wait for First Review",
            "Green <24h | Yellow 24-48h | Red >48h",
        )
        rt_fig = _pdf_chart_review_turnaround(contributors)
        if rt_fig:
            _pdf_add_chart_image(pdf, rt_fig, max_height_mm=155)

        # --- 8. Oldest Open PRs table ---
        _pdf_section(pdf, "Oldest Open PRs")
        if oldest:
            _pdf_draw_table(
                pdf,
                ["#", "Title", "Age (days)", "Author", "Created"],
                [
                    [
                        o.get("number", ""),
                        o.get("title", ""),
                        o.get("age_days", 0),
                        o.get("author", ""),
                        _pdf_short_date(o.get("created_at")),
                    ]
                    for o in oldest
                ],
                col_widths=_pdf_normalize_widths(w, [0.07, 0.40, 0.12, 0.18, 0.23]),
                row_height=7,
            )
        else:
            _pdf_paragraph(pdf, w, 5, "No open pull requests.")

        # --- 9. Slowest Merged PRs table ---
        _pdf_section(pdf, "Slowest Merged PRs")
        if slowest:
            _pdf_draw_table(
                pdf,
                ["#", "Title", "Cycle Time", "Author", "Merged"],
                [
                    [
                        s.get("number", ""),
                        s.get("title", ""),
                        _pdf_duration_str(
                            s.get("cycle_time_display"), s.get("cycle_time_days", 0)
                        ),
                        s.get("author", ""),
                        _pdf_short_date(s.get("merged_at")),
                    ]
                    for s in slowest
                ],
                col_widths=_pdf_normalize_widths(w, [0.07, 0.38, 0.15, 0.18, 0.22]),
                row_height=7,
            )
        else:
            _pdf_paragraph(pdf, w, 5, "No merged pull requests.")

        # --- 10. Contributor Activity table ---
        _pdf_section(pdf, "Contributor Activity (summary table)")
        if contributors:
            _pdf_draw_table(
                pdf,
                ["Username", "Total PRs", "Merged", "Avg Cycle Time", "Merge Rate (%)"],
                [
                    [
                        c.get("username", ""),
                        c.get("total_prs", 0),
                        c.get("merged_prs", 0),
                        _pdf_duration_str(
                            c.get("avg_cycle_time_display"), c.get("avg_cycle_time", 0)
                        ),
                        c.get("merge_rate", 0),
                    ]
                    for c in contributors
                ],
                col_widths=_pdf_normalize_widths(w, [0.22, 0.14, 0.12, 0.28, 0.24]),
                row_height=7,
            )
        else:
            _pdf_paragraph(pdf, w, 5, "No contributor data.")

        out = pdf.output()
        return bytes(out) if isinstance(out, (bytes, bytearray)) else str(out).encode("latin-1")
