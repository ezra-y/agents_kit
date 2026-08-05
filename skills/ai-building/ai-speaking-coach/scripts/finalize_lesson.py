#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from ai_speaking_coach.lessons import FinalLessonSpec, finalize_lesson


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate and save a strong-model lesson.")
    parser.add_argument("spec", type=Path, help="JSON file matching FinalLessonSpec")
    args = parser.parse_args()

    spec = FinalLessonSpec.model_validate_json(args.spec.read_text(encoding="utf-8"))
    destination = finalize_lesson(spec)
    print(f"lesson={destination}")


if __name__ == "__main__":
    main()
