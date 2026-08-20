from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol, Sequence

from .database import connect, content_digest, ensure_database

MODEL_ID = "intfloat/multilingual-e5-small"
MODEL_REVISION = "fd1525a9fd15316a2d503bf26ab031a61d056e98"


class RetrievalUnavailable(RuntimeError):
    pass


class EmbeddingProvider(Protocol):
    @property
    def model_id(self) -> str: ...

    @property
    def model_revision(self) -> str: ...

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class LocalE5EmbeddingProvider:
    def __init__(self, model_cache: Path, *, device: str = "cpu") -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ModuleNotFoundError as exc:
            raise RetrievalUnavailable(
                "sentence-transformers is not installed"
            ) from exc
        model_cache.mkdir(parents=True, exist_ok=True)
        self._model = SentenceTransformer(
            MODEL_ID,
            revision=MODEL_REVISION,
            device=device,
            cache_folder=str(model_cache),
        )

    @property
    def model_id(self) -> str:
        return MODEL_ID

    @property
    def model_revision(self) -> str:
        return MODEL_REVISION

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return self._encode([f"passage: {text}" for text in texts])

    def embed_query(self, text: str) -> list[float]:
        return self._encode([f"query: {text}"])[0]

    def _encode(self, texts: Sequence[str]) -> list[list[float]]:
        vectors = self._model.encode(
            list(texts),
            batch_size=64,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return vectors.tolist()


def _lancedb() -> Any:
    try:
        import lancedb
        from lancedb.index import FTS
    except ModuleNotFoundError as exc:
        raise RetrievalUnavailable("lancedb is not installed") from exc
    return lancedb, FTS


def _content_rows(database: Path) -> list[dict[str, Any]]:
    ensure_database(database)
    with connect(database) as connection:
        return [
            dict(row)
            for row in connection.execute(
                """
                SELECT
                    id, type, group_id, text, meaning, topics_json,
                    examples_json, usage_note, context, approved
                FROM content_items
                WHERE approved = 1
                ORDER BY id
                """
            )
        ]


def _search_text(item: dict[str, Any]) -> str:
    return "\n".join(
        part
        for part in (
            item["text"],
            item["meaning"],
            " ".join(json.loads(item["topics_json"])),
            item["usage_note"],
            item["context"],
            *json.loads(item["examples_json"]),
        )
        if part
    )


def rebuild_index(
    database: Path,
    index_path: Path,
    manifest_path: Path,
    provider: EmbeddingProvider,
) -> int:
    lancedb, FTS = _lancedb()
    items = _content_rows(database)
    if not items:
        raise ValueError("Cannot build an index with no approved content")
    texts = [_search_text(item) for item in items]
    vectors = provider.embed_documents(texts)
    rows = [
        {
            "id": item["id"],
            "type": item["type"],
            "group_id": item["group_id"] or "",
            "text": item["text"],
            "meaning": item["meaning"],
            "topics": item["topics_json"],
            "usage_note": item["usage_note"],
            "search_text": text,
            "approved": True,
            "vector": vector,
        }
        for item, text, vector in zip(items, texts, vectors, strict=True)
    ]
    index_path.mkdir(parents=True, exist_ok=True)
    database_handle = lancedb.connect(str(index_path))
    table = database_handle.create_table("content", rows, mode="overwrite")
    table.create_index(
        "search_text",
        config=FTS(
            with_position=True,
            base_tokenizer="simple",
            language="English",
            lower_case=True,
            stem=True,
            remove_stop_words=False,
        ),
        replace=True,
    )
    with connect(database) as connection:
        source_hash = content_digest(connection)
    manifest = {
        "backend": "lancedb",
        "table": "content",
        "embedding_model": provider.model_id,
        "embedding_revision": provider.model_revision,
        "content_count": len(rows),
        "content_hash": source_hash,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(rows)


def index_status(
    database: Path,
    index_path: Path,
    manifest_path: Path,
) -> dict[str, Any]:
    if not manifest_path.is_file() or not index_path.is_dir():
        return {"ready": False, "reason": "missing_index_or_manifest"}
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    with connect(database) as connection:
        current_hash = content_digest(connection)
    expected = {
        "embedding_model": MODEL_ID,
        "embedding_revision": MODEL_REVISION,
        "content_hash": current_hash,
    }
    mismatches = {
        key: {"expected": value, "actual": manifest.get(key)}
        for key, value in expected.items()
        if manifest.get(key) != value
    }
    return {
        "ready": not mismatches,
        "reason": "ok" if not mismatches else "manifest_mismatch",
        "mismatches": mismatches,
        "manifest": manifest,
    }


def search_index(
    database: Path,
    index_path: Path,
    manifest_path: Path,
    model_cache: Path,
    query: str,
    limit: int,
) -> list[dict[str, Any]]:
    status = index_status(database, index_path, manifest_path)
    if not status["ready"]:
        raise RetrievalUnavailable(status["reason"])
    lancedb, _ = _lancedb()
    provider = LocalE5EmbeddingProvider(model_cache)
    table = lancedb.connect(str(index_path)).open_table("content")
    vector = provider.embed_query(query)
    builder = (
        table.search(query_type="hybrid")
        .vector(vector)
        .text(query)
        .rerank(normalize="rank")
    )
    rows = builder.where("approved = true").limit(limit).to_list()
    result = []
    for item in rows:
        public = {
            key: item[key]
            for key in ("id", "type", "text", "meaning", "usage_note")
            if key in item
        }
        public["topics"] = json.loads(item.get("topics") or "[]")
        for key in ("_relevance_score", "_score", "_distance"):
            if key in item:
                public["score"] = item[key]
                break
        result.append(public)
    return result
