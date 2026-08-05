from __future__ import annotations

import shutil
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .paths import database_path, skill_root
from .time_utils import isoformat, now


def connect(path: Path | None = None) -> sqlite3.Connection:
    db_path = path or database_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def apply_migrations(path: Path | None = None) -> list[int]:
    applied: list[int] = []
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
            row["version"]
            for row in connection.execute("SELECT version FROM schema_migrations").fetchall()
        }
        migration_dir = skill_root() / "migrations"
        for migration in sorted(migration_dir.glob("*.sql")):
            version_text = migration.name.split("_", 1)[0]
            version = int(version_text)
            if version in existing:
                continue
            connection.executescript(migration.read_text(encoding="utf-8"))
            connection.execute(
                "INSERT INTO schema_migrations(version, filename, applied_at) VALUES (?, ?, ?)",
                (version, migration.name, isoformat(now())),
            )
            applied.append(version)
    return applied


def backup_database(destination: Path, source: Path | None = None) -> Path:
    source_path = source or database_path()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not source_path.exists():
        raise FileNotFoundError(source_path)
    with (
        connect(source_path) as source_connection,
        sqlite3.connect(destination) as destination_connection,
    ):
        source_connection.backup(destination_connection)
    return destination


@contextmanager
def transaction(path: Path | None = None) -> Iterator[sqlite3.Connection]:
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


def restore_database(source: Path, destination: Path | None = None) -> Path:
    destination_path = destination or database_path()
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination_path)
    return destination_path
