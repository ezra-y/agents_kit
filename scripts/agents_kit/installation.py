from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .models import AssetRef, ChangeSet, Effect, PluginSpec
from .plugins import _hash_paths, manifest_data, plugin_file_paths
from .repository import Repository


class InstallationError(RuntimeError):
    pass


SUPPORTED_PLUGIN_DISTRIBUTIONS = {
    "claude": frozenset({"skills-dir"}),
    "codex": frozenset({"marketplace"}),
}


def validate_desired_installations(
    repo: Repository,
    desired: dict[str, Any],
    *,
    inventory: dict[str, Any] | None = None,
    plugin_overrides: dict[str, PluginSpec] | None = None,
) -> dict[str, Any]:
    inventory = inventory or repo.skill_registry()
    plugin_inventory = repo.plugin_inventory()
    plugin_inventory.update(plugin_overrides or {})
    problems: list[str] = []
    missing: list[str] = []
    destinations: dict[tuple[str, str], str] = {}
    count = 0
    targets = desired.get("targets")
    if not isinstance(targets, dict):
        return {
            "count": 0,
            "missing": [],
            "problems": ["desired-installations.json 缺 targets 对象"],
        }
    missing_targets = sorted(set(SUPPORTED_PLUGIN_DISTRIBUTIONS) - set(targets))
    if missing_targets:
        problems.append(
            "desired-installations.json 缺目标：" + ", ".join(missing_targets)
        )
    for target, record in targets.items():
        if target not in SUPPORTED_PLUGIN_DISTRIBUTIONS or not isinstance(record, dict):
            problems.append(f"desired-installations.json target 无效：{target}")
            continue
        if record.get("scope") != "user":
            problems.append(f"desired-installations.json {target}.scope 只支持 user")
        skills = record.get("skills", [])
        plugin_items = record.get("plugins", [])
        if not isinstance(skills, list) or not isinstance(plugin_items, list):
            problems.append(f"desired-installations.json {target} 清单无效")
            continue
        seen_skills: set[str] = set()
        for raw_ref in skills:
            count += 1
            if not isinstance(raw_ref, str):
                missing.append(str(raw_ref))
                continue
            try:
                ref = AssetRef.parse(raw_ref)
            except ValueError:
                missing.append(raw_ref)
                continue
            entry = inventory.get(ref.canonical)
            if ref.kind != "skill" or entry is None:
                missing.append(raw_ref)
                continue
            if ref.canonical in seen_skills:
                problems.append(f"{target} 重复声明 {ref.canonical}")
            seen_skills.add(ref.canonical)
            if entry.owner_kind == "plugin":
                plugin = plugin_inventory.get(entry.owner_id or "")
                if plugin is None:
                    missing.append(raw_ref)
                    continue
                embedded = plugin.embedded_skills.get(entry.name)
                target_spec = embedded.standalone.get(target) if embedded else None
                if target_spec is None or target_spec.mode != "self_contained":
                    problems.append(f"{raw_ref}: {target} 不允许脱离 Plugin 单独安装")
            destination = (target, entry.name)
            previous = destinations.get(destination)
            if previous and previous != ref.canonical:
                problems.append(f"{target} 投射路径冲突：{previous} 与 {ref.canonical}")
            destinations[destination] = ref.canonical

        seen_plugins: set[str] = set()
        for item in plugin_items:
            count += 1
            if not isinstance(item, dict):
                missing.append(str(item))
                continue
            raw_ref = item.get("ref")
            try:
                ref = AssetRef.parse(str(raw_ref))
            except ValueError:
                missing.append(str(raw_ref))
                continue
            if ref.kind != "plugin" or ref.local_id not in plugin_inventory:
                missing.append(str(raw_ref))
                continue
            if ref.canonical in seen_plugins:
                problems.append(f"{target} 重复声明 {ref.canonical}")
            seen_plugins.add(ref.canonical)
            distribution = item.get("distribution")
            supported = SUPPORTED_PLUGIN_DISTRIBUTIONS[target]
            if distribution not in supported:
                problems.append(
                    f"{ref.canonical}: {target} 不支持 distribution "
                    f"{distribution!r}，允许值为 {', '.join(sorted(supported))}"
                )
            plugin = plugin_inventory[ref.local_id]
            target_spec = plugin.targets.get(target)
            if target_spec is None or target_spec.support not in {"full", "partial"}:
                problems.append(
                    f"{ref.canonical}: {target} 支持状态为 "
                    f"{target_spec.support if target_spec else 'missing'}，不能安装"
                )
            destination = (target, ref.local_id)
            previous = destinations.get(destination)
            if previous and previous != ref.canonical:
                problems.append(f"{target} 投射路径冲突：{previous} 与 {ref.canonical}")
            destinations[destination] = ref.canonical
            embedded_refs = {
                AssetRef.plugin_skill(ref.local_id, skill_id).canonical
                for skill_id in plugin.embedded_skills
            }
            for duplicate in sorted(embedded_refs.intersection(seen_skills)):
                problems.append(f"{target} 同时安装 {ref.canonical} 和内嵌 {duplicate}")
    for raw_ref in sorted(set(missing)):
        problems.append(f"desired-installations.json 引用了不存在的资产：{raw_ref}")
    return {
        "count": count,
        "missing": sorted(set(missing)),
        "problems": list(dict.fromkeys(problems)),
    }


