from __future__ import annotations

import re
import urllib.parse
from pathlib import Path
from typing import Any

from . import docs, marketplace, mcps, plugins, runtime
from .installation import (
    InstallationError,
    global_plan,
    validate_desired_installations,
)
from .models import CheckReport, ContentMode, parse_skill_frontmatter
from .repository import Repository, RepositoryError
from .taxonomy import TaxonomyError, validate_tags

REFERENCE_CONTEXT = re.compile(
    r"skill|技能|invoke|run the|/(?:run|use)\b", re.IGNORECASE
)
REFERENCE = re.compile(r"`/([a-z][a-z0-9-]{2,40})`")
MARKDOWN_LINK = re.compile(r"!?\[[^\]]*\]\(([^)\n]+)\)")


def run(
    repo: Repository,
    *,
    command_help: str,
    repo_only: bool = False,
    verify_runtime: bool = False,
) -> CheckReport:
    report = CheckReport()
    try:
        inventory = repo.skill_registry(refresh=True)
    except RepositoryError as exc:
        report.problems.append(str(exc))
        return report

    _check_skill_files(repo, inventory, report)
    _check_desired_installations(repo, inventory, report)
    _check_sources(repo, inventory, report)
    _check_metadata(repo, inventory, report)
    _check_plugins(repo, inventory, report)
    _check_marketplace(repo, report)
    _check_scout(repo, report)
    _check_mcps(repo, report, repo_only=repo_only)
    _check_references(inventory, report)
    _check_docs(repo, command_help, report)
    if not repo_only:
        _check_global(repo, report)
    if verify_runtime:
        native = runtime.plugin_report(repo)
        report.sections["runtime"] = native
        report.problems.extend(native["problems"])
    report.sections["summary"] = {
        "skills": len(inventory),
        "active": len(repo.read_active()),
        "configured_available": len(repo.skill_activation()),
        "sources": len(repo.read_sources()["skills"])
        + len(repo.read_sources()["plugins"]),
        "plugins": len(repo.plugin_inventory()),
        "metadata": len(repo.read_metadata()["skills"]),
        "mcps": len(repo.read_mcps()["servers"]),
        "enabled_mcps": sum(
            1 for record in repo.read_mcps()["servers"].values() if record["enabled"]
        ),
        "repo_only": repo_only,
    }
    return report


def _check_skill_files(
    repo: Repository, inventory: dict[str, Any], report: CheckReport
) -> None:
    bad = 0
    categories = set(repo.categories)
    for name, entry in sorted(inventory.items()):
        if entry.category not in categories:
            report.problems.append(f"{name}: 未登记分类 {entry.category}")
            bad += 1
        path = entry.path / "SKILL.md"
        try:
            frontmatter = parse_skill_frontmatter(
                path.read_text(encoding="utf-8", errors="replace")
            )
        except (ValueError, RuntimeError) as exc:
            report.problems.append(f"{name}: {exc}")
            bad += 1
            continue
        if not isinstance(frontmatter.get("name"), str) or not frontmatter["name"]:
            report.problems.append(f"{name}: frontmatter 缺 name")
            bad += 1
        if (
            not isinstance(frontmatter.get("description"), str)
            or not frontmatter["description"].strip()
        ):
            report.problems.append(f"{name}: frontmatter 缺 description")
            bad += 1
        _check_symlinks(entry.path, report)
    report.sections["skill_files"] = {
        "checked": len(inventory),
        "invalid": bad,
    }


def _check_desired_installations(
    repo: Repository, inventory: dict[str, Any], report: CheckReport
) -> None:
    desired = repo.read_desired_installations()
    validation = validate_desired_installations(
        repo,
        desired,
        inventory=inventory,
    )
    report.problems.extend(validation["problems"])
    report.sections["desired_installations"] = {
        "count": validation["count"],
        "missing": validation["missing"],
    }


