from __future__ import annotations

import json
import os
import shutil
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import tomllib

from .models import ChangeSet, Effect
from .repository import Repository

SUPPORTED_TARGETS = {"claude", "codex"}
SUPPORTED_DISTRIBUTIONS = {"brew", "npm", "pypi", "remote"}
SUPPORTED_SECRET_SOURCES = {"command", "environment"}


class McpError(RuntimeError):
    pass


def import_server(
    repo: Repository,
    name: str,
    record: dict[str, Any],
    *,
    replace: bool = False,
) -> ChangeSet:
    validate_server(name, record, configured_targets=_configured_targets(repo))
    catalog = repo.read_mcps()
    if name in catalog["servers"] and not replace:
        raise McpError(f"MCP 已存在：{name}")
    catalog["servers"][name] = record
    changed = repo.write_mcps(catalog)
    return ChangeSet(
        changed={"mcps.json"} if changed else set(),
        effects={Effect.DOCS_BUILD, Effect.CHECK},
        details={"mcp": name, "enabled": record["enabled"]},
    )


def remove_server(repo: Repository, name: str) -> ChangeSet:
    catalog = repo.read_mcps()
    if catalog["servers"].pop(name, None) is None:
        raise McpError(f"找不到 MCP：{name}")
    changed = repo.write_mcps(catalog)
    return ChangeSet(
        changed={"mcps.json"} if changed else set(),
        effects={Effect.DOCS_BUILD, Effect.CHECK},
        details={"mcp": name, "removed": True},
    )


def set_enabled(repo: Repository, name: str, enabled: bool) -> ChangeSet:
    catalog = repo.read_mcps()
    record = catalog["servers"].get(name)
    if record is None:
        raise McpError(f"找不到 MCP：{name}")
    record["enabled"] = enabled
    changed = repo.write_mcps(catalog)
    return ChangeSet(
        changed={"mcps.json"} if changed else set(),
        effects={Effect.DOCS_BUILD, Effect.CHECK},
        details={"mcp": name, "enabled": enabled},
    )


def list_servers(
    repo: Repository, *, enabled_only: bool = False
) -> list[dict[str, Any]]:
    catalog = validated_catalog(repo)
    rows: list[dict[str, Any]] = []
    for name, record in sorted(catalog["servers"].items()):
        if enabled_only and not record["enabled"]:
            continue
        distribution = record["distribution"]
        rows.append(
            {
                "name": name,
                "description": record["description"],
                "tags": record["tags"],
                "recommendation": record["recommendation"],
                "enabled": record["enabled"],
                "targets": record["targets"],
                "distribution": distribution["type"],
                "package": distribution.get("package"),
                "version": distribution.get("version"),
                "source": record["source"]["url"],
            }
        )
    return rows


def show_server(repo: Repository, name: str) -> dict[str, Any]:
    catalog = validated_catalog(repo)
    try:
        record = catalog["servers"][name]
    except KeyError as exc:
        raise McpError(f"找不到 MCP：{name}") from exc
    return {"name": name, **record}


def apply(
    repo: Repository,
    names: list[str] | None = None,
    *,
    dry_run: bool = False,
    replace: bool = False,
) -> dict[str, Any]:
    catalog = validated_catalog(repo)
    selected = names or sorted(catalog["servers"])
    unknown = sorted(set(selected) - set(catalog["servers"]))
    if unknown:
        raise McpError("找不到 MCP：" + ", ".join(unknown))

    # Preflight the complete batch before installing packages or changing a client.
    actions: list[dict[str, Any]] = []
    conflicts: list[str] = []
    for name in selected:
        record = catalog["servers"][name]
        for target in record["targets"]:
            state = _target_state(repo, target, name)
            managed, exists = state["managed"], state["exists"]
            if record["enabled"]:
                if managed:
                    action = "unchanged" if state.get("enabled", True) else "enable"
                elif exists and not replace:
                    conflicts.append(
                        f"{target} 已有同名 MCP {name}，但不由 agents-kit 管理"
                    )
                    continue
                else:
                    action = "replace" if exists else "add"
                actions.append({"target": target, "mcp": name, "action": action})
            elif managed:
                actions.append({"target": target, "mcp": name, "action": "remove"})
    if conflicts:
        raise McpError("\n".join(conflicts))
    for name in selected:
        if catalog["servers"][name]["enabled"]:
            ensure_distribution(catalog["servers"][name], dry_run=dry_run)
    if not dry_run:
        completed: list[dict[str, Any]] = []
        for action in actions:
            target, name, kind = action["target"], action["mcp"], action["action"]
            try:
                if kind in {"replace", "remove"}:
                    _remove_target(target, name)
                if kind in {"replace", "add", "enable"}:
                    _add_target(repo, target, name)
                completed.append(action)
            except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
                raise McpError(
                    f"MCP 同步未完成：{target}/{name} {kind}；"
                    f"已处理 {len(completed)} 项，修正后可重试。{exc}"
                ) from exc
    return {"dry_run": dry_run, "actions": actions, "conflicts": []}


