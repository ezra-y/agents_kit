#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from ai_speaking_coach.embeddings import create_embedding_provider
from ai_speaking_coach.retrieval import LanceDBRetrievalIndex


def evaluate(cases: list[dict[str, Any]], mode: str, top_k: int) -> dict[str, Any]:
    provider = create_embedding_provider() if mode != "fts" else None
    index = LanceDBRetrievalIndex(provider)
    hits = 0
    reciprocal_rank = 0.0
    failures: list[dict[str, Any]] = []

    for case in cases:
        expected = set(case["expected_ids"])
        results = index.search(
            case["query"],
            mode=mode,
            limit=top_k,
            item_type=case.get("type"),
        )
        result_ids = [str(result["id"]) for result in results]
        rank = next(
            (
                position
                for position, item_id in enumerate(result_ids, start=1)
                if item_id in expected
            ),
            None,
        )
        if rank is not None:
            hits += 1
            reciprocal_rank += 1 / rank
        else:
            failures.append(
                {
                    "query": case["query"],
                    "expected_ids": sorted(expected),
                    "result_ids": result_ids,
                }
            )

    total = len(cases)
    return {
        "mode": mode,
        "cases": total,
        "top_k": top_k,
        "hit_rate": hits / total if total else 0.0,
        "mrr": reciprocal_rank / total if total else 0.0,
        "failures": failures,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark retrieval on human-labeled cases.")
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--mode", choices=["fts", "vector", "hybrid"], default="hybrid")
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    cases = [
        json.loads(line)
        for line in args.cases.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    result = evaluate(cases, args.mode, args.top_k)
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