def require_valid_desired_installations(
    repo: Repository,
    desired: dict[str, Any],
    *,
    plugin_overrides: dict[str, PluginSpec] | None = None,
) -> None:
    validation = validate_desired_installations(
        repo,
        desired,
        plugin_overrides=plugin_overrides,
    )
    if validation["problems"]:
        raise InstallationError("\n".join(validation["problems"]))


def enable_global(
    repo: Repository,
    name: str,
    *,
    target: str | None = None,
) -> ChangeSet:
    entry = repo.require_skill(name)
    desired = repo.read_desired_installations()
    targets = [target] if target else sorted(desired["targets"])
    changed = False
    for target_name in targets:
        if target_name not in desired["targets"]:
            raise InstallationError(f"未知安装目标：{target_name}")
        _require_standalone_support(repo, entry, target_name)
        skills = desired["targets"][target_name].setdefault("skills", [])
        if entry.qualified_id not in skills:
            skills.append(entry.qualified_id)
            changed = True
    require_valid_desired_installations(repo, desired)
    if changed:
        repo.write_desired_installations(desired)
    dependency_refs = [
        item
        for item in _expand_dependencies(
            repo,
            [entry.qualified_id],
            target=targets[0],
            missing=[],
        )
        if item != entry.qualified_id
    ]
    return ChangeSet(
        changed={"desired_installations"} if changed else set(),
        effects=(
            {Effect.GLOBAL_APPLY, Effect.DOCS_BUILD, Effect.CHECK}
            if changed
            else {Effect.GLOBAL_APPLY}
        ),
        details={
            "skill": entry.name,
            "ref": entry.qualified_id,
            "targets": targets,
            "installed": True,
            "dependencies": [repo.require_skill(ref).name for ref in dependency_refs],
            "dependency_refs": dependency_refs,
        },
    )


def disable_global(
    repo: Repository,
    name: str,
    *,
    target: str | None = None,
) -> ChangeSet:
    entry = repo.require_skill(name)
    desired = repo.read_desired_installations()
    targets = [target] if target else sorted(desired["targets"])
    changed = False
    for target_name in targets:
        record = desired["targets"].get(target_name)
        if record is None:
            raise InstallationError(f"未知安装目标：{target_name}")
        updated = [
            item for item in record.get("skills", []) if item != entry.qualified_id
        ]
        if updated != record.get("skills", []):
            record["skills"] = updated
            changed = True
    require_valid_desired_installations(repo, desired)
    if changed:
        repo.write_desired_installations(desired)
    return ChangeSet(
        changed={"desired_installations"} if changed else set(),
        effects=(
            {Effect.GLOBAL_APPLY, Effect.DOCS_BUILD, Effect.CHECK}
            if changed
            else {Effect.GLOBAL_APPLY}
        ),
        details={
            "skill": entry.name,
            "ref": entry.qualified_id,
            "targets": targets,
            "installed": False,
        },
    )


