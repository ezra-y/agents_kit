from __future__ import annotations

import hashlib
import json
import re
import subprocess
import unicodedata
from collections.abc import Iterable
from pathlib import Path

from .db import apply_migrations, transaction
from .models import ContentItem, SourceRef
from .paths import knowledge_path
from .time_utils import isoformat, now

CJK_RE = re.compile(r"[\u3400-\u9fff]")
BULLET_RE = re.compile(r"^\s*•\s*(.*)$")

KNOWN_EXPRESSION_CORRECTIONS = {
    "Who’s turn?": "Whose turn is it?",
    "Who's turn?": "Whose turn is it?",
    "He seems at little nervous.": "He seems a little nervous.",
}

EXPRESSIONS_REQUIRING_REVIEW = {
    "He owned himself defeated.",
}

REGISTER_NOTES = {
    "Shut up.": "Direct and often rude. Use only when the relationship and tone allow it.",
    "Full of shit.": "Vulgar and confrontational.",
    "Bite me.": "Rude slang used to reject or challenge someone.",
    "What’s your problem?": "Confrontational. Avoid in polite situations.",
    "What's your problem?": "Confrontational. Avoid in polite situations.",
    "Out of my way.": "Very direct and potentially rude.",
}

TOPIC_RULES = {
    "work": {"job", "work", "boss", "company", "project", "meeting", "resume", "fired"},
    "study": {"study", "school", "teacher", "student", "homework", "english", "paper"},
    "friends": {"friend", "party", "hang out", "weekend"},
    "travel": {"travel", "trip", "vacation", "flight", "hotel", "country", "city"},
    "food": {"food", "lunch", "dinner", "coffee", "cook", "restaurant", "drink"},
    "relationships": {"love", "marriage", "date", "miss you", "parents", "family"},
    "health": {"health", "sick", "breathe", "doctor", "hospital", "tired"},
}


def extract_doc_text(path: Path) -> str:
    result = subprocess.run(
        ["textutil", "-convert", "txt", "-stdout", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = (
        value.replace("’", "'")
        .replace("‘", "'")
        .replace("“", '"')
        .replace("”", '"')
    )
    value = re.sub(r"[ \t]+", " ", value)
    return value.strip()


def split_english_chinese(line: str) -> tuple[str, str]:
    match = CJK_RE.search(line)
    if not match:
        return normalize_text(line), ""
    english = normalize_text(line[: match.start()])
    meaning = normalize_text(line[match.start() :])
    return english, meaning


def infer_topics(*values: str) -> list[str]:
    haystack = " ".join(values).lower()
    topics = [
        topic
        for topic, words in TOPIC_RULES.items()
        if any(word in haystack for word in words)
    ]
    return topics or ["daily_life"]


def expression_usage_note(text: str) -> str:
    if text in REGISTER_NOTES:
        return REGISTER_NOTES[text]
    if text.endswith("?"):
        return "Use natural rising or fall-rise intonation according to the speaker's intent."
    return ""


def parse_common_500(path: Path) -> list[ContentItem]:
    lines = [normalize_text(line) for line in extract_doc_text(path).splitlines()]
    lines = [line for line in lines if line]
    if lines and "500" in lines[0]:
        lines = lines[1:]
    items: list[ContentItem] = []
    for order, line in enumerate(lines, start=1):
        text, meaning = split_english_chinese(line)
        text = KNOWN_EXPRESSION_CORRECTIONS.get(text, text)
        if not text:
            raise ValueError(f"Missing English text at source order {order}")
        items.append(
            ContentItem(
                id=f"common500-s{order:04d}",
                type="expression",
                text=text,
                meaning=meaning,
                topics=infer_topics(text, meaning),
                usage_note=expression_usage_note(text),
                source_ref=SourceRef(file=path.name, order=order),
                approved=not bool(CJK_RE.search(text))
                and text not in EXPRESSIONS_REQUIRING_REVIEW,
            )
        )
    return items


def _pattern_blocks(lines: Iterable[str]) -> list[list[str]]:
    blocks: list[list[str]] = []
    current: list[str] | None = None
    for raw_line in lines:
        line = normalize_text(raw_line)
        bullet = BULLET_RE.match(line)
        if bullet:
            if current is not None:
                blocks.append(current)
            current = []
            if bullet.group(1):
                current.append(bullet.group(1))
            continue
        if current is not None and line:
            current.append(line)
    if current is not None:
        blocks.append(current)
    return blocks


def _clean_example(line: str) -> str | None:
    if line.startswith(("举一反三", "注意", "注:", "注：")):
        return None
    english, _ = split_english_chinese(line)
    english = re.split(r"[（(]", english, maxsplit=1)[0].strip()
    if not english or not re.search(r"[A-Za-z]", english):
        return None
    return english


def parse_pattern_220(path: Path) -> list[ContentItem]:
    blocks = _pattern_blocks(extract_doc_text(path).splitlines())
    items: list[ContentItem] = []
    for order, block in enumerate(blocks, start=1):
        if not block:
            raise ValueError(f"Empty pattern block at source order {order}")
        pattern, inline_note = _clean_pattern(block[0])
        meaning = ""
        example_start = 1
        if len(block) > 1 and CJK_RE.search(block[1]):
            _, meaning = split_english_chinese(block[1])
            if not meaning:
                meaning = block[1]
            example_start = 2
        examples: list[str] = []
        for line in block[example_start:]:
            example = _clean_example(line)
            if example and example != pattern and example not in examples:
                examples.append(example)
            if len(examples) == 8:
                break
        approved = bool(re.search(r"[A-Za-z]", pattern)) and not bool(CJK_RE.search(pattern))
        items.append(
            ContentItem(
                id=f"pattern220-p{order:04d}",
                type="pattern",
                text=pattern,
                meaning=meaning,
                topics=infer_topics(pattern, meaning, *examples),
                examples=examples,
                usage_note=" ".join(
                    note for note in (_pattern_usage_note(pattern), inline_note) if note
                ),
                source_ref=SourceRef(file=path.name, order=order),
                approved=approved,
            )
        )
    return items


def _pattern_usage_note(pattern: str) -> str:
    lower = pattern.lower()
    if "look forward to" in lower or "used to" in lower or "thinking about" in lower:
        return "Check the form required after the final preposition and practice it in context."
    if "wanna" in lower or "gonna" in lower:
        return "Conversational form. Use the full form in formal writing."
    return ""


def _clean_pattern(raw_pattern: str) -> tuple[str, str]:
    notes: list[str] = []

    def remove_cjk_parenthetical(match: re.Match[str]) -> str:
        content = match.group(1)
        if CJK_RE.search(content):
            notes.append(normalize_text(content))
            return ""
        return match.group(0)

    pattern = re.sub(r"[（(]([^()（）]*)[）)]", remove_cjk_parenthetical, raw_pattern)
    if CJK_RE.match(pattern):
        first_english = re.search(r"[A-Za-z]", pattern)
        if first_english:
            notes.append(normalize_text(pattern[: first_english.start()].strip(" :：")))
            pattern = pattern[first_english.start() :]
    return normalize_text(pattern), " ".join(note for note in notes if note)


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
