"""收藏索引（scout）：登记上游来源里全部技能的名字和用途，不下载内容。

索引保存在 scout.json，由 docs.py 渲染成 docs/catalog.md 收藏总目录，
供 AI 按描述匹配、读取上游全文并按需安装。
"""

from __future__ import annotations

import re
import urllib.parse
from pathlib import Path
from typing import Any

from .models import ChangeSet, Effect, SkillCandidate, SourceSpec
from .repository import Repository

NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class ScoutError(RuntimeError):
    pass


def default_name(spec: SourceSpec) -> str:
    if spec.provider == "git":
        parsed = urllib.parse.urlparse(str(spec.locator.get("url") or ""))
        raw = parsed.path.removesuffix(".git").strip("/").replace("/", "-")
        raw = raw or (parsed.hostname or "")
    elif spec.provider == "http":
        parsed = urllib.parse.urlparse(str(spec.locator.get("url") or ""))
        raw = Path(parsed.path).name.split(".", 1)[0] or (parsed.hostname or "")
    else:
        raw = Path(str(spec.locator.get("local_path") or "")).name
    slug = re.sub(r"[^a-z0-9]+", "-", raw.lower()).strip("-")
    if not slug:
        raise ScoutError("无法从来源推导索引名，请用 --name 指定")
    return slug


def source_spec(record: dict[str, Any]) -> SourceSpec:
    return SourceSpec(
        provider=str(record["provider"]),
        locator=dict(record["locator"]),
    )


def build_record(
    spec: SourceSpec,
    revision: str | None,
    candidates: list[SkillCandidate],
    *,
    note: str = "",
) -> dict[str, Any]:
    if not candidates:
        raise ScoutError("来源中找不到任何技能")
    record: dict[str, Any] = {
        "provider": spec.provider,
        "locator": spec.locator,
        "revision": revision,
        "skills": [
            {
                "path": candidate.relative_path,
                "name": candidate.declared_name,
                "description": candidate.description,
            }
            for candidate in sorted(candidates, key=lambda item: item.relative_path)
        ],
    }
    if note:
        record["note"] = note
    return record


def save_source(repo: Repository, name: str, record: dict[str, Any]) -> ChangeSet:
    if not NAME_PATTERN.fullmatch(name):
        raise ScoutError("索引名只能包含小写字母、数字和连字符，并以字母或数字开头")
    data = repo.read_scout()
    existing = data["sources"].get(name)
    if existing and "note" not in record and existing.get("note"):
        record = {**record, "note": existing["note"]}
    data["sources"][name] = record
    changed = repo.write_scout(data)
    return ChangeSet(
        changed={"scout"} if changed else set(),
        effects={Effect.DOCS_BUILD, Effect.CHECK} if changed else set(),
        details={
            "index": name,
            "skills": len(record["skills"]),
            "revision": record.get("revision"),
        },
    )


def source_argument(record: dict[str, Any]) -> str:
    """还原可直接传给 skill import / source inspect 的来源参数。"""
    locator = record.get("locator", {})
    if record.get("provider") == "local":
        return str(locator.get("local_path") or "")
    return str(locator.get("url") or "")


def raw_skill_url(record: dict[str, Any], path: str) -> str | None:
    """GitHub 来源给出始终指向最新版的 SKILL.md 原文链接。"""
    if record.get("provider") != "git":
        return None
    locator = record.get("locator", {})
    parsed = urllib.parse.urlparse(str(locator.get("url") or ""))
    if parsed.hostname != "github.com":
        return None
    repo_path = parsed.path.removesuffix(".git").strip("/")
    ref = str(locator.get("ref") or "") or "HEAD"
    prefix = f"https://raw.githubusercontent.com/{repo_path}/{ref}"
    if path in {"", "."}:
        return f"{prefix}/SKILL.md"
    return f"{prefix}/{path}/SKILL.md"
