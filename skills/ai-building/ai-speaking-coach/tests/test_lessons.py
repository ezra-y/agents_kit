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
        focus_targets=["target-1"],
    )

    destination = finalize_lesson(spec)

    assert destination == isolated_root / "runtime" / "lessons" / "2026-08-06.md"
    text = destination.read_text(encoding="utf-8")
    assert "Status: finalized" in text
    assert "`target-1` Would you like to join me?" in text
    assert "Example: Would you like to join me for coffee?" in text


def test_finalize_lesson_rejects_unknown_item(isolated_root: Path) -> None:
    spec = FinalLessonSpec(
        date="2026-08-06",
        topic="test",
        communication_goal="Test an item.",
        scene="A short test scene.",
        focus_targets=["missing"],
    )

    with pytest.raises(ValueError, match="Unknown or unapproved"):
        finalize_lesson(spec)
