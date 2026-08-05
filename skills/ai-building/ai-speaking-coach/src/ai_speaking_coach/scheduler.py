from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from .models import Grade, LearningStatus
from .paths import load_settings
from .time_utils import isoformat, parse_timestamp


@dataclass(frozen=True)
class ReviewState:
    status: LearningStatus
    first_learned_at: str
    last_reviewed_at: str
    stability: float
    target_retention: float
    next_due_at: str
    review_count: int
    lapse_count: int
    scheduler_version: str


def interval_days(stability: float, target_retention: float) -> float:
    return -stability * math.log(target_retention)


def stability_for_interval(days: float, target_retention: float) -> float:
    if days <= 0:
        raise ValueError("Interval must be positive")
    return days / -math.log(target_retention)


def initial_state(
    reviewed_at: str,
    grade: Grade,
    requested_status: LearningStatus | None = None,
    settings: dict[str, Any] | None = None,
) -> ReviewState:
    config = settings or load_settings()
    scheduler = config["scheduler"]
    target = float(config["target_retention"])
    hours = float(scheduler["initial_intervals_hours"][grade])
    interval = hours / 24
    reviewed = parse_timestamp(reviewed_at)
    status = requested_status or _status_for_grade(grade, None)
    return ReviewState(
        status=status,
        first_learned_at=reviewed_at,
        last_reviewed_at=reviewed_at,
        stability=stability_for_interval(interval, target),
        target_retention=target,
        next_due_at=isoformat(reviewed + timedelta(days=interval)),
        review_count=1,
        lapse_count=int(grade == "forgot"),
        scheduler_version=scheduler["version"],
    )


def update_state(
    previous: ReviewState,
    reviewed_at: str,
    grade: Grade,
    requested_status: LearningStatus | None = None,
    settings: dict[str, Any] | None = None,
) -> ReviewState:
    config = settings or load_settings()
    scheduler = config["scheduler"]
    reviewed = parse_timestamp(reviewed_at)
    last_reviewed = parse_timestamp(previous.last_reviewed_at)
    if reviewed < last_reviewed:
        raise ValueError("Review timestamp cannot be before the previous review")

    old_interval = interval_days(previous.stability, previous.target_retention)
    actual_elapsed = max((reviewed - last_reviewed).total_seconds() / 86400, 1 / 1440)
    if grade == "forgot":
        new_interval = max(8 / 24, old_interval * float(scheduler["growth_factors"][grade]))
    else:
        elapsed_ratio = min(1.5, max(0.75, actual_elapsed / old_interval))
        new_interval = (
            old_interval * float(scheduler["growth_factors"][grade]) * elapsed_ratio
        )

    status = requested_status or _status_for_grade(grade, previous.status)
    return ReviewState(
        status=status,
        first_learned_at=previous.first_learned_at,
        last_reviewed_at=reviewed_at,
        stability=stability_for_interval(new_interval, previous.target_retention),
        target_retention=previous.target_retention,
        next_due_at=isoformat(reviewed + timedelta(days=new_interval)),
        review_count=previous.review_count + 1,
        lapse_count=previous.lapse_count + int(grade == "forgot"),
        scheduler_version=scheduler["version"],
    )


def state_from_row(row: Any) -> ReviewState:
    return ReviewState(
        status=row["status"],
        first_learned_at=row["first_learned_at"],
        last_reviewed_at=row["last_reviewed_at"],
        stability=row["stability"],
        target_retention=row["target_retention"],
        next_due_at=row["next_due_at"],
        review_count=row["review_count"],
        lapse_count=row["lapse_count"],
        scheduler_version=row["scheduler_version"],
    )


def _status_for_grade(
    grade: Grade, previous_status: LearningStatus | None
) -> LearningStatus:
    if grade in {"forgot", "hard"}:
        return "learning"
    if grade == "easy":
        return "fluent"
    if previous_status == "fluent":
        return "fluent"
    return "usable"


def upsert_review_state(
    connection: Any,
    item_id: str,
    reviewed_at: str,
    grade: Grade,
    requested_status: LearningStatus | None = None,
) -> ReviewState:
    row = connection.execute(
        "SELECT * FROM review_state WHERE item_id = ?", (item_id,)
    ).fetchone()
    state = (
        update_state(state_from_row(row), reviewed_at, grade, requested_status)
        if row
        else initial_state(reviewed_at, grade, requested_status)
    )
    connection.execute(
        """
        INSERT INTO review_state(
            item_id, status, first_learned_at, last_reviewed_at, stability,
            target_retention, next_due_at, review_count, lapse_count, scheduler_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
            status = excluded.status,
            first_learned_at = excluded.first_learned_at,
            last_reviewed_at = excluded.last_reviewed_at,
            stability = excluded.stability,
            target_retention = excluded.target_retention,
            next_due_at = excluded.next_due_at,
            review_count = excluded.review_count,
            lapse_count = excluded.lapse_count,
            scheduler_version = excluded.scheduler_version
        """,
        (
            item_id,
            state.status,
            state.first_learned_at,
            state.last_reviewed_at,
            state.stability,
            state.target_retention,
            state.next_due_at,
            state.review_count,
            state.lapse_count,
            state.scheduler_version,
        ),
    )
    return state


def rebuild_review_state(connection: Any) -> None:
    connection.execute("DELETE FROM review_state")
    rows = connection.execute(
        """
        SELECT item_id, studied_at, grade, status_after
        FROM session_items
        ORDER BY studied_at, session_id, item_id
        """
    ).fetchall()
    for row in rows:
        upsert_review_state(
            connection,
            row["item_id"],
            row["studied_at"],
            row["grade"],
            row["status_after"],
        )