def remove_from_targets(
    repo: Repository,
    name: str,
    *,
    targets: list[str] | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    selected_targets = targets
    if selected_targets is None:
        selected_targets = show_server(repo, name)["targets"]
    unknown_targets = sorted(set(selected_targets) - SUPPORTED_TARGETS)
    if unknown_targets:
        raise McpError("不支持的 MCP target：" + ", ".join(unknown_targets))
    actions: list[dict[str, str]] = []
    for target in selected_targets:
        state = _target_state(repo, target, name)
        if not state["managed"]:
            continue
        actions.append({"target": target, "mcp": name, "action": "remove"})
        if not dry_run:
            _remove_target(target, name)
    return {"dry_run": dry_run, "actions": actions}


def update_versions(
    repo: Repository,
    names: list[str] | None = None,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    catalog = validated_catalog(repo)
    selected = names or sorted(catalog["servers"])
    unknown = sorted(set(selected) - set(catalog["servers"]))
    if unknown:
        raise McpError("找不到 MCP：" + ", ".join(unknown))

    results: list[dict[str, Any]] = []
    updates: dict[str, str] = {}
    for name in selected:
        record = catalog["servers"][name]
        current = record["distribution"].get("version")
        latest = latest_version(record, timeout=repo.network_timeout)
        status = "unversioned"
        if latest is not None:
            status = "unchanged" if latest == current else "update_available"
            if latest != current:
                updates[name] = latest
        results.append(
            {
                "mcp": name,
                "status": status,
                "current": current,
                "latest": latest,
            }
        )

    if dry_run or not updates:
        return {"dry_run": dry_run, "results": results, "changed": []}

    for name, version in updates.items():
        record = catalog["servers"][name]
        if record["distribution"]["type"] == "brew":
            _run_checked(["brew", "upgrade", record["distribution"]["package"]])
        record["distribution"]["version"] = version
    with repo.write_lock():
        changed = repo.write_mcps(catalog)
    return {
        "dry_run": False,
        "results": results,
        "changed": ["mcps.json"] if changed else [],
    }


def latest_version(record: dict[str, Any], *, timeout: int) -> str | None:
    distribution = record["distribution"]
    kind = distribution["type"]
    package = distribution.get("package")
    if kind == "remote":
        return None
    if kind == "npm":
        result = _run_checked(
            ["npm", "view", package, "version", "--json"], timeout=timeout
        )
        parsed = json.loads(result.stdout)
        if not isinstance(parsed, str) or not parsed:
            raise McpError(f"npm 没有返回有效版本：{package}")
        return parsed
    if kind == "pypi":
        quoted = urllib.parse.quote(package, safe="")
        request = urllib.request.Request(
            f"https://pypi.org/pypi/{quoted}/json",
            headers={"User-Agent": "agents-kit/1"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
        version = payload.get("info", {}).get("version")
        if not isinstance(version, str) or not version:
            raise McpError(f"PyPI 没有返回有效版本：{package}")
        return version
    if kind == "brew":
        result = _run_checked(["brew", "info", "--json=v2", package], timeout=timeout)
        payload = json.loads(result.stdout)
        formulae = payload.get("formulae", [])
        version = formulae[0].get("versions", {}).get("stable") if formulae else None
        if not isinstance(version, str) or not version:
            raise McpError(f"Homebrew 没有返回有效版本：{package}")
        return version
    raise McpError(f"不支持的分发类型：{kind}")


def ensure_distribution(record: dict[str, Any], *, dry_run: bool = False) -> None:
    distribution = record["distribution"]
    if distribution["type"] != "brew":
        return
    command = _render_runtime(record)[0]
    if shutil.which(command):
        return
    if dry_run:
        return
    _run_checked(["brew", "install", distribution["package"]])


def runtime_spec(repo: Repository, name: str) -> tuple[list[str], dict[str, str]]:
    record = show_server(repo, name)
    argv = _render_runtime(record)
    environment = _resolve_environment(record)
    search_path = _runtime_path()
    executable = shutil.which(argv[0], path=search_path)
    if executable is None:
        raise McpError(f"MCP 启动命令不存在：{argv[0]}")
    argv[0] = executable
    child_env = dict(os.environ)
    child_env["PATH"] = search_path
    child_env.update(environment)
    return argv, child_env


def run_server(repo: Repository, name: str) -> None:
    argv, environment = runtime_spec(repo, name)
    os.execvpe(argv[0], argv, environment)


def runtime_issues(repo: Repository, *, include_targets: bool) -> list[str]:
    catalog = validated_catalog(repo)
    issues: list[str] = []
    for name, record in sorted(catalog["servers"].items()):
        if not record["enabled"]:
            continue
        try:
            argv = _render_runtime(record)
            if shutil.which(argv[0], path=_runtime_path()) is None:
                issues.append(f"{name}: MCP 启动命令不存在 {argv[0]}")
            _resolve_environment(record)
        except (McpError, OSError, subprocess.SubprocessError) as exc:
            issues.append(f"{name}: {exc}")
        if include_targets:
            for target in record["targets"]:
                state = _target_state(repo, target, name)
                if not state["managed"] or not state.get("enabled", True):
                    issues.append(f"{name}: {target} 全局配置未收敛")
    return issues


def validated_catalog(repo: Repository) -> dict[str, Any]:
    catalog = repo.read_mcps()
    targets = _configured_targets(repo)
    for name, record in sorted(catalog["servers"].items()):
        validate_server(name, record, configured_targets=targets)
    return catalog


def validate_server(
    name: str, record: dict[str, Any], *, configured_targets: set[str]
) -> None:
    if (
        not isinstance(name, str)
        or not name
        or any(
            character not in "abcdefghijklmnopqrstuvwxyz0123456789-_"
            for character in name
        )
    ):
        raise McpError(f"MCP 名称无效：{name}")
    if not isinstance(record, dict):
        raise McpError(f"{name}: MCP 记录必须是对象")
    if (
        not isinstance(record.get("description"), str)
        or not record["description"].strip()
    ):
        raise McpError(f"{name}: description 不能为空")
    tags = record.get("tags")
    if not isinstance(tags, list) or any(
        not isinstance(tag, str) or not tag for tag in tags
    ):
        raise McpError(f"{name}: tags 必须是字符串数组")
    recommendation = record.get("recommendation")
    if not isinstance(recommendation, int) or not 1 <= recommendation <= 5:
        raise McpError(f"{name}: recommendation 必须是 1-5")
    if not isinstance(record.get("enabled"), bool):
        raise McpError(f"{name}: enabled 必须是布尔值")
    targets = record.get("targets")
    if (
        not isinstance(targets, list)
        or any(target not in SUPPORTED_TARGETS for target in targets)
        or len(targets) != len(set(targets))
    ):
        raise McpError(f"{name}: targets 无效")
    unknown_targets = sorted(set(targets) - configured_targets)
    if unknown_targets:
        raise McpError(f"{name}: 未配置 MCP target " + ", ".join(unknown_targets))
    source = record.get("source")
    if (
        not isinstance(source, dict)
        or not isinstance(source.get("url"), str)
        or not source["url"]
        or source.get("policy") not in {"pinned", "review"}
    ):
        raise McpError(f"{name}: source 记录无效")
    distribution = record.get("distribution")
    if (
        not isinstance(distribution, dict)
        or distribution.get("type") not in SUPPORTED_DISTRIBUTIONS
    ):
        raise McpError(f"{name}: distribution 记录无效")
    if distribution["type"] != "remote":
        if (
            not isinstance(distribution.get("package"), str)
            or not distribution["package"]
        ):
            raise McpError(f"{name}: distribution.package 不能为空")
        if (
            not isinstance(distribution.get("version"), str)
            or not distribution["version"]
        ):
            raise McpError(f"{name}: distribution.version 不能为空")
    runtime = record.get("runtime")
    if (
        not isinstance(runtime, dict)
        or not isinstance(runtime.get("command"), str)
        or not runtime["command"]
        or not isinstance(runtime.get("args"), list)
        or any(not isinstance(argument, str) for argument in runtime["args"])
    ):
        raise McpError(f"{name}: runtime 记录无效")
    environment = record.get("environment", {})
    if not isinstance(environment, dict):
        raise McpError(f"{name}: environment 必须是对象")
    for variable, specification in environment.items():
        if not isinstance(variable, str) or not variable:
            raise McpError(f"{name}: 环境变量名称无效")
        if not isinstance(specification, dict) or not isinstance(
            specification.get("required"), bool
        ):
            raise McpError(f"{name}: {variable} 环境变量记录无效")
        source_spec = specification.get("source")
        if (
            not isinstance(source_spec, dict)
            or source_spec.get("type") not in SUPPORTED_SECRET_SOURCES
        ):
            raise McpError(f"{name}: {variable} secret source 无效")
        if source_spec["type"] == "environment" and not isinstance(
            source_spec.get("name"), str
        ):
            raise McpError(f"{name}: {variable} environment source 缺 name")
        if source_spec["type"] == "command" and (
            not isinstance(source_spec.get("argv"), list)
            or not source_spec["argv"]
            or any(
                not isinstance(item, str) or not item for item in source_spec["argv"]
            )
        ):
            raise McpError(f"{name}: {variable} command source 缺 argv")


def _configured_targets(repo: Repository) -> set[str]:
    targets = repo.config["mcp_install_targets"]["global"]
    return {target["id"] for target in targets}


def _render_runtime(record: dict[str, Any]) -> list[str]:
    distribution = record["distribution"]
    values = {
        "package": distribution.get("package", ""),
        "version": distribution.get("version", ""),
    }
    runtime = record["runtime"]
    try:
        return [
            runtime["command"].format(**values),
            *(argument.format(**values) for argument in runtime["args"]),
        ]
    except KeyError as exc:
        raise McpError(f"runtime 使用了未知模板字段：{exc}") from exc


def _resolve_environment(record: dict[str, Any]) -> dict[str, str]:
    resolved: dict[str, str] = {}
    for variable, specification in record.get("environment", {}).items():
        source = specification["source"]
        value = ""
        if source["type"] == "environment":
            value = os.environ.get(source["name"], "")
        elif source["type"] == "command":
            result = _run_checked(source["argv"], timeout=20)
            value = result.stdout.strip()
        if value:
            resolved[variable] = value
        elif specification["required"]:
            raise McpError(f"缺少必需凭据 {variable}")
    return resolved


def _runtime_path() -> str:
    candidates = [
        str(Path.home() / ".local" / "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        os.environ.get("PATH", ""),
    ]
    return os.pathsep.join(dict.fromkeys(filter(None, candidates)))


def _target_state(repo: Repository, target: str, name: str) -> dict[str, bool]:
    launcher = str(repo.root / "scripts" / "agents-kit")
    if target == "claude":
        config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
        path = (
            Path(config_dir).expanduser() if config_dir else Path.home()
        ) / ".claude.json"
        key = "mcpServers"
    elif target == "codex":
        path = (
            Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))).expanduser()
            / "config.toml"
        )
        key = "mcp_servers"
    else:
        raise McpError(f"不支持的 MCP target：{target}")
    if not path.is_file():
        return {"exists": False, "managed": False, "enabled": False}
    try:
        text = path.read_text(encoding="utf-8")
        data = tomllib.loads(text) if target == "codex" else json.loads(text)
        entries = data.get(key, {})
        if not isinstance(entries, dict):
            raise TypeError(f"{key} 必须是对象")
        entry = entries.get(name)
        if entry is None:
            return {"exists": False, "managed": False, "enabled": False}
        if not isinstance(entry, dict):
            raise TypeError(f"{name} 必须是对象")
    except (OSError, ValueError, TypeError, AttributeError) as exc:
        raise McpError(f"无法读取 {target} 全局 MCP 配置：{path}: {exc}") from exc
    return {
        "exists": True,
        "managed": (
            entry.get("type", "stdio") == "stdio"
            and entry.get("command") == launcher
            and entry.get("args") == ["mcp", "run", name]
        ),
        "enabled": entry.get("enabled", True) is not False,
    }


def _add_target(repo: Repository, target: str, name: str) -> None:
    launcher = str(repo.root / "scripts" / "agents-kit")
    command = [launcher, "mcp", "run", name]
    if target == "codex":
        _run_checked(["codex", "mcp", "add", name, "--", *command])
        return
    if target == "claude":
        _run_checked(["claude", "mcp", "add", "--scope", "user", name, "--", *command])
        return
    raise McpError(f"不支持的 MCP target：{target}")


def _remove_target(target: str, name: str) -> None:
    if target == "codex":
        _run_checked(["codex", "mcp", "remove", name])
        return
    if target == "claude":
        _run_checked(["claude", "mcp", "remove", "--scope", "user", name])
        return
    raise McpError(f"不支持的 MCP target：{target}")


def _run_checked(
    command: list[str], *, timeout: int | None = 60
) -> subprocess.CompletedProcess[str]:
    executable = shutil.which(command[0], path=_runtime_path())
    if executable is None:
        raise McpError(f"命令不存在：{command[0]}")
    result = subprocess.run(
        [executable, *command[1:]],
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
    )
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip()
        raise McpError(f"{command[0]} 执行失败：{message}")
    return result
