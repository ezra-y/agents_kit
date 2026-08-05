#!/usr/bin/env python3
from __future__ import annotations

from ai_speaking_coach.db import apply_migrations, backup_database
from ai_speaking_coach.paths import database_path, runtime_dir
from ai_speaking_coach.time_utils import now


def main() -> None:
    database = database_path()
    if database.exists():
        stamp = now().strftime("%Y%m%d-%H%M%S")
        backup = runtime_dir() / "backups" / f"coach-before-migration-{stamp}.sqlite"
        backup_database(backup)
        print(f"backup={backup}")
    applied = apply_migrations()
    print(f"applied_migrations={applied}")


if __name__ == "__main__":
    main()

