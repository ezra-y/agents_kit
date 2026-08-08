from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def skill_root() -> Path:
    override = os.environ.get("AI_SPEAKING_COACH_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    return Path(__file__).resolve().parents[2]


def private_dir() -> Path:
    return skill_root() / "private"


def learner_dir() -> Path:
    return private_dir() / "learner"


def learner_state_dir() -> Path:
    return learner_dir() / "state"


def records_dir() -> Path:
    return learner_dir() / "records"


def lessons_dir() -> Path:
    return records_dir() / "lessons"


def sessions_dir() -> Path:
    return records_dir() / "sessions"


def backup_dir() -> Path:
    return learner_dir() / "backups"


def runtime_dir() -> Path:
    return private_dir() / "runtime"


def preparation_dir() -> Path:
    return runtime_dir() / "preparation"


def cache_dir() -> Path:
    return private_dir() / "cache"


def model_cache_dir() -> Path:
    return cache_dir() / "models"


def diagnostics_dir() -> Path:
    return cache_dir() / "diagnostics"


def database_path() -> Path:
    return learner_state_dir() / "coach.sqlite"


def coach_mode_database_path() -> Path:
    return runtime_dir() / "coach-mode.sqlite"


def course_path() -> Path:
    return learner_dir() / "course.md"


def knowledge_path() -> Path:
    return learner_dir() / "knowledge" / "items.jsonl"


def settings_path() -> Path:
    return learner_dir() / "settings.json"


def lancedb_path() -> Path:
    return cache_dir() / "lancedb"


def embedding_manifest_path() -> Path:
    return cache_dir() / "embedding-manifest.json"


def ensure_private_layout() -> None:
    for directory in (
        learner_dir() / "knowledge" / "sources",
        learner_state_dir(),
        lessons_dir(),
        sessions_dir(),
        backup_dir(),
        preparation_dir(),
        model_cache_dir(),
        lancedb_path(),
        diagnostics_dir(),
    ):
        directory.mkdir(parents=True, exist_ok=True)


def load_settings() -> dict[str, Any]:
    defaults_path = skill_root() / "config" / "defaults.json"
    overrides_path = settings_path()
    defaults = json.loads(defaults_path.read_text(encoding="utf-8"))
    overrides = (
        json.loads(overrides_path.read_text(encoding="utf-8"))
        if overrides_path.exists()
        else {}
    )
    return _deep_merge(defaults, overrides)


def _deep_merge(base: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged
