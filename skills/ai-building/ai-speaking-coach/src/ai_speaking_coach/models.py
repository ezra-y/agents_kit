from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ContentType = Literal["expression", "pattern", "screen_line"]
LearningStatus = Literal["learning", "usable", "fluent"]
Grade = Literal["forgot", "hard", "good", "easy"]
ErrorType = Literal[
    "chinglish",
    "awkward",
    "grammar",
    "collocation",
    "pronunciation",
    "prosody",
    "pragmatics",
]


class SourceRef(BaseModel):
    file: str
    order: int = Field(gt=0)


class ContentItem(BaseModel):
    id: str
    type: ContentType
    text: str = Field(min_length=1)
    meaning: str = ""
    topics: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    usage_note: str = ""
    source_ref: SourceRef
    approved: bool = True
    group_id: str | None = None
    context: str = ""
    media_ref: dict[str, str | int] | None = None


class SessionItemResult(BaseModel):
    item_id: str
    activity: Literal["new", "review"]
    grade: Grade
    status_after: LearningStatus
    correction_count: int = Field(default=0, ge=0)
    studied_at: str


class ErrorObservation(BaseModel):
    id: str
    item_id: str | None = None
    occurred_at: str
    user_said: str
    natural_version: str
    error_type: ErrorType
    note: str = ""
    next_due_at: str


class SessionRecord(BaseModel):
    id: str
    started_at: str
    ended_at: str
    topic: str
    lesson_path: str | None = None
    summary_path: str | None = None
    notes: str = ""
    items: list[SessionItemResult]
    errors: list[ErrorObservation] = Field(default_factory=list)

