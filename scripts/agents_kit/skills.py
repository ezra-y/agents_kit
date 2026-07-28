from __future__ import annotations

import os
import re
import shutil
from typing import Any

from .models import (
    ChangeSet,
    ContentMode,
    Effect,
    SkillSnapshot,
    parse_skill_frontmatter,
)
from .repository import Repository

NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class SkillError(RuntimeError):
    pass


def list_skills(
    repo: Repository,
    *,
    active_only: bool = False,
    category: str | None = None,
    tracked_only: bool = False,
) -> list[dict[str, Any]]:
    active = set(repo.read_active())
    sources = repo.read_sources()["skills"]
    metadata = repo.read_metadata()["skills"]
    rows: list[dict[str, Any]] = []
    for name, entry in repo.inventory().items():
        if active_only and name not in active:
            continue
        if category and entry.category != category:
            continue
        if tracked_only and name not in sources:
            continue
        rows.append(
            {
                "name": name,
                "category": entry.category,
                "active": name in active,
                "tracked": name in sources,
                "description": metadata.get(name, {}).get("description", ""),
            }
        )
    return sorted(rows, key=lambda row: (row["category"], row["name"]))


def show_skill(repo: Repository, name: str) -> dict[str, Any]:
    entry = repo.require_skill(name)
    text = (entry.path / "SKILL.md").read_text(encoding="utf-8", errors="replace")
    try:
        frontmatter = parse_skill_frontmatter(text)
    except (ValueError, RuntimeError) as exc:
        raise SkillError(f"{name}: {exc}") from exc
    return {
        "name": name,
        "declared_name": frontmatter.get("name"),
        "category": entry.category,
        "path": str(entry.path),
        "active": name in repo.read_active(),
        "source": repo.source_record(name),
        "metadata": repo.metadata_record(name),
        "content_sha256": repo.hash_directory(entry.path),
    }


def import_snapshot(
    repo: Repository,
    snapshot: SkillSnapshot,
    *,
    category: str,
    name: str | None,
    description: str,
    trigger: str,
    recommendation: int,
    policy: str,
    replace: bool = False,
) -> ChangeSet:
    _validate_category(repo, category)
    skill_name = name or snapshot.declared_name or snapshot.path.name
    _validate_name(skill_name)
    metadata_record = _metadata_record(
        description=description or snapshot.description,
        trigger=trigger,
        recommendation=recommendation,
    )

    inventory = repo.inventory()
    existing = inventory.get(skill_name)
    destination = repo.skills_dir / category / skill_name
    content_changed = True
    if existing:
        destination = existing.path
        category = existing.category
        current_hash = repo.hash_skill_content(existing.path, snapshot.content_mode)
        content_changed = current_hash != snapshot.content_sha256
        if content_changed and not replace:
            raise SkillError(
                f"技能 {skill_name} 已存在且内容不同；使用 source update，"
                "或明确传入 --replace"
            )

    changed: set[str] = set()
    if content_changed or existing is None:
        if existing and snapshot.content_mode == ContentMode.SKILL_FILE:
            repo.install_skill_file(snapshot.path, destination)
        else:
            repo.install_skill_directory(
                snapshot.path, destination, replace=existing is not None
            )
        changed.add("skills")

    if repo.set_metadata_record(skill_name, metadata_record):
        changed.add("metadata")

    if snapshot.spec.provider == "local":
        if repo.remove_source_record(skill_name):
            changed.add("sources")
    else:
        record = build_source_record(
            snapshot,
            policy=policy,
            source_name=(
                snapshot.source_name
                if snapshot.source_name and snapshot.source_name != skill_name
                else None
            ),
        )
        if repo.source_record(skill_name) != record:
            repo.set_source_record(skill_name, record)
            changed.add("sources")

    return ChangeSet(
        changed=changed,
        effects={Effect.DOCS_BUILD, Effect.CHECK} if changed else set(),
        details={
            "skill": skill_name,
            "category": category,
            "content_changed": content_changed,
        },
    )