def global_plan(
    repo: Repository,
    *,
    target_filter: str | None = None,
) -> dict[str, Any]:
    desired = repo.read_desired_installations()
    actions: list[dict[str, str]] = []
    validation = validate_desired_installations(repo, desired)
    conflicts: list[str] = list(validation["problems"])
    missing: list[str] = list(validation["missing"])
    wanted_by_target: dict[str, list[str]] = {}
    explicit_by_target: dict[str, list[str]] = {}
    dependencies_by_target: dict[str, list[str]] = {}
    managed_roots = tuple(
        root.resolve() for root in (repo.skills_dir, repo.plugins_dir) if root.exists()
    )

    for install_target in repo.config["install_targets"]["global"]:
        platform = _install_platform(install_target)
        if target_filter and platform != target_filter:
            continue
        if install_target["mode"] != "symlink":
            raise InstallationError(
                f"第一版不支持全局安装模式：{install_target['mode']}"
            )
        target_state = desired["targets"].get(platform, {})
        explicit = list(target_state.get("skills", []))
        valid_explicit: list[str] = []
        for raw_ref in explicit:
            try:
                entry = repo.require_skill(raw_ref)
                _require_standalone_support(repo, entry, platform)
            except (OSError, RuntimeError, ValueError):
                if raw_ref not in missing:
                    missing.append(raw_ref)
                continue
            valid_explicit.append(entry.qualified_id)
        wanted = _expand_dependencies(
            repo,
            valid_explicit,
            target=platform,
            missing=missing,
        )
        explicit_by_target[platform] = valid_explicit
        wanted_by_target[platform] = wanted
        dependencies_by_target[platform] = [
            ref for ref in wanted if ref not in valid_explicit
        ]

        destination = Path(install_target["path"]).expanduser()
        if destination.is_symlink():
            target_path = destination.resolve()
            if target_path == repo.root or repo.root in target_path.parents:
                conflicts.append(f"目标目录不能指回仓库：{destination}")
                continue
        desired_destination_names: set[str] = set()
        for ref in wanted:
            entry = repo.require_skill(ref)
            link = destination / entry.name
            if entry.name in desired_destination_names:
                conflicts.append(f"{platform} 目标路径重名：{destination / entry.name}")
                continue
            desired_destination_names.add(entry.name)
            if not os.path.lexists(link):
                actions.append(
                    {
                        "action": "link",
                        "kind": "skill",
                        "platform": platform,
                        "ref": ref,
                        "target": str(link),
                        "source": str(entry.path),
                    }
                )
                continue
            if not link.is_symlink():
                conflicts.append(f"同名实体内容不受本工具管理：{link}")
                continue
            current_target = link.resolve()
            expected = entry.path.resolve()
            if current_target == expected:
                continue
            if _inside_any(current_target, managed_roots):
                actions.append(
                    {
                        "action": "relink",
                        "kind": "skill",
                        "platform": platform,
                        "ref": ref,
                        "target": str(link),
                        "source": str(entry.path),
                    }
                )
            else:
                conflicts.append(f"同名链接不属于 agents_kit：{link}")

        for plugin_item in target_state.get("plugins", []):
            if not isinstance(plugin_item, dict):
                conflicts.append(f"{platform} Plugin 安装声明必须是对象")
                continue
            raw_ref = plugin_item.get("ref")
            try:
                ref = AssetRef.parse(str(raw_ref))
                plugin = repo.require_plugin(ref.canonical)
            except (OSError, RuntimeError, ValueError) as exc:
                conflicts.append(str(exc))
                continue
            if platform == "claude":
                distribution = plugin_item.get("distribution", "skills-dir")
                if distribution != "skills-dir":
                    conflicts.append(f"Claude 暂不支持 Plugin 分发方式：{distribution}")
                    continue
                link = destination / plugin.package_id
                if plugin.package_id in desired_destination_names:
                    conflicts.append(f"投射路径冲突：{link}")
                    continue
                desired_destination_names.add(plugin.package_id)
                if not os.path.lexists(link):
                    actions.append(
                        {
                            "action": "link",
                            "kind": "plugin",
                            "platform": platform,
                            "ref": ref.canonical,
                            "target": str(link),
                            "source": str(plugin.root),
                        }
                    )
                elif not link.is_symlink():
                    conflicts.append(f"同名实体内容不受本工具管理：{link}")
                elif link.resolve() != plugin.root.resolve():
                    if _inside_any(link.resolve(), managed_roots):
                        actions.append(
                            {
                                "action": "relink",
                                "kind": "plugin",
                                "platform": platform,
                                "ref": ref.canonical,
                                "target": str(link),
                                "source": str(plugin.root),
                            }
                        )
                    else:
                        conflicts.append(f"同名链接不属于 agents_kit：{link}")

        if destination.is_dir():
            for item in destination.iterdir():
                if item.name.startswith(".") or item.name in desired_destination_names:
                    continue
                if item.is_symlink() and _inside_any(item.resolve(), managed_roots):
                    actions.append(
                        {
                            "action": "unlink",
                            "kind": "managed",
                            "platform": platform,
                            "ref": "",
                            "target": str(item),
                            "source": str(item.resolve()),
                        }
                    )
                elif any(
                    entry.name == item.name for entry in repo.skill_registry().values()
                ):
                    conflicts.append(f"非常驻技能被外部内容暴露：{item}")

    marketplace_actions = _codex_marketplace_plan(
        repo,
        desired["targets"].get("codex", {}),
        enabled=not conflicts and target_filter in {None, "codex"},
    )
    desired_plugins_by_target = {
        target: _desired_plugin_ids(record, target=target)
        for target, record in desired["targets"].items()
        if isinstance(record, dict)
    }
    return {
        "wanted": sorted(
            {
                repo.require_skill(ref).name
                for refs in wanted_by_target.values()
                for ref in refs
            }
        ),
        "wanted_refs": sorted(
            {ref for refs in wanted_by_target.values() for ref in refs}
        ),
        "wanted_by_target": wanted_by_target,
        "explicit": sorted(
            {
                repo.require_skill(ref).name
                for refs in explicit_by_target.values()
                for ref in refs
            }
        ),
        "explicit_refs": sorted(
            {ref for refs in explicit_by_target.values() for ref in refs}
        ),
        "explicit_by_target": explicit_by_target,
        "dependencies": sorted(
            {
                repo.require_skill(ref).name
                for refs in dependencies_by_target.values()
                for ref in refs
            }
        ),
        "dependency_refs": sorted(
            {ref for refs in dependencies_by_target.values() for ref in refs}
        ),
        "dependencies_by_target": dependencies_by_target,
        "missing": sorted(set(missing)),
        "actions": actions,
        "marketplace_actions": marketplace_actions,
        "desired_plugins_by_target": desired_plugins_by_target,
        "conflicts": list(dict.fromkeys(conflicts)),
    }


