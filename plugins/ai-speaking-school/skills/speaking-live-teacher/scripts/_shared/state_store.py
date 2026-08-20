from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .database import connect, ensure_database, transaction, utc_now

ARTIFACT_TABLES = {
    "lesson_plan": ("lesson_plans", "lesson_id"),
    "class_run": ("class_runs", "class_run_id"),
    "lesson_review_delta": ("lesson_review_deltas", "review_id"),
    "cycle_review": ("cycle_reviews", "cycle_review_id"),
    "persona_change_event": ("persona_events", "event_id"),
}


def _json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def read_document(database: Path, kind: str, default: Any = None) -> Any:
    ensure_database(database)
    with connect(database) as connection:
        row = connection.execute(
            """
            SELECT payload_json
            FROM school_documents
            WHERE kind = ?
            ORDER BY version DESC
            LIMIT 1
            """,
            (kind,),
        ).fetchone()
        if row is not None:
            return json.loads(row["payload_json"])
        if kind == "learner_profile":
            legacy = connection.execute(
                "SELECT * FROM learner_profile WHERE id = 1"
            ).fetchone()
            if legacy is not None:
                payload = dict(legacy)
                for field in ("interests_json", "preferred_topics_json"):
                    payload[field.removesuffix("_json")] = json.loads(payload.pop(field))
                return payload
    return default


