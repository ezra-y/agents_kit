from __future__ import annotations

import shutil
from pathlib import Path

import pytest


@pytest.fixture
def isolated_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    source_root = Path(__file__).resolve().parents[1]
    root = tmp_path / "ai-speaking-coach"
    (root / "config").mkdir(parents=True)
    (root / "migrations").mkdir()
    (root / "knowledge").mkdir()
    (root / "runtime" / "lancedb").mkdir(parents=True)
    (root / "runtime" / "lessons").mkdir()
    (root / "runtime" / "preparation").mkdir()
    (root / "runtime" / "sessions").mkdir()
    (root / "runtime" / "backups").mkdir()
    shutil.copy2(source_root / "config" / "defaults.json", root / "config" / "defaults.json")
    for migration in sorted((source_root / "migrations").glob("*.sql")):
        shutil.copy2(migration, root / "migrations" / migration.name)
    monkeypatch.setenv("AI_SPEAKING_COACH_ROOT", str(root))
    return root