def apply_global(
    repo: Repository,
    *,
    dry_run: bool = False,
    target: str | None = None,
) -> ChangeSet:
    plan = global_plan(repo, target_filter=target)
    if plan["missing"]:
        raise InstallationError("active 中存在缺失技能：" + ", ".join(plan["missing"]))
    if plan["conflicts"]:
        raise InstallationError("\n".join(plan["conflicts"]))
    execution = {
        "status": "planned" if dry_run else "complete",
        "targets": {},
    }
    if not dry_run:
        failures: list[str] = []
        platforms = sorted(
            {
                action["platform"]
                for action in [*plan["actions"], *plan["marketplace_actions"]]
                if action.get("platform")
            }
        )
        for platform in platforms:
            target_result = {
                "status": "complete",
                "completed": [],
            }
            execution["targets"][platform] = target_result
            try:
                for action in plan["actions"]:
                    if action.get("platform") != platform:
                        continue
                    _execute_link_action(action)
                    target_result["completed"].append(_public_action(action))
                for action in plan["marketplace_actions"]:
                    if action.get("platform") != platform:
                        continue
                    _execute_marketplace_action(action)
                    target_result["completed"].append(_public_action(action))
            except (OSError, RuntimeError) as exc:
                target_result["status"] = "failed"
                target_result["error"] = str(exc)
                failures.append(f"{platform}: {exc}")
        if failures:
            execution["status"] = (
                "partial"
                if any(result["completed"] for result in execution["targets"].values())
                else "failed"
            )
        _write_receipt(repo, plan, execution=execution)
        if failures:
            raise InstallationError("安装未全部完成：\n" + "\n".join(failures))
    return ChangeSet(
        details={
            "dry_run": dry_run,
            "linked": sum(
                1
                for action in plan["actions"]
                if action["action"] in {"link", "relink"}
            ),
            "unlinked": sum(
                1 for action in plan["actions"] if action["action"] == "unlink"
            ),
            "actions": plan["actions"],
            "marketplace_actions": plan["marketplace_actions"],
            "execution": execution,
        }
    )


