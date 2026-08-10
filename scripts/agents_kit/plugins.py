from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any

from .models import (
    AssetRef,
    ChangeSet,
    ComponentInventory,
    Effect,
    EmbeddedSkillSpec,
    MergeState,
    PluginManifestSpec,
    PluginSnapshot,
    PluginSpec,
    PluginTargetSpec,
    SourceSpec,
    StandaloneTargetSpec,
    UpdateDecision,
    parse_skill_frontmatter,
)
from .taxonomy import normalize_tags

if TYPE_CHECKING:
    from .repository import Repository

PLUGIN_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")
TARGETS = ("claude", "codex")
SUPPORT_STATES = {"full", "partial", "review", "unsupported"}
AUTHORITIES = {"upstream", "local"}
STANDALONE_MODES = {"self_contained", "plugin_only", "unsupported"}
TRANSPORT_IGNORES = {
    ".git",
    ".DS_Store",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
}
TRANSPORT_SUFFIX_IGNORES = {".pyc"}
KNOWN_TOP_LEVEL = {
    ".agents",
    ".app.json",
    ".claude-plugin",
    ".codex-plugin",
    ".lsp.json",
    ".mcp.json",
    "CHANGELOG",
    "CHANGELOG.md",
    "LICENSE",
    "LICENSE.md",
    "README",
    "README.md",
    "agents",
    "assets",
    "bin",
    "commands",
    "evals",
    "hooks",
    "monitors",
    "output-styles",
    "scripts",
    "settings.json",
    "skills",
    "themes",
    "workflows",
}
COMPONENT_ROOTS = {
    "skills": "skills",
    "commands": "commands",
    "agents": "agents",
    "hooks": "hooks",
    "workflows": "workflows",
    "output_styles": "output-styles",
    "themes": "themes",
    "monitors": "monitors",
    "executables": "bin",
    "scripts": "scripts",
    "assets": "assets",
    "evals": "evals",
}
SPECIAL_COMPONENTS = {
    "mcp_servers": ".mcp.json",
    "apps": ".app.json",
    "lsp_servers": ".lsp.json",
    "settings": "settings.json",
    "claude_manifest": ".claude-plugin/plugin.json",
    "codex_manifest": ".codex-plugin/plugin.json",
}
EXECUTABLE_SUFFIXES = {
    ".bash",
    ".command",
    ".exe",
    ".js",
    ".mjs",
    ".py",
    ".sh",
    ".ts",
    ".zsh",
}


class PluginError(RuntimeError):
    pass


@dataclass(frozen=True)
class PluginStatePlan:
    metadata: dict[str, Any]
    sources: dict[str, Any]
    desired_installations: dict[str, Any]
    duplicate_skill_removals: tuple[Path, ...] = ()


