from __future__ import annotations

import json
import os
import shlex
import subprocess
from pathlib import Path
from typing import Any

from .database import connect, ensure_database
from .retrieval import RetrievalUnavailable, search_index


def _tokens(text: str) -> set[str]:
    return {part.casefold() for part in text.replace("/", " ").replace("_", " ").split() if part}


def lexical_search(database: Path, query: str, limit: int = 8) -> list[dict[str, Any]]:
    ensure_database(database)
    q = _tokens(query)
    scored: list[tuple[float, dict[str, Any]]] = []
    with connect(database) as connection:
        rows = connection.execute(
            """
            SELECT id, type, text, meaning, topics_json, examples_json, usage_note, context
            FROM content_items
            WHERE approved = 1
            ORDER BY id
            """
        ).fetchall()
    for row in rows:
        item = dict(row)
        item["topics"] = json.loads(item.pop("topics_json"))
        item["examples"] = json.loads(item.pop("examples_json"))
        haystack = " ".join(str(item.get(k, "")) for k in ("text", "meaning", "function", "scene", "tags"))
        haystack += " " + " ".join(item["topics"])
        haystack += " " + item.get("usage_note", "") + " " + item.get("context", "")
        tokens = _tokens(haystack)
        score = len(q & tokens) / max(1, len(q))
        if query.casefold() in haystack.casefold():
            score += 1.0
        if score > 0:
            scored.append((score, item))
    scored.sort(key=lambda pair: (-pair[0], str(pair[1].get("id", ""))))
    return [item for _, item in scored[:limit]]


def search(
    database: Path,
    query: str,
    limit: int = 8,
    *,
    lancedb_path: Path | None = None,
    manifest_path: Path | None = None,
    model_cache: Path | None = None,
) -> dict[str, Any]:
    command = os.environ.get("AI_SPEAKING_MATERIAL_SEARCH_CMD")
    if command:
        process = subprocess.run(
            shlex.split(command),
            input=json.dumps(
                {"query": query, "limit": limit, "database": str(database)},
                ensure_ascii=False,
            ),
            text=True,
            capture_output=True,
            check=False,
        )
        if process.returncode == 0:
            return {"backend": "external_e5", "items": json.loads(process.stdout)}
        return {
            "backend": "external_failed",
            "error": process.stderr.strip(),
            "items": lexical_search(database, query, limit),
        }
    if lancedb_path and manifest_path and model_cache:
        try:
            return {
                "backend": "local_e5",
                "items": search_index(
                    database,
                    lancedb_path,
                    manifest_path,
                    model_cache,
                    query,
                    limit,
                ),
            }
        except (RetrievalUnavailable, FileNotFoundError, OSError, RuntimeError) as exc:
            return {
                "backend": "sqlite_lexical_fallback",
                "degraded_reason": str(exc),
                "items": lexical_search(database, query, limit),
            }
    return {
        "backend": "sqlite_lexical_fallback",
        "items": lexical_search(database, query, limit),
    }
