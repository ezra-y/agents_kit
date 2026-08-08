from __future__ import annotations

from pathlib import Path

import pytest

from ai_speaking_coach.corpus import import_content_items
from ai_speaking_coach.lessons import FinalLessonSpec, finalize_lesson
from ai_speaking_coach.models import ContentItem, SourceRef


def test_finalize_lesson_validates_ids_and_writes_final_file(isolated_root: Path) -> None:
    import_content_items(
        [
            ContentItem(
                id="target-1",
                type="expression",
                text="Would you like to join me?",
                meaning="你愿意和我一起吗？",
                topics=["friends"],
                examples=["Would you like to join me for coffee?"],
                source_ref=SourceRef(file="test", order=1),
            )
        ]
    )
    spec = FinalLessonSpec(
        date="2026-08-06",
        topic="making plans",
        communication_goal="Invite a new friend to do something together.",
        scene="Two classmates finish class and discuss the weekend.",
        target_task="Agree on one activity and settle the time.",
        current_bottleneck="Follow-up questions are delayed.",
        success_evidence=[
            "Reach an agreement without a model-provided sentence.",
            "Ask one relevant follow-up in time.",
        ],
        input_task="Understand the friend's availability.",
        transfer_task="Repeat with one scheduling conflict.",
        focus_targets=["target-1"],
    )

    destination = finalize_lesson(spec)

    assert destination == isolated_root / "runtime" / "lessons" / "2026-08-06.md"
    text = destination.read_text(encoding="utf-8")
    assert "Status: finalized" in text
    assert "Target task: Agree on one activity and settle the time." in text
    assert "Current bottleneck: Follow-up questions are delayed." in text
    assert "Reach an agreement without a model-provided sentence." in text
    assert "Listening demand: Understand the friend's availability." in text
    assert "Transfer task: Repeat with one scheduling conflict." in text
    assert "`target-1` Would you like to join me?" in text
    assert "Example: Would you like to join me for coffee?" in text


def test_finalize_lesson_rejects_unknown_item(isolated_root: Path) -> None:
    spec = FinalLessonSpec(
        date="2026-08-06",
        topic="test",
        communication_goal="Test an item.",
        scene="A short test scene.",
        target_task="Use the item in a short exchange.",
        current_bottleneck="The item has not been checked.",
        success_evidence=["Use the item independently."],
        input_task="Understand one short prompt.",
        transfer_task="Use the item with a different partner.",
        focus_targets=["missing"],
    )

    with pytest.raises(ValueError, match="Unknown or unapproved"):
        finalize_lesson(spec)


def test_final_lesson_requires_task_evidence() -> None:
    with pytest.raises(ValueError, match="target_task"):
        FinalLessonSpec.model_validate(
            {
                "date": "2026-08-06",
                "topic": "test",
                "communication_goal": "Test an item.",
                "scene": "A short test scene.",
            }
        )
