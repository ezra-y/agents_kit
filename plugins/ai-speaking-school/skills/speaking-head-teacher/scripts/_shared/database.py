from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class MigrationRequiredError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def plugin_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / ".codex-plugin" / "plugin.json").is_file():
            return parent
    raise RuntimeError("Cannot locate ai-speaking-school plugin root")


def connect(path: Path, *, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        connection = sqlite3.connect(
            f"{path.resolve().as_uri()}?mode=ro",
            uri=True,
            timeout=5,
        )
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    if not readonly:
        connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def table_exists(connection: sqlite3.Connection, name: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (name,),
    ).fetchone()
    return row is not None


def table_columns(connection: sqlite3.Connection, name: str) -> set[str]:
    if not table_exists(connection, name):
        return set()
    return {str(row["name"]) for row in connection.execute(f'PRAGMA table_info("{name}")')}


def apply_migrations(path: Path) -> list[int]:
    applied: list[int] = []
    migration_dir = plugin_root() / "migrations" / "learner"
    with connect(path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                filename TEXT NOT NULL UNIQUE,
                applied_at TEXT NOT NULL
            )
            """
        )
        existing = {
            int(row["version"])
            for row in connection.execute("SELECT version FROM schema_migrations")
        }
        for migration in sorted(migration_dir.glob("*.sql")):
            version = int(migration.name.split("_", 1)[0])
            if version in existing:
                continue
            connection.executescript(migration.read_text(encoding="utf-8"))
            connection.execute(
                "INSERT INTO schema_migrations(version, filename, applied_at) VALUES (?, ?, ?)",
                (version, migration.name, utc_now()),
            )
            applied.append(version)
    return applied


def _content_hash(item: dict[str, Any]) -> str:
    payload = {key: value for key, value in item.items() if key != "approved"}
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def seed_content_items(path: Path) -> int:
    seed_root = plugin_root() / "assets" / "seed"
    seeds = [
        seed_root / "public-items.jsonl",
        seed_root / "items.jsonl",
    ]
    if not any(seed.is_file() for seed in seeds):
        return 0
    timestamp = utc_now()
    inserted = 0
    with connect(path) as connection:
        if connection.execute("SELECT COUNT(*) FROM content_items").fetchone()[0]:
            return 0
        for seed in seeds:
            if not seed.is_file():
                continue
            for line in seed.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                item = json.loads(line)
                source = item["source_ref"]
                cursor = connection.execute(
                    """
                    INSERT OR IGNORE INTO content_items(
                        id, type, group_id, text, meaning, topics_json, examples_json,
                        usage_note, context, source_file, source_order, media_ref_json,
                        content_hash, approved, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item["id"],
                        item["type"],
                        item.get("group_id"),
                        item["text"],
                        item.get("meaning", ""),
                        json.dumps(item.get("topics", []), ensure_ascii=False),
                        json.dumps(item.get("examples", []), ensure_ascii=False),
                        item.get("usage_note", ""),
                        item.get("context", ""),
                        source["file"],
                        source["order"],
                        json.dumps(item["media_ref"], ensure_ascii=False)
                        if item.get("media_ref")
                        else None,
                        _content_hash(item),
                        int(bool(item.get("approved"))),
                        timestamp,
                        timestamp,
                    ),
                )
                inserted += cursor.rowcount
    return inserted


def ensure_database(path: Path) -> list[int]:
    if path.is_file() and path.stat().st_size > 0:
        with connect(path, readonly=True) as connection:
            versions = (
                {
                    int(row["version"])
                    for row in connection.execute(
                        "SELECT version FROM schema_migrations"
                    )
                }
                if table_exists(connection, "schema_migrations")
                else set()
            )
            has_legacy_data = any(
                table_exists(connection, table)
                and connection.execute(
                    f'SELECT EXISTS(SELECT 1 FROM "{table}" LIMIT 1)'
                ).fetchone()[0]
                for table in (
                    "learner_profile",
                    "content_items",
                    "review_state",
                    "sessions",
                    "session_items",
                    "errors",
                )
            )
        if 6 not in versions and (versions or has_legacy_data):
            raise MigrationRequiredError(
                "A pre-0.6 learner database was found. Do not migrate it in place. "
                "Run tools/migrate_0_5_4.py on a backed-up candidate copy, then point "
                "AI_SPEAKING_SCHOOL_HOME to the migrated data root."
            )
    applied = apply_migrations(path)
    seed_content_items(path)
    return applied


@contextmanager
def transaction(path: Path) -> Iterator[sqlite3.Connection]:
    ensure_database(path)
    connection = connect(path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def backup_database(source: Path, destination: Path) -> Path:
    if not source.is_file():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with connect(source, readonly=True) as source_connection, sqlite3.connect(
        destination
    ) as target:
        source_connection.backup(target)
    return destination


def restore_database(source: Path, destination: Path) -> Path:
    if not source.is_file():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return destination


def content_digest(connection: sqlite3.Connection) -> str:
    digest = hashlib.sha256()
    if not table_exists(connection, "content_items"):
        return digest.hexdigest()
    for row in connection.execute(
        "SELECT id, content_hash FROM content_items ORDER BY id"
    ):
        digest.update(f"{row['id']}:{row['content_hash']}\n".encode())
    return digest.hexdigest()
