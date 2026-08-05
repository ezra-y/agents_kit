from __future__ import annotations

import zipfile
from pathlib import Path

from ai_speaking_coach.db import apply_migrations
from ai_speaking_coach.exporter import export_bundle


def test_export_bundle_contains_state_and_excludes_rebuildable_cache(
    isolated_root: Path,
) -> None:
    apply_migrations()
    (isolated_root / "SKILL.md").write_text("---\nname: test\n---\n", encoding="utf-8")
    (isolated_root / "knowledge" / "items.jsonl").write_text("{}\n", encoding="utf-8")
    (isolated_root / "runtime" / "lessons" / "lesson.md").write_text(
        "lesson\n",
        encoding="utf-8",
    )
    (isolated_root / "runtime" / "models").mkdir()
    (isolated_root / "runtime" / "models" / "weights.bin").write_bytes(b"model")
    (isolated_root / "runtime" / "lancedb" / "index.bin").write_bytes(b"index")

    bundle = export_bundle()

    with zipfile.ZipFile(bundle) as archive:
        names = set(archive.namelist())
    assert "ai-speaking-coach/SKILL.md" in names
    assert "ai-speaking-coach/knowledge/items.jsonl" in names
    assert "ai-speaking-coach/runtime/coach.sqlite" in names
    assert "ai-speaking-coach/runtime/lessons/lesson.md" in names
    assert "ai-speaking-coach/runtime/models/weights.bin" not in names
    assert "ai-speaking-coach/runtime/lancedb/index.bin" not in names


def test_export_can_include_model_and_index(isolated_root: Path) -> None:
    apply_migrations()
    (isolated_root / "runtime" / "models").mkdir()
    (isolated_root / "runtime" / "models" / "weights.bin").write_bytes(b"model")
    (isolated_root / "runtime" / "lancedb" / "index.bin").write_bytes(b"index")

    bundle = export_bundle(include_index=True, include_model=True)

    with zipfile.ZipFile(bundle) as archive:
        names = set(archive.namelist())
    assert "ai-speaking-coach/runtime/models/weights.bin" in names
    assert "ai-speaking-coach/runtime/lancedb/index.bin" in names
