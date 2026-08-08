#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from ai_speaking_coach.corpus import read_jsonl, validate_items


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate the teaching corpus.")
    parser.add_argument("--path", type=Path)
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--require-approved", action="store_true")
    args = parser.parse_args()

    items = read_jsonl(args.path)
    errors = validate_items(items)
    counts = Counter(item.type for item in items)
    if args.expected_count is not None and len(items) != args.expected_count:
        errors.append(f"Expected {args.expected_count} items, found {len(items)}")
    unapproved = sum(not item.approved for item in items)
    if args.require_approved and unapproved:
        errors.append(f"{unapproved} items still need approval")

    print(f"total={len(items)}")
    for item_type, count in sorted(counts.items()):
        print(f"{item_type}={count}")
    print(f"approved={sum(item.approved for item in items)}")
    print(f"needs_review={unapproved}")
    if errors:
        raise SystemExit("\n".join(errors))
    print("knowledge: valid")


if __name__ == "__main__":
    main()
