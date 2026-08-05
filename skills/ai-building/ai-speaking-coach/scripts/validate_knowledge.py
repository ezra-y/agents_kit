#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter

from ai_speaking_coach.corpus import read_jsonl, validate_items


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate the teaching corpus.")
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()

    items = read_jsonl()
    errors = validate_items(items)
    counts = Counter(item.type for item in items)
    if counts["expression"] != 502:
        errors.append(f"Expected 502 source expressions, found {counts['expression']}")
    if counts["pattern"] != 220:
        errors.append(f"Expected 220 patterns, found {counts['pattern']}")
    if args.strict and len(items) != 722:
        errors.append(f"Expected 722 total source items, found {len(items)}")

    print(f"total={len(items)}")
    print(f"expressions={counts['expression']}")
    print(f"patterns={counts['pattern']}")
    print(f"approved={sum(item.approved for item in items)}")
    print(f"needs_review={sum(not item.approved for item in items)}")
    if errors:
        raise SystemExit("\n".join(errors))
    print("knowledge: valid")


if __name__ == "__main__":
    main()
