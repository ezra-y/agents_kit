from __future__ import annotations

import os
import re
import shutil
from typing import Any

from .models import (
    AssetRef,
    ChangeSet,
    ContentMode,
    Effect,
    SkillSnapshot,
    parse_skill_frontmatter,
)
from .repository import ACTIVE_HEADER, Repository, RepositoryError
from .taxonomy import normalize_tags, validate_known_tags

NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class SkillError(RuntimeError):
    pass


def list_skills(
    repo: Repository,
    *,
    active_only: bool = False,
    category: str | None = None,
    tags: list[str] | None = None,
    tracked_only: bool = False,
) -> list[dict[str, Any]]:
    activation = repo.skill_activation()
    validate_known_tags(repo, tags or [])
    required_tags = set(tags or [])
    rows: list[dict[str, Any]] = []
    plugin_sources = repo.read_sources()["plugins"]
    for entry in repo.skill_registry().values():
        ref = entry.qualified_id
        metadata = repo.metadata_record(ref) or {}
        tracked = (
            entry.owner_kind == "plugin" and entry.owner_id in plugin_sources
        ) or repo.source_record(ref) is not None
        active = bool(activation.get(ref))
        if active_only and not active:
            continue
        if category and entry.category != category:
            continue
        if tracked_only and not tracked:
            continue
        skill_tags = metadata.get("tags", [])
        if required_tags and not required_tags.issubset(skill_tags):
            continue
        rows.append(
            {
                "name": entry.name,
                "ref": ref,
                "category": entry.category,
                "owner": {
                    "kind": entry.owner_kind,
                    "id": entry.owner_id,
                },
                "active": active,
                "active_targets": sorted(activation.get(ref, {})),
                "activation": activation.get(ref, {}),
                "tracked": tracked,
                "description": metadata.get("description", ""),
                "tags": skill_tags,
            }
        )
    return sorted(rows, key=lambda row: (row["category"], row["ref"]))


def show_skill(repo: Repository, name: str) -> dict[str, Any]:
    entry = repo.require_skill(name)
    text = (entry.path / "SKILL.md").read_text(encoding="utf-8", errors="replace")
    try:
        frontmatter = parse_skill_frontmatter(text)
    except (ValueError, RuntimeError) as exc:
        raise SkillError(f"{name}: {exc}") from exc
    source = repo.source_record(entry.qualified_id)
    if entry.owner_kind == "plugin":
        inherited = repo.read_sources()["plugins"].get(entry.owner_id or "")
        source = (
            {
                "inherited_from": AssetRef.plugin(entry.owner_id or "").canonical,
                **inherited,
            }
            if inherited
            else None
        )
    return {
        "name": entry.name,
        "ref": entry.qualified_id,
        "declared_name": frontmatter.get("name"),
        "category": entry.category,
        "path": str(entry.path),
        "owner": {"kind": entry.owner_kind, "id": entry.owner_id},
        "active_targets": [
            target for target in repo.skill_activation().get(entry.qualified_id, {})
        ],
        "source": source,
        "metadata": repo.metadata_record(entry.qualified_id),
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
    tags: list[str],
    policy: str,
    replace: bool = False,
) -> ChangeSet:
    _validate_category(repo, category)
    skill_name = name or snapshot.declared_name or snapshot.path.name
    _validate_name(skill_name)
    metadata_record = _metadata_record(
        repo,
        description=description or snapshot.description,
        trigger=trigger,
        recommendation=recommendation,
        tags=tags,
    )

    standalone_ref = AssetRef.standalone_skill(skill_name).canonical
    existing = repo.skill_registry().get(standalone_ref)
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
    tags: list[str] | None = None,
) -> ChangeSet:
    entry = repo.require_skill(name)
    ref = entry.qualified_id
    current = dict(repo.metadata_record(ref) or {})
    if description is not None:
        current["description"] = description
    if trigger is not None:
        current["trigger"] = trigger
    if recommendation is not None:
        current["recommendation"] = recommendation
    if dependencies is not None:
        current["dependencies"] = list(dict.fromkeys(dependencies))
    if tags is not None:
        current["tags"] = tags
    validated = _metadata_record(
        repo,
        description=current.get("description", ""),
        trigger=current.get("trigger", ""),
        recommendation=current.get("recommendation"),
        dependencies=current.get("dependencies"),
        tags=current.get("tags", []),
    )
    if entry.owner_kind == "plugin":
        validated["category"] = current.get("category", entry.category)
    changed = repo.set_metadata_record(ref, validated)
    return ChangeSet(
        changed={"metadata"} if changed else set(),
        effects={Effect.DOCS_BUILD, Effect.CHECK} if changed else set(),
        details={"skill": ref},
    )


