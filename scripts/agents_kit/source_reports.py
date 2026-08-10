from __future__ import annotations

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
) -> str:
    results = list(report.get("results", []))
    failures = list(report.get("failures", []))
    updated = [
        row
        for row in results
        if (row.get("decision") == "auto_apply" or row.get("status") == "safe_update")
        and row.get("applied")
    ]
    review = [
        row
        for row in results
        if (
            row.get("decision") == "review_required"
            or row.get("status") == "review_required"
        )
        and row.get("upstream_modified") is not False
    ]
    unchanged = sum(
        row.get("merge_state") in {"unchanged", "local_only"}
        or row.get("status") == "unchanged"
        for row in results
    )

    lines = [
        "# 上游技能审核",
        "",
        "> 逐项检查待确认内容；不要使用 `source update --all` 批量接受。",
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
                "| Skill | 拦截原因 | 变化规模 | 上游 |",
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

    lines.extend(
        [
            "",
            "确认后单独更新：",
            "",
            "```bash",
            f"agents-kit source update {name} --yes",
            "```",
            "",
            "</details>",
        ]
    )
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
