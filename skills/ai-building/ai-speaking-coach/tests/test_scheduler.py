from __future__ import annotations

from datetime import UTC, datetime, timedelta

from ai_speaking_coach.scheduler import initial_state, interval_days, update_state

BASE = datetime(2026, 8, 5, 12, tzinfo=UTC)


def stamp(hours: float = 0) -> str:
    return (BASE + timedelta(hours=hours)).isoformat(timespec="seconds")


def test_initial_grade_order() -> None:
    states = {
        grade: initial_state(stamp(), grade)
        for grade in ("forgot", "hard", "good", "easy")
    }
    intervals = {
        grade: interval_days(state.stability, state.target_retention)
        for grade, state in states.items()
    }
    assert intervals["forgot"] < intervals["hard"] < intervals["good"] < intervals["easy"]


def test_review_updates_status_and_lapses() -> None:
    previous = initial_state(stamp(), "good")
    forgotten = update_state(previous, stamp(72), "forgot")
    assert forgotten.status == "learning"
    assert forgotten.lapse_count == 1
    assert forgotten.review_count == 2


def test_late_success_grows_more_than_early_success() -> None:
    previous = initial_state(stamp(), "good")
    early = update_state(previous, stamp(24), "good")
    late = update_state(previous, stamp(120), "good")
    assert late.stability > early.stability

