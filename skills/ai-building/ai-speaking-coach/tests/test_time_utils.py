from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

from ai_speaking_coach.paths import settings_path
from ai_speaking_coach.time_utils import now


def test_local_timezone_default_is_aware(isolated_root: Path) -> None:
    current = now()

    assert current.tzinfo is not None
    assert current.utcoffset() is not None


def test_learner_can_override_timezone(isolated_root: Path) -> None:
    path = settings_path()
    path.write_text(json.dumps({"timezone": "UTC"}), encoding="utf-8")

    assert now().utcoffset() == timedelta(0)
