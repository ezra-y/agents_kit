from __future__ import annotations

import urllib.parse
from collections.abc import Mapping
from typing import Any

REASON_LABELS = {
    "local_content_modified": "本地内容已修改",
    "low_similarity": "SKILL.md 变化较大",
    "file_layout_changed": "文件结构发生变化",
    "low_content_similarity": "全部内容变化较大",
    "content_change_too_large": "变化超过 500 行",
    "binary_content_changed": "二进制内容发生变化",
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
        if row.get("status") == "safe_update" and row.get("applied")
    ]
    review = [row for row in results if row.get("status") == "review_required"]
    unchanged = sum(row.get("status") == "unchanged" for row in results)

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
                ", ".join(f"`{row['skill']}`" for row in updated),
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
            name = str(row["skill"])
            reason = "；".join(_reason_labels(row))
            scale = _change_scale(row)
            source_url = _source_url(sources.get(name, {}), row)
            source = f"[查看]({source_url})" if source_url else "—"
            lines.append(
                f"| `{_escape_table(name)}` | {_escape_table(reason)} | "
                f"{_escape_table(scale)} | {source} |"
            )
        for row in review:
            lines.extend(_review_details(row, sources.get(str(row["skill"]), {})))

    if failures:
        lines.extend(["", "## 检查失败", ""])
        for failure in failures:
            lines.append(
                f"- `{failure.get('skill', 'unknown')}`："
                f"{failure.get('error', '未知错误')}"
            )

    return "\n".join(lines).rstrip() + "\n"


def _review_details(
    row: Mapping[str, Any],
    source_record: Mapping[str, Any],
) -> list[str]:
    name = str(row["skill"])
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
    if isinstance(row.get("content_similarity"), (int, float)):
        lines.append(f"- 全部文本相似度：{_percent(row['content_similarity'])}")
    if isinstance(row.get("changed_lines"), int):
        lines.append(f"- 文本增删：{row['changed_lines']} 行")

    changed_files = list(row.get("changed_files", []))
    added_paths = list(row.get("added_paths", []))
    removed_paths = list(row.get("removed_paths", []))
    if changed_files or added_paths or removed_paths:
        lines.extend(["", "**文件变化**", ""])
        for item in changed_files[:DETAIL_LIST_LIMIT]:
            path = item.get("path", "unknown")
            if item.get("binary"):
                lines.append(f"- `{path}`：二进制内容变化")
                continue
            lines.append(
                f"- `{path}`：+{item.get('added_lines', 0)} / "
                f"-{item.get('deleted_lines', 0)}"
            )
        lines.extend(f"- 新增 `{path}`" for path in added_paths[:DETAIL_LIST_LIMIT])
        lines.extend(f"- 删除 `{path}`" for path in removed_paths[:DETAIL_LIST_LIMIT])
        hidden = max(0, len(changed_files) - DETAIL_LIST_LIMIT)
        hidden += max(0, len(added_paths) - DETAIL_LIST_LIMIT)
        hidden += max(0, len(removed_paths) - DETAIL_LIST_LIMIT)
        if hidden:
            lines.append(f"- 还有 {hidden} 项，见 Actions Artifact 中的 JSON")

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
    return [REASON_LABELS.get(reason, str(reason)) for reason in reasons] or [
        "需要人工确认"
    ]


def _change_scale(row: Mapping[str, Any]) -> str:
    parts: list[str] = []
    if isinstance(row.get("changed_lines"), int):
        parts.append(f"{row['changed_lines']} 行")
    added = len(row.get("added_paths", []))
    removed = len(row.get("removed_paths", []))
    if added or removed:
        parts.append(f"+{added}/-{removed} 文件")
    if isinstance(row.get("content_similarity"), (int, float)):
        parts.append(f"{_percent(row['content_similarity'])} 相似")
    return "；".join(parts) or "结构变化"


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
