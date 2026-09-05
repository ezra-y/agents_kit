from __future__ import annotations

import hashlib
import json
import re
import subprocess
import urllib.parse
from collections.abc import Mapping
from typing import Any

REASON_LABELS = {
    "local_upstream_conflict": "本地与上游同时修改",
    "candidate_validation_failed": "候选内容体检失败",
}

DETAIL_LIST_LIMIT = 8
DIFF_LINE_LIMIT = 24


def render_source_review_markdown(
    report: Mapping[str, Any],
    sources: Mapping[str, Any],
    *,
    run_url: str = "",
    include_details: bool = True,
) -> str:
    results = list(report.get("results", []))
    failures = list(report.get("failures", []))
    updated = [
        row
        for row in results
        if (row.get("decision") == "auto_apply" or row.get("status") == "safe_update")
        and row.get("applied")
    ]
    review = pending_updates(report)
    unchanged = sum(
        row.get("merge_state") in {"unchanged", "local_only"}
        or row.get("status") == "unchanged"
        for row in results
    )

    lines = [
        "# 上游技能审核",
        "",
        "更新检查已完成。以下待办不影响当前安装；只有确认过的更新才会应用。",
        "同一批变化不重复更新此事项。每次运行的完整结果仍保存在 Actions 报告。",
        "",
        "| 结果 | 数量 |",
        "|---|---:|",
        f"| 无变化 | **{unchanged}** |",
        f"| 自动更新 | **{len(updated)}** |",
        f"| 待人工确认 | **{len(review)}** |",
        f"| 检查失败 | **{len(failures)}** |",
    ]
    if run_url:
        lines.extend(["", f"[查看本次 Actions 运行]({run_url})"])

    if updated:
        lines.extend(
            [
                "",
                "## 已自动更新",
                "",
                ", ".join(f"`{_row_name(row)}`" for row in updated),
            ]
        )

    lines.extend(["", "## 待人工确认", ""])
    if not review:
        lines.append("没有待人工确认的更新。")
    else:
        lines.extend(
            [
                "| Skill | 更新内容 / 待处理原因 | 变化规模 | 上游 |",
                "|---|---|---:|---|",
            ]
        )
        for row in review:
            name = _row_name(row)
            reason = "；".join(_reason_labels(row))
            scale = _change_scale(row)
            source_url = _source_url(sources.get(name, {}), row)
            source = f"[查看]({source_url})" if source_url else "—"
            lines.append(
                f"| `{_escape_table(name)}` | {_escape_table(reason)} | "
                f"{_escape_table(scale)} | {source} |"
            )
        if include_details:
            for row in review:
                name = _row_name(row)
                lines.extend(_review_details(row, sources.get(name, {})))

    if failures:
        lines.extend(["", "## 检查失败", ""])
        for failure in failures:
            name = (
                failure.get("skill")
                or failure.get("asset")
                or failure.get("plugin")
                or "unknown"
            )
            lines.append(f"- `{name}`：{failure.get('error', '未知错误')}")

    lines.extend(["", f"<!-- agents-kit-review:v1:{review_fingerprint(report)} -->"])
    return "\n".join(lines).rstrip() + "\n"


def _review_details(
    row: Mapping[str, Any],
    source_record: Mapping[str, Any],
) -> list[str]:
    name = _row_name(row)
    reasons = "；".join(_reason_labels(row))
    lines = [
        "",
        "<details>",
        f"<summary><code>{name}</code> · {reasons} · {_change_scale(row)}</summary>",
        "",
    ]
    source_url = _source_url(source_record, row)
    if source_url:
        lines.append(f"- 上游版本：[打开来源]({source_url})")
    if isinstance(row.get("similarity"), (int, float)):
        lines.append(f"- `SKILL.md` 相似度：{_percent(row['similarity'])}")
    if isinstance(row.get("changed_lines"), int):
        lines.append(f"- 文本增删：{row['changed_lines']} 行")

    problems = list(row.get("validation_problems", []))
    if problems:
        lines.extend(["", "**候选内容体检**", ""])
        lines.extend(f"- {problem}" for problem in problems[:DETAIL_LIST_LIMIT])
        if len(problems) > DETAIL_LIST_LIMIT:
            lines.append(
                f"- 还有 {len(problems) - DETAIL_LIST_LIMIT} 项，"
                "见 Actions Artifact 中的 JSON"
            )

    diff_lines = list(row.get("skill_diff", []))
    if diff_lines:
        visible = diff_lines[:DIFF_LINE_LIMIT]
        lines.extend(["", "**`SKILL.md` 差异摘要**", "", "```diff", *visible])
        if len(diff_lines) > DIFF_LINE_LIMIT:
            qualifier = "至少 " if row.get("skill_diff_truncated") else ""
            lines.append(
                f"... 其余{qualifier}{len(diff_lines) - DIFF_LINE_LIMIT} 行已省略"
            )
        lines.append("```")

    blocked = bool(problems) or row.get("decision") == "blocked"
    conflict = row.get(
        "merge_state"
    ) == "diverged" or "local_upstream_conflict" in row.get("reasons", [])
    if blocked or conflict:
        instruction = (
            "新版文件尚不完整，需补齐来源后重新检查；当前版本保持不变。"
            if blocked
            else "本地与上游都有修改，需逐项合并；不会自动覆盖本地内容。"
        )
        command = f"agents-kit source check {name} --json"
    else:
        instruction = "确认后单独更新："
        command = f"agents-kit source update {name} --yes"
    lines.extend(["", instruction, "", "```bash", command, "```", "", "</details>"])
    return lines


