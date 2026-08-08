from __future__ import annotations

import json
from pathlib import Path

from ai_speaking_coach.lessons import FinalLessonSpec
from ai_speaking_coach.models import ContentItem, SessionRecord


def test_committed_schemas_match_pydantic_models() -> None:
    root = Path(__file__).resolve().parents[1]
    expected = {
        "final-lesson.schema.json": FinalLessonSpec.model_json_schema(),
        "session.schema.json": SessionRecord.model_json_schema(),
        "knowledge-item.schema.json": ContentItem.model_json_schema(),
    }
    for filename, schema in expected.items():
        committed = json.loads((root / "schemas" / filename).read_text(encoding="utf-8"))
        assert committed == schema
