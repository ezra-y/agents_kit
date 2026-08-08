#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json

from ai_speaking_coach.class_schedule import (
    dismiss_reminder_setup,
    plan_class_schedule,
    reminder_status,
    save_class_schedule,
)
from ai_speaking_coach.paths import load_settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan and persist class reminder preferences.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("status")
    subparsers.add_parser("dismiss")

    plan_parser = subparsers.add_parser("plan")
    _add_schedule_arguments(plan_parser)

    save_parser = subparsers.add_parser("save")
    _add_schedule_arguments(save_parser)
    save_parser.add_argument("--automation-id", required=True)

    args = parser.parse_args()
    if args.command == "status":
        result = reminder_status()
    elif args.command == "dismiss":
        result = dismiss_reminder_setup()
    else:
        schedule = plan_class_schedule(
            cadence=args.cadence,
            local_time=args.local_time,
            timezone=args.timezone or str(load_settings()["timezone"]),
            weekdays=args.weekday,
        )
        result = schedule.to_dict()
        if args.command == "save":
            result = save_class_schedule(schedule, args.automation_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def _add_schedule_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--cadence",
        choices=["daily", "every_other_day", "weekly"],
        required=True,
    )
    parser.add_argument("--time", dest="local_time", required=True)
    parser.add_argument("--timezone")
    parser.add_argument("--weekday", action="append", default=[])


if __name__ == "__main__":
    main()