def load_plugin_spec(root: Path) -> PluginSpec:
    sidecar_path = root / "agents-kit.plugin.json"
    try:
        raw = json.loads(sidecar_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise PluginError(f"Plugin 缺 agents-kit.plugin.json：{root}") from exc
    except json.JSONDecodeError as exc:
        raise PluginError(f"Plugin sidecar JSON 无效：{sidecar_path}: {exc}") from exc
    if not isinstance(raw, dict) or raw.get("schema_version") != 2:
        raise PluginError(f"{sidecar_path}: schema_version 必须是 2")

    package_id = raw.get("package_id")
    if not isinstance(package_id, str) or not PLUGIN_ID_PATTERN.fullmatch(package_id):
        raise PluginError(f"{sidecar_path}: package_id 无效")
    if root.name != package_id:
        raise PluginError(
            f"Plugin 目录名与 package_id 不一致：{root.name} != {package_id}"
        )

    upstream_targets_raw = raw.get("upstream_targets", [])
    if not isinstance(upstream_targets_raw, list) or any(
        target not in TARGETS for target in upstream_targets_raw
    ):
        raise PluginError(f"{sidecar_path}: upstream_targets 无效")
    upstream_targets = frozenset(upstream_targets_raw)

    targets_raw = raw.get("targets")
    if not isinstance(targets_raw, dict):
        raise PluginError(f"{sidecar_path}: targets 必须是对象")
    targets: dict[str, PluginTargetSpec] = {}
    for target, value in targets_raw.items():
        if target not in TARGETS or not isinstance(value, dict):
            raise PluginError(f"{sidecar_path}: target 无效：{target}")
        support = value.get("support")
        if support not in SUPPORT_STATES:
            raise PluginError(f"{sidecar_path}: {target}.support 无效")
        limitations = value.get("limitations", [])
        if not isinstance(limitations, list) or any(
            not isinstance(item, str) or not item for item in limitations
        ):
            raise PluginError(f"{sidecar_path}: {target}.limitations 无效")
        if support == "partial" and not limitations:
            raise PluginError(f"{sidecar_path}: partial target 必须声明 limitations")
        manifest = _parse_manifest_spec(
            root,
            target,
            value.get("manifest"),
            sidecar_path=sidecar_path,
            required=support != "unsupported",
        )
        marketplace = value.get("marketplace", {})
        if not isinstance(marketplace, dict) or any(
            not isinstance(key, str) or not isinstance(item, str)
            for key, item in marketplace.items()
        ):
            raise PluginError(f"{sidecar_path}: {target}.marketplace 无效")
        targets[target] = PluginTargetSpec(
            support=support,
            manifest=manifest,
            limitations=tuple(limitations),
            marketplace=dict(marketplace),
        )

    embedded_raw = raw.get("embedded_skills", {})
    if not isinstance(embedded_raw, dict):
        raise PluginError(f"{sidecar_path}: embedded_skills 必须是对象")
    embedded_skills: dict[str, EmbeddedSkillSpec] = {}
    for skill_id, value in embedded_raw.items():
        if (
            not isinstance(skill_id, str)
            or not PLUGIN_ID_PATTERN.fullmatch(skill_id)
            or not isinstance(value, dict)
        ):
            raise PluginError(f"{sidecar_path}: embedded Skill 无效：{skill_id}")
        standalone_raw = value.get("standalone", {})
        if not isinstance(standalone_raw, dict):
            raise PluginError(f"{sidecar_path}: {skill_id}.standalone 必须是对象")
        standalone: dict[str, StandaloneTargetSpec] = {}
        for target in TARGETS:
            target_raw = standalone_raw.get(
                target,
                {
                    "mode": "plugin_only",
                    "reason": "未声明独立安装资格",
                },
            )
            if not isinstance(target_raw, dict):
                raise PluginError(
                    f"{sidecar_path}: {skill_id}.{target} 独立安装声明无效"
                )
            mode = target_raw.get("mode")
            reason = target_raw.get("reason", "")
            if mode not in STANDALONE_MODES or not isinstance(reason, str):
                raise PluginError(
                    f"{sidecar_path}: {skill_id}.{target} 独立安装声明无效"
                )
            if mode != "self_contained" and not reason:
                raise PluginError(
                    f"{sidecar_path}: {skill_id}.{target} 必须说明限制原因"
                )
            standalone[target] = StandaloneTargetSpec(mode=mode, reason=reason)
        dependencies = value.get("dependencies", [])
        if not isinstance(dependencies, list) or any(
            not isinstance(item, str) or not item for item in dependencies
        ):
            raise PluginError(f"{sidecar_path}: {skill_id}.dependencies 无效")
        embedded_skills[skill_id] = EmbeddedSkillSpec(
            standalone=standalone,
            dependencies=tuple(dependencies),
        )

    local_paths = raw.get("local_paths", [])
    if not isinstance(local_paths, list) or any(
        not isinstance(item, str) or not item for item in local_paths
    ):
        raise PluginError(f"{sidecar_path}: local_paths 必须是路径数组")
    normalized_local_paths = tuple(
        _validate_relative_path(root, item, field="local_paths") for item in local_paths
    )
    upstream_manifest_paths: set[str] = set()
    for target, target_spec in targets.items():
        manifest = target_spec.manifest
        if target in upstream_targets:
            if manifest is None or manifest.authority != "upstream":
                raise PluginError(
                    f"{sidecar_path}: {target} 在 upstream_targets 中，"
                    "manifest authority 必须是 upstream"
                )
            upstream_manifest_paths.add(manifest.path)
        elif manifest is not None and manifest.authority == "upstream":
            raise PluginError(
                f"{sidecar_path}: {target} manifest 是 upstream authority，"
                "但 target 未列入 upstream_targets"
            )
    authority_conflicts = sorted(
        local_path
        for local_path in normalized_local_paths
        if any(
            _relative_paths_overlap(local_path, manifest_path)
            for manifest_path in upstream_manifest_paths
        )
    )
    if authority_conflicts:
        raise PluginError(
            f"{sidecar_path}: local_paths 与 upstream manifest authority 冲突："
            + ", ".join(authority_conflicts)
        )
    return PluginSpec(
        package_id=package_id,
        root=root,
        upstream_targets=upstream_targets,
        targets=targets,
        embedded_skills=embedded_skills,
        local_paths=normalized_local_paths,
    )


def inventory_plugin(root: Path) -> ComponentInventory:
    known: dict[str, tuple[Path, ...]] = {}
    known_roots = set(KNOWN_TOP_LEVEL)
    known_roots.add("agents-kit.plugin.json")
    for component, directory_name in COMPONENT_ROOTS.items():
        directory = root / directory_name
        if not directory.exists():
            continue
        if component == "skills":
            paths = tuple(
                sorted(
                    (
                        path.relative_to(root)
                        for path in directory.iterdir()
                        if path.is_dir() and (path / "SKILL.md").is_file()
                    ),
                    key=lambda path: path.as_posix(),
                )
            )
        else:
            paths = (Path(directory_name),)
        known[component] = paths
    for component, relative in SPECIAL_COMPONENTS.items():
        if (root / relative).exists():
            known[component] = (Path(relative),)

    unknown: list[Path] = []
    executable: list[Path] = []
    binary: list[Path] = []
    for path in _plugin_files(root):
        relative = path.relative_to(root)
        if relative.parts[0] not in known_roots:
            unknown.append(relative)
        if _is_executable(path):
            executable.append(relative)
        if _is_binary(path):
            binary.append(relative)
    return ComponentInventory(
        known_components=dict(sorted(known.items())),
        unknown_paths=tuple(sorted(unknown, key=lambda item: item.as_posix())),
        executable_paths=tuple(sorted(executable, key=lambda item: item.as_posix())),
        binary_paths=tuple(sorted(binary, key=lambda item: item.as_posix())),
    )


def plugin_file_paths(root: Path) -> tuple[str, ...]:
    return tuple(
        path.relative_to(root).as_posix()
        for path in sorted(_plugin_files(root), key=lambda item: item.as_posix())
    )


def manifest_data(root: Path, target: str) -> dict[str, Any] | None:
    relative = {
        "claude": ".claude-plugin/plugin.json",
        "codex": ".codex-plugin/plugin.json",
    }[target]
    path = root / relative
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise PluginError(f"Manifest JSON 无效：{path}: {exc}") from exc
    if not isinstance(data, dict):
        raise PluginError(f"Manifest 顶层必须是对象：{path}")
    return data


def inspect_plugin_directory(
    root: Path,
    *,
    revision: str | None,
    source_spec: SourceSpec,
) -> PluginSnapshot:
    _validate_plugin_symlinks(root)
    manifests = {target: manifest_data(root, target) for target in TARGETS}
    upstream_targets = frozenset(
        target for target, manifest in manifests.items() if manifest is not None
    )
    if not upstream_targets:
        raise PluginError(
            "候选目录不是 Plugin：缺 .claude-plugin/plugin.json "
            "和 .codex-plugin/plugin.json"
        )
    package_ids = {
        str(manifest.get("name"))
        for manifest in manifests.values()
        if manifest is not None and manifest.get("name")
    }
    if len(package_ids) > 1:
        raise PluginError("两个平台 manifest 的 name 不一致")
    package_id = next(iter(package_ids), root.name)
    if not PLUGIN_ID_PATTERN.fullmatch(package_id):
        raise PluginError(f"Plugin ID 无效：{package_id}")
    return PluginSnapshot(
        package_id=package_id,
        root=root,
        upstream_targets=upstream_targets,
        component_inventory=inventory_plugin(root),
        upstream_digest=_hash_paths(root, plugin_file_paths(root)),
        revision=revision,
        spec=source_spec,
    )


def import_plugin_snapshot(
    repo: Repository,
    snapshot: PluginSnapshot,
    *,
    category: str,
    targets: tuple[str, ...],
    tags: list[str],
    replace: bool = False,
) -> ChangeSet:
    if category not in repo.categories:
        raise PluginError(f"未知分类：{category}")
    invalid_targets = sorted(set(targets) - set(TARGETS))
    if invalid_targets:
        raise PluginError("未知目标：" + ", ".join(invalid_targets))
    normalized_tags = normalize_tags(repo, tags)
    destination = repo.plugins_dir / snapshot.package_id
    if destination.exists() and not replace:
        raise PluginError(f"Plugin 已存在：{snapshot.package_id}")

    upstream_paths = plugin_file_paths(snapshot.root)
    duplicates = _standalone_duplicates(repo, snapshot.root)
    active_refs = {
        raw_ref
        for record in repo.read_desired_installations()["targets"].values()
        for raw_ref in record.get("skills", [])
    }
    active_duplicates = [
        entry.qualified_id
        for entry in duplicates.values()
        if entry.qualified_id in active_refs
    ]
    if active_duplicates:
        raise PluginError(
            "这些独立 Skill 当前已安装，不能自动改成 plugin_only："
            + ", ".join(active_duplicates)
        )
    for skill_id, entry in duplicates.items():
        candidate = snapshot.root / "skills" / skill_id
        if repo.hash_directory(entry.path) != repo.hash_directory(candidate):
            raise PluginError(
                f"同名独立 Skill 与 Plugin 内容不同，需要人工迁移：{skill_id}"
            )

    stage_parent = Path(tempfile.mkdtemp(prefix="agents-kit-plugin-import-"))
    stage = stage_parent / snapshot.package_id
    managed_upstream_targets = (
        frozenset() if snapshot.spec.provider == "local" else snapshot.upstream_targets
    )
    try:
        shutil.copytree(
            snapshot.root,
            stage,
            symlinks=True,
            ignore=shutil.ignore_patterns(".git", "__pycache__", "*.pyc", ".DS_Store"),
        )
        sidecar = _build_sidecar(
            stage,
            package_id=snapshot.package_id,
            upstream_targets=managed_upstream_targets,
            requested_targets=frozenset(targets),
        )
        _write_json(stage / "agents-kit.plugin.json", sidecar)
        candidate_spec = load_plugin_spec(stage)
        embedded_ids = _embedded_skill_ids(stage)
        plan = _plan_plugin_import(
            repo,
            stage,
            snapshot=snapshot,
            category=category,
            tags=normalized_tags,
            duplicates=duplicates,
            upstream_paths=upstream_paths,
            candidate_spec=candidate_spec,
        )
        repo.install_plugin_directory(stage, destination, replace=replace)
        repo.write_metadata(plan.metadata)
        repo.write_sources(plan.sources)
        desired_changed = repo.write_desired_installations(plan.desired_installations)
        for path in plan.duplicate_skill_removals:
            shutil.rmtree(path)
    finally:
        shutil.rmtree(stage_parent, ignore_errors=True)

    repo.refresh()
    changed = {"plugins", "metadata", "sources"}
    if desired_changed:
        changed.add("desired_installations")
    return ChangeSet(
        changed=changed,
        effects={Effect.DOCS_BUILD, Effect.CHECK},
        details={
            "plugin": snapshot.package_id,
            "upstream_targets": sorted(managed_upstream_targets),
            "embedded_skills": embedded_ids,
            "migrated_standalone_skills": sorted(duplicates),
        },
    )


def list_plugins(repo: Repository) -> list[dict[str, Any]]:
    sources = repo.read_sources()["plugins"]
    rows: list[dict[str, Any]] = []
    for plugin_id, spec in repo.plugin_inventory().items():
        inventory = inventory_plugin(spec.root)
        rows.append(
            {
                "id": plugin_id,
                "ref": AssetRef.plugin(plugin_id).canonical,
                "path": str(spec.root),
                "tracked": plugin_id in sources,
                "upstream_targets": sorted(spec.upstream_targets),
                "targets": {
                    target: {
                        "support": value.support,
                        "authority": (
                            value.manifest.authority if value.manifest else None
                        ),
                    }
                    for target, value in sorted(spec.targets.items())
                },
                "skills": sorted(spec.embedded_skills),
                "unknown_paths": [path.as_posix() for path in inventory.unknown_paths],
            }
        )
    return rows


def show_plugin(repo: Repository, plugin_id: str) -> dict[str, Any]:
    spec = repo.require_plugin(plugin_id)
    inventory = inventory_plugin(spec.root)
    return {
        "id": spec.package_id,
        "ref": AssetRef.plugin(spec.package_id).canonical,
        "path": str(spec.root),
        "upstream_targets": sorted(spec.upstream_targets),
        "targets": {
            target: {
                "support": value.support,
                "limitations": list(value.limitations),
                "manifest": (
                    {
                        "path": value.manifest.path,
                        "authority": value.manifest.authority,
                    }
                    if value.manifest
                    else None
                ),
            }
            for target, value in sorted(spec.targets.items())
        },
        "embedded_skills": {
            skill_id: {
                "standalone": {
                    target: {
                        "mode": target_spec.mode,
                        "reason": target_spec.reason,
                    }
                    for target, target_spec in sorted(skill.standalone.items())
                },
                "dependencies": list(skill.dependencies),
            }
            for skill_id, skill in sorted(spec.embedded_skills.items())
        },
        "inventory": {
            "known_components": {
                name: [path.as_posix() for path in paths]
                for name, paths in inventory.known_components.items()
            },
            "unknown_paths": [path.as_posix() for path in inventory.unknown_paths],
            "executable_paths": [
                path.as_posix() for path in inventory.executable_paths
            ],
            "binary_paths": [path.as_posix() for path in inventory.binary_paths],
        },
        "source": repo.read_sources()["plugins"].get(spec.package_id),
    }


def classify_plugin_update(
    repo: Repository,
    plugin_id: str,
    snapshot: PluginSnapshot,
) -> dict[str, Any]:
    from .sources import classify_changed_paths

    spec = repo.require_plugin(plugin_id)
    if snapshot.package_id != spec.package_id:
        raise PluginError(
            f"Plugin 身份漂移：期望 {spec.package_id}，上游得到 {snapshot.package_id}"
        )
    record = repo.read_sources()["plugins"].get(spec.package_id)
    if record is None:
        raise PluginError(f"{plugin_id} 没有来源登记")
    resolved = record.get("resolved", {})
    base_digest = resolved.get("upstream_sha256")
    upstream_paths = resolved.get("upstream_paths", [])
    if not isinstance(base_digest, str) or not isinstance(upstream_paths, list):
        raise PluginError(f"{plugin_id} 的来源摘要不完整")
    local_digest = _hash_paths(spec.root, upstream_paths)
    remote_digest = snapshot.upstream_digest
    local_modified = local_digest != base_digest
    upstream_modified = remote_digest != base_digest
    if not upstream_modified:
        merge_state = MergeState.LOCAL_ONLY if local_modified else MergeState.UNCHANGED
        return {
            "status": merge_state.value,
            "merge_state": merge_state.value,
            "risk_class": None,
            "decision": None,
            "local_modified": local_modified,
            "upstream_modified": False,
            "local_sha256": local_digest,
            "remote_sha256": remote_digest,
            "resolved_sha256": base_digest,
            "changed_paths": [],
        }
    merge_state = MergeState.DIVERGED if local_modified else MergeState.UPSTREAM_ONLY
    remote_paths = set(plugin_file_paths(snapshot.root))
    changed_paths = _changed_file_paths(
        spec.root,
        snapshot.root,
        set(upstream_paths) | remote_paths,
    )
    risk_class = classify_changed_paths(
        spec.root,
        snapshot.root,
        changed_paths,
    )
    local_owned = _local_owned_paths(spec)
    authority_conflicts = sorted(
        path
        for path in remote_paths
        if any(path == root or path.startswith(f"{root}/") for root in local_owned)
    )
    if authority_conflicts:
        decision = UpdateDecision.BLOCKED
    elif merge_state == MergeState.UPSTREAM_ONLY and risk_class.value == "docs_only":
        decision = UpdateDecision.AUTO_APPLY
    else:
        decision = UpdateDecision.REVIEW_REQUIRED
    return {
        "status": (
            "safe_update"
            if decision == UpdateDecision.AUTO_APPLY
            else "review_required"
        ),
        "merge_state": merge_state.value,
        "risk_class": risk_class.value,
        "decision": decision.value,
        "local_modified": local_modified,
        "upstream_modified": True,
        "local_sha256": local_digest,
        "remote_sha256": remote_digest,
        "resolved_sha256": base_digest,
        "changed_paths": changed_paths,
        "authority_conflicts": authority_conflicts,
    }


def update_plugin_from_snapshot(
    repo: Repository,
    plugin_id: str,
    snapshot: PluginSnapshot,
) -> ChangeSet:
    comparison = classify_plugin_update(repo, plugin_id, snapshot)
    if comparison["merge_state"] == MergeState.DIVERGED.value:
        raise PluginError(f"{plugin_id} 本地和上游同时修改，不能自动覆盖")
    if comparison["decision"] == UpdateDecision.BLOCKED.value:
        raise PluginError(
            f"{plugin_id} 上游路径与本地 authority 冲突："
            + ", ".join(comparison["authority_conflicts"])
        )
    if not comparison["upstream_modified"]:
        return ChangeSet(details={"plugin": plugin_id, **comparison})

    current = repo.require_plugin(plugin_id)
    record = repo.read_sources()["plugins"][plugin_id]
    stage_parent = Path(tempfile.mkdtemp(prefix="agents-kit-plugin-update-"))
    stage = stage_parent / plugin_id
    try:
        shutil.copytree(
            snapshot.root,
            stage,
            symlinks=True,
            ignore=shutil.ignore_patterns(".git", "__pycache__", "*.pyc", ".DS_Store"),
        )
        for relative in _local_owned_paths(current):
            source = current.root / relative
            destination = stage / relative
            if not source.exists():
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, destination, dirs_exist_ok=True, symlinks=True)
            else:
                shutil.copy2(source, destination)
        _sync_embedded_sidecar(stage)
        candidate_spec = load_plugin_spec(stage)
        plan = _plan_plugin_update(
            repo,
            stage,
            plugin_id=plugin_id,
            snapshot=snapshot,
            source_record=record,
            candidate_spec=candidate_spec,
        )
        repo.install_plugin_directory(stage, current.root, replace=True)
        repo.write_metadata(plan.metadata)
        repo.write_sources(plan.sources)
        desired_changed = repo.write_desired_installations(plan.desired_installations)
    finally:
        shutil.rmtree(stage_parent, ignore_errors=True)

    repo.refresh()
    changed = {"plugins", "metadata", "sources"}
    if desired_changed:
        changed.add("desired_installations")
    return ChangeSet(
        changed=changed,
        effects={Effect.DOCS_BUILD, Effect.CHECK},
        details={"plugin": plugin_id, **comparison},
    )