def _reason_labels(row: Mapping[str, Any]) -> list[str]:
    reasons = list(row.get("reasons", []))
    labels = [REASON_LABELS.get(reason, str(reason)) for reason in reasons]
    risk_class = row.get("risk_class")
    if risk_class:
        labels.append(
            {
                "instructional": "Agent 指令或平台配置变化",
                "executable": "可执行内容变化",
                "binary": "二进制内容变化",
                "unknown": "未知类型内容变化",
                "docs_only": "纯文档变化",
            }.get(str(risk_class), str(risk_class))
        )
    return list(dict.fromkeys(labels)) or ["需要人工确认"]


def _change_scale(row: Mapping[str, Any]) -> str:
    changed_lines = row.get("changed_lines")
    if isinstance(changed_lines, int) and changed_lines:
        return f"`SKILL.md` {changed_lines} 行"
    return "受管内容变化"


def _source_url(
    record: Mapping[str, Any],
    row: Mapping[str, Any],
) -> str | None:
    locator = record.get("locator", {})
    if not isinstance(locator, Mapping):
        return None
    url = str(locator.get("url") or "")
    if not url:
        return None
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return None
    if record.get("provider") != "git":
        return url
    base = url.removesuffix(".git")
    if parsed.hostname != "github.com":
        return base
    revision = str(row.get("revision") or locator.get("ref") or "")
    path = str(locator.get("path") or "").strip("/")
    if not revision:
        return base
    tree_url = f"{base}/tree/{urllib.parse.quote(revision, safe='')}"
    if path:
        tree_url += f"/{urllib.parse.quote(path, safe='/')}"
    return tree_url


def _percent(value: float) -> str:
    return f"{value:.1%}"


def _escape_table(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")


def _row_name(row: Mapping[str, Any]) -> str:
    return str(row.get("skill") or row.get("asset") or row.get("plugin") or "unknown")


def pending_updates(report: Mapping[str, Any]) -> list[dict[str, Any]]:
    return sorted(
        (
            row
            for row in report.get("results", [])
            if not row.get("applied")
            and row.get("upstream_modified") is not False
            and (
                row.get("decision") in {"review_required", "blocked"}
                or row.get("status") == "review_required"
            )
        ),
        key=_row_name,
    )


def review_fingerprint(report: Mapping[str, Any]) -> str:
    """Only actionable content changes matter, not run URLs or unrelated commits."""
    fields = (
        "merge_state",
        "decision",
        "risk_class",
        "local_sha256",
        "remote_sha256",
        "resolved_sha256",
        "reasons",
        "validation_problems",
        "authority_conflicts",
        "changed_paths",
        "skill_diff",
    )
    pending = [
        {"asset": _row_name(row), **{key: row[key] for key in fields if key in row}}
        for row in pending_updates(report)
    ]
    for row in pending:
        for key in (
            "reasons",
            "validation_problems",
            "authority_conflicts",
            "changed_paths",
        ):
            if key in row:
                row[key] = sorted(row[key])
    failures = sorted(
        (
            {"asset": _row_name(row), "error": row.get("error", "未知错误")}
            for row in report.get("failures", [])
        ),
        key=lambda row: (row["asset"], row["error"]),
    )
    payload = json.dumps(
        {"pending": pending, "failures": failures},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def _gh(args: list[str], *, body: str | None = None) -> str:
    try:
        result = subprocess.run(
            ["gh", *args],
            input=body,
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"上游待办同步失败：{exc}") from exc
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip()[:2000])
    return result.stdout


def sync_review_issue(
    report: Mapping[str, Any],
    sources: Mapping[str, Any],
    *,
    repository: str,
    run_url: str = "",
    dry_run: bool = False,
) -> dict[str, Any]:
    """One issue, updated only when its pending work changes. Never changes subscriptions."""
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("仓库必须使用 owner/name 格式")
    # A missing/truncated report must not close an unresolved issue.
    if not all(isinstance(report.get(key), list) for key in ("results", "failures")):
        raise ValueError("报告缺少完整的 results/failures 数组")
    if not all(
        isinstance(row, dict) for key in ("results", "failures") for row in report[key]
    ):
        raise ValueError("报告条目必须是对象")
    title = "上游技能待更新"
    issues = json.loads(
        _gh(
            [
                "issue",
                "list",
                "--repo",
                repository,
                "--state",
                "all",
                "--limit",
                "100",
                "--search",
                f'"{title}" in:title',
                "--json",
                "number,title,body,state",
            ]
        )
    )
    exact = sorted(
        (item for item in issues if item["title"] == title),
        key=lambda item: (item["state"] != "OPEN", -item["number"]),
    )
    current = exact[0] if exact else None
    needed = bool(pending_updates(report) or report["failures"])
    marker = f"<!-- agents-kit-review:v1:{review_fingerprint(report)} -->"
    if not needed:
        action = "close" if current and current["state"] == "OPEN" else "unchanged"
    elif (
        current and marker in (current.get("body") or "") and current["state"] == "OPEN"
    ):
        action = "unchanged"
    else:
        action = "update" if current else "create"
    result = {
        "action": action,
        "issue": current["number"] if current else None,
        "pending": len(pending_updates(report)),
        "failures": len(report["failures"]),
        "dry_run": dry_run,
    }
    if dry_run or action == "unchanged":
        return result
    selector = [str(current["number"]), "--repo", repository] if current else []
    if action == "close":
        _gh(["issue", "close", *selector])
    else:
        body = render_source_review_markdown(
            report, sources, run_url=run_url, include_details=False
        )
        if current:
            _gh(["issue", "edit", *selector, "--body-file", "-"], body=body)
            if current["state"] != "OPEN":
                _gh(["issue", "reopen", *selector])
        else:
            _gh(
                [
                    "issue",
                    "create",
                    "--repo",
                    repository,
                    "--title",
                    title,
                    "--body-file",
                    "-",
                ],
                body=body,
            )
    return result
