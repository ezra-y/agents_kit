#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json

from ai_speaking_coach.class_schedule import (
    class_schedule,
    dismiss_reminder_setup,
    reminder_status,
    save_class_schedule,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan and persist class reminder preferences.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("status")
    subparsers.add_parser("dismiss")

    save_parser = subparsers.add_parser("save")
    save_parser.add_argument("--schedule", required=True)
    save_parser.add_argument("--timezone", required=True)
    save_parser.add_argument("--rrule", required=True)
    save_parser.add_argument("--automation-id", required=True)

    args = parser.parse_args()
    if args.command == "status":
        result = reminder_status()
    elif args.command == "dismiss":
        result = dismiss_reminder_setup()
    else:
        schedule = class_schedule(
            schedule_text=args.schedule,
            timezone=args.timezone,
            rrule=args.rrule,
        )
        result = save_class_schedule(schedule, args.automation_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
