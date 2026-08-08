#!/usr/bin/env python3
from __future__ import annotations

from ai_speaking_coach.db import apply_migrations, backup_database
from ai_speaking_coach.paths import (
    backup_dir,
    coach_mode_database_path,
    database_path,
    ensure_private_layout,
)
from ai_speaking_coach.time_utils import now


def main() -> None:
    ensure_private_layout()
    stamp = now().strftime("%Y%m%d-%H%M%S")
    learner_database = database_path()
    mode_database = coach_mode_database_path()
    if learner_database.exists():
        backup = backup_dir() / f"learner-before-migration-{stamp}.sqlite"
        backup_database(backup, learner_database)
        print(f"backup={backup}")
    if mode_database.exists():
        backup = backup_dir() / f"coach-mode-before-migration-{stamp}.sqlite"
        backup_database(backup, mode_database)
        print(f"backup={backup}")
    print(f"learner_migrations={apply_migrations()}")
    print(f"runtime_migrations={apply_migrations(mode_database, group='runtime')}")


if __name__ == "__main__":
    main()