def _check_sources(
    repo: Repository, inventory: dict[str, Any], report: CheckReport
) -> None:
    catalog = repo.read_sources()
    records = catalog["skills"]
    normalized_records = _normalized_skill_keys(repo, records)
    stale = sorted(set(normalized_records) - set(inventory))
    for name in stale:
        report.problems.append(f"sources.json 中的 {name} 不存在")
    for name in sorted(set(normalized_records).intersection(inventory)):
        if inventory[name].owner_kind == "plugin":
            report.problems.append(f"{name}: Plugin-owned Skill 不能有独立 source")
    for name, record in sorted(records.items()):
        if not isinstance(record, dict):
            report.problems.append(f"{name}: source 记录必须是对象")
            continue
        provider = record.get("provider")
        if not isinstance(provider, str) or not provider:
            report.problems.append(f"{name}: source provider 不能为空")
        if not isinstance(record.get("locator"), dict):
            report.problems.append(f"{name}: source locator 必须是对象")
        try:
            mode = ContentMode(record.get("content_mode"))
            if mode == ContentMode.PLUGIN_DIRECTORY:
                raise ValueError
        except (TypeError, ValueError):
            report.problems.append(f"{name}: source content_mode 无效")
        if record.get("policy") not in {"review", "pinned"}:
            report.problems.append(f"{name}: source policy 无效")
        resolved = record.get("resolved")
        if not isinstance(resolved, dict) or not isinstance(
            resolved.get("content_sha256"), str
        ):
            report.problems.append(f"{name}: source resolved 摘要不完整")
    plugin_stale = sorted(set(catalog["plugins"]) - set(repo.plugin_inventory()))
    for plugin_id in plugin_stale:
        report.problems.append(f"sources.json 中的 Plugin {plugin_id} 不存在")
    for plugin_id, record in sorted(catalog["plugins"].items()):
        if not isinstance(record, dict):
            report.problems.append(f"{plugin_id}: Plugin source 记录必须是对象")
            continue
        if record.get("content_mode") != "plugin_directory":
            report.problems.append(
                f"{plugin_id}: Plugin source content_mode 必须是 plugin_directory"
            )
        resolved = record.get("resolved")
        if (
            not isinstance(resolved, dict)
            or not isinstance(resolved.get("upstream_sha256"), str)
            or not isinstance(resolved.get("upstream_paths"), list)
        ):
            report.problems.append(f"{plugin_id}: Plugin source resolved 摘要不完整")
    report.sections["sources"] = {
        "skills": len(records),
        "plugins": len(catalog["plugins"]),
        "stale_skills": stale,
        "stale_plugins": plugin_stale,
    }


def _check_metadata(
    repo: Repository, inventory: dict[str, Any], report: CheckReport
) -> None:
    catalog = repo.read_metadata()
    metadata = catalog["skills"]
    normalized_metadata = _normalized_skill_keys(repo, metadata)
    if catalog["taxonomy_version"] != repo.taxonomy_version:
        report.problems.append(
            "metadata.json taxonomy_version "
            f"{catalog['taxonomy_version']} 与 agents-kit.json "
            f"{repo.taxonomy_version} 不一致"
        )
    stale = sorted(set(normalized_metadata) - set(inventory))
    missing = sorted(set(inventory) - set(normalized_metadata))
    for name in stale:
        report.problems.append(f"metadata.json 中的 {name} 不存在")
    for name in missing:
        report.problems.append(f"{name}: 缺 metadata")

    graph: dict[str, list[str]] = {}
    for raw_name, record in sorted(metadata.items()):
        try:
            name = repo.resolve_skill_ref(raw_name).canonical
        except RepositoryError:
            name = raw_name
        if not isinstance(record, dict):
            report.problems.append(f"{name}: metadata 记录必须是对象")
            graph[name] = []
            continue
        recommendation = record.get("recommendation")
        if not isinstance(recommendation, int) or not 1 <= recommendation <= 5:
            report.problems.append(f"{name}: recommendation 必须是 1-5")
        description = record.get("description")
        if not isinstance(description, str) or not description.strip():
            report.problems.append(f"{name}: metadata 缺 description")
        if not isinstance(record.get("trigger"), str):
            report.problems.append(f"{name}: metadata trigger 必须是字符串")
        try:
            validate_tags(repo, record.get("tags"))
        except TaxonomyError as exc:
            report.problems.append(f"{name}: {exc}")
        dependencies = record.get("dependencies", [])
        if not isinstance(dependencies, list) or any(
            not isinstance(item, str) for item in dependencies
        ):
            report.problems.append(f"{name}: dependencies 必须是技能名数组")
            dependencies = []
        normalized_dependencies: list[str] = []
        for dependency in dependencies:
            try:
                dependency_ref = repo.resolve_skill_ref(dependency).canonical
            except RepositoryError:
                report.problems.append(f"{name}: 依赖不存在 {dependency}")
                continue
            normalized_dependencies.append(dependency_ref)
        graph[name] = normalized_dependencies
    _check_dependency_cycles(graph, report)
    report.sections["metadata"] = {
        "count": len(metadata),
        "missing": missing,
        "stale": stale,
    }


