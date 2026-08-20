from __future__ import annotations

import json
from pathlib import Path

from .contracts import Handoff
from .database import transaction


def persist_handoff(database: Path, payload: dict) -> bool:
    handoff = Handoff.model_validate(payload).model_dump(mode="json")
    with transaction(database) as connection:
        cursor = connection.execute(
            """
            INSERT OR IGNORE INTO handoffs(
                handoff_id, workflow_run_id, from_role, to_role, action,
                status, created_at, idempotency_key, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                handoff["handoff_id"],
                handoff["workflow_run_id"],
                handoff["from_role"],
                handoff["to_role"],
                handoff["action"],
                handoff["status"],
                handoff["created_at"],
                handoff["idempotency_key"],
                json.dumps(handoff, ensure_ascii=False, separators=(",", ":")),
            ),
        )
    return cursor.rowcount == 1
