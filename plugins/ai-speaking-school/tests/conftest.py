from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture
def school_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "school"
    monkeypatch.setenv("AI_SPEAKING_SCHOOL_HOME", str(home))
    return home
