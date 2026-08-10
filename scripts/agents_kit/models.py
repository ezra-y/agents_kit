from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Literal


class Effect(str, Enum):
    GLOBAL_APPLY = "global_apply"
    DOCS_BUILD = "docs_build"
    CHECK = "check"


class ContentMode(str, Enum):
    DIRECTORY = "directory"
    SKILL_FILE = "skill_file"
    PLUGIN_DIRECTORY = "plugin_directory"


class MergeState(str, Enum):
    UNCHANGED = "unchanged"
    UPSTREAM_ONLY = "upstream_only"
    LOCAL_ONLY = "local_only"
    DIVERGED = "diverged"


class RiskClass(str, Enum):
    DOCS_ONLY = "docs_only"
    INSTRUCTIONAL = "instructional"
    EXECUTABLE = "executable"
    BINARY = "binary"
    UNKNOWN = "unknown"


class UpdateDecision(str, Enum):
    AUTO_APPLY = "auto_apply"
    REVIEW_REQUIRED = "review_required"
    BLOCKED = "blocked"


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
class AssetRef:
    kind: Literal["plugin", "skill"]
    owner_kind: Literal["standalone", "plugin"] | None
    owner_id: str | None
    local_id: str

    @classmethod
    def plugin(cls, plugin_id: str) -> AssetRef:
        return cls("plugin", None, None, plugin_id)

    @classmethod
    def standalone_skill(cls, skill_id: str) -> AssetRef:
        return cls("skill", "standalone", None, skill_id)

    @classmethod
    def plugin_skill(cls, plugin_id: str, skill_id: str) -> AssetRef:
        return cls("skill", "plugin", plugin_id, skill_id)

    @classmethod
    def parse(cls, value: str) -> AssetRef:
        if value.startswith("plugin:"):
            plugin_id = value.removeprefix("plugin:")
            if plugin_id:
                return cls.plugin(plugin_id)
        if value.startswith("skill:standalone/"):
            skill_id = value.removeprefix("skill:standalone/")
            if skill_id:
                return cls.standalone_skill(skill_id)
        if value.startswith("skill:plugin/"):
            remainder = value.removeprefix("skill:plugin/")
            owner_id, separator, skill_id = remainder.partition("/")
            if separator and owner_id and skill_id:
                return cls.plugin_skill(owner_id, skill_id)
        raise ValueError(f"无效资产引用：{value}")

    @property
    def canonical(self) -> str:
        if self.kind == "plugin":
            return f"plugin:{self.local_id}"
        if self.owner_kind == "standalone":
            return f"skill:standalone/{self.local_id}"
        return f"skill:plugin/{self.owner_id}/{self.local_id}"

    def __str__(self) -> str:
        return self.canonical


@dataclass(frozen=True)
class SkillEntry:
    name: str
    category: str
    path: Path
    owner_kind: Literal["standalone", "plugin"] = "standalone"
    owner_id: str | None = None

    @property
    def ref(self) -> AssetRef:
        if self.owner_kind == "plugin":
            if self.owner_id is None:
                raise ValueError(f"Plugin-owned Skill 缺 owner_id：{self.name}")
            return AssetRef.plugin_skill(self.owner_id, self.name)
        return AssetRef.standalone_skill(self.name)

    @property
    def qualified_id(self) -> str:
        return self.ref.canonical


@dataclass(frozen=True)
class StandaloneTargetSpec:
    mode: Literal["self_contained", "plugin_only", "unsupported"]
    reason: str = ""


@dataclass(frozen=True)
class EmbeddedSkillSpec:
    standalone: dict[str, StandaloneTargetSpec]
    dependencies: tuple[str, ...] = ()


@dataclass(frozen=True)
class PluginManifestSpec:
    path: str
    authority: Literal["upstream", "local"]


@dataclass(frozen=True)
class PluginTargetSpec:
    support: Literal["full", "partial", "review", "unsupported"]
    manifest: PluginManifestSpec | None
    limitations: tuple[str, ...] = ()
    marketplace: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class PluginSpec:
    package_id: str
    root: Path
    upstream_targets: frozenset[str]
    targets: dict[str, PluginTargetSpec]
    embedded_skills: dict[str, EmbeddedSkillSpec]
    local_paths: tuple[str, ...] = ()


@dataclass(frozen=True)
class ComponentInventory:
    known_components: dict[str, tuple[Path, ...]]
    unknown_paths: tuple[Path, ...]
    executable_paths: tuple[Path, ...]
    binary_paths: tuple[Path, ...]


@dataclass(frozen=True)
class PluginSnapshot:
    package_id: str
    root: Path
    upstream_targets: frozenset[str]
    component_inventory: ComponentInventory
    upstream_digest: str
    revision: str | None
    spec: SourceSpec


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
