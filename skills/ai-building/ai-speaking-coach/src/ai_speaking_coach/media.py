from __future__ import annotations

import json
import re
from pathlib import Path

from pydantic import BaseModel, Field

from .corpus import import_content_items, read_jsonl, write_jsonl
from .models import ContentItem, SourceRef
from .paths import knowledge_path


class MediaLine(BaseModel):
    speaker: str
    text: str
    meaning: str = ""
    usage_note: str = ""
    context: str = ""
    topics: list[str] = Field(default_factory=list)
    start: str
    end: str


class MediaDialogue(BaseModel):
    title: str
    season: int = Field(ge=0)
    episode: int = Field(ge=0)
    dialogue: int = Field(gt=0)
    lines: list[MediaLine] = Field(min_length=2, max_length=6)


def ingest_media_dialogue(source: Path) -> list[ContentItem]:
    dialogue = MediaDialogue.model_validate_json(source.read_text(encoding="utf-8"))
    slug = _slug(dialogue.title)
    group_id = (
        f"screen-{slug}-s{dialogue.season:02d}e{dialogue.episode:02d}"
        f"-d{dialogue.dialogue:04d}"
    )
    items: list[ContentItem] = []
    for order, line in enumerate(dialogue.lines, start=1):
        item_id = f"{group_id}-l{order:04d}"
        items.append(
            ContentItem(
                id=item_id,
                type="screen_line",
                group_id=group_id,
                text=line.text.strip(),
                meaning=line.meaning.strip(),
                topics=line.topics or ["screen_dialogue"],
                usage_note=line.usage_note.strip(),
                context=line.context.strip(),
                source_ref=SourceRef(file=source.name, order=order),
                media_ref={
                    "title": dialogue.title,
                    "season": dialogue.season,
                    "episode": dialogue.episode,
                    "speaker": line.speaker,
                    "start": line.start,
                    "end": line.end,
                },
                approved=True,
            )
        )
    existing = read_jsonl() if knowledge_path().exists() else []
    existing_ids = {item.id for item in existing}
    duplicates = existing_ids.intersection(item.id for item in items)
    if duplicates:
        raise ValueError(f"Media IDs already exist: {sorted(duplicates)}")
    merged = [*existing, *items]
    write_jsonl(merged)
    import_content_items(items)
    return items


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not slug:
        raise ValueError("Media title must contain ASCII letters or digits")
    return slug


def write_media_template(destination: Path) -> Path:
    template = {
        "title": "Example Show",
        "season": 1,
        "episode": 1,
        "dialogue": 1,
        "lines": [
            {
                "speaker": "Alex",
                "text": "Are you free this weekend?",
                "meaning": "你这周末有空吗？",
                "usage_note": "A natural, casual invitation opener.",
                "context": "Two friends are making plans.",
                "topics": ["friends", "weekend_plans"],
                "start": "00:00:10.000",
                "end": "00:00:12.000",
            },
            {
                "speaker": "Sam",
                "text": "It depends. What did you have in mind?",
                "meaning": "要看情况。你有什么想法？",
                "usage_note": "Use this to avoid committing before hearing the plan.",
                "context": "Sam asks for more information before deciding.",
                "topics": ["friends", "weekend_plans"],
                "start": "00:00:12.100",
                "end": "00:00:15.000",
            },
        ],
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(template, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return destination

