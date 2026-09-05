"""Read actual host plugin loading without starting a model turn."""

from __future__ import annotations

import json
import os
import selectors
import shutil
import signal
import subprocess
import time
from datetime import datetime, timezone
from typing import Any

from .models import AssetRef, parse_skill_frontmatter
from .plugins import _embedded_skill_paths, manifest_data
from .repository import Repository


def read_json(command: list[str]) -> Any:
    result = subprocess.run(
        command, capture_output=True, text=True, timeout=40, check=False
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip()[:2000])
    return json.loads(result.stdout)


def codex_skills(cwd: str) -> list[dict[str, Any]]:
    executable = shutil.which("codex")
    if not executable:
        raise RuntimeError("找不到 Codex 程序")
    process = subprocess.Popen(
        [executable, "app-server", "--stdio"],
        cwd=cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    assert process.stdin is not None and process.stdout is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    buffer = b""

    def send(payload: dict[str, Any]) -> None:
        process.stdin.write((json.dumps(payload) + "\n").encode())
        process.stdin.flush()

    def receive(request_id: int) -> dict[str, Any]:
        nonlocal buffer
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            for key, _ in selector.select(0.25):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    raise RuntimeError("Codex 查询进程提前结束")
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    payload = json.loads(line)
                    if payload.get("id") == request_id:
                        if "error" in payload:
                            raise RuntimeError(str(payload["error"]))
                        return payload["result"]
        raise RuntimeError("Codex 技能查询超时")

    try:
        send(
            {
                "id": 1,
                "method": "initialize",
                "params": {
                    "clientInfo": {"name": "agents-kit-check", "version": "1"},
                    "capabilities": {"experimentalApi": True},
                },
            }
        )
        receive(1)
        send({"method": "initialized", "params": {}})
        send(
            {
                "id": 2,
                "method": "skills/list",
                "params": {
                    "cwds": [cwd],
                    "forceReload": True,
                },
            }
        )
        groups = receive(2).get("data", [])
        errors = [error for group in groups for error in group.get("errors", [])]
        if errors:
            raise RuntimeError(str(errors)[:2000])
        return [skill for group in groups for skill in group.get("skills", [])]
    finally:
        selector.close()
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        process.stdin.close()
        process.stdout.close()


def plugin_report(
    repo: Repository, *, target_filter: str | None = None
) -> dict[str, Any]:
    problems: list[str] = []
    rows: list[dict[str, Any]] = []
    for target, state in repo.read_desired_installations()["targets"].items():
        if target_filter and target != target_filter:
            continue
        desired = state.get("plugins", [])
        if not desired:
            continue
        try:
            payload = read_json([target, "plugin", "list", "--json"])
            installed = payload if target == "claude" else payload["installed"]
            discovered = codex_skills(str(repo.root)) if target == "codex" else []
        except (
            OSError,
            ValueError,
            KeyError,
            RuntimeError,
            subprocess.SubprocessError,
        ) as exc:
            problems.append(f"{target}: 无法核验实际加载：{exc}")
            continue
        for item in desired:
            name = AssetRef.parse(item["ref"]).local_id
            spec = repo.require_plugin(name)
            plugin_id = f"{name}@{'skills-dir' if target == 'claude' else 'agents-kit'}"
            actual = next(
                (p for p in installed if p.get("id", p.get("pluginId")) == plugin_id),
                None,
            )
            errors = list(actual.get("errors", [])) if actual else ["宿主未发现该安装"]
            if actual and not actual.get("enabled"):
                errors.append("宿主没有启用这个插件")
            expected = manifest_data(spec.root, target) or {}
            if (
                actual
                and expected.get("version")
                and actual.get("version") != expected["version"]
            ):
                errors.append(
                    f"版本不一致：宿主 {actual.get('version')} / 仓库 {expected['version']}"
                )
            paths = _embedded_skill_paths(spec.root, target=target)
            expected_names = {
                f"{name}:{parse_skill_frontmatter((path / 'SKILL.md').read_text()).get('name', sid)}"
                for sid, path in paths.items()
            }
            missing: list[str] = []
            if target == "codex":
                loaded = {
                    p["name"]
                    for p in discovered
                    if p.get("pluginId") == plugin_id and p.get("enabled", True)
                }
                missing = sorted(expected_names - loaded)
                if missing:
                    errors.append("未发现技能：" + ", ".join(missing))
            rows.append(
                {
                    "target": target,
                    "plugin": name,
                    "status": "failed" if errors else "loaded",
                    "version": actual.get("version") if actual else None,
                    "expected_skills": len(paths),
                    "missing_skills": missing,
                    "errors": errors,
                }
            )
            problems.extend(f"{target}/{name}: {error}" for error in errors)
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "ok": not problems,
        "plugins": rows,
        "problems": problems,
        "model_inference": False,
    }