def _check_plugins(
    repo: Repository, inventory: dict[str, Any], report: CheckReport
) -> None:
    checked = 0
    for plugin_id, spec in sorted(repo.plugin_inventory().items()):
        checked += 1
        disk_skills = {
            entry.name
            for entry in inventory.values()
            if entry.owner_kind == "plugin" and entry.owner_id == plugin_id
        }
        declared_skills = set(spec.embedded_skills)
        for skill_id in sorted(disk_skills - declared_skills):
            report.problems.append(f"{plugin_id}: sidecar 缺 embedded Skill {skill_id}")
        for skill_id in sorted(declared_skills - disk_skills):
            report.problems.append(
                f"{plugin_id}: sidecar 声明的 Skill 不存在 {skill_id}"
            )
        for skill_id, embedded in spec.embedded_skills.items():
            if not any(
                target.mode == "self_contained"
                for target in embedded.standalone.values()
            ):
                continue
            if embedded.dependencies:
                report.problems.append(
                    f"{plugin_id}/{skill_id}: self_contained Skill "
                    "不能声明 Plugin 根目录依赖"
                )
            skill_root = plugins._embedded_skill_paths(spec.root)[skill_id]
            for path in skill_root.rglob("*"):
                if not path.is_file() or path.is_symlink():
                    continue
                text = path.read_text(encoding="utf-8", errors="replace")
                if "${CLAUDE_PLUGIN_ROOT}" in text:
                    report.problems.append(
                        f"{plugin_id}/{skill_id}: self_contained Skill "
                        "引用 CLAUDE_PLUGIN_ROOT"
                    )
                if path.name == "SKILL.md" and re.search(
                    r"(?<!\.)\.\./[A-Za-z0-9_.-]", text
                ):
                    report.problems.append(
                        f"{plugin_id}/{skill_id}: self_contained Skill "
                        "包含跨出 Skill 根目录的相对路径"
                    )
            skill_file = skill_root / "SKILL.md"
            if skill_file.is_file():
                text = skill_file.read_text(encoding="utf-8", errors="replace")
                for match in MARKDOWN_LINK.finditer(text):
                    raw = match.group(1).strip().split(maxsplit=1)[0]
                    parsed = urllib.parse.urlsplit(raw)
                    if parsed.scheme or parsed.netloc or not parsed.path:
                        continue
                    relative = urllib.parse.unquote(parsed.path)
                    if relative.startswith(("#", "/")):
                        continue
                    target = (skill_root / relative).resolve()
                    root = skill_root.resolve()
                    if target != root and root not in target.parents:
                        report.problems.append(
                            f"{plugin_id}/{skill_id}: self_contained Skill "
                            f"链接越界 {relative}"
                        )
        for target, target_spec in spec.targets.items():
            if target_spec.manifest is None:
                continue
            manifest = plugins.manifest_data(spec.root, target)
            if manifest is None:
                report.problems.append(f"{plugin_id}: {target} manifest 不存在")
                continue
            if manifest.get("name") != plugin_id:
                report.problems.append(f"{plugin_id}: {target} manifest name 不一致")
            declared = manifest.get("skills", [])
            paths = [declared] if isinstance(declared, str) else declared
            if target == "claude" and isinstance(paths, list):
                for path in paths:
                    if isinstance(path, str) and not path.startswith("./"):
                        report.problems.append(
                            f"{plugin_id}: Claude skills 路径须以 ./ 开头：{path}"
                        )
            if (
                target_spec.manifest.authority == "upstream"
                and target not in spec.upstream_targets
            ):
                report.problems.append(
                    f"{plugin_id}: {target} 标记 upstream authority "
                    "但不在 upstream_targets"
                )
        component_inventory = plugins.inventory_plugin(spec.root)
        if component_inventory.unknown_paths:
            report.warnings.append(
                f"{plugin_id}: 保留了 {len(component_inventory.unknown_paths)} "
                "个未知 Plugin 路径，更新时需要 Review"
            )
    report.sections["plugins"] = {"count": checked}


