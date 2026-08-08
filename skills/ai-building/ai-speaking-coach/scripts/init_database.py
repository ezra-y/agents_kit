#!/usr/bin/env python3
from __future__ import annotations

from ai_speaking_coach.db import apply_migrations
from ai_speaking_coach.paths import (
    coach_mode_database_path,
    database_path,
    ensure_private_layout,
)


def main() -> None:
    ensure_private_layout()
    learner_applied = apply_migrations()
    mode_applied = apply_migrations(coach_mode_database_path(), group="runtime")
    print(f"learner_database={database_path()}")
    print(f"learner_migrations={learner_applied}")
    print(f"mode_database={coach_mode_database_path()}")
    print(f"runtime_migrations={mode_applied}")


if __name__ == "__main__":
    main()