def detach_plugin(repo: Repository, plugin_id: str) -> ChangeSet:
    repo.require_plugin(plugin_id)
    changed = repo.remove_plugin_source_record(plugin_id)
    return ChangeSet(
        changed={"sources"} if changed else set(),
        effects={Effect.DOCS_BUILD, Effect.CHECK} if changed else set(),
        details={"plugin": plugin_id, "detached": changed},
    )


def remove_plugin(repo: Repository, plugin_id: str) -> ChangeSet:
    spec = repo.require_plugin(plugin_id)
    plugin_ref = AssetRef.plugin(plugin_id).canonical
    desired = repo.read_desired_installations()
    for target in desired["targets"].values():
        target["plugins"] = [
            item
            for item in target.get("plugins", [])
            if not isinstance(item, dict) or item.get("ref") != plugin_ref
        ]
        target["skills"] = [
            item
            for item in target.get("skills", [])
            if not item.startswith(f"skill:plugin/{plugin_id}/")
        ]
    repo.write_desired_installations(desired)
    metadata = repo.read_metadata()
    for key in list(metadata["skills"]):
        if key.startswith(f"skill:plugin/{plugin_id}/"):
            metadata["skills"].pop(key)
    repo.write_metadata(metadata)
    repo.remove_plugin_source_record(plugin_id)
    shutil.rmtree(spec.root)
    repo.refresh()
    return ChangeSet(
        changed={"plugins", "metadata", "sources", "desired_installations"},
        effects={Effect.GLOBAL_APPLY, Effect.DOCS_BUILD, Effect.CHECK},
        details={"plugin": plugin_id, "removed": True},
    )