def project_plan(
    repo: Repository,
    target: str,
    *,
    project: Path,
    replace: bool = False,
) -> dict[str, Any]:
    project = project.expanduser().resolve()
    if not project.is_dir():
        raise InstallationError(f"项目目录不存在：{project}")
    selected = _select_skills(repo, target)
    selected = _expand_dependencies(repo, selected, target="claude")
    copies: list[dict[str, str]] = []
    conflicts: list[str] = []
    for install_target in repo.config["install_targets"]["project"]:
        if install_target["mode"] != "copy":
            raise InstallationError(
                f"第一版不支持项目安装模式：{install_target['mode']}"
            )
        destination_root = project / install_target["path"]
        for ref in selected:
            entry = repo.require_skill(ref)
            _require_standalone_support(repo, entry, "claude")
            destination = destination_root / entry.name
            if os.path.lexists(destination) and not replace:
                conflicts.append(str(destination))
            copies.append(
                {
                    "skill": ref,
                    "source": str(entry.path),
                    "target": str(destination),
                    "replace": str(bool(os.path.lexists(destination))).lower(),
                }
            )
    return {
        "project": str(project),
        "skills": [repo.require_skill(ref).name for ref in selected],
        "skill_refs": selected,
        "copies": copies,
        "conflicts": conflicts,
    }


def install_project(
    repo: Repository,
    target: str,
    *,
    project: Path,
    replace: bool = False,
    dry_run: bool = False,
) -> ChangeSet:
    plan = project_plan(repo, target, project=project, replace=replace)
    if plan["conflicts"]:
        raise InstallationError(
            "项目中已存在同名内容；检查后使用 --replace：\n  "
            + "\n  ".join(plan["conflicts"])
        )
    if not dry_run:
        for copy in plan["copies"]:
            source = Path(copy["source"])
            destination = Path(copy["target"])
            _copy_directory(source, destination, replace=replace)
    return ChangeSet(
        details={
            "dry_run": dry_run,
            "project": plan["project"],
            "skills": plan["skills"],
            "copies": plan["copies"],
        }
    )


def _select_skills(repo: Repository, target: str) -> list[str]:
    try:
        return [repo.resolve_skill_ref(target).canonical]
    except RuntimeError:
        pass
    category_matches = sorted(
        entry.qualified_id
        for entry in repo.skill_registry().values()
        if entry.category == target
    )
    if category_matches:
        return category_matches
    raise InstallationError(f"找不到技能或分类：{target}")


