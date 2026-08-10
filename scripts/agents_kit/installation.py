from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .models import AssetRef, ChangeSet, Effect
from .repository import Repository


class InstallationError(RuntimeError):
    pass


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
    conflicts: list[str] = []
    missing: list[str] = []
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
        enabled=target_filter in {None, "codex"},
    )
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
        "missing": missing,
        "actions": actions,
        "marketplace_actions": marketplace_actions,
        "conflicts": conflicts,
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
    if not dry_run:
        for action in plan["actions"]:
            target = Path(action["target"])
            if action["action"] == "unlink":
                target.unlink(missing_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.is_symlink():
                target.unlink()
            target.symlink_to(action["source"])
        for action in plan["marketplace_actions"]:
            _execute_marketplace_action(action)
        _write_receipt(repo, plan)
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
        try:
            ref = AssetRef.parse(str(item.get("ref")))
        except ValueError:
            continue
        if ref.kind == "plugin":
            desired_ids.add(ref.local_id)

    executable = shutil.which("codex")
    if executable is None:
        return (
            [
                {
                    "action": "manual",
                    "platform": "codex",
                    "reason": "找不到 codex CLI",
                }
            ]
            if desired_ids
            else []
        )
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
    marketplaces = _run_json(
        [executable, "plugin", "marketplace", "list", "--json"],
        fallback={"marketplaces": []},
    )
    configured = {
        item.get("name")
        for item in marketplaces.get("marketplaces", [])
        if isinstance(item, dict)
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

    plugin_state = _run_json(
        [executable, "plugin", "list", "--json"],
        fallback={"installed": []},
    )
    installed = {
        str(item.get("name")): item
        for item in plugin_state.get("installed", [])
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


def _run_json(command: list[str], *, fallback: dict[str, Any]) -> dict[str, Any]:
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    if result.returncode:
        return fallback
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return fallback
    return data if isinstance(data, dict) else fallback


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


def _write_receipt(repo: Repository, plan: dict[str, Any]) -> None:
    explicit_state_home = os.environ.get("AGENTS_KIT_STATE_HOME")
    if explicit_state_home is None and not (repo.root / ".git").is_dir():
        return
    state_home = Path(
        explicit_state_home
        or os.environ.get(
            "XDG_STATE_HOME",
            str(Path.home() / ".local/state"),
        )
    )
    path = state_home / "agents-kit/receipts.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "schema_version": 1,
        "repository": str(repo.root),
        "actions": plan["actions"],
        "marketplace_actions": [
            {key: value for key, value in action.items() if key != "command"}
            for action in plan["marketplace_actions"]
        ],
    }
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)
