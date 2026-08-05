#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from ai_speaking_coach.models import SessionRecord
from ai_speaking_coach.sessions import record_session


def main() -> None:
    parser = argparse.ArgumentParser(description="Record a completed speaking session.")
    parser.add_argument("record", type=Path, help="JSON file matching the session record schema")
    args = parser.parse_args()
    record = SessionRecord.model_validate_json(args.record.read_text(encoding="utf-8"))
    inserted = record_session(record)
    print("session: recorded" if inserted else "session: already recorded")


if __name__ == "__main__":
    main()

