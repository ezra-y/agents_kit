from __future__ import annotations

import json

from .db import apply_migrations, transaction
from .time_utils import isoformat, now


def save_profile(
    preferred_name: str | None,
    english_name: str | None,
    coach_name: str | None,
    goals: str,
    interests: list[str],
    preferred_topics: list[str],
    language_mode: str = "mostly_english",
) -> None:
    apply_migrations()
    timestamp = isoformat(now())
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO learner_profile(
                id, preferred_name, english_name, coach_name, goals,
                interests_json, preferred_topics_json, language_mode,
                created_at, updated_at
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                preferred_name = excluded.preferred_name,
                english_name = excluded.english_name,
                coach_name = excluded.coach_name,
                goals = excluded.goals,
                interests_json = excluded.interests_json,
                preferred_topics_json = excluded.preferred_topics_json,
                language_mode = excluded.language_mode,
                updated_at = excluded.updated_at
            """,
            (
                preferred_name,
                english_name,
                coach_name,
                goals,
                json.dumps(interests, ensure_ascii=False),
                json.dumps(preferred_topics, ensure_ascii=False),
                language_mode,
                timestamp,
                timestamp,
            ),
        )

