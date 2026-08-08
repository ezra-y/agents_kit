from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from pathlib import Path

from .db import apply_migrations, transaction
from .models import ContentItem
from .paths import knowledge_path
from .time_utils import isoformat, now

CJK_RE = re.compile(r"[\u3400-\u9fff]")


def write_jsonl(items: Iterable[ContentItem], destination: Path | None = None) -> Path:
    output_path = destination or knowledge_path()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [item.model_dump_json(exclude_none=True) for item in items]
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return output_path


def read_jsonl(path: Path | None = None) -> list[ContentItem]:
    source_path = path or knowledge_path()
    return [
        ContentItem.model_validate_json(line)
        for line in source_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def content_hash(item: ContentItem) -> str:
    payload = item.model_dump(exclude={"approved"}, mode="json")
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def import_content_items(items: Iterable[ContentItem]) -> int:
    apply_migrations()
    timestamp = isoformat(now())
    count = 0
    with transaction() as connection:
        for item in items:
            connection.execute(
                """
                INSERT INTO content_items(
                    id, type, group_id, text, meaning, topics_json, examples_json,
                    usage_note, context, source_file, source_order, media_ref_json,
                    content_hash, approved, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    type = excluded.type,
                    group_id = excluded.group_id,
                    text = excluded.text,
                    meaning = excluded.meaning,
                    topics_json = excluded.topics_json,
                    examples_json = excluded.examples_json,
                    usage_note = excluded.usage_note,
                    context = excluded.context,
                    source_file = excluded.source_file,
                    source_order = excluded.source_order,
                    media_ref_json = excluded.media_ref_json,
                    content_hash = excluded.content_hash,
                    approved = excluded.approved,
                    updated_at = excluded.updated_at
                """,
                (
                    item.id,
                    item.type,
                    item.group_id,
                    item.text,
                    item.meaning,
                    json.dumps(item.topics, ensure_ascii=False),
                    json.dumps(item.examples, ensure_ascii=False),
                    item.usage_note,
                    item.context,
                    item.source_ref.file,
                    item.source_ref.order,
                    json.dumps(item.media_ref, ensure_ascii=False) if item.media_ref else None,
                    content_hash(item),
                    int(item.approved),
                    timestamp,
                    timestamp,
                ),
            )
            count += 1
    return count


def validate_items(items: list[ContentItem]) -> list[str]:
    errors: list[str] = []
    ids = [item.id for item in items]
    if len(ids) != len(set(ids)):
        errors.append("Duplicate content IDs found")
    sources = [(item.source_ref.file, item.source_ref.order) for item in items]
    if len(sources) != len(set(sources)):
        errors.append("Duplicate source positions found")
    for item in items:
        if not item.text.strip():
            errors.append(f"{item.id}: empty text")
        if CJK_RE.search(item.text):
            errors.append(f"{item.id}: Chinese characters found in teaching text")
    return errors
