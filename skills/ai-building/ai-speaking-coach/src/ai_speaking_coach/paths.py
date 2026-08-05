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


def runtime_dir() -> Path:
    return skill_root() / "runtime"


def database_path() -> Path:
    return runtime_dir() / "coach.sqlite"


def knowledge_path() -> Path:
    return skill_root() / "knowledge" / "items.jsonl"


def lancedb_path() -> Path:
    return runtime_dir() / "lancedb"


def load_settings() -> dict[str, Any]:
    defaults_path = skill_root() / "config" / "defaults.json"
    settings_path = runtime_dir() / "settings.json"
    defaults = json.loads(defaults_path.read_text(encoding="utf-8"))
    overrides = (
        json.loads(settings_path.read_text(encoding="utf-8")) if settings_path.exists() else {}
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
