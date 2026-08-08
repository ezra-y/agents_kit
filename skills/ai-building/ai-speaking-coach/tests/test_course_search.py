from __future__ import annotations

from pathlib import Path

from ai_speaking_coach.corpus import import_content_items
from ai_speaking_coach.course_search import search_course_content
from ai_speaking_coach.db import transaction
from ai_speaking_coach.embeddings import HashEmbeddingProvider
from ai_speaking_coach.models import ContentItem, SourceRef
from ai_speaking_coach.retrieval import LanceDBRetrievalIndex


def test_search_includes_learning_state_and_errors(isolated_root: Path) -> None:
    items = [
        ContentItem(
            id="invite",
            type="expression",
            text="Would you like to join me?",
            meaning="你愿意和我一起吗？",
            topics=["friends"],
            source_ref=SourceRef(file="test", order=1),
        ),
        ContentItem(
            id="weather",
            type="expression",
            text="It looks like rain.",
            meaning="看起来要下雨。",
            topics=["daily_life"],
            source_ref=SourceRef(file="test", order=2),
        ),
    ]
    import_content_items(items)
    provider = HashEmbeddingProvider()
    LanceDBRetrievalIndex(
        provider,
        isolated_root / "private" / "cache" / "lancedb",
    ).rebuild(items)

    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO sessions(id, started_at, ended_at, topic)
            VALUES ('session-1', '2026-08-01T10:00:00+08:00',
                    '2026-08-01T10:30:00+08:00', 'friends')
            """
        )
        connection.execute(
            """
            INSERT INTO review_state(
                item_id, status, first_learned_at, last_reviewed_at, stability,
                target_retention, next_due_at, review_count, lapse_count, scheduler_version
            ) VALUES (
                'invite', 'learning', '2026-08-01T10:00:00+08:00',
                '2026-08-01T10:00:00+08:00', 1.0, 0.85,
                '2026-08-02T10:00:00+08:00', 1, 0, 'test'
            )
            """
        )
        connection.execute(
            """
            INSERT INTO errors(
                id, session_id, item_id, occurred_at, user_said, natural_version,
                error_type, note, next_due_at
            ) VALUES (
                'error-1', 'session-1', 'invite', '2026-08-01T10:05:00+08:00',
                'Do you want join me?', 'Would you like to join me?',
                'grammar', '', '2026-08-02T10:00:00+08:00'
            )
            """
        )

    response = search_course_content(
        "join me",
        provider=provider,
        mode="fts",
        limit=2,
    )

    result = next(item for item in response["results"] if item["id"] == "invite")
    assert result["learning_status"] == "learning"
    assert result["review"]["next_due_at"] == "2026-08-02T10:00:00+08:00"
    assert result["unresolved_errors"][0]["natural_version"] == "Would you like to join me?"


def test_search_rejects_empty_query(isolated_root: Path) -> None:
    try:
        search_course_content("", provider=None, mode="fts")
    except ValueError as error:
        assert str(error) == "query must not be empty"
    else:
        raise AssertionError("empty query should fail")
