from __future__ import annotations

from collections import defaultdict
from typing import Any

from .db import apply_migrations, connect
from .embeddings import EmbeddingProvider
from .retrieval import LanceDBRetrievalIndex, SearchMode, public_result


def search_course_content(
    query: str,
    provider: EmbeddingProvider | None,
    mode: SearchMode = "hybrid",
    limit: int = 20,
    item_type: str | None = None,
) -> dict[str, Any]:
    normalized_query = query.strip()
    if not normalized_query:
        raise ValueError("query must not be empty")
    if limit < 1 or limit > 100:
        raise ValueError("limit must be between 1 and 100")
    if mode != "fts" and provider is None:
        raise ValueError(f"{mode} search requires an embedding provider")

    apply_migrations()
    retrieved = LanceDBRetrievalIndex(provider).search(
        normalized_query,
        mode=mode,
        limit=limit,
        item_type=item_type,
    )
    public_items = [public_result(item) for item in retrieved]
    item_ids = [str(item["id"]) for item in public_items]
    states, errors = _load_learning_context(item_ids)

    results: list[dict[str, Any]] = []
    for item in public_items:
        item_id = str(item["id"])
        review = states.get(item_id)
        result = dict(item)
        result["learning_status"] = review["status"] if review else "unseen"
        result["review"] = review
        result["unresolved_errors"] = errors.get(item_id, [])
        results.append(result)

    return {
        "query": normalized_query,
        "mode": mode,
        "count": len(results),
        "results": results,
    }


def _load_learning_context(
    item_ids: list[str],
) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    if not item_ids:
        return {}, {}

    placeholders = ", ".join("?" for _ in item_ids)
    with connect() as connection:
        review_rows = connection.execute(
            f"""
            SELECT item_id, status, first_learned_at, last_reviewed_at,
                   stability, target_retention, next_due_at, review_count, lapse_count
            FROM review_state
            WHERE item_id IN ({placeholders})
            """,
            item_ids,
        ).fetchall()
        error_rows = connection.execute(
            f"""
            SELECT id, item_id, occurred_at, user_said, natural_version,
                   error_type, note, next_due_at
            FROM errors
            WHERE resolved_at IS NULL
              AND item_id IN ({placeholders})
            ORDER BY occurred_at DESC
            """,
            item_ids,
        ).fetchall()

    states = {str(row["item_id"]): dict(row) for row in review_rows}
    errors: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in error_rows:
        item_id = str(row["item_id"])
        if len(errors[item_id]) < 3:
            errors[item_id].append(dict(row))
    return states, dict(errors)
