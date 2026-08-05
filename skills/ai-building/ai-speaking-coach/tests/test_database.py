from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from ai_speaking_coach.db import (
    apply_migrations,
    backup_database,
    connect,
    transaction,
)


def test_initial_migration(isolated_root: Path) -> None:
    database = isolated_root / "runtime" / "coach.sqlite"
    assert apply_migrations(database) == [1]
    assert apply_migrations(database) == []
    with connect(database) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    assert {
        "learner_profile",
        "content_items",
        "sessions",
        "session_items",
        "review_state",
        "errors",
    }.issubset(tables)


def test_foreign_key_rejects_unknown_item(isolated_root: Path) -> None:
    database = isolated_root / "runtime" / "coach.sqlite"
    apply_migrations(database)
    with connect(database) as connection:
        connection.execute(
            """
            INSERT INTO sessions(id, started_at, topic)
            VALUES ('s1', '2026-08-05T10:00:00+08:00', '')
            """
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO session_items(
                    session_id, item_id, studied_at, activity, grade, status_after
                ) VALUES ('s1', 'missing', '2026-08-05T10:01:00+08:00', 'new', 'good', 'usable')
                """
            )


def test_transaction_rolls_back_completely(isolated_root: Path) -> None:
    database = isolated_root / "runtime" / "coach.sqlite"
    apply_migrations(database)
    with pytest.raises(RuntimeError), transaction(database) as connection:
        connection.execute(
            """
            INSERT INTO sessions(id, started_at, topic)
            VALUES ('s1', '2026-08-05T10:00:00+08:00', '')
            """
        )
        raise RuntimeError("stop")
    with connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


def test_backup_can_be_restored(isolated_root: Path) -> None:
    database = isolated_root / "runtime" / "coach.sqlite"
    backup = isolated_root / "runtime" / "backups" / "backup.sqlite"
    apply_migrations(database)
    with connect(database) as connection:
        connection.execute(
            """
            INSERT INTO sessions(id, started_at, topic)
            VALUES ('s1', '2026-08-05T10:00:00+08:00', 'test')
            """
        )
    backup_database(backup, database)
    with connect(backup) as connection:
        assert connection.execute("SELECT topic FROM sessions").fetchone()[0] == "test"
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