def _build_sidecar(
    root: Path,
    *,
    package_id: str,
    upstream_targets: frozenset[str],
    requested_targets: frozenset[str],
) -> dict[str, Any]:
    targets: dict[str, Any] = {}
    local_paths: list[str] = []
    for target in TARGETS:
        manifest_relative = {
            "claude": ".claude-plugin/plugin.json",
            "codex": ".codex-plugin/plugin.json",
        }[target]
        if target in upstream_targets:
            support = "full"
            authority = "upstream"
        elif target in requested_targets:
            _create_target_manifest(root, target, package_id)
            support = "review"
            authority = "local"
            local_paths.append(manifest_relative)
        else:
            targets[target] = {
                "support": "unsupported",
                "limitations": ["尚未创建或验证该平台 manifest"],
            }
            continue
        target_spec: dict[str, Any] = {
            "support": support,
            "manifest": {
                "path": manifest_relative,
                "authority": authority,
            },
            "marketplace": _default_marketplace(target),
        }
        if support == "review":
            target_spec["limitations"] = ["尚未完成目标端安装与触发测试"]
        targets[target] = target_spec

    embedded_skills = {
        skill_id: {
            "standalone": {
                target: {
                    "mode": "plugin_only",
                    "reason": "尚未验证脱离 Plugin 根目录后的运行依赖",
                }
                for target in TARGETS
            },
            "dependencies": [],
        }
        for skill_id in _embedded_skill_ids(root)
    }
    return {
        "schema_version": 2,
        "package_id": package_id,
        "upstream_targets": sorted(upstream_targets),
        "targets": targets,
        "embedded_skills": embedded_skills,
        "local_paths": sorted(local_paths),
    }


