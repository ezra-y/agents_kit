"""Read actual host plugin loading without starting a model turn."""

from __future__ import annotations

import json
import os
import re
import selectors
import shutil
import signal
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
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


@contextmanager
def stdio_session(command: list[str], *, cwd: str, timeout: float = 35):
    """A bounded RPC session; all processes belong to this probe and are reaped."""
    process = subprocess.Popen(
        command,
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
    deadline = time.monotonic() + timeout

    def request(message: dict[str, Any]) -> dict[str, Any]:
        nonlocal buffer
        process.stdin.write((json.dumps(message) + "\n").encode())
        process.stdin.flush()
        if "id" not in message:
            return {}
        while time.monotonic() < deadline:
            for key, _ in selector.select(
                min(0.25, max(0, deadline - time.monotonic()))
            ):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    raise RuntimeError("查询进程提前结束，未返回完整结果")
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    try:
                        payload = json.loads(line)
                    except ValueError:
                        continue  # Some launchers print startup notices on stdout.
                    if (
                        not isinstance(payload, dict)
                        or payload.get("id") != message["id"]
                    ):
                        continue
                    if "error" in payload:
                        raise RuntimeError(str(payload["error"])[:1000])
                    result = payload.get("result")
                    if not isinstance(result, dict):
                        raise TypeError("查询返回格式无效：缺少 result 对象")
                    return result
        raise RuntimeError("实际连通检查超时")

    try:
        yield request
    finally:
        selector.close()
        try:
            process.stdin.close()
        except (OSError, BrokenPipeError):
            pass
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=2)
                if sig == signal.SIGTERM:
                    continue  # Also release any descendants that outlived the launcher.
            except subprocess.TimeoutExpired:
                continue
        process.stdout.close()


def codex_skills(cwd: str) -> list[dict[str, Any]]:
    executable = shutil.which("codex")
    if not executable:
        raise RuntimeError("找不到 Codex 程序")
    with stdio_session([executable, "app-server", "--stdio"], cwd=cwd) as query:
        query(
            {
                "id": 1,
                "method": "initialize",
                "params": {
                    "clientInfo": {"name": "agents-kit-check", "version": "1"},
                    "capabilities": {"experimentalApi": True},
                },
            }
        )
        query({"method": "initialized", "params": {}})
        result = query(
            {
                "id": 2,
                "method": "skills/list",
                "params": {
                    "cwds": [cwd],
                    "forceReload": True,
                },
            }
        )
    groups = result.get("data")
    if not isinstance(groups, list) or not groups:
        raise RuntimeError("Codex 未返回技能清单")
    errors = [error for group in groups for error in group.get("errors", [])]
    if errors:
        raise RuntimeError(str(errors)[:2000])
    return [skill for group in groups for skill in group.get("skills", [])]


def claude_skills(plugin_id: str) -> set[str]:
    result = subprocess.run(
        ["claude", "plugin", "details", plugin_id],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    match = re.search(
        r"^[ \t]*Skills[ \t]*\((\d+)\)[ \t]*([^\n]*)", result.stdout, re.MULTILINE
    )
    if result.returncode or not match:
        raise RuntimeError("Claude 未返回可核验的插件技能清单")
    names = {name.strip() for name in match[2].split(",") if name.strip()}
    if len(names) != int(match[1]):
        raise RuntimeError("Claude 插件技能清单不完整")
    return names


def mcp_report(repo: Repository) -> dict[str, Any]:
    """Initialize each enabled server and list its tools; never call a tool or model."""
    names = sorted(
        name for name, rec in repo.read_mcps()["servers"].items() if rec["enabled"]
    )

    def probe(name: str) -> dict[str, Any]:
        row: dict[str, Any] = {"name": name, "status": "failed", "tool_count": 0}
        try:
            with stdio_session(
                [str(repo.root / "scripts/agents-kit"), "mcp", "run", name],
                cwd=str(repo.root),
                timeout=45,
            ) as query:
                hello = query(
                    {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {},
                            "clientInfo": {"name": "agents-kit-check", "version": "1"},
                        },
                    }
                )
                query({"jsonrpc": "2.0", "method": "notifications/initialized"})
                tools: set[str] = set()
                cursor = None
                cursors: set[str] = set()
                request_id = 2
                while True:
                    result = query(
                        {
                            "jsonrpc": "2.0",
                            "id": request_id,
                            "method": "tools/list",
                            "params": {"cursor": cursor} if cursor else {},
                        }
                    )
                    if not isinstance(result.get("tools"), list):
                        raise TypeError("MCP 未返回工具列表")
                    tools.update(tool["name"] for tool in result["tools"])
                    cursor = result.get("nextCursor")
                    if not cursor:
                        break
                    if cursor in cursors:
                        raise RuntimeError("MCP 工具分页重复，检查已停止")
                    cursors.add(cursor)
                    request_id += 1
                if not tools:
                    raise RuntimeError("MCP 已连接，但没有提供工具")
                row.update(
                    status="ready",
                    tool_count=len(tools),
                    protocol=hello.get("protocolVersion"),
                )
        except (
            OSError,
            ValueError,
            KeyError,
            TypeError,
            RuntimeError,
            subprocess.SubprocessError,
        ) as exc:
            row["error"] = str(exc)[:1000]
        return row

    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(probe, names))
    problems = [
        f"MCP/{row['name']}: {row.get('error', '未就绪')}"
        for row in rows
        if row["status"] != "ready"
    ]
    return {
        "ok": not problems,
        "servers": rows,
        "problems": problems,
        "tools_called": 0,
        "model_inference": False,
    }


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
            TypeError,
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
            if target == "claude" and not errors:
                try:
                    loaded = {f"{name}:{sid}" for sid in claude_skills(plugin_id)}
                    missing = sorted(expected_names - loaded)
                    if missing:
                        errors.append("未发现技能：" + ", ".join(missing))
                except (
                    OSError,
                    ValueError,
                    RuntimeError,
                    subprocess.SubprocessError,
                ) as exc:
                    errors.append(str(exc))
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
