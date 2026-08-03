from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from .core import redact_text, utc_now


def state_home() -> Path:
    override = os.environ.get("SKILL_PUBLISHER_HOME")
    if override:
        return Path(override).expanduser().resolve()
    xdg_state = os.environ.get("XDG_STATE_HOME")
    if xdg_state:
        return (Path(xdg_state).expanduser() / "skill-publisher").resolve()
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            return (Path(local_app_data) / "skill-publisher").resolve()
    return (Path.home() / ".local" / "state" / "skill-publisher").resolve()


def create_run_directory(
    *,
    skill_name: str,
    version: str,
    fingerprint: str,
    repository_key: str,
    root: Path | None = None,
) -> tuple[str, Path]:
    timestamp = utc_now().replace(":", "").replace(".", "").replace("+", "")
    run_id = f"{timestamp}-{skill_name}-{fingerprint[:8]}"
    safe_repo_key = _safe_component(repository_key)
    home = (root or state_home()).resolve()
    run_dir = home / "repositories" / safe_repo_key / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    atomic_write_json(
        home / "repositories" / safe_repo_key / "latest.json",
        {
            "run_id": run_id,
            "run_dir": str(run_dir),
            "skill_name": skill_name,
            "version": version,
            "updated_at": utc_now(),
        },
    )
    return run_id, run_dir


def _safe_component(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-").lower()
    return normalized or "local"


def atomic_write_json(path: Path | str, data: dict[str, Any]) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    _atomic_write_text(destination, redact_text(payload))


def atomic_write_text(path: Path | str, text: str) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write_text(destination, redact_text(text))


def _atomic_write_text(path: Path, text: str) -> None:
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        delete=False,
    ) as handle:
        handle.write(text)
        temp_path = Path(handle.name)
    os.replace(temp_path, path)


def load_run(run_dir: Path | str) -> dict[str, Any]:
    directory = Path(run_dir).expanduser().resolve()
    plan_path = directory / "plan.json"
    if not plan_path.is_file():
        raise FileNotFoundError(f"Missing plan.json in {directory}")
    data = json.loads(plan_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise TypeError(f"Invalid plan: {plan_path}")
    return data


def save_run(run_dir: Path | str, plan: dict[str, Any]) -> None:
    directory = Path(run_dir).expanduser().resolve()
    plan["updated_at"] = utc_now()
    atomic_write_json(directory / "plan.json", plan)


def append_event(
    run_dir: Path | str,
    *,
    event: str,
    platform: str | None = None,
    status: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    directory = Path(run_dir).expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True)
    record = {
        "at": utc_now(),
        "event": event,
        "platform": platform,
        "status": status,
        "details": details or {},
    }
    payload = redact_text(json.dumps(record, ensure_ascii=False, sort_keys=True)) + "\n"
    with (directory / "events.ndjson").open("a", encoding="utf-8") as handle:
        handle.write(payload)


def write_receipt(run_dir: Path | str, plan: dict[str, Any]) -> Path:
    directory = Path(run_dir).expanduser().resolve()
    receipt = {
        "schema_version": plan.get("schema_version", 1),
        "run_id": plan["run_id"],
        "created_at": plan["created_at"],
        "updated_at": utc_now(),
        "engine": plan.get("engine", {}),
        "source": plan["source"],
        "skill": plan["skill"],
        "version": plan["version"],
        "targets": plan["targets"],
        "source_reviews": plan.get("source_reviews", {}),
        "platforms": plan.get("platforms", {}),
        "next_actions": collect_next_actions(plan),
    }
    path = directory / "receipt.json"
    atomic_write_json(path, receipt)
    return path


def collect_next_actions(plan: dict[str, Any]) -> list[dict[str, str]]:
    actions: list[dict[str, str]] = []
    for platform, result in plan.get("platforms", {}).items():
        status = result.get("status", "unknown")
        if status in {"verified", "indexed"}:
            continue
        message = result.get("next_action") or _default_next_action(status)
        actions.append({"platform": platform, "status": status, "action": message})
    return actions


def _default_next_action(status: str) -> str:
    return {
        "planned": "Complete source review, then publish.",
        "blocked": "Resolve the blocker and rerun preflight.",
        "manual_handoff": "Complete the official form or authorization, then verify.",
        "submitted": "Wait for the platform to expose an approval or public status.",
        "pending_review": "Wait for review, then verify the public listing.",
        "published": "Run remote verification.",
        "rejected": "Review the platform feedback before preparing a new submission.",
        "unknown": "Query the platform again before making another change.",
    }.get(status, "Review the platform result.")


def render_report(plan: dict[str, Any]) -> str:
    skill = plan["skill"]
    source = plan["source"]
    engine_fingerprint = plan.get("engine", {}).get("fingerprint")
    lines = [
        "# Skill 发布记录",
        "",
        f"- 运行 ID：`{plan['run_id']}`",
        f"- Skill：`{skill['name']}`",
        f"- 版本：`{plan['version']}`",
        f"- 发布器指纹：`{engine_fingerprint[:12] if engine_fingerprint else '无'}`",
        f"- 源提交：`{source.get('commit') or '无'}`",
        f"- 源仓库：{source.get('remote_url') or source.get('root') or '无'}",
        "",
        "## 平台状态",
        "",
        "| 平台 | 状态 | 公开地址或说明 |",
        "|---|---|---|",
    ]
    for platform in plan["targets"]:
        result = plan.get("platforms", {}).get(platform, {})
        status = result.get("status", "planned")
        detail = (
            result.get("public_url")
            or result.get("submission_id")
            or result.get("next_action")
            or result.get("planned_action")
            or ""
        )
        lines.append(f"| {platform} | `{status}` | {detail} |")

    next_actions = collect_next_actions(plan)
    if next_actions:
        lines.extend(["", "## 还需处理", ""])
        for action in next_actions:
            lines.append(
                f"- `{action['platform']}`（`{action['status']}`）：{action['action']}"
            )
    lines.extend(
        [
            "",
            "## 官方来源核对",
            "",
            "| 平台 | 状态 | 核对时间 |",
            "|---|---|---|",
        ]
    )
    for platform in plan["targets"]:
        review = plan.get("source_reviews", {}).get(platform, {})
        lines.append(
            f"| {platform} | `{review.get('status', 'pending')}` | "
            f"{review.get('reviewed_at', '')} |"
        )
    return "\n".join(lines) + "\n"
