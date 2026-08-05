#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json

from ai_speaking_coach.embeddings import create_embedding_provider
from ai_speaking_coach.retrieval import LanceDBRetrievalIndex, public_result


def main() -> None:
    parser = argparse.ArgumentParser(description="Search the teaching corpus.")
    parser.add_argument("query")
    parser.add_argument("--provider", choices=["local_e5", "hash"], default=None)
    parser.add_argument("--mode", choices=["fts", "vector", "hybrid"], default="hybrid")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--type", choices=["expression", "pattern", "screen_line"])
    args = parser.parse_args()

    provider = create_embedding_provider(args.provider) if args.mode != "fts" else None
    results = LanceDBRetrievalIndex(provider).search(
        args.query,
        mode=args.mode,
        limit=args.limit,
        item_type=args.type,
    )
    print(json.dumps([public_result(item) for item in results], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
