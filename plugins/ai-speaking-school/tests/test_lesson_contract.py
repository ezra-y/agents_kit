from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "authoring" / "shared-runtime"))

from contracts import LessonPlan


def lesson_payload() -> dict:
    return json.loads(
        (ROOT / "tests" / "fixtures" / "lesson_plan.example.json").read_text(
            encoding="utf-8"
        )
    )


def test_detailed_ready_lesson_is_valid():
    lesson = LessonPlan.model_validate(lesson_payload())
    assert lesson.status == "ready"
    assert len(lesson.target_items) == 2
    assert lesson.required_modules[-1] == "M05"


@pytest.mark.parametrize(
    "change",
    [
        lambda payload: payload.update(target_items=payload["target_items"][:1]),
        lambda payload: payload["steps"][0].update(transition=""),
        lambda payload: payload.update(required_modules=["M01"]),
        lambda payload: payload.update(hint_ladder=["直接给答案"]),
        lambda payload: payload.update(final_review=None),
    ],
)
def test_incomplete_ready_lesson_is_rejected(change):
    payload = copy.deepcopy(lesson_payload())
    change(payload)
    with pytest.raises(ValidationError):
        LessonPlan.model_validate(payload)
