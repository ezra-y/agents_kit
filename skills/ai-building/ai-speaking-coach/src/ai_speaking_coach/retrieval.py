from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Literal

import lancedb
from lancedb.index import FTS

from .corpus import ContentItem, read_jsonl
from .embeddings import EmbeddingProvider
from .paths import embedding_manifest_path, lancedb_path, load_settings
from .time_utils import isoformat, now

SearchMode = Literal["fts", "vector", "hybrid"]


def search_text(item: ContentItem) -> str:
    return "\n".join(
        part
        for part in (
            item.text,
            item.meaning,
            " ".join(item.topics),
            item.usage_note,
            item.context,
            *item.examples,
        )
        if part
    )


class LanceDBRetrievalIndex:
    def __init__(
        self,
        provider: EmbeddingProvider | None,
        path: Path | None = None,
        table_name: str = "content",
    ) -> None:
        self.provider = provider
        self.path = path or lancedb_path()
        self.table_name = table_name

    def rebuild(self, items: Sequence[ContentItem]) -> int:
        approved = [item for item in items if item.approved]
        if not approved:
            raise ValueError("Cannot build an index with no approved content")
        if self.provider is None:
            raise ValueError("An embedding provider is required to build the index")
        texts = [search_text(item) for item in approved]
        settings = load_settings()
        batch_size = int(settings["embedding"]["batch_size"])
        vectors: list[list[float]] = []
        for offset in range(0, len(texts), batch_size):
            vectors.extend(self.provider.embed_documents(texts[offset : offset + batch_size]))
        rows = [
            {
                "id": item.id,
                "type": item.type,
                "group_id": item.group_id or "",
                "text": item.text,
                "meaning": item.meaning,
                "topics": json.dumps(item.topics, ensure_ascii=False),
                "usage_note": item.usage_note,
                "search_text": text,
                "approved": item.approved,
                "vector": vector,
            }
            for item, text, vector in zip(approved, texts, vectors, strict=True)
        ]
        self.path.mkdir(parents=True, exist_ok=True)
        database = lancedb.connect(str(self.path))
        table = database.create_table(self.table_name, rows, mode="overwrite")
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
        self._write_manifest(approved, len(vectors[0]))
        return len(rows)

    def search(
        self,
        query: str,
        mode: SearchMode = "hybrid",
        limit: int | None = None,
        item_type: str | None = None,
    ) -> list[dict[str, Any]]:
        settings = load_settings()
        result_limit = limit or int(settings["retrieval"]["result_limit"])
        database = lancedb.connect(str(self.path))
        table = database.open_table(self.table_name)
        where = "approved = true"
        if item_type:
            safe_type = item_type.replace("'", "''")
            where += f" AND type = '{safe_type}'"

        if mode == "fts":
            builder = table.search(query, query_type="fts", fts_columns="search_text")
        else:
            if self.provider is None:
                raise RuntimeError(f"Embedding provider is required for {mode} search")
            vector = self.provider.embed_query(query)
            if mode == "vector":
                builder = table.search(vector, query_type="vector")
            else:
                builder = (
                    table.search(query_type="hybrid")
                    .vector(vector)
                    .text(query)
                    .rerank(normalize="rank")
                )
        return builder.where(where).limit(result_limit).to_list()

    def _write_manifest(self, items: Sequence[ContentItem], dimensions: int) -> None:
        content_digest = hashlib.sha256(
            "\n".join(f"{item.id}:{search_text(item)}" for item in items).encode()
        ).hexdigest()
        manifest = {
            "backend": "lancedb",
            "table": self.table_name,
            "embedding_model": self.provider.model_id,
            "embedding_revision": self.provider.model_revision,
            "dimensions": dimensions,
            "content_count": len(items),
            "content_hash": content_digest,
            "built_at": isoformat(now()),
        }
        destination = embedding_manifest_path()
        destination.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


def build_default_index(provider: EmbeddingProvider) -> int:
    return LanceDBRetrievalIndex(provider).rebuild(read_jsonl())


def public_result(item: dict[str, Any]) -> dict[str, Any]:
    result = {
        key: item[key]
        for key in ("id", "type", "text", "meaning", "topics", "usage_note")
        if key in item
    }
    if isinstance(result.get("topics"), str):
        result["topics"] = json.loads(result["topics"])
    for score_key in ("_relevance_score", "_score", "_distance"):
        if score_key in item:
            result["score"] = item[score_key]
            break
    return result
