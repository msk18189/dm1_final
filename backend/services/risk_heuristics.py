"""Rule-based risk scores when ML models are not trained yet."""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from database.models import PullRequest
from services.filters import ensure_utc, format_duration


def compute_heuristic_scores(pr: PullRequest, now: Optional[datetime] = None) -> Dict[str, Any]:
    """
    Estimate risk, bottleneck, delay, and review wait from PR attributes.
    Uses the same signals as stale PR alerts so both panels stay consistent.
    """
    now = now or ensure_utc(datetime.utcnow())
    age_days = 0
    if pr.created_at:
        age_days = (now - ensure_utc(pr.created_at)).days

    risk = 0.0
    bottleneck = 0.0
    delay_days = max(1.0, age_days * 0.3)
    review_wait = float(pr.wait_for_review_hours or 0)

    if age_days >= 30:
        risk += 35
        bottleneck += 40
    elif age_days >= 14:
        risk += 22
        bottleneck += 28
    elif age_days >= 7:
        risk += 12
        bottleneck += 15

    if (pr.review_count or 0) == 0:
        risk += 30
        bottleneck += 35
        if review_wait <= 0:
            review_wait = max(24.0, age_days * 24.0)

    files = pr.files_changed or 0
    if files > 20:
        risk += 18
        bottleneck += 12
        delay_days += min(files * 0.15, 10)

    if (pr.comment_count or 0) > 10 and (pr.review_count or 0) < 2:
        risk += 15
        bottleneck += 18

    lines = (pr.lines_added or 0) + (pr.lines_deleted or 0)
    if lines > 500:
        risk += 10
        delay_days += 2

    if (pr.commit_count or 0) > 15:
        risk += 5
        bottleneck += 5

    risk = min(100.0, risk)
    bottleneck = min(100.0, bottleneck)
    delay_days = round(min(max(delay_days, 0.5), 60.0), 1)
    review_wait = round(min(max(review_wait, 1.0), 720.0), 1)

    return {
        "risk_score": risk,
        "bottleneck_probability": bottleneck,
        "predicted_delay_days": delay_days,
        "predicted_review_wait_hours": review_wait,
        "predicted_delay_display": format_duration(delay_days * 24),
        "source": "heuristic",
    }


def ml_scores_valid(pred) -> bool:
    """True if stored ML prediction has any non-zero signal."""
    if not pred:
        return False
    return bool(
        (pred.risk_score and pred.risk_score > 0.01)
        or (pred.bottleneck_probability and pred.bottleneck_probability > 0.01)
        or (pred.predicted_delay_days and pred.predicted_delay_days > 0.01)
        or (pred.predicted_review_wait and pred.predicted_review_wait > 0.01)
    )


def scores_for_open_pr(pr: PullRequest, pred, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Prefer ML scores when trained; otherwise use heuristics."""
    now = now or ensure_utc(datetime.utcnow())

    if ml_scores_valid(pred):
        risk_pct = round((pred.risk_score or 0) * 100, 1)
        bottleneck_pct = round((pred.bottleneck_probability or 0) * 100, 1)
        delay_days = pred.predicted_delay_days or 0
        return {
            "risk_score": risk_pct,
            "bottleneck_probability": bottleneck_pct,
            "predicted_delay_days": round(delay_days, 1) if delay_days else None,
            "predicted_delay_display": format_duration((delay_days or 0) * 24),
            "predicted_review_wait_hours": round(pred.predicted_review_wait, 1)
            if pred.predicted_review_wait
            else None,
            "source": "ml",
        }

    return compute_heuristic_scores(pr, now)
