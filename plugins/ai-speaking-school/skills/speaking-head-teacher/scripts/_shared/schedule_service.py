from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .database import connect, ensure_database, transaction

VALID_KINDS = {"t30", "t0", "t14"}


def task_template_path(skill_root: Path, kind: str) -> Path:
    if kind not in VALID_KINDS:
        raise ValueError(f"Unknown task kind: {kind}")
    return skill_root / "assets" / "task-prompts" / f"{kind}.md"


def load_task_prompt(skill_root: Path, kind: str) -> str:
    return task_template_path(skill_root, kind).read_text(encoding="utf-8")


def register_task(
    database: Path,
    kind: str,
    task_id: str,
    *,
    schedule: str = "",
    timezone_name: str = "local",
) -> dict[str, Any]:
    if kind not in VALID_KINDS:
        raise ValueError(f"Unknown task kind: {kind}")
    if not task_id.strip():
        raise ValueError("Host task_id is required")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    fingerprint = hashlib.sha256(
        f"{kind}\0{schedule}\0{timezone_name}".encode()
    ).hexdigest()
    with transaction(database) as connection:
        connection.execute(
            """
            INSERT INTO schedule_state(
                task_kind, task_id, schedule, timezone, fingerprint,
                status, updated_at, host_confirmed_at
            ) VALUES (?, ?, ?, ?, ?, 'host_confirmed', ?, ?)
            ON CONFLICT(task_kind) DO UPDATE SET
                task_id = excluded.task_id,
                schedule = excluded.schedule,
                timezone = excluded.timezone,
                fingerprint = excluded.fingerprint,
                status = excluded.status,
                updated_at = excluded.updated_at,
                host_confirmed_at = excluded.host_confirmed_at
            """,
            (kind, task_id, schedule, timezone_name, fingerprint, now, now),
        )
    return task_state(database)


def task_state(database: Path) -> dict[str, Any]:
    ensure_database(database)
    state = {"tasks": {}}
    with connect(database) as connection:
        for row in connection.execute("SELECT * FROM schedule_state ORDER BY task_kind"):
            payload = dict(row)
            kind = payload.pop("task_kind")
            state["tasks"][kind] = payload
    return state