def _create_target_manifest(root: Path, target: str, package_id: str) -> None:
    destination = (
        root
        / {
            "claude": ".claude-plugin/plugin.json",
            "codex": ".codex-plugin/plugin.json",
        }[target]
    )
    if destination.exists():
        return
    source_target = "codex" if target == "claude" else "claude"
    source = manifest_data(root, source_target) or {}
    common_keys = (
        "name",
        "version",
        "description",
        "author",
        "homepage",
        "repository",
        "license",
        "keywords",
    )
    manifest = {key: source[key] for key in common_keys if key in source}
    manifest["name"] = str(manifest.get("name") or package_id)
    if (root / "skills").is_dir():
        manifest["skills"] = "./skills/"
    destination.parent.mkdir(parents=True, exist_ok=True)
    _write_json(destination, manifest)


def _default_marketplace(target: str) -> dict[str, str]:
    if target == "codex":
        return {
            "category": "Developer Tools",
            "installation": "AVAILABLE",
            "authentication": "ON_INSTALL",
        }
    return {}


def _local_owned_paths(spec: PluginSpec) -> tuple[str, ...]:
    paths = {"agents-kit.plugin.json", *spec.local_paths}
    for target in spec.targets.values():
        if target.manifest and target.manifest.authority == "local":
            paths.add(target.manifest.path)
    return tuple(sorted(paths))


