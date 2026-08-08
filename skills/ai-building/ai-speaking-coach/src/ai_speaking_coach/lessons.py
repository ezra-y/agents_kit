from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator

from .db import apply_migrations, connect
from .embeddings import EmbeddingProvider
from .paths import load_settings, runtime_dir
from .retrieval import LanceDBRetrievalIndex, public_result
from .time_utils import isoformat, now


@dataclass(frozen=True)
class LessonPreparation:
    date: str
    topic: str
    due_items: list[dict[str, Any]]
    error_items: list[dict[str, Any]]
    new_candidates: list[dict[str, Any]]
    destination: Path


class LessonErrorRepair(BaseModel):
    learner_version: str
    natural_version: str
    focus: str = ""


class FinalLessonSpec(BaseModel):
    date: str
    topic: str = Field(min_length=1)
    communication_goal: str = Field(min_length=1)
    scene: str = Field(min_length=1)
    target_task: str = Field(min_length=1)
    current_bottleneck: str = Field(min_length=1)
    success_evidence: list[str] = Field(min_length=1)
    input_task: str = Field(min_length=1)
    transfer_task: str = Field(min_length=1)
    required_reviews: list[str] = Field(default_factory=list)
    error_repairs: list[LessonErrorRepair] = Field(default_factory=list)
    focus_targets: list[str] = Field(default_factory=list)
    quick_checks: list[str] = Field(default_factory=list)
    optional_extensions: list[str] = Field(default_factory=list)
    live_notes: list[str] = Field(default_factory=list)

    @field_validator("date")
    @classmethod
    def valid_date(cls, value: str) -> str:
        if len(value) != 10 or value[4] != "-" or value[7] != "-":
            raise ValueError("date must use YYYY-MM-DD")
        return value


def prepare_lesson(
    provider: EmbeddingProvider | None,
    date: str | None = None,
    topic: str | None = None,
    force: bool = False,
) -> LessonPreparation:
    apply_migrations()
    current = now()
    lesson_date = date or current.date().isoformat()
    destination = runtime_dir() / "preparation" / f"{lesson_date}.md"
    if destination.exists() and not force:
        return _read_existing_plan(destination)

    with connect() as connection:
        due_items = [
            dict(row)
            for row in connection.execute(
                """
                SELECT c.id, c.text, c.meaning, c.type, r.status, r.next_due_at
                FROM review_state r
                JOIN content_items c ON c.id = r.item_id
                WHERE r.next_due_at <= ? AND c.approved = 1
                ORDER BY r.next_due_at
                """,
                (isoformat(current),),
            ).fetchall()
        ]
        errors = [
            dict(row)
            for row in connection.execute(
                """
                SELECT e.id AS error_id, e.item_id, e.user_said, e.natural_version,
                       e.error_type, e.note, e.next_due_at
                FROM errors e
                WHERE e.resolved_at IS NULL AND e.next_due_at <= ?
                ORDER BY e.next_due_at
                """,
                (isoformat(current),),
            ).fetchall()
        ]
        profile = connection.execute("SELECT * FROM learner_profile WHERE id = 1").fetchone()

    selected_topic = topic or _topic_from_profile(profile) or _topic_from_due(due_items)
    query = _retrieval_query(selected_topic, due_items, errors)
    settings = load_settings()
    candidate_limit = int(settings["retrieval"]["candidate_limit"])
    retrieved = LanceDBRetrievalIndex(provider).search(
        query,
        mode="hybrid" if provider else "fts",
        limit=candidate_limit,
    )
    excluded_ids = {item["id"] for item in due_items}
    excluded_ids.update(item["item_id"] for item in errors if item["item_id"])
    new_candidates = [
        _clean_result(item) for item in retrieved if item["id"] not in excluded_ids
    ]
    maximum = int(settings["candidate_items"]["maximum"])
    available_slots = max(maximum - len(due_items) - len(errors), 0)
    new_candidates = new_candidates[:available_slots]
    _write_lesson(
        destination,
        lesson_date,
        selected_topic,
        due_items,
        errors,
        new_candidates,
    )
    return LessonPreparation(
        date=lesson_date,
        topic=selected_topic,
        due_items=due_items,
        error_items=errors,
        new_candidates=new_candidates,
        destination=destination,
    )


def finalize_lesson(spec: FinalLessonSpec) -> Path:
    apply_migrations()
    sections = (
        spec.required_reviews,
        spec.focus_targets,
        spec.quick_checks,
        spec.optional_extensions,
    )
    item_ids = [item_id for section in sections for item_id in section]
    if len(item_ids) != len(set(item_ids)):
        raise ValueError("A content item may appear in only one lesson section")
    items = _load_approved_items(item_ids)
    missing = [item_id for item_id in item_ids if item_id not in items]
    if missing:
        raise ValueError(f"Unknown or unapproved lesson items: {', '.join(missing)}")

    destination = runtime_dir() / "lessons" / f"{spec.date}.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Speaking Lesson: {spec.date}",
        "",
        "Status: finalized",
        "Prepared by: strong-model",
        f"Topic: {spec.topic}",
        f"Communication goal: {spec.communication_goal}",
        "",
        "## Scene",
        "",
        spec.scene,
        "",
        "## Task Evidence",
        "",
        f"- Target task: {spec.target_task}",
        f"- Current bottleneck: {spec.current_bottleneck}",
        f"- Listening demand: {spec.input_task}",
        f"- Transfer task: {spec.transfer_task}",
        *_render_success_evidence(spec.success_evidence),
        "",
        "## Required Reviews",
        "",
        *_render_items(spec.required_reviews, items, "No required reviews."),
        "",
        "## Error Repairs",
        "",
        *_render_error_repairs(spec.error_repairs),
        "",
        "## Focus Targets",
        "",
        *_render_items(spec.focus_targets, items, "No focus targets."),
        "",
        "## Quick Checks",
        "",
        *_render_items(spec.quick_checks, items, "No quick checks."),
        "",
        "## Optional Extensions",
        "",
        *_render_items(spec.optional_extensions, items, "No optional extensions."),
        "",
        "## Live Teaching Notes",
        "",
    ]
    notes = spec.live_notes or ["No lesson-specific notes."]
    lines.extend(f"- {note}" for note in notes)
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return destination


