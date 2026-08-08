from __future__ import annotations

import shutil
from pathlib import Path

import pytest


@pytest.fixture
def isolated_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    source_root = Path(__file__).resolve().parents[1]
    root = tmp_path / "ai-speaking-coach"
    (root / "config").mkdir(parents=True)
    (root / "private" / "learner" / "knowledge").mkdir(parents=True)
    (root / "private" / "learner" / "state").mkdir()
    (root / "private" / "learner" / "records" / "lessons").mkdir(parents=True)
    (root / "private" / "learner" / "records" / "sessions").mkdir()
    (root / "private" / "learner" / "backups").mkdir()
    (root / "private" / "runtime" / "preparation").mkdir(parents=True)
    (root / "private" / "cache" / "lancedb").mkdir(parents=True)
    (root / "private" / "cache" / "models").mkdir()
    (root / "private" / "cache" / "diagnostics").mkdir()
    shutil.copy2(source_root / "config" / "defaults.json", root / "config" / "defaults.json")
    shutil.copytree(source_root / "migrations", root / "migrations")
    monkeypatch.setenv("AI_SPEAKING_COACH_ROOT", str(root))
    return root