def _relative_paths_overlap(left: str, right: str) -> bool:
    return left == right or left.startswith(f"{right}/") or right.startswith(f"{left}/")


def _changed_file_paths(
    local_root: Path,
    remote_root: Path,
    candidates: set[str],
) -> list[str]:
    return sorted(
        relative
        for relative in candidates
        if _single_file_hash(local_root / relative)
        != _single_file_hash(remote_root / relative)
    )


def _single_file_hash(path: Path) -> str | None:
    if path.is_symlink():
        return f"link:{os.readlink(path)}"
    if not path.is_file():
        return None
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sync_embedded_sidecar(root: Path) -> None:
    path = root / "agents-kit.plugin.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    embedded = data.setdefault("embedded_skills", {})
    actual = set(_embedded_skill_ids(root))
    for skill_id in list(embedded):
        if skill_id not in actual:
            embedded.pop(skill_id)
    for skill_id in sorted(actual - set(embedded)):
        embedded[skill_id] = {
            "standalone": {
                target: {
                    "mode": "plugin_only",
                    "reason": "尚未验证脱离 Plugin 根目录后的运行依赖",
                }
                for target in TARGETS
            },
            "dependencies": [],
        }
    _write_json(path, data)


def _plan_plugin_import(
    repo: Repository,
    staged_plugin: Path,
    *,
    snapshot: PluginSnapshot,
    category: str,
    tags: list[str],
    duplicates: dict[str, Any],
    upstream_paths: tuple[str, ...],
    candidate_spec: PluginSpec,
) -> PluginStatePlan:
    metadata = repo.read_metadata()
    sources = repo.read_sources()
    desired = repo.read_desired_installations()
    plugin_id = snapshot.package_id
    prefix = f"skill:plugin/{plugin_id}/"
    embedded_ids = set(_embedded_skill_ids(staged_plugin))
    embedded_refs = {
        AssetRef.plugin_skill(plugin_id, skill_id).canonical
        for skill_id in embedded_ids
    }
    for key in list(metadata["skills"]):
        if key.startswith(prefix) and key not in embedded_refs:
            metadata["skills"].pop(key)
    for skill_id in sorted(embedded_ids):
        standalone_ref = AssetRef.standalone_skill(skill_id).canonical
        plugin_ref = AssetRef.plugin_skill(plugin_id, skill_id).canonical
        record = metadata["skills"].pop(standalone_ref, None) or metadata["skills"].pop(
            skill_id, None
        )
        generated = _default_skill_metadata(
            staged_plugin / "skills" / skill_id,
            tags=tags,
        )
        if record is None:
            record = generated
        record["category"] = category
        metadata["skills"][plugin_ref] = record
        sources["skills"].pop(standalone_ref, None)
        sources["skills"].pop(skill_id, None)
    _filter_removed_plugin_skills(desired, plugin_id, embedded_refs)

    if snapshot.spec.provider == "local":
        sources["plugins"].pop(plugin_id, None)
    else:
        sources["plugins"][plugin_id] = {
            "provider": snapshot.spec.provider,
            "locator": snapshot.spec.locator,
            "content_mode": "plugin_directory",
            "policy": repo.config["defaults"]["source_policy"],
            "resolved": {
                "revision": snapshot.revision,
                "upstream_sha256": snapshot.upstream_digest,
                "upstream_paths": list(upstream_paths),
            },
        }
    _validate_planned_desired(repo, desired, candidate_spec)
    return PluginStatePlan(
        metadata=metadata,
        sources=sources,
        desired_installations=desired,
        duplicate_skill_removals=tuple(entry.path for entry in duplicates.values()),
    )


