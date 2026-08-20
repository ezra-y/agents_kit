from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

DEFAULTS = {
    "target_retention": 0.85,
    "version": "exponential-stability-v1",
    "initial_intervals_hours": {"forgot": 8, "hard": 24, "good": 72, "easy": 168},
    "growth_factors": {"forgot": 0.35, "hard": 1.25, "good": 2.0, "easy": 3.0},
}


def _parse(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _stability(days: float, retention: float) -> float:
    return days / -math.log(retention)


def _interval(stability: float, retention: float) -> float:
    return -stability * math.log(retention)


def _status(grade: str, previous: str | None, requested: str | None) -> str:
    if requested:
        return requested
    if grade in {"forgot", "hard"}:
        return "learning"
    if grade == "easy":
        return "fluent"
    return "fluent" if previous == "fluent" else "usable"


def update_item(previous: dict[str, Any] | None, reviewed_at: str, grade: str, requested_status: str | None = None) -> dict[str, Any]:
    cfg = DEFAULTS
    now = _parse(reviewed_at)
    target = float(cfg["target_retention"])
    if previous is None:
        hours = float(cfg["initial_intervals_hours"][grade])
        days = hours / 24
        return {
            "status": _status(grade, None, requested_status),
            "first_learned_at": reviewed_at,
            "last_reviewed_at": reviewed_at,
            "stability": _stability(days, target),
            "target_retention": target,
            "next_review_at": _iso(now + timedelta(days=days)),
            "review_count": 1,
            "lapse_count": int(grade == "forgot"),
            "scheduler_version": cfg["version"],
        }
    last = _parse(previous["last_reviewed_at"])
    if now < last:
        raise ValueError("Review timestamp cannot be before previous review")
    old_interval = _interval(float(previous["stability"]), float(previous["target_retention"]))
    elapsed = max((now - last).total_seconds() / 86400, 1 / 1440)
    if grade == "forgot":
        new_interval = max(8 / 24, old_interval * float(cfg["growth_factors"][grade]))
    else:
        ratio = min(1.5, max(0.75, elapsed / old_interval))
        new_interval = old_interval * float(cfg["growth_factors"][grade]) * ratio
    return {
        "status": _status(grade, previous.get("status"), requested_status),
        "first_learned_at": previous["first_learned_at"],
        "last_reviewed_at": reviewed_at,
        "stability": _stability(new_interval, target),
        "target_retention": target,
        "next_review_at": _iso(now + timedelta(days=new_interval)),
        "review_count": int(previous.get("review_count", 0)) + 1,
        "lapse_count": int(previous.get("lapse_count", 0)) + int(grade == "forgot"),
        "scheduler_version": cfg["version"],
    }


def apply_review(item_state: dict[str, Any], review_id: str, reviewed_at: str, updates: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    adjusted: list[dict[str, Any]] = []
    for update in updates:
        item_id = update["item_id"]
        previous = item_state.get(item_id)
        if previous and previous.get("last_review_id") == review_id:
            schedule = previous
        else:
            schedule = update_item(previous, reviewed_at, update["grade"], update.get("status_after"))
            schedule["last_review_id"] = review_id
            schedule["last_reason"] = update.get("reason", "")
            schedule["last_observations"] = update.get("observations", [])
            item_state[item_id] = schedule
        updated = dict(update)
        updated["status_after"] = schedule["status"]
        updated["next_review_at"] = schedule["next_review_at"]
        adjusted.append(updated)
    return item_state, adjusted
