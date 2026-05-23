import csv
import io
from datetime import datetime, timezone,timedelta
from typing import Any, Dict, List, Optional
from sqlalchemy import func, case, and_, or_
from sqlalchemy.orm import Session

from database.models import MLPrediction, PullRequest, Repository
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
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> PRFilterParams:
    return PRFilterParams(days=days, author=author, state=state, start_date=start_date, end_date=end_date)


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
        stale_cutoff = datetime.utcnow() - timedelta(days=30)
        stale_count = self.db.query(func.count(subq.c.id)).filter(subq.c.state == "OPEN", subq.c.created_at < stale_cutoff).scalar() or 0
        merged_count = self.db.query(func.count(subq.c.id)).filter(subq.c.state == "MERGED").scalar() or 0
        closed_count = self.db.query(func.count(subq.c.id)).filter(subq.c.state.in_(["MERGED", "CLOSED"])).scalar() or 0

        # 2. averages
        avg_cycle_days = float(self.db.query(func.avg(subq.c.cycle_time_days)).filter(subq.c.state == "MERGED").scalar() or 0.0)
        avg_cycle = avg_cycle_days * 24

        # For median cycle time:
        cycle_times = [float(r[0]) for r in self.db.query(subq.c.cycle_time_days).filter(subq.c.state == "MERGED", subq.c.cycle_time_days.isnot(None)).order_by(subq.c.cycle_time_days).all()]
        if cycle_times:
            n = len(cycle_times)
            median_cycle = (cycle_times[n // 2] if n % 2 == 1 else (cycle_times[n // 2 - 1] + cycle_times[n // 2]) / 2) * 24
        else:
            median_cycle = 0.0

        avg_wait = float(self.db.query(func.avg(subq.c.wait_for_review_hours)).filter(subq.c.wait_for_review_hours.isnot(None), subq.c.wait_for_review_hours >= 0).scalar() or 0.0)
        avg_review = float(self.db.query(func.avg(subq.c.review_duration_hours)).filter(subq.c.review_duration_hours.isnot(None), subq.c.review_duration_hours >= 0).scalar() or 0.0)

        merge_rate = round((merged_count / closed_count * 100) if closed_count else 0, 2)
        avg_reviews = float(self.db.query(func.avg(subq.c.review_count)).scalar() or 0.0)

        return {
            "total_prs": total_count,
            "open_prs": open_count,
            "stale_prs": stale_count,
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
        query = get_filtered_prs_query(self.db, repo_id, filters)
        month_keys = _month_range(months)
        flow = {
            ym: {"month": _format_month_label(ym), "created": 0, "merged": 0, "closed": 0}
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
        
        # define stale cutoff
        stale_cutoff = datetime.utcnow() - timedelta(days=30)

        # We start from the filtered query:
        query = get_filtered_prs_query(self.db, repo_id, filters)
        subq = query.subquery()

        # Now group by subq.c.author and aggregate:
        agg_query = self.db.query(
            subq.c.author.label("author"),
            func.count(subq.c.id).label("total_prs"),
            func.sum(case((subq.c.state == "MERGED", 1), else_=0)).label("merged_prs"),
            func.sum(case((subq.c.state == "OPEN", 1), else_=0)).label("open_prs"),
            func.sum(case((and_(subq.c.state == "OPEN", subq.c.created_at < stale_cutoff), 1), else_=0)).label("stale_prs"),
            func.avg(case((subq.c.state == "MERGED", subq.c.cycle_time_days), else_=None)).label("avg_cycle"),
            func.avg(subq.c.wait_for_review_hours).label("avg_wait")
        ).filter(subq.c.author.isnot(None)).group_by(subq.c.author)
        
        # Get total number of contributors
        total_contributors = agg_query.count()
        
        # Sort and paginate
        agg_query = agg_query.order_by(func.count(subq.c.id).desc())
        offset = (page - 1) * limit
        results = agg_query.offset(offset).limit(limit).all()
        
        formatted_results = []
        for r in results:
            author = r.author
            total_prs = r.total_prs
            merged_prs = int(r.merged_prs or 0)
            open_prs = int(r.open_prs or 0)
            stale_pr_count = int(r.stale_prs or 0)
            
            avg_cycle_days = float(r.avg_cycle or 0.0)
            avg_cycle_h = avg_cycle_days * 24
            
            avg_wait_h = float(r.avg_wait or 0.0)
            
            formatted_results.append({
                "username": author,
                "total_prs": total_prs,
                "merged_prs": merged_prs,
                "open_prs": open_prs,
                "avg_cycle_time": round(avg_cycle_days, 2),
                "avg_cycle_time_display": format_duration(avg_cycle_h),
                "avg_wait_for_review": round(avg_wait_h / 24, 2) if avg_wait_h else 0,
                "merge_rate": round((merged_prs / total_prs * 100) if total_prs else 0, 2),
                "stale_pr_count": stale_pr_count,
            })
            
        return {
            "data": formatted_results,
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
                "cycle_time_days": round(pr.cycle_time_days, 2) if pr.cycle_time_days is not None else 0,
                "cycle_time_display": format_duration(pr.cycle_time_days * 24) if pr.cycle_time_days is not None else {"value": 0, "unit": "hrs", "raw_hours": 0.0},
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
        now = ensure_utc(datetime.utcnow())
        cutoff_14 = datetime.utcnow() - timedelta(days=14)
        
        query = self.db.query(PullRequest).filter(
            PullRequest.repo_id == repo_id,
            PullRequest.state == "OPEN"
        ).filter(
            or_(
                PullRequest.created_at < cutoff_14,
                PullRequest.review_count == 0,
                PullRequest.files_changed > 20,
                and_(PullRequest.comment_count > 10, PullRequest.review_count < 2)
            )
        )
        
        prs = query.all()
        alerts = []
        for pr in prs:
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
        
        offset = (page - 1) * limit
        paginated_alerts = alerts[offset:offset+limit]
        
        return {
            "data": paginated_alerts,
            "total": len(alerts),
            "page": page,
            "limit": limit,
            "pages": (len(alerts) + limit - 1) // limit if limit else 1
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

    def build_export_pdf(
        self,
        repo_id: int,
        days: Optional[int] = None,
        author: Optional[str] = None,
        state: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
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
        kpi = self.get_kpi_with_duration(repo_id, days, author, state, start_date, end_date)
        monthly = self.get_monthly_flow_filtered(
            repo_id, months=6, days=days, author=author, state=state, start_date=start_date, end_date=end_date
        )
        throughput = self.get_throughput_filtered(
            repo_id, weeks=8, days=days, author=author, state=state, start_date=start_date, end_date=end_date
        )
        contributors = self.get_contributors_filtered(
            repo_id, limit=15, days=days, author=author, state=state, start_date=start_date, end_date=end_date
        )["data"]
        oldest = self.get_oldest_open_filtered(
            repo_id, limit=10, days=days, author=author, state=state, start_date=start_date, end_date=end_date
        )["data"]
        slowest = self.get_slowest_merged_filtered(
            repo_id, limit=10, days=days, author=author, state=state, start_date=start_date, end_date=end_date
        )["data"]
        stale = self.get_stale_recommendations(repo_id)["data"]
        risks = self.get_pr_risk_panel(repo_id, limit=15)["data"]

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
