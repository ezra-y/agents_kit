"""Hourly pull, installation reconciliation and an explicit completion record."""

from __future__ import annotations

import fcntl
import json
import os
import signal
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .repository import Repository


def state_path(repo: Repository) -> Path:
    base = Path(
        os.environ.get(
            "AGENTS_KIT_STATE_HOME",
            os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state")),
        )
    )
    return base / "agents-kit" / "sync-status.json"


def read_status(repo: Repository) -> dict[str, Any]:
    path = state_path(repo)
    if not path.is_file():
        return {
            "status": "never_verified",
            "message": "尚无完整同步验收记录",
            "last_success_at": None,
        }
    try:
        data = json.loads(path.read_text())
        if data.get("repository") != str(repo.root):
            return {
                "status": "other_repository",
                "message": "记录属于另一份仓库",
                "last_success_at": None,
            }
        return data
    except (OSError, ValueError):
        return {
            "status": "invalid_record",
            "message": "同步记录无法读取",
            "last_success_at": None,
        }


def _run(repo: Repository, args: list[str], timeout: int = 120) -> str:
    process = subprocess.Popen(
        args,
        cwd=repo.root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        out, err = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
        raise RuntimeError(f"命令超时：{' '.join(args[:3])}") from None
    if process.returncode:
        raise RuntimeError((err or out).strip()[:2000])
    return out.strip()


def sync(repo: Repository) -> dict[str, Any]:
    path = state_path(repo)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix(".lock").open("a") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "busy", "message": "已有同步在执行，本次不重复启动"}
        previous = read_status(repo)
        now = datetime.now(timezone.utc).isoformat()
        result: dict[str, Any] = {
            "repository": str(repo.root),
            "last_attempt_at": now,
            "last_success_at": previous.get("last_success_at"),
            "status": "checking",
            "completed_steps": [],
        }
        phase = "检查工作区"
        try:
            branch = _run(repo, ["git", "branch", "--show-current"])
            dirty = _run(
                repo, ["git", "status", "--porcelain", "--untracked-files=normal"]
            )
            if branch != "main" or dirty:
                result.update(
                    status="skipped",
                    message="工作区有未提交修改，未拉取或覆盖"
                    if dirty
                    else "当前不在 main 分支，未拉取或覆盖",
                    blocked_since=previous.get("blocked_since", now),
                    changed_files=len(dirty.splitlines()) if dirty else 0,
                )
            else:
                phase = "获取远端更新"
                _run(
                    repo,
                    [
                        "git",
                        "-c",
                        "core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=15",
                        "fetch",
                        "--quiet",
                        "origin",
                        "main:refs/remotes/origin/main",
                    ],
                    90,
                )
                with repo.write_lock():
                    if _run(
                        repo,
                        ["git", "status", "--porcelain", "--untracked-files=normal"],
                    ):
                        raise RuntimeError("获取期间工作区发生修改，已停止，未覆盖")
                    if _run(repo, ["git", "branch", "--show-current"]) != "main":
                        raise RuntimeError("获取期间分支发生变化，已停止")
                    local = _run(repo, ["git", "rev-parse", "HEAD"])
                    remote = _run(repo, ["git", "rev-parse", "origin/main"])
                    if (
                        _run(repo, ["git", "merge-base", "HEAD", "origin/main"])
                        != local
                    ):
                        raise RuntimeError("本地提交领先或分叉；请先审查提交，未覆盖")
                    if local != remote:
                        _run(
                            repo,
                            ["git", "merge", "--ff-only", "--quiet", "origin/main"],
                        )
                result["revision"] = remote
                launcher = str(repo.root / "scripts/agents-kit")
                for phase, args in [
                    ("插件索引", ["marketplace", "build", "--json"]),
                    ("技能清单", ["docs", "build", "--json"]),
                    ("同步安装", ["global", "apply", "--json"]),
                    ("实际加载验收", ["check", "--repo-only", "--runtime", "--json"]),
                ]:
                    output = _run(repo, [launcher, *args], 180)
                    result["completed_steps"].append(phase)
                    if phase == "实际加载验收":
                        result["runtime"] = (
                            json.loads(output).get("sections", {}).get("runtime")
                        )
                result.update(
                    status="success",
                    message="仓库、安装和实际插件加载已核验",
                    last_success_at=now,
                )
        except (OSError, RuntimeError, ValueError) as exc:
            result.update(status="failed", phase=phase, message=str(exc))
        repo.write_json_if_changed(path, result)
        return result