def rename_skill(repo: Repository, old_name: str, new_name: str) -> ChangeSet:
    entry = repo.require_skill(old_name)
    if entry.owner_kind == "plugin":
        raise SkillError("Plugin-owned Skill 不能单独重命名；请管理完整 Plugin")
    old_ref = entry.qualified_id
    frontmatter = parse_skill_frontmatter(
        (entry.path / "SKILL.md").read_text(encoding="utf-8")
    )
    declared_name = str(frontmatter.get("name") or old_name)
    _validate_name(new_name)
    if old_name == new_name:
        return ChangeSet(details={"skill": old_name})
    try:
        repo.require_skill(new_name)
    except RepositoryError:
        pass
    else:
        raise SkillError(f"技能名已存在：{new_name}")
    destination = entry.path.with_name(new_name)
    os.replace(entry.path, destination)
    repo.refresh()

    new_ref = AssetRef.standalone_skill(new_name).canonical
    desired = repo.read_desired_installations()
    for target in desired["targets"].values():
        target["skills"] = [
            new_ref if item == old_ref else item for item in target.get("skills", [])
        ]
    repo.write_desired_installations(desired)
    repo.write_text_if_changed(
        repo.active_path,
        ACTIVE_HEADER
        + "\n".join(
            new_name if name == entry.name else name
            for name in _legacy_active_names(repo.active_path)
        )
        + "\n",
    )

    sources = repo.read_sources()
    source_key = old_ref if old_ref in sources["skills"] else entry.name
    if source_key in sources["skills"]:
        source = sources["skills"].pop(source_key)
        if declared_name != new_name:
            source["source_name"] = declared_name
        else:
            source.pop("source_name", None)
        sources["skills"][new_ref] = source
        repo.write_sources(sources)

    metadata = repo.read_metadata()
    metadata_key = old_ref if old_ref in metadata["skills"] else entry.name
    if metadata_key in metadata["skills"]:
        metadata["skills"][new_ref] = metadata["skills"].pop(metadata_key)
    for record in metadata["skills"].values():
        dependencies = record.get("dependencies")
        if isinstance(dependencies, list):
            record["dependencies"] = [
                new_ref if dependency in {old_ref, entry.name} else dependency
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
    if entry.owner_kind == "plugin":
        metadata = dict(repo.metadata_record(entry.qualified_id) or {})
        metadata["category"] = category
        changed = repo.set_metadata_record(entry.qualified_id, metadata)
        repo.refresh()
        return ChangeSet(
            changed={"metadata"} if changed else set(),
            effects={Effect.DOCS_BUILD, Effect.CHECK} if changed else set(),
            details={"skill": entry.qualified_id, "category": category},
        )
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
    if entry.owner_kind == "plugin":
        raise SkillError("Plugin-owned Skill 不能单独删除；请使用 plugin remove")
    ref = entry.qualified_id
    metadata = repo.read_metadata()
    dependents: list[str] = []
    for other_name, record in metadata["skills"].items():
        if ref in record.get("dependencies", []) or entry.name in record.get(
            "dependencies", []
        ):
            dependents.append(other_name)
            record["dependencies"] = [
                dependency
                for dependency in record["dependencies"]
                if dependency not in {ref, entry.name}
            ]

    shutil.rmtree(entry.path)
    repo.refresh()
    desired = repo.read_desired_installations()
    for target in desired["targets"].values():
        target["skills"] = [item for item in target.get("skills", []) if item != ref]
    repo.write_desired_installations(desired)
    repo.remove_source_record(ref)
    metadata["skills"].pop(ref, None)
    metadata["skills"].pop(entry.name, None)
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
    repo: Repository,
    *,
    description: Any,
    trigger: Any,
    recommendation: Any,
    dependencies: Any = None,
    tags: Any,
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
        "tags": normalize_tags(repo, tags),
    }
    if dependencies:
        if not isinstance(dependencies, list) or any(
            not isinstance(item, str) or not item for item in dependencies
        ):
            raise SkillError("metadata dependencies 必须是技能名数组")
        normalized_dependencies = [
            repo.resolve_skill_ref(dependency).canonical for dependency in dependencies
        ]
        record["dependencies"] = list(dict.fromkeys(normalized_dependencies))
    return record


def _legacy_active_names(path: Any) -> list[str]:
    names: list[str] = []
    if not path.is_file():
        return names
    for line in path.read_text(encoding="utf-8").splitlines():
        name = line.split("#", 1)[0].strip()
        if name and name not in names:
            names.append(name)
    return names
