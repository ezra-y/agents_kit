from __future__ import annotations

from pathlib import Path

from ai_speaking_coach.corpus import import_content_items, write_jsonl
from ai_speaking_coach.course_search import search_course_content
from ai_speaking_coach.embeddings import HashEmbeddingProvider
from ai_speaking_coach.lessons import FinalLessonSpec, finalize_lesson, prepare_lesson
from ai_speaking_coach.models import (
    ContentItem,
    ErrorObservation,
    SessionItemResult,
    SessionRecord,
    SourceRef,
)
from ai_speaking_coach.retrieval import LanceDBRetrievalIndex
from ai_speaking_coach.sessions import record_session


def test_prepare_teach_record_and_retrieve_cycle(isolated_root: Path) -> None:
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
            id="reply",
            type="expression",
            text="I'd love to.",
            meaning="我很愿意。",
            topics=["friends"],
            source_ref=SourceRef(file="test", order=2),
        ),
    ]
    write_jsonl(items)
    import_content_items(items)
    provider = HashEmbeddingProvider()
    LanceDBRetrievalIndex(provider, isolated_root / "runtime" / "lancedb").rebuild(items)

    preparation = prepare_lesson(
        provider=provider,
        date="2026-08-06",
        topic="inviting a friend",
        force=True,
    )
    assert preparation.destination.parent.name == "preparation"

    lesson = finalize_lesson(
        FinalLessonSpec(
            date="2026-08-06",
            topic="inviting a friend",
            communication_goal="Invite someone and respond naturally.",
            scene="Two classmates make a plan after class.",
            target_task="Make one plan and agree on the details.",
            current_bottleneck="Invitations need a grammar repair.",
            success_evidence=["Complete the invitation without a prompt."],
            input_task="Understand whether the friend accepts or declines.",
            transfer_task="Invite the friend to a different activity.",
            focus_targets=["invite"],
            quick_checks=["reply"],
        )
    )
    assert "Status: finalized" in lesson.read_text(encoding="utf-8")

    recorded = record_session(
        SessionRecord(
            id="session-e2e",
            started_at="2026-08-06T19:30:00+08:00",
            ended_at="2026-08-06T20:00:00+08:00",
            topic="inviting a friend",
            lesson_path=str(lesson),
            items=[
                SessionItemResult(
                    item_id="invite",
                    activity="new",
                    grade="hard",
                    status_after="learning",
                    correction_count=1,
                    studied_at="2026-08-06T19:42:00+08:00",
                )
            ],
            errors=[
                ErrorObservation(
                    id="error-e2e",
                    item_id="invite",
                    occurred_at="2026-08-06T19:40:00+08:00",
                    user_said="Do you want join me?",
                    natural_version="Would you like to join me?",
                    error_type="grammar",
                    next_due_at="2026-08-07T19:40:00+08:00",
                )
            ],
        )
    )
    assert recorded is True

    response = search_course_content(
        "join me",
        provider=None,
        mode="fts",
        limit=2,
    )
    result = next(item for item in response["results"] if item["id"] == "invite")
    assert result["learning_status"] == "learning"
    assert result["review"]["next_due_at"]
    assert result["unresolved_errors"][0]["id"] == "error-e2e"
