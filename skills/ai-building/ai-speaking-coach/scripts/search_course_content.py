#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json

from ai_speaking_coach.course_search import search_course_content
from ai_speaking_coach.embeddings import create_embedding_provider


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Search course content with learning state for Codex or GPT Live."
    )
    parser.add_argument("--query", required=True)
    parser.add_argument("--mode", choices=["fts", "vector", "hybrid"], default="hybrid")
    parser.add_argument("--provider", choices=["local_e5", "hash"], default=None)
    parser.add_argument("--limit", type=int, default=40)
    parser.add_argument("--type", choices=["expression", "pattern", "screen_line"])
    args = parser.parse_args()

    provider = create_embedding_provider(args.provider) if args.mode != "fts" else None
    response = search_course_content(
        query=args.query,
        provider=provider,
        mode=args.mode,
        limit=args.limit,
        item_type=args.type,
    )
    print(json.dumps(response, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
