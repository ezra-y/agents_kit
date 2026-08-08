from __future__ import annotations

import zipfile
from pathlib import Path

from ai_speaking_coach.corpus import import_content_items
from ai_speaking_coach.db import apply_migrations, connect
from ai_speaking_coach.exporter import export_bundle
from ai_speaking_coach.models import ContentItem, SessionItemResult, SessionRecord, SourceRef
from ai_speaking_coach.sessions import record_session


def test_personal_export_contains_state_and_excludes_rebuildable_cache(
    isolated_root: Path,
) -> None:
    apply_migrations()
    import_content_items(
        [
            ContentItem(
                id="item-1",
                type="expression",
                text="I see.",
                meaning="我明白。",
                source_ref=SourceRef(file="test", order=1),
            )
        ]
    )
    record_session(
        SessionRecord(
            id="session-export",
            started_at="2026-08-06T19:30:00+08:00",
            ended_at="2026-08-06T20:00:00+08:00",
            topic="test",
            items=[
                SessionItemResult(
                    item_id="item-1",
                    activity="new",
                    grade="good",
                    status_after="usable",
                    studied_at="2026-08-06T19:40:00+08:00",
                )
            ],
        )
    )
    (isolated_root / "SKILL.md").write_text("---\nname: test\n---\n", encoding="utf-8")
    knowledge = (
        isolated_root / "private" / "learner" / "knowledge" / "items.jsonl"
    )
    knowledge.write_text("{}\n", encoding="utf-8")
    lesson = (
        isolated_root
        / "private"
        / "learner"
        / "records"
        / "lessons"
        / "lesson.md"
    )
    lesson.write_text("lesson\n", encoding="utf-8")
    (isolated_root / "private" / "cache" / "models" / "weights.bin").write_bytes(b"model")
    (isolated_root / "private" / "cache" / "lancedb" / "index.bin").write_bytes(b"index")

    bundle = export_bundle()

    with zipfile.ZipFile(bundle) as archive:
        names = set(archive.namelist())
        restored = Path(
            archive.extract(
                "ai-speaking-coach/private/learner/state/coach.sqlite",
                isolated_root / "restored",
            )
        )
    assert "ai-speaking-coach/SKILL.md" in names
    assert "ai-speaking-coach/private/learner/knowledge/items.jsonl" in names
    assert "ai-speaking-coach/private/learner/state/coach.sqlite" in names
    assert "ai-speaking-coach/private/learner/records/lessons/lesson.md" in names
    assert "ai-speaking-coach/private/cache/models/weights.bin" not in names
    assert "ai-speaking-coach/private/cache/lancedb/index.bin" not in names
    with connect(restored) as connection:
        assert connection.execute("SELECT COUNT(*) FROM session_items").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM review_state").fetchone()[0] == 1


def test_personal_export_can_include_model_and_index(isolated_root: Path) -> None:
    apply_migrations()
    (isolated_root / "private" / "cache" / "models" / "weights.bin").write_bytes(b"model")
    (isolated_root / "private" / "cache" / "lancedb" / "index.bin").write_bytes(b"index")

    bundle = export_bundle(include_index=True, include_model=True)

    with zipfile.ZipFile(bundle) as archive:
        names = set(archive.namelist())
    assert "ai-speaking-coach/private/cache/models/weights.bin" in names
    assert "ai-speaking-coach/private/cache/lancedb/index.bin" in names


def test_public_export_keeps_only_sanitized_private_skeleton(isolated_root: Path) -> None:
    apply_migrations()
    (isolated_root / "SKILL.md").write_text("---\nname: test\n---\n", encoding="utf-8")
    learner = isolated_root / "private" / "learner"
    (learner / "course.example.md").write_text("# Example\n", encoding="utf-8")
    (learner / "course.md").write_text("# Real learner\n", encoding="utf-8")
    (learner / "knowledge" / "items.example.jsonl").write_text("{}\n", encoding="utf-8")
    (learner / "knowledge" / "items.jsonl").write_text('{"private": true}\n', encoding="utf-8")

    bundle = export_bundle(public_release=True)

    with zipfile.ZipFile(bundle) as archive:
        names = set(archive.namelist())
    assert "ai-speaking-coach/private/learner/course.example.md" in names
    assert "ai-speaking-coach/private/learner/knowledge/items.example.jsonl" in names
    assert "ai-speaking-coach/private/learner/course.md" not in names
    assert "ai-speaking-coach/private/learner/knowledge/items.jsonl" not in names
    assert "ai-speaking-coach/private/learner/state/coach.sqlite" not in names