def _check_marketplace(repo: Repository, report: CheckReport) -> None:
    if not repo.plugin_inventory() and not any(
        path.is_file() for path in marketplace.expected_indexes(repo)
    ):
        report.sections["marketplace"] = {"stale": []}
        return
    stale = marketplace.check(repo)
    for path in stale:
        report.problems.append(f"Marketplace 索引已过期：{path}")
    report.sections["marketplace"] = {"stale": stale}


def _normalized_skill_keys(repo: Repository, records: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in records.items():
        try:
            canonical = repo.resolve_skill_ref(key).canonical
        except RepositoryError:
            canonical = key
        normalized[canonical] = value
    return normalized


def _check_scout(repo: Repository, report: CheckReport) -> None:
    try:
        sources = repo.read_scout()["sources"]
    except RepositoryError as exc:
        report.problems.append(str(exc))
        report.sections["scout"] = {"sources": 0, "skills": 0}
        return
    total = 0
    for name, record in sorted(sources.items()):
        if not isinstance(record, dict):
            report.problems.append(f"scout {name}: 记录必须是对象")
            continue
        if not isinstance(record.get("provider"), str) or not record["provider"]:
            report.problems.append(f"scout {name}: provider 不能为空")
        if not isinstance(record.get("locator"), dict):
            report.problems.append(f"scout {name}: locator 必须是对象")
        indexed = record.get("skills")
        if not isinstance(indexed, list) or not indexed:
            report.problems.append(f"scout {name}: skills 必须是非空数组")
            continue
        paths: set[str] = set()
        for item in indexed:
            if not isinstance(item, dict) or not all(
                isinstance(item.get(key), str)
                for key in ("path", "name", "description")
            ):
                report.problems.append(
                    f"scout {name}: 条目必须包含 path、name、description 字符串"
                )
                continue
            if item["path"] in paths:
                report.problems.append(f"scout {name}: 条目路径重复 {item['path']}")
            paths.add(item["path"])
        total += len(indexed)
    report.sections["scout"] = {"sources": len(sources), "skills": total}


def _check_mcps(repo: Repository, report: CheckReport, *, repo_only: bool) -> None:
    try:
        catalog = mcps.validated_catalog(repo)
    except (RepositoryError, mcps.McpError) as exc:
        report.problems.append(str(exc))
        report.sections["mcps"] = {"count": 0, "enabled": 0}
        return
    if not repo_only:
        report.problems.extend(mcps.runtime_issues(repo, include_targets=True))
    report.sections["mcps"] = {
        "count": len(catalog["servers"]),
        "enabled": sum(
            1 for record in catalog["servers"].values() if record["enabled"]
        ),
    }


def _check_dependency_cycles(graph: dict[str, list[str]], report: CheckReport) -> None:
    visited: set[str] = set()
    visiting: list[str] = []

    def visit(name: str) -> None:
        if name in visited:
            return
        if name in visiting:
            cycle = visiting[visiting.index(name) :] + [name]
            report.problems.append("技能依赖形成循环：" + " -> ".join(cycle))
            return
        visiting.append(name)
        for dependency in graph.get(name, []):
            if dependency in graph:
                visit(dependency)
        visiting.pop()
        visited.add(name)

    for name in graph:
        visit(name)


def _check_references(inventory: dict[str, Any], report: CheckReport) -> None:
    known = {entry.name for entry in inventory.values()}
    by_name = {
        entry.name: entry
        for entry in inventory.values()
        if sum(1 for candidate in inventory.values() if candidate.name == entry.name)
        == 1
    }
    broken: list[str] = []
    missing_files: list[str] = []
    for name, entry in sorted(inventory.items()):
        text = (entry.path / "SKILL.md").read_text(encoding="utf-8", errors="replace")
        broken.extend(_missing_skill_references(name, text, known))
        missing_files.extend(_missing_markdown_links(name, entry.path, text, by_name))
    report.problems.extend([*broken, *missing_files])
    report.sections["references"] = {
        "broken_skills": broken,
        "missing_files": missing_files,
    }


def candidate_skill_problems(
    name: str,
    skill_root: Path,
    inventory: dict[str, Any],
    *,
    skill_text: str | None = None,
) -> list[str]:
    problems: list[str] = []
    skill_file = skill_root / "SKILL.md"
    try:
        text = (
            skill_text
            if skill_text is not None
            else skill_file.read_text(encoding="utf-8", errors="replace")
        )
        frontmatter = parse_skill_frontmatter(text)
    except (OSError, ValueError, RuntimeError) as exc:
        return [f"{name}: {exc}"]
    if not isinstance(frontmatter.get("name"), str) or not frontmatter["name"]:
        problems.append(f"{name}: frontmatter 缺 name")
    if (
        not isinstance(frontmatter.get("description"), str)
        or not frontmatter["description"].strip()
    ):
        problems.append(f"{name}: frontmatter 缺 description")
    symlink_report = CheckReport()
    _check_symlinks(skill_root, symlink_report)
    problems.extend(symlink_report.problems)
    known = {entry.name for entry in inventory.values()}
    problems.extend(_missing_skill_references(name, text, known))
    problems.extend(_missing_markdown_links(name, skill_root, text, inventory))
    return problems


def _missing_skill_references(
    name: str,
    text: str,
    known: set[str],
) -> list[str]:
    missing: list[str] = []
    seen: set[str] = set()
    for match in REFERENCE.finditer(text):
        reference = match.group(1)
        if reference in known or reference in seen:
            continue
        around = text[max(0, match.start() - 80) : match.end() + 80]
        if not REFERENCE_CONTEXT.search(around):
            continue
        before = text[max(0, match.start() - 24) : match.start()]
        if re.search(r"do not|don't|never|不要|禁止", before, re.IGNORECASE):
            continue
        seen.add(reference)
        missing.append(f"{name} 引用了 /{reference}，但仓库里不存在")
    return missing


def _missing_markdown_links(
    name: str,
    skill_root: Path,
    text: str,
    inventory: dict[str, Any],
) -> list[str]:
    missing: list[str] = []
    skills_root = skill_root.parents[1].resolve()
    for match in MARKDOWN_LINK.finditer(text):
        raw = match.group(1).strip()
        if raw.startswith("<") and ">" in raw:
            raw = raw[1 : raw.index(">")]
        else:
            raw = raw.split(maxsplit=1)[0]
        parsed = urllib.parse.urlsplit(raw)
        if parsed.scheme or parsed.netloc or not parsed.path:
            continue
        relative = urllib.parse.unquote(parsed.path)
        if relative.startswith(("#", "/")):
            continue
        if "/" not in relative and not Path(relative).suffix:
            continue
        target = (skill_root / relative).resolve()
        parts = Path(relative).parts
        referenced_skill = (
            parts[-2] if len(parts) >= 2 and parts[-1] == "SKILL.md" else None
        )
        if not target.exists() and referenced_skill in inventory:
            continue
        if target != skills_root and skills_root not in target.parents:
            missing.append(f"{name}: Markdown 链接越出技能库 {relative}")
        elif not target.exists():
            missing.append(f"{name}: Markdown 链接目标不存在 {relative}")
    return list(dict.fromkeys(missing))


def _check_docs(repo: Repository, command_help: str, report: CheckReport) -> None:
    try:
        stale = docs.check(repo, command_help=command_help)
    except (OSError, RuntimeError, ValueError) as exc:
        report.problems.append(f"文档生成检查失败：{exc}")
        stale = []
    for path in stale:
        report.problems.append(f"生成文档已过期：{path}")
    report.sections["docs"] = {"stale": stale}


def _check_global(repo: Repository, report: CheckReport) -> None:
    try:
        plan = global_plan(repo)
    except InstallationError as exc:
        report.problems.append(str(exc))
        return
    for name in plan["missing"]:
        report.problems.append(f"全局安装缺少技能：{name}")
    report.problems.extend(plan["conflicts"])
    for action in plan["actions"]:
        report.problems.append(f"全局安装未收敛：{action['action']} {action['target']}")
    for action in plan["marketplace_actions"]:
        report.problems.append(
            f"插件安装未收敛：{action['action']} {action.get('plugin', action.get('marketplace', ''))}"
        )
    report.sections["global"] = plan


IGNORED_TREE_DIRS = {".git", "__pycache__", ".venv", "venv", "node_modules"}


def _check_symlinks(root: Path, report: CheckReport) -> None:
    root_real = root.resolve()
    for path in root.rglob("*"):
        if any(part in IGNORED_TREE_DIRS for part in path.relative_to(root).parts):
            continue
        if not path.is_symlink():
            continue
        target = path.resolve()
        if target != root_real and root_real not in target.parents:
            report.problems.append(f"技能包含越界软链接：{path}")