def build_source_record(
    snapshot: SkillSnapshot,
    *,
    policy: str,
    source_name: str | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "provider": snapshot.spec.provider,
        "locator": snapshot.spec.locator,
        "content_mode": snapshot.content_mode.value,
        "policy": policy,
        "resolved": {
            "revision": snapshot.revision,
            "content_sha256": snapshot.content_sha256,
        },
    }
    if source_name:
        record["source_name"] = source_name
    return record


def set_metadata(
    repo: Repository,
    name: str,
    *,
    description: str | None = None,
    trigger: str | None = None,
    recommendation: int | None = None,
    dependencies: list[str] | None = None,
) -> ChangeSet:
    repo.require_skill(name)
    current = dict(repo.metadata_record(name) or {})
    if description is not None:
        current["description"] = description
    if trigger is not None:
        current["trigger"] = trigger
    if recommendation is not None:
        current["recommendation"] = recommendation
    if dependencies is not None:
        current["dependencies"] = list(dict.fromkeys(dependencies))
    validated = _metadata_record(
        description=current.get("description", ""),
        trigger=current.get("trigger", ""),
        recommendation=current.get("recommendation"),
        dependencies=current.get("dependencies"),
    )
    changed = repo.set_metadata_record(name, validated)
    return ChangeSet(
        changed={"metadata"} if changed else set(),
        effects={Effect.DOCS_BUILD, Effect.CHECK} if changed else set(),
        details={"skill": name},
    )


def rename_skill(repo: Repository, old_name: str, new_name: str) -> ChangeSet:
    entry = repo.require_skill(old_name)
    frontmatter = parse_skill_frontmatter(
        (entry.path / "SKILL.md").read_text(encoding="utf-8")
    )
    declared_name = str(frontmatter.get("name") or old_name)
    _validate_name(new_name)
    if old_name == new_name:
        return ChangeSet(details={"skill": old_name})
    if new_name in repo.inventory():
        raise SkillError(f"技能名已存在：{new_name}")
    destination = entry.path.with_name(new_name)
    os.replace(entry.path, destination)
    repo.refresh()

    active = [new_name if name == old_name else name for name in repo.read_active()]
    repo.write_active(active)

    sources = repo.read_sources()
    if old_name in sources["skills"]:
        source = sources["skills"].pop(old_name)
        if declared_name != new_name:
            source["source_name"] = declared_name
        else:
            source.pop("source_name", None)
        sources["skills"][new_name] = source
        repo.write_sources(sources)

    metadata = repo.read_metadata()
    if old_name in metadata["skills"]:
        metadata["skills"][new_name] = metadata["skills"].pop(old_name)
    for record in metadata["skills"].values():
        dependencies = record.get("dependencies")
        if isinstance(dependencies, list):
            record["dependencies"] = [
                new_name if dependency == old_name else dependency
                for dependency in dependencies
            ]
    repo.write_metadata(metadata)

    return ChangeSet(
        changed={"skills", "active", "sources", "metadata"},
        effects={Effect.GLOBAL_APPLY, Effect.DOCS_BUILD, Effect.CHECK},
        details={"old_name": old_name, "new_name": new_name},
    )


