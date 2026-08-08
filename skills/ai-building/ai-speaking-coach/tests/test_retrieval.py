from __future__ import annotations

from pathlib import Path

from ai_speaking_coach.embeddings import HashEmbeddingProvider
from ai_speaking_coach.models import ContentItem, SourceRef
from ai_speaking_coach.retrieval import LanceDBRetrievalIndex


def test_rebuild_and_search(isolated_root: Path) -> None:
    items = [
        ContentItem(
            id="a",
            type="expression",
            text="Are you free this weekend?",
            meaning="你这周末有空吗？",
            topics=["friends"],
            source_ref=SourceRef(file="test", order=1),
        ),
        ContentItem(
            id="b",
            type="expression",
            text="I need to reschedule.",
            meaning="我需要改时间。",
            topics=["plans"],
            source_ref=SourceRef(file="test", order=2),
        ),
        ContentItem(
            id="c",
            type="expression",
            text="This item is not approved.",
            source_ref=SourceRef(file="test", order=3),
            approved=False,
        ),
    ]
    index = LanceDBRetrievalIndex(
        HashEmbeddingProvider(),
        isolated_root / "private" / "cache" / "lancedb",
    )
    assert index.rebuild(items) == 2
    fts_results = index.search("free weekend", mode="fts", limit=2)
    assert fts_results[0]["id"] == "a"
    assert all(result["id"] != "c" for result in fts_results)
    hybrid_results = index.search("change my plans", mode="hybrid", limit=2)
    assert hybrid_results