def _load_approved_items(item_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not item_ids:
        return {}
    placeholders = ", ".join("?" for _ in item_ids)
    with connect() as connection:
        rows = connection.execute(
            f"""
            SELECT id, text, meaning, usage_note, examples_json
            FROM content_items
            WHERE approved = 1 AND id IN ({placeholders})
            """,
            item_ids,
        ).fetchall()
    return {str(row["id"]): dict(row) for row in rows}


def _render_items(
    item_ids: list[str],
    items: dict[str, dict[str, Any]],
    empty: str,
) -> list[str]:
    if not item_ids:
        return [f"- {empty}"]
    lines: list[str] = []
    for item_id in item_ids:
        item = items[item_id]
        detail = f"`{item_id}` {item['text']} | {item['meaning']}".rstrip(" |")
        if item["usage_note"]:
            detail += f" | {item['usage_note']}"
        lines.append(f"- {detail}")
        examples = json.loads(item["examples_json"])
        if examples:
            lines.append(f"  Example: {examples[0]}")
    return lines


def _render_error_repairs(errors: list[LessonErrorRepair]) -> list[str]:
    if not errors:
        return ["- No planned error repairs."]
    return [
        f"- {error.learner_version} -> {error.natural_version}"
        + (f" | {error.focus}" if error.focus else "")
        for error in errors
    ]


def _render_success_evidence(evidence: list[str]) -> list[str]:
    return [
        "- Success evidence:",
        *(f"  - {criterion}" for criterion in evidence),
    ]


def _topic_from_profile(profile: Any) -> str | None:
    if profile is None:
        return None
    topics = json.loads(profile["preferred_topics_json"])
    interests = json.loads(profile["interests_json"])
    if topics:
        return str(topics[0])
    if interests:
        return f"talking about {interests[0]}"
    return None


def _topic_from_due(due_items: list[dict[str, Any]]) -> str:
    if due_items:
        return f"a natural conversation using {due_items[0]['text']}"
    return "getting to know each other and everyday life"


def _retrieval_query(
    topic: str,
    due_items: list[dict[str, Any]],
    errors: list[dict[str, Any]],
) -> str:
    due_text = " ".join(item["text"] for item in due_items[:5])
    corrections = " ".join(item["natural_version"] for item in errors[:5])
    return f"{topic}\n{due_text}\n{corrections}".strip()


def _clean_result(item: dict[str, Any]) -> dict[str, Any]:
    return public_result(item)


def _write_lesson(
    destination: Path,
    date: str,
    topic: str,
    due_items: list[dict[str, Any]],
    errors: list[dict[str, Any]],
    new_candidates: list[dict[str, Any]],
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# 备课输入：{date}",
        "",
        "Status: preparation-draft",
        f"Topic: {topic}",
        "",
        "## 教师目标",
        "",
        "- 尽可能使用英语，以较慢但自然的语速开始。",
        "- 学生说完一两句话后及时处理高价值错误。",
        "- 明确指出中式表达、别扭搭配和不符合场景的语气。",
        "- 快速检查已会内容，重点练习未知、到期和反复出错内容。",
        "",
        "## 到期复习",
        "",
    ]
    lines.extend(_item_lines(due_items, empty="今天没有到期内容。"))
    lines.extend(["", "## 旧错误", ""])
    if errors:
        lines.extend(
            f"- `{item['error_id']}` {item['user_said']} -> "
            f"{item['natural_version']} ({item['error_type']})"
            for item in errors
        )
    else:
        lines.append("- 今天没有到期错误。")
    lines.extend(["", "## 新内容候选", ""])
    lines.extend(_item_lines(new_candidates, empty="没有可用的新内容候选。"))
    lines.extend(
        [
            "",
            "## 情景要求",
            "",
            "围绕今日话题组织自然多轮对话。不要逐项朗读清单，也不要为了数量强塞表达。",
        ]
    )
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _item_lines(items: list[dict[str, Any]], empty: str) -> list[str]:
    if not items:
        return [f"- {empty}"]
    return [
        f"- `{item['id']}` {item['text']} | {item.get('meaning', '')}".rstrip()
        for item in items
    ]


def _read_existing_plan(path: Path) -> LessonPreparation:
    text = path.read_text(encoding="utf-8")
    topic_line = next((line for line in text.splitlines() if line.startswith("Topic: ")), "")
    return LessonPreparation(
        date=path.stem,
        topic=topic_line.removeprefix("Topic: "),
        due_items=[],
        error_items=[],
        new_candidates=[],
        destination=path,
    )
