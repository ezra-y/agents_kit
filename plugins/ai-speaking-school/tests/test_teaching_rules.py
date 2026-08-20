from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_onboarding_has_fixed_questions_and_full_completion_gate():
    skill = read("skills/speaking-head-teacher/SKILL.md")
    assert "首次访谈只补下面四组信息" in skill
    assert "最多再追问一个问题" in skill
    assert "complete-onboarding" in skill
    for task_kind in ("T-30", "T0", "T14"):
        assert task_kind in skill


def test_live_teacher_rules_are_loaded_once_and_auto_advance():
    skill = read("skills/speaking-live-teacher/SKILL.md")
    assert "不等用户说“继续”" in skill
    assert "课堂中不做逐轮 Hook" in skill
    assert "`required_modules` 是结束门槛" in skill
    assert "不是学习内容" in skill


def test_class_execution_reference_only_keeps_three_examples():
    reference = read(
        "skills/speaking-live-teacher/references/class-execution.md"
    )
    assert reference.count("\n## ") == 3
    assert "模块过渡" in reference
    assert "卡住时支援" in reference
    assert "口头说明替换位置" in reference


def test_lesson_schema_contains_detailed_execution_contract():
    schema = json.loads(
        read("authoring/schemas/lesson_plan.schema.json")
    )
    properties = schema["properties"]
    for field in (
        "delivery_pace",
        "required_modules",
        "target_items",
        "scenario_brief",
        "recall_prompts",
        "hint_ladder",
        "answer_reveal_condition",
        "final_review",
    ):
        assert field in properties