def _plan_plugin_update(
    repo: Repository,
    staged_plugin: Path,
    *,
    plugin_id: str,
    snapshot: PluginSnapshot,
    source_record: dict[str, Any],
    candidate_spec: PluginSpec,
) -> PluginStatePlan:
    metadata = repo.read_metadata()
    sources = repo.read_sources()
    desired = repo.read_desired_installations()
    prefix = f"skill:plugin/{plugin_id}/"
    existing = {
        key.removeprefix(prefix): value
        for key, value in metadata["skills"].items()
        if key.startswith(prefix)
    }
    actual = set(_embedded_skill_ids(staged_plugin))
    for skill_id in set(existing) - actual:
        metadata["skills"].pop(f"{prefix}{skill_id}", None)
    template = next(iter(existing.values()), None)
    for skill_id in sorted(actual):
        current = existing.get(skill_id)
        if current is not None:
            _default_skill_metadata(
                staged_plugin / "skills" / skill_id,
                tags=list(current.get("tags", [])),
            )
            continue
        if template is None:
            raise PluginError(f"{plugin_id} 新增 {skill_id}，但没有可继承的 metadata")
        record = _default_skill_metadata(
            staged_plugin / "skills" / skill_id,
            tags=list(template.get("tags", [])),
        )
        record["category"] = template.get("category", "ai-building")
        metadata["skills"][f"{prefix}{skill_id}"] = record
    embedded_refs = {
        AssetRef.plugin_skill(plugin_id, skill_id).canonical for skill_id in actual
    }
    _filter_removed_plugin_skills(desired, plugin_id, embedded_refs)
    updated = dict(source_record)
    updated["resolved"] = {
        "revision": snapshot.revision,
        "upstream_sha256": snapshot.upstream_digest,
        "upstream_paths": list(plugin_file_paths(snapshot.root)),
    }
    sources["plugins"][plugin_id] = updated
    _validate_planned_desired(repo, desired, candidate_spec)
    return PluginStatePlan(
        metadata=metadata,
        sources=sources,
        desired_installations=desired,
    )


def _filter_removed_plugin_skills(
    desired: dict[str, Any],
    plugin_id: str,
    embedded_refs: set[str],
) -> None:
    plugin_prefix = f"skill:plugin/{plugin_id}/"
    for target in desired["targets"].values():
        target["skills"] = [
            ref
            for ref in target.get("skills", [])
            if not ref.startswith(plugin_prefix) or ref in embedded_refs
        ]


