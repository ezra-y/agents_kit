from __future__ import annotations

import hashlib
import math
import os
import re
from collections.abc import Sequence
from typing import Protocol

from .paths import load_settings, runtime_dir


class EmbeddingProvider(Protocol):
    @property
    def model_id(self) -> str: ...

    @property
    def model_revision(self) -> str: ...

    @property
    def dimensions(self) -> int: ...

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class LocalE5EmbeddingProvider:
    def __init__(
        self,
        model: str | None = None,
        revision: str | None = None,
        device: str | None = None,
    ) -> None:
        settings = load_settings()
        embedding = settings["embedding"]
        self._model_id = model or str(embedding["model"])
        self._revision = revision or str(embedding["revision"])
        self._batch_size = int(embedding["batch_size"])
        self._normalize = bool(embedding["normalize"])
        self._query_prefix = str(embedding["query_prefix"])
        self._passage_prefix = str(embedding["passage_prefix"])
        endpoint = str(embedding.get("download_endpoint", "")).strip()
        if endpoint:
            os.environ.setdefault("HF_ENDPOINT", endpoint)

        from sentence_transformers import SentenceTransformer

        cache_folder = runtime_dir() / "models"
        cache_folder.mkdir(parents=True, exist_ok=True)
        self._model = SentenceTransformer(
            self._model_id,
            revision=self._revision,
            device=device or str(embedding["device"]),
            cache_folder=str(cache_folder),
        )
        dimensions = self._model.get_embedding_dimension()
        if dimensions is None:
            raise RuntimeError(f"Embedding dimensions unavailable for {self._model_id}")
        self._dimensions = int(dimensions)

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def model_revision(self) -> str:
        return self._revision

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return self._encode([f"{self._passage_prefix}{text}" for text in texts])

    def embed_query(self, text: str) -> list[float]:
        vectors = self._encode([f"{self._query_prefix}{text}"])
        return vectors[0]

    def _encode(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        vectors = self._model.encode(
            list(texts),
            batch_size=self._batch_size,
            convert_to_numpy=True,
            normalize_embeddings=self._normalize,
            show_progress_bar=False,
        )
        return vectors.tolist()


class HashEmbeddingProvider:
    """Deterministic local vectors for pipeline tests, never for teaching quality."""

    def __init__(self, dimensions: int = 128) -> None:
        self._dimensions = dimensions

    @property
    def model_id(self) -> str:
        return f"hash-test-{self._dimensions}"

    @property
    def model_revision(self) -> str:
        return "test-only"

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed_one(text)

    def _embed_one(self, text: str) -> list[float]:
        vector = [0.0] * self._dimensions
        tokens = re.findall(r"[a-z0-9']+|[\u3400-\u9fff]", text.lower())
        for token in tokens:
            digest = hashlib.blake2b(token.encode(), digest_size=8).digest()
            bucket = int.from_bytes(digest[:4], "big") % self._dimensions
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vector[bucket] += sign
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]


def create_embedding_provider(name: str | None = None) -> EmbeddingProvider:
    provider_name = name or load_settings()["embedding"]["provider"]
    if provider_name in {"local_e5", "e5"}:
        return LocalE5EmbeddingProvider()
    if provider_name == "hash":
        return HashEmbeddingProvider()
    raise ValueError(f"Unknown embedding provider: {provider_name}")
