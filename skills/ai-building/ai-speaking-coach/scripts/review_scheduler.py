#!/usr/bin/env python3
from __future__ import annotations

import argparse

from ai_speaking_coach.db import apply_migrations, transaction
from ai_speaking_coach.scheduler import rebuild_review_state


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild review state from session history.")
    parser.add_argument("--rebuild", action="store_true", required=True)
    parser.parse_args()
    apply_migrations()
    with transaction() as connection:
        rebuild_review_state(connection)
        count = connection.execute("SELECT COUNT(*) FROM review_state").fetchone()[0]
    print(f"review_state_rows={count}")


if __name__ == "__main__":
    main()

