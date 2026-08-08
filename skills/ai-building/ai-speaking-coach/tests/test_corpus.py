from __future__ import annotations

from pathlib import Path

from ai_speaking_coach.corpus import (
    read_jsonl,
    validate_items,
    write_jsonl,
)
from ai_speaking_coach.models import ContentItem, SourceRef


def item(item_id: str, order: int, text: str = "Could you say that again?") -> ContentItem:
    return ContentItem(
        id=item_id,
        type="expression",
        text=text,
        source_ref=SourceRef(file="test-source", order=order),
    )


def test_jsonl_round_trip(tmp_path: Path) -> None:
    destination = tmp_path / "items.jsonl"
    expected = [item("repair-request", 1)]

    write_jsonl(expected, destination)

    assert read_jsonl(destination) == expected
    assert validate_items(expected) == []


def test_validation_rejects_duplicate_ids_and_sources() -> None:
    duplicate_id = item("same-id", 1)
    duplicate_source = item("same-id", 2)
    same_position = item("different-id", 1)

    errors = validate_items([duplicate_id, duplicate_source, same_position])

    assert "Duplicate content IDs found" in errors
    assert "Duplicate source positions found" in errors


def test_validation_rejects_chinese_in_teaching_text() -> None:
    errors = validate_items([item("mixed-text", 1, "Please 再说一次.")])

    assert errors == ["mixed-text: Chinese characters found in teaching text"]
