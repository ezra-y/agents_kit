from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


class Effect(str, Enum):
    GLOBAL_APPLY = "global_apply"
    DOCS_BUILD = "docs_build"
    CHECK = "check"


class ContentMode(str, Enum):
    DIRECTORY = "directory"
    SKILL_FILE = "skill_file"


@dataclass
class ChangeSet:
    changed: set[str] = field(default_factory=set)
    effects: set[Effect] = field(default_factory=set)
    details: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def merge(self, other: ChangeSet) -> ChangeSet:
        self.changed.update(other.changed)
        self.effects.update(other.effects)
        self.details.update(other.details)
        self.warnings.extend(other.warnings)
        return self


@dataclass(frozen=True)
class SkillEntry:
    name: str
    category: str
    path: Path


@dataclass(frozen=True)
class SourceSpec:
    provider: str
    locator: dict[str, Any]


@dataclass(frozen=True)
class SkillCandidate:
    relative_path: str
    declared_name: str
    description: str


@dataclass(frozen=True)
class ResolvedSource:
    spec: SourceSpec
    revision: str | None
    root: Path
    content_mode: ContentMode = ContentMode.DIRECTORY


@dataclass(frozen=True)
class SkillSnapshot:
    path: Path
    declared_name: str
    description: str
    content_sha256: str
    content_mode: ContentMode
    revision: str | None
    spec: SourceSpec
    source_name: str | None = None


@dataclass
class CheckReport:
    problems: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    sections: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.problems


def parse_skill_frontmatter(text: str) -> dict[str, Any]:
    if not text.startswith("---"):
        raise ValueError("SKILL.md 缺 YAML frontmatter")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("SKILL.md frontmatter 必须从第一行开始")
    try:
        end = next(
            index
            for index, line in enumerate(lines[1:], start=1)
            if line.strip() == "---"
        )
    except StopIteration as exc:
        raise ValueError("SKILL.md frontmatter 缺结束标记") from exc
    try:
        import yaml
    except ModuleNotFoundError as exc:
        raise RuntimeError("缺少 PyYAML；请通过 agents-kit 运行") from exc
    try:
        parsed = yaml.safe_load("\n".join(lines[1:end]))
    except yaml.YAMLError as exc:
        raise ValueError(f"SKILL.md frontmatter YAML 无效：{exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("SKILL.md frontmatter 必须是对象")  # noqa: TRY004
    return parsed
