#!/usr/bin/env python3
from __future__ import annotations

import argparse

from ai_speaking_coach.profile import save_profile


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update the learner profile.")
    parser.add_argument("--name")
    parser.add_argument("--english-name")
    parser.add_argument("--coach-name")
    parser.add_argument("--goals", required=True)
    parser.add_argument("--interest", action="append", default=[])
    parser.add_argument("--topic", action="append", default=[])
    parser.add_argument("--language-mode", default="mostly_english")
    args = parser.parse_args()
    save_profile(
        preferred_name=args.name,
        english_name=args.english_name,
        coach_name=args.coach_name,
        goals=args.goals,
        interests=args.interest,
        preferred_topics=args.topic,
        language_mode=args.language_mode,
    )
    print("profile: saved")


if __name__ == "__main__":
    main()

