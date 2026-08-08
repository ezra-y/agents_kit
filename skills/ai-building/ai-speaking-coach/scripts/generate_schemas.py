#!/usr/bin/env python3
from __future__ import annotations

import json

from ai_speaking_coach.lessons import FinalLessonSpec
from ai_speaking_coach.models import ContentItem, SessionRecord
from ai_speaking_coach.paths import skill_root


def main() -> None:
    destination = skill_root() / "schemas"
    destination.mkdir(parents=True, exist_ok=True)
    schemas = {
        "final-lesson.schema.json": FinalLessonSpec.model_json_schema(),
        "session.schema.json": SessionRecord.model_json_schema(),
        "knowledge-item.schema.json": ContentItem.model_json_schema(),
    }
    for filename, schema in schemas.items():
        path = destination / filename
        path.write_text(
            json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"schema={path}")


if __name__ == "__main__":
    main()
