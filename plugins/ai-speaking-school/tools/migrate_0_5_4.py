from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import sqlite3
import sys
import tarfile
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_ROOT = ROOT / "authoring" / "shared-runtime"
runtime_spec = importlib.util.spec_from_file_location(
    "shared_runtime",
    RUNTIME_ROOT / "__init__.py",
    submodule_search_locations=[str(RUNTIME_ROOT)],
)
if runtime_spec is None or runtime_spec.loader is None:
    raise RuntimeError(f"Cannot load shared runtime from {RUNTIME_ROOT}")
runtime_package = importlib.util.module_from_spec(runtime_spec)
sys.modules["shared_runtime"] = runtime_package
runtime_spec.loader.exec_module(runtime_package)

from shared_runtime.database import (
    MigrationRequiredError,
    apply_migrations,
    backup_database,
    connect,
    content_digest,
    ensure_database,
    table_columns,
    table_exists,
)
from shared_runtime.state_store import write_document

PRESERVE_TABLES = (
    "learner_profile",
    "content_items",
    "review_state",
    "errors",
    "sessions",
    "session_items",
)
LEGACY_AUDIT_TABLES = (
    "pending_sessions",
    "session_events",
    "session_modules",
    "assessment_cycles",
)
IGNORED_PERSONA_FIELDS = ("preset", "warmth", "directness", "energy", "humor")
DEFAULT_PERSONA_NOTES = {
    "Patient and calm. Give the learner room to finish before correcting.",
    "Keep teacher turns very short and move quickly back to learner output.",
    "Use lively task framing without cheering after every answer.",
    "Be calm and exact. State useful errors directly and require the full retry.",
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def backup_data_directory(data_root: Path, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        prefix="ai-speaking-coach-backup.",
        suffix=".tar.gz",
    )
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        with tarfile.open(temporary, "w:gz") as archive:
            archive.add(data_root, arcname=data_root.name)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def rows(connection: sqlite3.Connection, table: str) -> int:
    if not table_exists(connection, table):
        return 0
    return int(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])


def schema_versions(connection: sqlite3.Connection) -> list[int]:
    if not table_exists(connection, "schema_migrations"):
        return []
    return [
        int(row["version"])
        for row in connection.execute(
            "SELECT version FROM schema_migrations ORDER BY version"
        )
    ]