def move_skill(repo: Repository, name: str, category: str) -> ChangeSet:
    entry = repo.require_skill(name)
    _validate_category(repo, category)
    if entry.category == category:
        return ChangeSet(details={"skill": name, "category": category})
    destination = repo.skills_dir / category / name
    if destination.exists():
        raise SkillError(f"目标已存在：{destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    os.replace(entry.path, destination)
    repo.refresh()
    effects = {Effect.DOCS_BUILD, Effect.CHECK}
    if name in repo.read_active():
        effects.add(Effect.GLOBAL_APPLY)
    return ChangeSet(
        changed={"skills"},
        effects=effects,
        details={"skill": name, "category": category},
    )


def remove_skill(repo: Repository, name: str) -> ChangeSet:
    entry = repo.require_skill(name)
    metadata = repo.read_metadata()
    dependents: list[str] = []
    for other_name, record in metadata["skills"].items():
        if name in record.get("dependencies", []):
            dependents.append(other_name)
            record["dependencies"] = [
                dependency
                for dependency in record["dependencies"]
                if dependency != name
            ]

    shutil.rmtree(entry.path)
    repo.refresh()
    repo.write_active([item for item in repo.read_active() if item != name])
    repo.remove_source_record(name)
    metadata["skills"].pop(name, None)
    repo.write_metadata(metadata)

    return ChangeSet(
        changed={"skills", "active", "sources", "metadata"},
        effects={Effect.GLOBAL_APPLY, Effect.DOCS_BUILD, Effect.CHECK},
        details={"skill": name, "cleaned_dependents": dependents},
        warnings=(
            [f"已从这些技能的依赖中移除 {name}：{', '.join(dependents)}"]
            if dependents
            else []
        ),
    )


def detach_source(repo: Repository, name: str) -> ChangeSet:
    repo.require_skill(name)
    changed = repo.remove_source_record(name)
    return ChangeSet(
        changed={"sources"} if changed else set(),
        effects={Effect.DOCS_BUILD, Effect.CHECK} if changed else set(),
        details={"skill": name, "detached": changed},
    )


def update_from_source(
    repo: Repository, name: str, snapshot: SkillSnapshot
) -> ChangeSet:
    entry = repo.require_skill(name)
    record = repo.source_record(name)
    if record is None:
        raise SkillError(f"{name} 没有来源登记")
    current_hash = repo.hash_skill_content(entry.path, snapshot.content_mode)
    content_changed = current_hash != snapshot.content_sha256
    if content_changed:
        if snapshot.content_mode == ContentMode.SKILL_FILE:
            repo.install_skill_file(snapshot.path, entry.path)
        else:
            repo.install_skill_directory(snapshot.path, entry.path, replace=True)
    updated_record = dict(record)
    updated_record["content_mode"] = snapshot.content_mode.value
    if snapshot.declared_name != name:
        updated_record["source_name"] = snapshot.declared_name
    else:
        updated_record.pop("source_name", None)
    updated_record["resolved"] = {
        "revision": snapshot.revision,
        "content_sha256": snapshot.content_sha256,
    }
    source_changed = repo.source_record(name) != updated_record
    if source_changed:
        repo.set_source_record(name, updated_record)
    changed: set[str] = set()
    if content_changed:
        changed.add("skills")
    if source_changed:
        changed.add("sources")
    return ChangeSet(
        changed=changed,
        effects={Effect.DOCS_BUILD, Effect.CHECK} if changed else set(),
        details={"skill": name, "content_changed": content_changed},
    )


def _validate_name(name: str) -> None:
    if not NAME_PATTERN.fullmatch(name):
        raise SkillError("技能名只能包含小写字母、数字和连字符，并以字母或数字开头")


def _validate_category(repo: Repository, category: str) -> None:
    if category not in repo.categories:
        raise SkillError(
            f"未知分类：{category}；可用分类：{', '.join(repo.categories)}"
        )


def _metadata_record(
    *,
    description: Any,
    trigger: Any,
    recommendation: Any,
    dependencies: Any = None,
) -> dict[str, Any]:
    if not isinstance(description, str) or not description.strip():
        raise SkillError("metadata description 不能为空")
    if not isinstance(trigger, str):
        raise SkillError("metadata trigger 必须是字符串")
    if not isinstance(recommendation, int) or not 1 <= recommendation <= 5:
        raise SkillError("metadata recommendation 必须是 1-5")
    record: dict[str, Any] = {
        "recommendation": recommendation,
        "description": description.strip(),
        "trigger": trigger.strip(),
    }
    if dependencies:
        if not isinstance(dependencies, list) or any(
            not isinstance(item, str) or not item for item in dependencies
        ):
            raise SkillError("metadata dependencies 必须是技能名数组")
        record["dependencies"] = list(dict.fromkeys(dependencies))
    return record
