#!/usr/bin/env python3
from __future__ import annotations

import argparse

from ai_speaking_coach.embeddings import create_embedding_provider
from ai_speaking_coach.lessons import prepare_lesson


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare a daily speaking lesson.")
    parser.add_argument("--date")
    parser.add_argument("--topic")
    parser.add_argument("--provider", choices=["local_e5", "hash"], default=None)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    provider = create_embedding_provider(args.provider)
    plan = prepare_lesson(
        provider=provider,
        date=args.date,
        topic=args.topic,
        force=args.force,
    )
    print(f"preparation={plan.destination}")
    print(f"topic={plan.topic}")
    print(f"due={len(plan.due_items)}")
    print(f"errors={len(plan.error_items)}")
    print(f"new_candidates={len(plan.new_candidates)}")


if __name__ == "__main__":
    main()
