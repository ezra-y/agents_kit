#!/usr/bin/env python3
from __future__ import annotations

from ai_speaking_coach.db import apply_migrations
from ai_speaking_coach.paths import database_path


def main() -> None:
    applied = apply_migrations()
    print(f"database={database_path()}")
    print(f"applied_migrations={applied}")


if __name__ == "__main__":
    main()

