from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from .models import ChangeSet, Effect
from .repository import Repository


class InstallationError(RuntimeError):
    pass


def enable_global(repo: Repository, name: str) -> ChangeSet:
    repo.require_skill(name)
    active = repo.read_active()
    changed = False
    if name not in active:
        active.append(name)
        changed = repo.write_active(active)
    return ChangeSet(
        changed={"active"} if changed else set(),
        effects=(
            {Effect.GLOBAL_APPLY, Effect.DOCS_BUILD, Effect.CHECK}
            if changed
            else {Effect.GLOBAL_APPLY}
        ),
        details={"skill": name, "active": True},
    )


def disable_global(repo: Repository, name: str) -> ChangeSet:
    repo.require_skill(name)
    active = repo.read_active()
    updated = [item for item in active if item != name]
    changed = updated != active and repo.write_active(updated)
    return ChangeSet(
        changed={"active"} if changed else set(),
        effects=(
            {Effect.GLOBAL_APPLY, Effect.DOCS_BUILD, Effect.CHECK}
            if changed
            else {Effect.GLOBAL_APPLY}
        ),
        details={"skill": name, "active": False},
    )


def global_plan(repo: Repository) -> dict[str, Any]:
    inventory = repo.inventory()
    wanted = repo.read_active()
    missing = [name for name in wanted if name not in inventory]
    actions: list[dict[str, str]] = []
    conflicts: list[str] = []
    managed_root = repo.skills_dir.resolve()

    for target in repo.config["install_targets"]["global"]:
        if target["mode"] != "symlink":
            raise InstallationError(f"第一版不支持全局安装模式：{target['mode']}")
        destination = Path(target["path"]).expanduser()
        if destination.is_symlink():
            target_path = destination.resolve()
            if target_path == repo.root or repo.root in target_path.parents:
                conflicts.append(f"目标目录不能指回仓库：{destination}")
                continue
        for name in wanted:
            entry = inventory.get(name)
            if entry is None:
                continue
            link = destination / name
            if not os.path.lexists(link):
                actions.append(
                    {
                        "action": "link",
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
            if _inside(current_target, managed_root):
                actions.append(
                    {
                        "action": "relink",
                        "target": str(link),
                        "source": str(entry.path),
                    }
                )
            else:
                conflicts.append(f"同名链接不属于 agents_kit：{link}")

        if destination.is_dir():
            for item in destination.iterdir():
                if item.name.startswith(".") or item.name in wanted:
                    continue
                if item.is_symlink() and _inside(item.resolve(), managed_root):
                    actions.append(
                        {
                            "action": "unlink",
                            "target": str(item),
                            "source": str(item.resolve()),
                        }
                    )
                elif item.name in inventory:
                    conflicts.append(f"非常驻技能被外部内容暴露：{item}")
    return {
        "wanted": wanted,
        "missing": missing,
        "actions": actions,
        "conflicts": conflicts,
    }


def apply_global(repo: Repository, *, dry_run: bool = False) -> ChangeSet:
    plan = global_plan(repo)
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
    selected = _expand_dependencies(repo, selected)
    copies: list[dict[str, str]] = []
    conflicts: list[str] = []
    for install_target in repo.config["install_targets"]["project"]:
        if install_target["mode"] != "copy":
            raise InstallationError(
                f"第一版不支持项目安装模式：{install_target['mode']}"
            )
        destination_root = project / install_target["path"]
        for name in selected:
            destination = destination_root / name
            if os.path.lexists(destination) and not replace:
                conflicts.append(str(destination))
            copies.append(
                {
                    "skill": name,
                    "source": str(repo.require_skill(name).path),
                    "target": str(destination),
                    "replace": str(bool(os.path.lexists(destination))).lower(),
                }
            )
    return {
        "project": str(project),
        "skills": selected,
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
    inventory = repo.inventory()
    if target in inventory:
        return [target]
    category_matches = sorted(
        name for name, entry in inventory.items() if entry.category == target
    )
    if category_matches:
        return category_matches
    raise InstallationError(f"找不到技能或分类：{target}")


def _expand_dependencies(repo: Repository, selected: list[str]) -> list[str]:
    metadata = repo.read_metadata()["skills"]
    result = list(selected)
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(name: str) -> None:
        if name in visited:
            return
        if name in visiting:
            raise InstallationError(f"技能依赖形成循环：{name}")
        if name not in repo.inventory():
            raise InstallationError(f"依赖技能不存在：{name}")
        visiting.add(name)
        for dependency in metadata.get(name, {}).get("dependencies", []):
            visit(dependency)
            if dependency not in result:
                result.append(dependency)
        visiting.remove(name)
        visited.add(name)

    for name in list(result):
        visit(name)
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
