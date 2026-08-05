from __future__ import annotations

import math

from ai_speaking_coach.embeddings import HashEmbeddingProvider


def test_embedding_provider_separates_document_and_query_calls() -> None:
    provider = HashEmbeddingProvider(dimensions=32)

    documents = provider.embed_documents(["Are you free this weekend?"])
    query = provider.embed_query("free weekend")

    assert len(documents) == 1
    assert len(documents[0]) == provider.dimensions
    assert len(query) == provider.dimensions
    assert math.isclose(sum(value * value for value in query), 1.0)
    assert provider.model_revision == "test-only"