def _expand_dependencies(
    repo: Repository,
    selected: list[str],
    *,
    target: str,
    missing: list[str] | None = None,
) -> list[str]:
    """按 metadata 的 dependencies 展开闭包，检测循环。

    missing 为 None 时，缺失依赖直接报错（项目安装用）；
    传入列表时，缺失依赖记录到该列表并跳过（全局 plan 用，让 plan 能报告而不是崩）。
    """
    result = [repo.resolve_skill_ref(item).canonical for item in selected]
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(ref: str) -> None:
        if ref in visited:
            return
        if ref in visiting:
            raise InstallationError(f"技能依赖形成循环：{ref}")
        try:
            entry = repo.require_skill(ref)
            _require_standalone_support(repo, entry, target)
        except RuntimeError:
            if missing is None:
                raise InstallationError(f"依赖技能不存在或不可独立安装：{ref}")
            if ref in result:
                result.remove(ref)
            if ref not in missing:
                missing.append(ref)
            return
        visiting.add(ref)
        metadata = repo.metadata_record(ref) or {}
        for dependency in metadata.get("dependencies", []):
            try:
                dependency_ref = repo.resolve_skill_ref(dependency).canonical
            except RuntimeError:
                dependency_ref = dependency
            visit(dependency_ref)
            if dependency_ref not in result:
                try:
                    repo.require_skill(dependency_ref)
                except RuntimeError:
                    continue
                result.append(dependency_ref)
        visiting.remove(ref)
        visited.add(ref)

    for ref in list(result):
        visit(ref)
    return result


