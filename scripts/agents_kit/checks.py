from __future__ import annotations

import re
import urllib.parse
from pathlib import Path
from typing import Any

from . import docs, mcps
from .installation import InstallationError, global_plan
from .models import CheckReport, ContentMode, parse_skill_frontmatter
from .repository import Repository, RepositoryError
from .taxonomy import TaxonomyError, validate_tags

REFERENCE_CONTEXT = re.compile(
    r"skill|技能|invoke|run the|/(?:run|use)\b", re.IGNORECASE
)
REFERENCE = re.compile(r"`/([a-z][a-z0-9-]{2,40})`")
MARKDOWN_LINK = re.compile(r"!?\[[^\]]*\]\(([^)\n]+)\)")


def run(repo: Repository, *, command_help: str, repo_only: bool = False) -> CheckReport:
    report = CheckReport()
    try:
        inventory = repo.inventory(refresh=True)
    except RepositoryError as exc:
        report.problems.append(str(exc))
        return report

    _check_skill_files(repo, inventory, report)
    _check_active(repo, inventory, report)
    _check_sources(repo, inventory, report)
    _check_metadata(repo, inventory, report)
    _check_mcps(repo, report, repo_only=repo_only)
    _check_references(inventory, report)
    _check_docs(repo, command_help, report)
    if not repo_only:
        _check_global(repo, report)
    report.sections["summary"] = {
        "skills": len(inventory),
        "active": len(repo.read_active()),
        "sources": len(repo.read_sources()["skills"]),
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


def _check_active(
    repo: Repository, inventory: dict[str, Any], report: CheckReport
) -> None:
    active = repo.read_active()
    missing = sorted(set(active) - set(inventory))
    for name in missing:
        report.problems.append(f"active.txt 中的 {name} 不存在")
    report.sections["active"] = {"count": len(active), "missing": missing}


def _check_sources(
    repo: Repository, inventory: dict[str, Any], report: CheckReport
) -> None:
    records = repo.read_sources()["skills"]
    stale = sorted(set(records) - set(inventory))
    for name in stale:
        report.problems.append(f"sources.json 中的 {name} 不存在")
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
            content_mode = ContentMode(record.get("content_mode"))
        except (TypeError, ValueError):
            report.problems.append(f"{name}: source content_mode 无效")
            content_mode = None
        if record.get("policy") not in {"review", "pinned"}:
            report.problems.append(f"{name}: source policy 无效")
        resolved = record.get("resolved")
        if not isinstance(resolved, dict) or not isinstance(
            resolved.get("content_sha256"), str
        ):
            report.problems.append(f"{name}: source resolved 摘要不完整")
        elif content_mode and name in inventory:
            local_hash = repo.hash_skill_content(inventory[name].path, content_mode)
            if local_hash != resolved["content_sha256"]:
                report.problems.append(
                    f"{name}: 本地受管内容与 source resolved 摘要不一致"
                )
    report.sections["sources"] = {"count": len(records), "stale": stale}


def _check_metadata(
    repo: Repository, inventory: dict[str, Any], report: CheckReport
) -> None:
    catalog = repo.read_metadata()
    metadata = catalog["skills"]
    if catalog["taxonomy_version"] != repo.taxonomy_version:
        report.problems.append(
            "metadata.json taxonomy_version "
            f"{catalog['taxonomy_version']} 与 agents-kit.json "
            f"{repo.taxonomy_version} 不一致"
        )
    stale = sorted(set(metadata) - set(inventory))
    missing = sorted(set(inventory) - set(metadata))
    for name in stale:
        report.problems.append(f"metadata.json 中的 {name} 不存在")
    for name in missing:
        report.problems.append(f"{name}: 缺 metadata")

    graph: dict[str, list[str]] = {}
    for name, record in sorted(metadata.items()):
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
        graph[name] = dependencies
        for dependency in dependencies:
            if dependency not in inventory:
                report.problems.append(f"{name}: 依赖不存在 {dependency}")
    _check_dependency_cycles(graph, report)
    report.sections["metadata"] = {
        "count": len(metadata),
        "missing": missing,
        "stale": stale,
    }


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
    known = set(inventory)
    broken: list[str] = []
    missing_files: list[str] = []
    for name, entry in sorted(inventory.items()):
        text = (entry.path / "SKILL.md").read_text(encoding="utf-8", errors="replace")
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
            broken.append(f"{name} 引用了 /{reference}，但仓库里不存在")
        missing_files.extend(
            _missing_markdown_links(name, entry.path, text, inventory)
        )
    report.problems.extend([*broken, *missing_files])
    report.sections["references"] = {
        "broken_skills": broken,
        "missing_files": missing_files,
    }


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
    report.sections["global"] = plan


def _check_symlinks(root: Path, report: CheckReport) -> None:
    root_real = root.resolve()
    for path in root.rglob("*"):
        if not path.is_symlink():
            continue
        target = path.resolve()
        if target != root_real and root_real not in target.parents:
            report.problems.append(f"技能包含越界软链接：{path}")
