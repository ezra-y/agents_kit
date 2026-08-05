#!/usr/bin/env python3
from __future__ import annotations

import argparse

from ai_speaking_coach.corpus import read_jsonl
from ai_speaking_coach.embeddings import create_embedding_provider
from ai_speaking_coach.retrieval import LanceDBRetrievalIndex


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the local LanceDB retrieval index.")
    parser.add_argument("--provider", choices=["local_e5", "hash"], default=None)
    parser.add_argument("--rebuild", action="store_true", required=True)
    args = parser.parse_args()
    provider = create_embedding_provider(args.provider)
    count = LanceDBRetrievalIndex(provider).rebuild(read_jsonl())
    print(f"indexed={count}")
    print(f"embedding_model={provider.model_id}")


if __name__ == "__main__":
    main()
