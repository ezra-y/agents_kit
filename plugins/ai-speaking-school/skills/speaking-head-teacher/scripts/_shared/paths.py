from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


def default_home() -> Path:
    configured = os.environ.get("AI_SPEAKING_SCHOOL_HOME")
    if configured:
        return Path(configured).expanduser()
    legacy = os.environ.get("AI_SPEAKING_COACH_DATA_DIR")
    if legacy:
        return Path(legacy).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "ai-speaking-coach"
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        return base / "ai-speaking-coach"
    base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "ai-speaking-coach"


@dataclass(frozen=True)
class SchoolPaths:
    root: Path

    @classmethod
    def from_env(cls) -> "SchoolPaths":
        return cls(default_home())

    @property
    def learner(self) -> Path:
        return self.root / "learner"

    @property
    def state(self) -> Path:
        return self.learner / "state"

    @property
    def database(self) -> Path:
        return self.state / "coach.sqlite"

    @property
    def settings(self) -> Path:
        return self.learner / "settings.json"

    @property
    def course(self) -> Path:
        return self.learner / "course.md"

    @property
    def knowledge(self) -> Path:
        return self.learner / "knowledge" / "items.jsonl"

    @property
    def records(self) -> Path:
        return self.learner / "records"

    @property
    def cache(self) -> Path:
        return self.root / "cache"

    @property
    def model_cache(self) -> Path:
        return self.cache / "models"

    @property
    def lancedb(self) -> Path:
        return self.cache / "lancedb"

    @property
    def embedding_manifest(self) -> Path:
        return self.cache / "embedding-manifest.json"

    @property
    def runtime(self) -> Path:
        return self.root / "runtime"

    def ensure(self) -> None:
        for path in (self.state, self.records, self.model_cache, self.lancedb):
            path.mkdir(parents=True, exist_ok=True)
