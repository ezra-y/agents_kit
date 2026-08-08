#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json

from ai_speaking_coach.coach_mode import (
    activate_coach_mode,
    deactivate_coach_mode,
    get_coach_mode,
    set_coach_phase,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage persistent AI speaking coach mode.")
    parser.add_argument("--thread-id")
    subparsers = parser.add_subparsers(dest="command", required=True)

    start = subparsers.add_parser("start")
    start.add_argument("--phase", choices=["onboarding", "teaching", "after_class"])
    start.add_argument("--lesson-date")

    phase = subparsers.add_parser("phase")
    phase.add_argument("value", choices=["onboarding", "teaching", "after_class"])

    subparsers.add_parser("stop")
    subparsers.add_parser("status")
    args = parser.parse_args()

    if args.command == "start":
        state = activate_coach_mode(args.thread_id, args.phase, args.lesson_date)
    elif args.command == "phase":
        state = set_coach_phase(args.value, args.thread_id)
    elif args.command == "stop":
        state = deactivate_coach_mode(args.thread_id)
    else:
        state = get_coach_mode(args.thread_id)

    print(json.dumps(state.to_dict() if state else {"active": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
