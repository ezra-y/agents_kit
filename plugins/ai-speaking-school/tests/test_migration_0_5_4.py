from __future__ import annotations

import hashlib
import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MIGRATOR_PATH = ROOT / "tools" / "migrate_0_5_4.py"

spec = importlib.util.spec_from_file_location("migrate_0_5_4", MIGRATOR_PATH)
assert spec and spec.loader
migrator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migrator)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_old_database(data_root: Path) -> Path:
    database = data_root / "learner" / "state" / "coach.sqlite"
    database.parent.mkdir(parents=True, exist_ok=True)
    migration_root = ROOT / "migrations" / "learner"
    connection = sqlite3.connect(database)
    connection.executescript((migration_root / "001_initial.sql").read_text())
    connection.execute(
        """
        CREATE TABLE schema_migrations(
            version INTEGER PRIMARY KEY,
            filename TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        "INSERT INTO schema_migrations VALUES (1, '001_initial.sql', '2026-01-01T00:00:00Z')"
    )
    connection.executescript(
        """
        ALTER TABLE sessions ADD COLUMN completion_status TEXT NOT NULL DEFAULT 'completed';
        ALTER TABLE session_items ADD COLUMN support_level TEXT NOT NULL DEFAULT 'none';
        ALTER TABLE session_items ADD COLUMN task_outcome TEXT NOT NULL DEFAULT 'complete';
        ALTER TABLE session_items ADD COLUMN correction_uptake TEXT NOT NULL DEFAULT 'not_needed';
        ALTER TABLE session_items ADD COLUMN transferred INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE assessment_cycles (
            id TEXT PRIMARY KEY,
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            status TEXT NOT NULL,
            session_count INTEGER NOT NULL DEFAULT 0,
            evidence_path TEXT NOT NULL,
            report_path TEXT,
            change_level TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            applied_at TEXT,
            note TEXT NOT NULL DEFAULT ''
        );
        """
    )
    connection.executemany(
        "INSERT INTO schema_migrations VALUES (?, ?, ?)",
        [
            (2, "002_live_session_journal.sql", "2026-01-02T00:00:00Z"),
            (4, "004_periodic_assessments.sql", "2026-01-04T00:00:00Z"),
        ],
    )
    item = {
        "id": "fixture-item-1",
        "type": "expression",
        "text": "Could you repeat that?",
        "meaning": "请再说一遍。",
        "topics": ["daily_life"],
        "examples": ["Could you repeat the last part?"],
        "usage_note": "",
        "context": "",
        "source_ref": {"file": "fixture-source.md", "order": 1},
    }
    source = item["source_ref"]
    connection.execute(
        """
        INSERT INTO content_items(
            id, type, group_id, text, meaning, topics_json, examples_json,
            usage_note, context, source_file, source_order, media_ref_json,
            content_hash, approved, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)
        """,
        (
            item["id"],
            item["type"],
            item["text"],
            item["meaning"],
            json.dumps(item["topics"]),
            json.dumps(item["examples"]),
            item["usage_note"],
            item["context"],
            source["file"],
            source["order"],
            "legacy-content-hash",
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
        ),
    )
    connection.execute(
        """
        INSERT INTO learner_profile VALUES(
            1, 'Test Learner', NULL, 'Alex', 'general conversation', '[]', '[]',
            'mostly_english', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )
        """
    )
    connection.execute(
        """
        INSERT INTO sessions(
            id, started_at, ended_at, topic, lesson_path, summary_path,
            notes, completion_status
        ) VALUES(
            'legacy-session-1', '2026-01-10T10:00:00Z', '2026-01-10T10:30:00Z',
            'repair', '/old/lesson.json', '/old/summary.json', '', 'completed'
        )
        """
    )
    connection.execute(
        """
        INSERT INTO session_items(
            session_id, item_id, studied_at, activity, grade, status_after,
            correction_count, support_level, task_outcome, correction_uptake, transferred
        ) VALUES(
            'legacy-session-1', ?, '2026-01-10T10:20:00Z', 'new', 'good', 'usable',
            1, 'light_cue', 'complete', 'after_cue', 1
        )
        """,
        (item["id"],),
    )
    connection.execute(
        """
        INSERT INTO review_state VALUES(
            ?, 'usable', '2026-01-10T10:20:00Z', '2026-01-10T10:20:00Z',
            2.0, 0.85, '2026-01-13T10:20:00Z', 1, 0, 'legacy-v1'
        )
        """,
        (item["id"],),
    )
    connection.execute(
        """
        INSERT INTO errors VALUES(
            'legacy-error-1', 'legacy-session-1', ?, '2026-01-10T10:22:00Z',
            'discuss about it', 'discuss it', 'grammar', '', NULL,
            '2026-01-13T10:22:00Z'
        )
        """,
        (item["id"],),
    )
    connection.execute(
        """
        INSERT INTO assessment_cycles VALUES(
            'legacy-cycle-1', '2026-01-01', '2026-01-14', 'completed', 1,
            '/old/evidence.json', '/old/report.json', 'minor',
            '2026-01-14T12:00:00Z', '2026-01-14T12:10:00Z', NULL, ''
        )
        """
    )
    connection.commit()
    connection.close()

    learner = data_root / "learner"
    (learner / "course.md").write_text("# Old course\n", encoding="utf-8")
    (learner / "settings.json").write_text(
        json.dumps(
            {
                "teacher_persona": {
                    "preset": "gentle",
                    "name": "Custom Teacher",
                    "warmth": 5,
                    "directness": 3,
                    "energy": 3,
                    "humor": 1,
                    "pace": "slow_natural",
                    "english_ratio": "balanced",
                    "custom_note": "以后纠错直接一点。",
                },
                "scheduled_tasks": {
                    "class_reminder": {"task_id": "old-task-1"}
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return database


def test_migration_preserves_old_data_and_adds_new_chain(tmp_path: Path):
    data_root = tmp_path / "ai-speaking-coach"
    source = build_old_database(data_root)
    before_hash = digest(source)
    candidate = tmp_path / "candidate" / "coach.sqlite"
    backup = tmp_path / "backup" / "coach.sqlite"
    data_backup = tmp_path / "backup" / "data.tar.gz"
    report_path = tmp_path / "migration-report.json"

    report = migrator.migrate(
        source,
        candidate,
        data_root,
        backup,
        data_backup,
        report_path,
    )

    assert report["status"] == "completed"
    assert report["validation"]["ok"] is True
    assert digest(source) == before_hash
    assert backup.is_file() and data_backup.is_file() and report_path.is_file()
    assert report["imports"]["legacy_item_evidence"] == 1
    assert report["imports"]["legacy_assessments"] == 1
    assert report["persona"]["requires_confirmation"]
    assert {item["field"] for item in report["persona"]["ignored"]} == {
        "preset",
        "warmth",
        "directness",
        "energy",
        "humor",
    }
    with sqlite3.connect(candidate) as connection:
        versions = {
            row[0] for row in connection.execute("SELECT version FROM schema_migrations")
        }
        assert {1, 2, 4, 6, 7, 8}.issubset(versions)
        assert connection.execute("SELECT COUNT(*) FROM content_items").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM review_state").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM item_learning_state").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM item_evidence").fetchone()[0] == 1
        mapped = connection.execute(
            "SELECT mapped_decision FROM legacy_assessment_imports"
        ).fetchone()[0]
        assert mapped == "adjust"


def test_fresh_database_uses_only_001_and_006_plus(tmp_path: Path):
    database = tmp_path / "fresh" / "coach.sqlite"
    applied = migrator.apply_migrations(database)
    assert applied == [1, 6, 7, 8]
    with sqlite3.connect(database) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    assert "class_runs" in tables
    assert "pending_sessions" not in tables
    assert "session_events" not in tables


def test_role_runtime_refuses_to_migrate_old_database_in_place(tmp_path: Path):
    data_root = tmp_path / "ai-speaking-coach"
    source = build_old_database(data_root)
    before_hash = digest(source)

    with pytest.raises(migrator.MigrationRequiredError):
        migrator.ensure_database(source)

    assert digest(source) == before_hash