def inventory(data_root: Path, database: Path) -> dict[str, Any]:
    with connect(database, readonly=True) as connection:
        table_names = {
            str(row["name"])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        counts = {
            table: rows(connection, table)
            for table in (*PRESERVE_TABLES, *LEGACY_AUDIT_TABLES)
            if table in table_names
        }
        content_hash = content_digest(connection)
        versions = schema_versions(connection)
    settings = read_object(data_root / "learner" / "settings.json")
    manifest = read_object(data_root / "cache" / "embedding-manifest.json")
    return {
        "data_root": str(data_root),
        "database": str(database),
        "database_sha256": sha256(database),
        "schema_migrations": versions,
        "table_counts": counts,
        "content_hash": content_hash,
        "persona": settings.get("teacher_persona")
        if isinstance(settings, dict)
        else None,
        "scheduled_tasks": settings.get("scheduled_tasks")
        if isinstance(settings, dict)
        else None,
        "embedding_manifest": manifest or None,
        "model_cache_exists": (data_root / "cache" / "models").is_dir(),
        "lancedb_exists": (data_root / "cache" / "lancedb").is_dir(),
    }


def read_object(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else {}


def persona_report(data_root: Path, database: Path) -> dict[str, Any]:
    settings = read_object(data_root / "learner" / "settings.json")
    persona = settings.get("teacher_persona")
    if not isinstance(persona, dict):
        return {
            "found": False,
            "ignored": [],
            "candidates": [],
            "requires_confirmation": [],
        }

    ignored = [
        {"field": field, "value": persona[field]}
        for field in IGNORED_PERSONA_FIELDS
        if field in persona
    ]
    candidates: list[dict[str, Any]] = []
    confirmations: list[dict[str, Any]] = []

    pace = persona.get("pace")
    if isinstance(pace, str) and pace:
        candidates.append({"field": "pace", "value": pace})

    with connect(database) as connection:
        profile = (
            connection.execute(
                "SELECT coach_name, language_mode FROM learner_profile WHERE id = 1"
            ).fetchone()
            if table_exists(connection, "learner_profile")
            else None
        )
    language_mode = profile["language_mode"] if profile else None
    english_ratio = persona.get("english_ratio")
    if isinstance(english_ratio, str) and english_ratio:
        candidates.append(
            {
                "field": "english_ratio",
                "value": english_ratio,
                "effective_value": language_mode or english_ratio,
                "source_priority": "learner_profile.language_mode"
                if language_mode
                else "teacher_persona.english_ratio",
            }
        )

    name = persona.get("name")
    coach_name = profile["coach_name"] if profile else None
    if isinstance(name, str) and name and name not in {"Mia", "Alex", "Jamie", "Morgan"}:
        confirmations.append(
            {
                "field": "name",
                "value": name,
                "profile_coach_name": coach_name,
            }
        )

    note = persona.get("custom_note")
    if (
        isinstance(note, str)
        and note.strip()
        and note.strip() not in DEFAULT_PERSONA_NOTES
    ):
        confirmations.append({"field": "custom_note", "value": note.strip()})

    return {
        "found": True,
        "values": persona,
        "ignored": ignored,
        "candidates": candidates,
        "requires_confirmation": confirmations,
    }


def import_course_reference(data_root: Path, database: Path) -> bool:
    course = data_root / "learner" / "course.md"
    if not course.is_file():
        return False
    payload = {
        "source": str(course),
        "status": "legacy_reference_only",
        "content": course.read_text(encoding="utf-8"),
    }
    write_document(database, "legacy_course_reference", payload)
    return True


def import_legacy_assessments(database: Path, timestamp: str) -> int:
    with connect(database) as connection:
        if not table_exists(connection, "assessment_cycles"):
            return 0
        source_rows = connection.execute(
            "SELECT * FROM assessment_cycles ORDER BY period_end"
        ).fetchall()
        inserted = 0
        for row in source_rows:
            payload = dict(row)
            mapped = {
                "keep": "keep",
                "minor": "adjust",
                "major": "replan",
            }.get(payload.get("change_level"))
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO legacy_assessment_imports(
                    legacy_cycle_id, mapped_decision, payload_json, imported_at
                ) VALUES (?, ?, ?, ?)
                """,
                (
                    payload["id"],
                    mapped,
                    json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    timestamp,
                ),
            )
            inserted += cursor.rowcount
        connection.commit()
    return inserted


def _legacy_evidence_type(
    support_level: Any,
    correction_uptake: Any,
    transferred: Any,
) -> str | None:
    if transferred == 1:
        return "transfer"
    if correction_uptake == "self_repair":
        return "self_repair"
    if correction_uptake in {"after_cue", "after_model"}:
        return "corrected_retry"
    if support_level in {"light_cue", "strong_cue"}:
        return "prompted"
    if support_level == "full_model":
        return "repetition"
    return None


def import_legacy_item_evidence(database: Path) -> int:
    with connect(database) as connection:
        columns = table_columns(connection, "session_items")
        required = {
            "session_id",
            "item_id",
            "studied_at",
            "support_level",
            "task_outcome",
            "correction_uptake",
            "transferred",
        }
        if not required.issubset(columns):
            return 0
        source_rows = connection.execute(
            """
            SELECT
                session_id, item_id, studied_at, grade, status_after,
                support_level, task_outcome, correction_uptake, transferred
            FROM session_items
            ORDER BY session_id, item_id
            """
        ).fetchall()
        inserted = 0
        for row in source_rows:
            payload = dict(row)
            evidence_type = _legacy_evidence_type(
                payload["support_level"],
                payload["correction_uptake"],
                payload["transferred"],
            )
            if evidence_type is None:
                continue
            evidence_id = (
                f"legacy:{payload['session_id']}:{payload['item_id']}"
            )
            outcome = {
                "complete": "success",
                "partial": "partial",
                "blocked": "failed",
            }.get(payload["task_outcome"], "not_judged")
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO item_evidence(
                    evidence_id, source, legacy_session_id, item_id,
                    observed_at, evidence_type, support_level, outcome, payload_json
                ) VALUES (?, 'legacy_session_item', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    evidence_id,
                    payload["session_id"],
                    payload["item_id"],
                    payload["studied_at"],
                    evidence_type,
                    payload["support_level"],
                    outcome,
                    json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                ),
            )
            inserted += cursor.rowcount
        connection.commit()
    return inserted


def validate(
    source_inventory: dict[str, Any],
    candidate: Path,
) -> dict[str, Any]:
    with connect(candidate) as connection:
        after_counts = {
            table: rows(connection, table)
            for table in PRESERVE_TABLES
        }
        required_tables = (
            "lesson_plans",
            "class_runs",
            "lesson_review_deltas",
            "cycle_reviews",
            "item_learning_state",
            "item_evidence",
            "persona_events",
            "schedule_state",
            "migration_runs",
        )
        missing_tables = [
            table for table in required_tables if not table_exists(connection, table)
        ]
        foreign_keys = [
            dict(row) for row in connection.execute("PRAGMA foreign_key_check")
        ]
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        versions = schema_versions(connection)
        candidate_content_hash = content_digest(connection)
        persona_columns = [
            row
            for table in ("persona_events", "school_documents")
            for row in table_columns(connection, table)
            if row in IGNORED_PERSONA_FIELDS
        ]

    before_counts = source_inventory["table_counts"]
    preserved = {
        table: {
            "before": before_counts.get(table, 0),
            "after": after_counts[table],
            "ok": before_counts.get(table, 0) == after_counts[table],
        }
        for table in PRESERVE_TABLES
    }
    return {
        "preserved_counts": preserved,
        "content_hash_before": source_inventory["content_hash"],
        "content_hash_after": candidate_content_hash,
        "content_hash_ok": source_inventory["content_hash"]
        == candidate_content_hash,
        "schema_migrations": versions,
        "required_migrations_present": all(
            version in versions for version in (1, 6, 7, 8)
        ),
        "missing_required_tables": missing_tables,
        "foreign_key_check": foreign_keys,
        "integrity_check": integrity,
        "persona_numeric_columns": persona_columns,
        "runtime_database_migrated": False,
        "ok": (
            all(item["ok"] for item in preserved.values())
            and source_inventory["content_hash"] == candidate_content_hash
            and all(version in versions for version in (1, 6, 7, 8))
            and not missing_tables
            and not foreign_keys
            and integrity == "ok"
            and not persona_columns
        ),
    }


def migrate(
    source: Path,
    candidate: Path,
    data_root: Path,
    backup: Path,
    data_backup: Path,
    report_path: Path,
) -> dict[str, Any]:
    if source.resolve() == candidate.resolve():
        raise ValueError("Candidate database must differ from the source database")
    if not source.is_file():
        raise FileNotFoundError(source)
    source_inventory = inventory(data_root, source)
    source_hash_before = sha256(source)
    backup_database(source, backup)
    backup_data_directory(data_root, data_backup)
    candidate.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(backup, candidate)
    started = now()
    run_id = f"MIG-{uuid.uuid4().hex[:12].upper()}"

    applied = apply_migrations(candidate)
    persona = persona_report(data_root, candidate)
    course_imported = import_course_reference(data_root, candidate)
    legacy_assessments = import_legacy_assessments(candidate, started)
    legacy_evidence = import_legacy_item_evidence(candidate)
    validation = validate(source_inventory, candidate)
    source_hash_after = sha256(source)
    validation["source_database_unchanged"] = source_hash_before == source_hash_after
    validation["ok"] = validation["ok"] and validation["source_database_unchanged"]
    report = {
        "migration_run_id": run_id,
        "status": "completed" if validation["ok"] else "failed",
        "source": source_inventory,
        "backup": {
            "database": {
                "path": str(backup),
                "sha256": sha256(backup),
            },
            "data_directory": {
                "path": str(data_backup),
                "sha256": sha256(data_backup),
            },
        },
        "candidate": {
            "path": str(candidate),
            "sha256": sha256(candidate),
            "applied_migrations": applied,
        },
        "imports": {
            "legacy_course_reference": course_imported,
            "legacy_assessments": legacy_assessments,
            "legacy_item_evidence": legacy_evidence,
        },
        "persona": persona,
        "old_scheduled_task_ids": source_inventory.get("scheduled_tasks"),
        "validation": validation,
        "rollback": {
            "source_untouched": validation["source_database_unchanged"],
            "restore_database_from": str(backup),
            "restore_data_directory_from": str(data_backup),
        },
        "started_at": started,
        "completed_at": now(),
    }
    with connect(candidate) as connection:
        connection.execute(
            """
            INSERT INTO migration_runs(
                migration_run_id, source_database, candidate_database,
                started_at, completed_at, status, report_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                str(source),
                str(candidate),
                report["started_at"],
                report["completed_at"],
                report["status"],
                json.dumps(report, ensure_ascii=False, separators=(",", ":")),
            ),
        )
        connection.commit()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inventory and migrate ai-speaking-coach 0.5.4 on a database copy."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    inventory_command = sub.add_parser("inventory")
    inventory_command.add_argument("--data-root", type=Path, required=True)
    inventory_command.add_argument("--database", type=Path)
    inventory_command.add_argument("--output", type=Path)

    migrate_command = sub.add_parser("migrate")
    migrate_command.add_argument("--data-root", type=Path, required=True)
    migrate_command.add_argument("--source", type=Path)
    migrate_command.add_argument("--candidate", type=Path, required=True)
    migrate_command.add_argument("--backup", type=Path, required=True)
    migrate_command.add_argument("--data-backup", type=Path, required=True)
    migrate_command.add_argument("--report", type=Path, required=True)
    migrate_command.add_argument(
        "--old-runtime-stopped",
        action="store_true",
        help="Confirm old sessions and Scheduled Tasks are stopped before copying data.",
    )

    validate_command = sub.add_parser("validate")
    validate_command.add_argument("--data-root", type=Path, required=True)
    validate_command.add_argument("--source", type=Path)
    validate_command.add_argument("--candidate", type=Path, required=True)
    validate_command.add_argument("--output", type=Path)

    args = parser.parse_args()
    default_database = args.data_root / "learner" / "state" / "coach.sqlite"

    if args.command == "inventory":
        result = inventory(args.data_root, args.database or default_database)
    elif args.command == "migrate":
        if not args.old_runtime_stopped:
            raise SystemExit(
                "Refusing migration: pass --old-runtime-stopped only after pausing "
                "old Scheduled Tasks and exiting old plugin sessions."
            )
        result = migrate(
            args.source or default_database,
            args.candidate,
            args.data_root,
            args.backup,
            args.data_backup,
            args.report,
        )
    else:
        source = args.source or default_database
        result = validate(inventory(args.data_root, source), args.candidate)

    output = getattr(args, "output", None)
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(text, encoding="utf-8")
    print(text, end="")
    if args.command in {"migrate", "validate"}:
        check = result["validation"]["ok"] if args.command == "migrate" else result["ok"]
        if not check:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