def _copy_directory(source: Path, destination: Path, *, replace: bool) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if os.path.lexists(destination) and not replace:
        raise InstallationError(f"目标已存在：{destination}")
    temporary = Path(
        tempfile.mkdtemp(prefix=f".{destination.name}.", dir=destination.parent)
    )
    shutil.rmtree(temporary)
    try:
        shutil.copytree(
            source,
            temporary,
            symlinks=True,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
        )
        if os.path.lexists(destination):
            if destination.is_symlink() or destination.is_file():
                destination.unlink()
            else:
                shutil.rmtree(destination)
        os.replace(temporary, destination)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def _inside(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def _inside_any(path: Path, roots: tuple[Path, ...]) -> bool:
    return any(_inside(path, root) for root in roots)


def _install_platform(target: dict[str, Any]) -> str:
    platform = target.get("platform")
    if platform in {"claude", "codex"}:
        return str(platform)
    return "codex" if target.get("id") in {"agents", "codex"} else "claude"


def _require_standalone_support(
    repo: Repository,
    entry: Any,
    target: str,
) -> None:
    if entry.owner_kind == "standalone":
        return
    plugin = repo.require_plugin(entry.owner_id or "")
    embedded = plugin.embedded_skills.get(entry.name)
    target_spec = embedded.standalone.get(target) if embedded else None
    if target_spec is None or target_spec.mode != "self_contained":
        reason = (
            target_spec.reason
            if target_spec is not None
            else "sidecar 没有声明该 Skill"
        )
        raise InstallationError(
            f"{entry.qualified_id} 在 {target} 上不能独立安装：{reason}"
        )


def _codex_marketplace_plan(
    repo: Repository,
    target_state: dict[str, Any],
    *,
    enabled: bool,
) -> list[dict[str, Any]]:
    if not enabled:
        return []
    desired_ids: set[str] = set()
    for item in target_state.get("plugins", []):
        if not isinstance(item, dict):
            continue
        if item.get("distribution") != "marketplace":
            continue
        try:
            ref = AssetRef.parse(str(item.get("ref")))
        except ValueError:
            continue
        if ref.kind == "plugin":
            desired_ids.add(ref.local_id)

    previous_desired_ids = _previous_codex_desired_plugins(repo)
    if not desired_ids and not previous_desired_ids:
        return []
    executable = shutil.which("codex")
    if executable is None:
        raise InstallationError("无法探测 Codex Plugin 状态：找不到 codex CLI")
    marketplace_name = "agents-kit"
    marketplace_path = repo.root / ".agents/plugins/marketplace.json"
    if marketplace_path.is_file():
        try:
            marketplace_name = str(
                json.loads(marketplace_path.read_text(encoding="utf-8")).get(
                    "name", marketplace_name
                )
            )
        except (OSError, json.JSONDecodeError):
            pass
    marketplaces = _run_json([executable, "plugin", "marketplace", "list", "--json"])
    marketplace_items = marketplaces.get("marketplaces")
    if not isinstance(marketplace_items, list):
        raise InstallationError(
            "Codex Marketplace 状态格式不兼容：缺 marketplaces 数组"
        )
    configured = {
        item.get("name") for item in marketplace_items if isinstance(item, dict)
    }
    actions: list[dict[str, Any]] = []
    if desired_ids and marketplace_name not in configured:
        actions.append(
            {
                "action": "marketplace_add",
                "platform": "codex",
                "marketplace": marketplace_name,
                "source": str(repo.root),
                "command": [
                    executable,
                    "plugin",
                    "marketplace",
                    "add",
                    str(repo.root),
                    "--json",
                ],
            }
        )

    plugin_state = _run_json([executable, "plugin", "list", "--json"])
    installed_items = plugin_state.get("installed")
    if not isinstance(installed_items, list):
        raise InstallationError("Codex Plugin 状态格式不兼容：缺 installed 数组")
    installed = {
        str(item.get("name")): item
        for item in installed_items
        if isinstance(item, dict)
        and item.get("marketplaceName") == marketplace_name
        and item.get("installed")
    }
    for plugin_id in sorted(desired_ids - set(installed)):
        actions.append(
            {
                "action": "plugin_add",
                "platform": "codex",
                "plugin": plugin_id,
                "marketplace": marketplace_name,
                "command": [
                    executable,
                    "plugin",
                    "add",
                    f"{plugin_id}@{marketplace_name}",
                    "--json",
                ],
            }
        )
    for plugin_id in sorted(desired_ids.intersection(installed)):
        item = installed[plugin_id]
        expected = manifest_data(repo.require_plugin(plugin_id).root, "codex") or {}
        version = expected.get("version")
        reasons = []
        if item.get("enabled") is False:
            reasons.append("插件已停用")
        if version and item.get("version") != version:
            reasons.append("安装版本与中央仓库不一致")
        if item.get("version") and not _codex_cache_matches(
            repo, plugin_id, marketplace_name, str(item["version"])
        ):
            reasons.append("安装副本与中央仓库内容不一致")
        if reasons:
            actions.append(
                {
                    "action": "plugin_refresh",
                    "platform": "codex",
                    "plugin": plugin_id,
                    "marketplace": marketplace_name,
                    "reason": "；".join(reasons),
                    "command": [
                        executable,
                        "plugin",
                        "add",
                        f"{plugin_id}@{marketplace_name}",
                        "--json",
                    ],
                }
            )
    for plugin_id in sorted(set(installed) - desired_ids):
        actions.append(
            {
                "action": "plugin_remove",
                "platform": "codex",
                "plugin": plugin_id,
                "marketplace": marketplace_name,
                "command": [
                    executable,
                    "plugin",
                    "remove",
                    f"{plugin_id}@{marketplace_name}",
                    "--json",
                ],
            }
        )
    return actions


def _codex_cache_matches(
    repo: Repository, plugin_id: str, marketplace: str, version: str
) -> bool:
    cache = (
        Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
        / "plugins/cache"
    )
    installed_root = cache / marketplace / plugin_id / version
    if not installed_root.is_dir():
        return False
    source_root = repo.require_plugin(plugin_id).root
    # Native installation skips symlinks and transient environments/caches.
    source_files = [
        p for p in plugin_file_paths(source_root) if not (source_root / p).is_symlink()
    ]
    installed_files = [
        p
        for p in plugin_file_paths(installed_root)
        if not (installed_root / p).is_symlink()
    ]
    return set(source_files) == set(installed_files) and _hash_paths(
        source_root, source_files
    ) == _hash_paths(installed_root, installed_files)


def _desired_plugin_ids(record: dict[str, Any], *, target: str) -> list[str]:
    found: set[str] = set()
    for item in record.get("plugins", []):
        if not isinstance(item, dict) or item.get(
            "distribution"
        ) not in SUPPORTED_PLUGIN_DISTRIBUTIONS.get(target, ()):
            continue
        try:
            ref = AssetRef.parse(str(item.get("ref")))
        except ValueError:
            continue
        if ref.kind == "plugin":
            found.add(ref.local_id)
    return sorted(found)


def _run_json(command: list[str]) -> dict[str, Any]:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise InstallationError(
            f"Codex 状态探测失败（{' '.join(command)}）：{exc}"
        ) from exc
    if result.returncode:
        message = result.stderr.strip() or result.stdout.strip()
        raise InstallationError(f"Codex 状态探测失败（{' '.join(command)}）：{message}")
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise InstallationError(
            f"Codex 状态探测返回了无效 JSON（{' '.join(command)}）"
        ) from exc
    if not isinstance(data, dict):
        raise InstallationError(f"Codex 状态探测格式不兼容（{' '.join(command)}）")
    return data


def _execute_link_action(action: dict[str, Any]) -> None:
    target = Path(action["target"])
    if action["action"] == "unlink":
        target.unlink(missing_ok=True)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink():
        target.unlink()
    target.symlink_to(action["source"])


def _public_action(action: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in action.items() if key != "command"}


def _execute_marketplace_action(action: dict[str, Any]) -> None:
    if action.get("action") == "manual":
        return
    command = action.get("command")
    if not isinstance(command, list) or not command:
        raise InstallationError(f"Marketplace action 缺命令：{action}")
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    if result.returncode:
        message = result.stderr.strip() or result.stdout.strip()
        raise InstallationError(
            f"Codex Plugin 操作失败（{action.get('action')}）：{message}"
        )


def _receipt_path(repo: Repository) -> Path | None:
    explicit_state_home = os.environ.get("AGENTS_KIT_STATE_HOME")
    if explicit_state_home is None and not (repo.root / ".git").is_dir():
        return None
    state_home = Path(
        explicit_state_home
        or os.environ.get(
            "XDG_STATE_HOME",
            str(Path.home() / ".local/state"),
        )
    )
    return state_home / "agents-kit/receipts.json"


def _previous_codex_desired_plugins(repo: Repository) -> set[str]:
    path = _receipt_path(repo)
    if path is None or not path.is_file():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    desired = data.get("desired_plugins_by_target", {})
    if isinstance(desired, dict) and isinstance(desired.get("codex"), list):
        return {
            str(plugin_id)
            for plugin_id in desired["codex"]
            if isinstance(plugin_id, str)
        }
    legacy: set[str] = set()
    for action in data.get("marketplace_actions", []):
        if not isinstance(action, dict) or not isinstance(action.get("plugin"), str):
            continue
        if action.get("action") == "plugin_add":
            legacy.add(action["plugin"])
        elif action.get("action") == "plugin_remove":
            legacy.discard(action["plugin"])
    return legacy


def _write_receipt(
    repo: Repository,
    plan: dict[str, Any],
    *,
    execution: dict[str, Any],
) -> None:
    path = _receipt_path(repo)
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "schema_version": 2,
        "repository": str(repo.root),
        "desired_plugins_by_target": plan.get("desired_plugins_by_target", {}),
        "actions": [_public_action(action) for action in plan["actions"]],
        "marketplace_actions": [
            _public_action(action) for action in plan["marketplace_actions"]
        ],
        "execution": execution,
    }
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)
