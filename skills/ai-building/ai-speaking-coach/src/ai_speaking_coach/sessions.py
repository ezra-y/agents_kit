from __future__ import annotations

from pathlib import Path

from .db import apply_migrations, transaction
from .models import SessionRecord
from .paths import sessions_dir
from .scheduler import upsert_review_state
from .time_utils import parse_timestamp


def record_session(record: SessionRecord) -> bool:
    parse_timestamp(record.started_at)
    parse_timestamp(record.ended_at)
    apply_migrations()
    inserted_session = False
    with transaction() as connection:
        cursor = connection.execute(
            """
            INSERT INTO sessions(
                id, started_at, ended_at, topic, lesson_path, summary_path, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            (
                record.id,
                record.started_at,
                record.ended_at,
                record.topic,
                record.lesson_path,
                record.summary_path,
                record.notes,
            ),
        )
        inserted_session = cursor.rowcount == 1
        if not inserted_session:
            return False

        for item in record.items:
            parse_timestamp(item.studied_at)
            connection.execute(
                """
                INSERT INTO session_items(
                    session_id, item_id, studied_at, activity, grade,
                    status_after, correction_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    item.item_id,
                    item.studied_at,
                    item.activity,
                    item.grade,
                    item.status_after,
                    item.correction_count,
                ),
            )
            upsert_review_state(
                connection,
                item.item_id,
                item.studied_at,
                item.grade,
                item.status_after,
            )

        for error in record.errors:
            parse_timestamp(error.occurred_at)
            parse_timestamp(error.next_due_at)
            connection.execute(
                """
                INSERT INTO errors(
                    id, session_id, item_id, occurred_at, user_said,
                    natural_version, error_type, note, next_due_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    error.id,
                    record.id,
                    error.item_id,
                    error.occurred_at,
                    error.user_said,
                    error.natural_version,
                    error.error_type,
                    error.note,
                    error.next_due_at,
                ),
            )

    summary_path = _write_summary(record)
    with transaction() as connection:
        connection.execute(
            "UPDATE sessions SET summary_path = ? WHERE id = ?",
            (str(summary_path), record.id),
        )
    return True


def _write_summary(record: SessionRecord) -> Path:
    date = record.started_at[:10]
    destination = sessions_dir() / f"{date}.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Speaking Class Record: {date}",
        "",
        f"- Session: `{record.id}`",
        f"- Topic: {record.topic}",
        f"- Started: {record.started_at}",
        f"- Ended: {record.ended_at}",
        "",
        "## Practiced Content",
        "",
    ]
    lines.extend(
        f"- `{item.item_id}`: {item.activity}, {item.grade}, {item.status_after}"
        for item in record.items
    )
    lines.extend(["", "## Errors", ""])
    if record.errors:
        lines.extend(
            f"- {error.user_said} -> {error.natural_version} ({error.error_type})"
            for error in record.errors
        )
    else:
        lines.append("- No errors from this class need long-term review.")
    if record.notes:
        lines.extend(["", "## Teacher Notes", "", record.notes])
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return destination
