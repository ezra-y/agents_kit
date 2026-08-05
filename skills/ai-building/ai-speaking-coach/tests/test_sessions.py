from __future__ import annotations

from pathlib import Path

from ai_speaking_coach.corpus import import_content_items
from ai_speaking_coach.db import apply_migrations, connect
from ai_speaking_coach.models import (
    ContentItem,
    ErrorObservation,
    SessionItemResult,
    SessionRecord,
    SourceRef,
)
from ai_speaking_coach.sessions import record_session


def test_record_session_is_idempotent(isolated_root: Path) -> None:
    apply_migrations()
    import_content_items(
        [
            ContentItem(
                id="common500-s0001",
                type="expression",
                text="What's up?",
                source_ref=SourceRef(file="test", order=1),
            )
        ]
    )
    record = SessionRecord(
        id="2026-08-05-01",
        started_at="2026-08-05T19:30:00+08:00",
        ended_at="2026-08-05T20:00:00+08:00",
        topic="meeting a friend",
        items=[
            SessionItemResult(
                item_id="common500-s0001",
                activity="new",
                grade="easy",
                status_after="fluent",
                studied_at="2026-08-05T19:35:00+08:00",
            )
        ],
        errors=[
            ErrorObservation(
                id="err-1",
                item_id="common500-s0001",
                occurred_at="2026-08-05T19:36:00+08:00",
                user_said="I very like it.",
                natural_version="I really like it.",
                error_type="chinglish",
                next_due_at="2026-08-06T19:36:00+08:00",
            )
        ],
    )
    assert record_session(record) is True
    assert record_session(record) is False
    with connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM session_items").fetchone()[0] == 1
        assert connection.execute("SELECT review_count FROM review_state").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM errors").fetchone()[0] == 1

