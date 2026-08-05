#!/usr/bin/env python3
from __future__ import annotations

from ai_speaking_coach.db import apply_migrations, connect
from ai_speaking_coach.time_utils import isoformat, now


def main() -> None:
    apply_migrations()
    with connect() as connection:
        total = connection.execute(
            "SELECT COUNT(*) FROM content_items WHERE approved = 1"
        ).fetchone()[0]
        rows = connection.execute(
            "SELECT status, COUNT(*) AS count FROM review_state GROUP BY status"
        ).fetchall()
        status_counts = {row["status"]: row["count"] for row in rows}
        learned = sum(status_counts.values())
        due = connection.execute(
            "SELECT COUNT(*) FROM review_state WHERE next_due_at <= ?",
            (isoformat(now()),),
        ).fetchone()[0]
        unresolved_errors = connection.execute(
            "SELECT COUNT(*) FROM errors WHERE resolved_at IS NULL"
        ).fetchone()[0]

    print(f"approved_content={total}")
    print(f"unseen={max(total - learned, 0)}")
    for status in ("learning", "usable", "fluent"):
        print(f"{status}={status_counts.get(status, 0)}")
    print(f"due_now={due}")
    print(f"unresolved_errors={unresolved_errors}")


if __name__ == "__main__":
    main()