def _validate_planned_desired(
    repo: Repository,
    desired: dict[str, Any],
    candidate_spec: PluginSpec,
) -> None:
    from .installation import InstallationError, require_valid_desired_installations

    try:
        require_valid_desired_installations(
            repo,
            desired,
            plugin_overrides={candidate_spec.package_id: candidate_spec},
        )
    except InstallationError as exc:
        raise PluginError(f"Plugin 候选安装状态无效：{exc}") from exc


def _standalone_duplicates(repo: Repository, plugin_root: Path) -> dict[str, Any]:
    embedded = set(_embedded_skill_ids(plugin_root))
    return {
        entry.name: entry
        for entry in repo.skill_registry().values()
        if entry.owner_kind == "standalone" and entry.name in embedded
    }


def _embedded_skill_ids(root: Path) -> list[str]:
    skills_root = root / "skills"
    if not skills_root.is_dir():
        return []
    return sorted(
        path.name
        for path in skills_root.iterdir()
        if path.is_dir() and (path / "SKILL.md").is_file()
    )


def _default_skill_metadata(root: Path, *, tags: list[str]) -> dict[str, Any]:
    try:
        frontmatter = parse_skill_frontmatter(
            (root / "SKILL.md").read_text(encoding="utf-8")
        )
    except (OSError, ValueError, RuntimeError) as exc:
        raise PluginError(f"{root}: 无法生成 Skill metadata：{exc}") from exc
    description = str(frontmatter.get("description") or "").strip()
    if not description:
        raise PluginError(f"{root}: Skill description 为空")
    return {
        "recommendation": 3,
        "description": " ".join(description.split()),
        "trigger": "",
        "tags": list(tags),
    }


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _hash_paths(root: Path, paths: tuple[str, ...] | list[str]) -> str:
    import hashlib

    digest = hashlib.sha256()
    for relative in sorted(paths):
        digest.update(relative.encode("utf-8"))
        path = root / relative
        if path.is_symlink():
            digest.update(b"L")
            digest.update(os.readlink(path).encode("utf-8"))
            continue
        if not path.is_file():
            digest.update(b"MISSING")
            continue
        digest.update(b"F")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def _parse_manifest_spec(
    root: Path,
    target: str,
    value: Any,
    *,
    sidecar_path: Path,
    required: bool,
) -> PluginManifestSpec | None:
    if value is None and not required:
        return None
    if not isinstance(value, dict):
        raise PluginError(f"{sidecar_path}: {target}.manifest 必须是对象")
    relative = value.get("path")
    authority = value.get("authority")
    if not isinstance(relative, str) or authority not in AUTHORITIES:
        raise PluginError(f"{sidecar_path}: {target}.manifest 无效")
    normalized = _validate_relative_path(root, relative, field=f"{target}.manifest")
    expected = {
        "claude": ".claude-plugin/plugin.json",
        "codex": ".codex-plugin/plugin.json",
    }[target]
    if normalized != expected:
        raise PluginError(f"{sidecar_path}: {target}.manifest 必须位于 {expected}")
    manifest_path = root / normalized
    if not manifest_path.is_file():
        raise PluginError(f"{sidecar_path}: manifest 不存在：{normalized}")
    return PluginManifestSpec(path=normalized, authority=authority)


def _validate_relative_path(root: Path, value: str, *, field: str) -> str:
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise PluginError(f"{field} 路径越界：{value}")
    candidate = (root / Path(*path.parts)).resolve()
    resolved_root = root.resolve()
    if candidate != resolved_root and resolved_root not in candidate.parents:
        raise PluginError(f"{field} 路径越界：{value}")
    return path.as_posix()


def _plugin_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for directory, dirs, names in os.walk(root):
        kept_dirs: list[str] = []
        for name in sorted(dirs):
            if name in TRANSPORT_IGNORES:
                continue
            path = Path(directory) / name
            if path.is_symlink():
                files.append(path)
            else:
                kept_dirs.append(name)
        dirs[:] = kept_dirs
        for name in sorted(names):
            path = Path(directory) / name
            if name in TRANSPORT_IGNORES or path.suffix in TRANSPORT_SUFFIX_IGNORES:
                continue
            files.append(path)
    return files


def _validate_plugin_symlinks(root: Path) -> None:
    resolved_root = root.resolve()
    for path in root.rglob("*"):
        if not path.is_symlink():
            continue
        target = path.resolve()
        if target != resolved_root and resolved_root not in target.parents:
            raise PluginError(f"Plugin 包含越界软链接：{path}")


def _is_executable(path: Path) -> bool:
    try:
        mode_executable = bool(path.stat().st_mode & 0o111)
    except OSError:
        mode_executable = False
    return mode_executable or path.suffix.lower() in EXECUTABLE_SUFFIXES


def _is_binary(path: Path) -> bool:
    try:
        data = path.read_bytes()[:8192]
    except OSError:
        return True
    if b"\0" in data:
        return True
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False