def write_document(database: Path, kind: str, payload: dict[str, Any]) -> int:
    with transaction(database) as connection:
        version = int(
            connection.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM school_documents WHERE kind = ?",
                (kind,),
            ).fetchone()[0]
        )
        connection.execute(
            """
            INSERT INTO school_documents(kind, version, payload_json, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (kind, version, _json(payload), utc_now()),
        )
    return version


def save_artifact(
    database: Path,
    kind: str,
    artifact_id: str,
    payload: dict[str, Any],
    *,
    version: int | None = None,
) -> str:
    with transaction(database) as connection:
        if kind == "lesson_plan":
            plan_version = version or int(payload["plan_version"])
            connection.execute(
                """
                INSERT INTO lesson_plans(
                    lesson_id, plan_version, learner_id, course_plan_id,
                    status, created_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(lesson_id, plan_version) DO UPDATE SET
                    learner_id = excluded.learner_id,
                    course_plan_id = excluded.course_plan_id,
                    status = excluded.status,
                    created_at = excluded.created_at,
                    payload_json = excluded.payload_json
                """,
                (
                    artifact_id,
                    plan_version,
                    payload["learner_id"],
                    payload["course_plan_id"],
                    payload["status"],
                    payload["created_at"],
                    _json(payload),
                ),
            )
        elif kind == "class_run":
            connection.execute(
                """
                INSERT INTO class_runs(
                    class_run_id, lesson_id, lesson_plan_version, voice_session_id,
                    started_at, status, note, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(class_run_id) DO UPDATE SET
                    status = excluded.status,
                    note = excluded.note,
                    payload_json = excluded.payload_json
                """,
                (
                    artifact_id,
                    payload["lesson_id"],
                    payload["lesson_plan_version"],
                    payload["voice_session_id"],
                    payload["started_at"],
                    payload["status"],
                    payload.get("note", ""),
                    _json(payload),
                ),
            )
        elif kind == "lesson_review_delta":
            connection.execute(
                """
                INSERT INTO lesson_review_deltas(
                    review_id, class_run_id, lesson_id, reviewed_at, completion, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(review_id) DO UPDATE SET payload_json = excluded.payload_json
                """,
                (
                    artifact_id,
                    payload["class_run_id"],
                    payload["lesson_id"],
                    payload["reviewed_at"],
                    payload["completion"],
                    _json(payload),
                ),
            )
        elif kind == "cycle_review":
            connection.execute(
                """
                INSERT INTO cycle_reviews(
                    cycle_review_id, period_start, period_end, decision, created_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(cycle_review_id) DO UPDATE SET payload_json = excluded.payload_json
                """,
                (
                    artifact_id,
                    payload["period_start"],
                    payload["period_end"],
                    payload["decision"],
                    payload["created_at"],
                    _json(payload),
                ),
            )
            connection.execute(
                """
                INSERT INTO cycle_state(id, last_cycle_review_id, last_period_end, updated_at)
                VALUES (1, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    last_cycle_review_id = excluded.last_cycle_review_id,
                    last_period_end = excluded.last_period_end,
                    updated_at = excluded.updated_at
                """,
                (artifact_id, payload["period_end"], utc_now()),
            )
        elif kind == "persona_change_event":
            connection.execute(
                """
                INSERT INTO persona_events(
                    event_id, source, requested_at, scope, instruction,
                    status, effective_from, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(event_id) DO UPDATE SET
                    status = excluded.status,
                    effective_from = excluded.effective_from,
                    payload_json = excluded.payload_json
                """,
                (
                    artifact_id,
                    payload["source"],
                    payload["requested_at"],
                    payload["scope"],
                    payload["instruction"],
                    payload["status"],
                    payload.get("effective_from"),
                    _json(payload),
                ),
            )
        else:
            raise ValueError(f"Unknown artifact kind: {kind}")
    return f"sqlite:{kind}:{artifact_id}"


def list_artifacts(database: Path, kind: str) -> list[dict[str, Any]]:
    ensure_database(database)
    table, _ = ARTIFACT_TABLES[kind]
    order = {
        "lesson_plan": "created_at, plan_version",
        "class_run": "started_at",
        "lesson_review_delta": "reviewed_at",
        "cycle_review": "created_at",
        "persona_change_event": "requested_at",
    }[kind]
    with connect(database) as connection:
        return [
            json.loads(row["payload_json"])
            for row in connection.execute(
                f"SELECT payload_json FROM {table} ORDER BY {order}"
            )
        ]


def read_artifact(
    database: Path,
    kind: str,
    artifact_id: str,
    *,
    version: int | None = None,
) -> dict[str, Any] | None:
    ensure_database(database)
    table, id_field = ARTIFACT_TABLES[kind]
    where = f"{id_field} = ?"
    params: list[Any] = [artifact_id]
    if kind == "lesson_plan" and version is not None:
        where += " AND plan_version = ?"
        params.append(version)
    order = " ORDER BY plan_version DESC" if kind == "lesson_plan" else ""
    with connect(database) as connection:
        row = connection.execute(
            f"SELECT payload_json FROM {table} WHERE {where}{order} LIMIT 1",
            params,
        ).fetchone()
    return json.loads(row["payload_json"]) if row is not None else None


def latest_ready_lesson(database: Path) -> dict[str, Any] | None:
    ensure_database(database)
    with connect(database) as connection:
        row = connection.execute(
            """
            SELECT payload_json
            FROM lesson_plans
            WHERE status = 'ready'
            ORDER BY created_at DESC, plan_version DESC
            LIMIT 1
            """
        ).fetchone()
    return json.loads(row["payload_json"]) if row is not None else None


def class_run_for_session(
    database: Path,
    voice_session_id: str,
) -> dict[str, Any] | None:
    ensure_database(database)
    with connect(database) as connection:
        row = connection.execute(
            "SELECT payload_json FROM class_runs WHERE voice_session_id = ?",
            (voice_session_id,),
        ).fetchone()
    return json.loads(row["payload_json"]) if row is not None else None


def read_item_learning_state(database: Path) -> dict[str, dict[str, Any]]:
    ensure_database(database)
    with connect(database) as connection:
        rows = connection.execute("SELECT * FROM item_learning_state ORDER BY item_id")
        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            payload = dict(row)
            payload["last_observations"] = json.loads(
                payload.pop("last_observations_json")
            )
            result[payload.pop("item_id")] = payload
        return result


def write_item_learning_state(
    database: Path,
    item_state: dict[str, dict[str, Any]],
) -> None:
    with transaction(database) as connection:
        for item_id, state in item_state.items():
            connection.execute(
                """
                INSERT INTO item_learning_state(
                    item_id, status, first_learned_at, last_reviewed_at, stability,
                    target_retention, next_review_at, review_count, lapse_count,
                    scheduler_version, last_review_id, last_reason, last_observations_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(item_id) DO UPDATE SET
                    status = excluded.status,
                    last_reviewed_at = excluded.last_reviewed_at,
                    stability = excluded.stability,
                    target_retention = excluded.target_retention,
                    next_review_at = excluded.next_review_at,
                    review_count = excluded.review_count,
                    lapse_count = excluded.lapse_count,
                    scheduler_version = excluded.scheduler_version,
                    last_review_id = excluded.last_review_id,
                    last_reason = excluded.last_reason,
                    last_observations_json = excluded.last_observations_json
                """,
                (
                    item_id,
                    state["status"],
                    state["first_learned_at"],
                    state["last_reviewed_at"],
                    state["stability"],
                    state["target_retention"],
                    state["next_review_at"],
                    state["review_count"],
                    state["lapse_count"],
                    state["scheduler_version"],
                    state.get("last_review_id"),
                    state.get("last_reason", ""),
                    _json(state.get("last_observations", [])),
                ),
            )


def save_review_evidence(database: Path, payload: dict[str, Any]) -> None:
    with transaction(database) as connection:
        for item_update in payload.get("item_updates", []):
            for index, observation in enumerate(item_update.get("observations", []), 1):
                evidence_id = f"{payload['review_id']}:{item_update['item_id']}:{index}"
                connection.execute(
                    """
                    INSERT OR REPLACE INTO item_evidence(
                        evidence_id, source, review_id, class_run_id, item_id,
                        observed_at, evidence_type, support_level, outcome, payload_json
                    ) VALUES (?, 'lesson_review', ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        evidence_id,
                        payload["review_id"],
                        payload["class_run_id"],
                        item_update["item_id"],
                        payload["reviewed_at"],
                        observation["evidence_type"],
                        observation.get("support_level", "unknown"),
                        observation.get("outcome", "not_judged"),
                        _json(observation),
                    ),
                )
        for error in payload.get("error_updates", []):
            connection.execute(
                """
                INSERT OR REPLACE INTO learning_error_evidence(
                    error_id, review_id, class_run_id, item_id, observed_at,
                    learner_version, corrected_version, note
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    error["error_id"],
                    payload["review_id"],
                    payload["class_run_id"],
                    error.get("item_id"),
                    payload["reviewed_at"],
                    error["learner_version"],
                    error["corrected_version"],
                    error.get("note", ""),
                ),
            )


def update_class_status(database: Path, class_run_id: str, status: str) -> None:
    payload = read_artifact(database, "class_run", class_run_id)
    if payload is None:
        raise KeyError(class_run_id)
    payload["status"] = status
    save_artifact(database, "class_run", class_run_id, payload)


def legacy_assessments(database: Path) -> list[dict[str, Any]]:
    ensure_database(database)
    with connect(database) as connection:
        return [
            json.loads(row["payload_json"])
            for row in connection.execute(
                "SELECT payload_json FROM legacy_assessment_imports ORDER BY imported_at"
            )
        ]


def migration_report(database: Path) -> dict[str, Any] | None:
    ensure_database(database)
    with connect(database) as connection:
        row = connection.execute(
            """
            SELECT report_json
            FROM migration_runs
            ORDER BY started_at DESC
            LIMIT 1
            """
        ).fetchone()
    return json.loads(row["report_json"]) if row is not None else None
