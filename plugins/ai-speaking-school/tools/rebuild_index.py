from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_ROOT = ROOT / "authoring" / "shared-runtime"
runtime_spec = importlib.util.spec_from_file_location(
    "shared_runtime",
    RUNTIME_ROOT / "__init__.py",
    submodule_search_locations=[str(RUNTIME_ROOT)],
)
if runtime_spec is None or runtime_spec.loader is None:
    raise RuntimeError(f"Cannot load shared runtime from {RUNTIME_ROOT}")
runtime_package = importlib.util.module_from_spec(runtime_spec)
sys.modules["shared_runtime"] = runtime_package
runtime_spec.loader.exec_module(runtime_package)

from shared_runtime.database import ensure_database
from shared_runtime.paths import SchoolPaths
from shared_runtime.retrieval import (
    LocalE5EmbeddingProvider,
    index_status,
    rebuild_index,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild the derived E5/LanceDB index.")
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()
    paths = SchoolPaths.from_env()
    paths.ensure()
    ensure_database(paths.database)
    if args.status:
        result = index_status(
            paths.database,
            paths.lancedb,
            paths.embedding_manifest,
        )
    else:
        provider = LocalE5EmbeddingProvider(paths.model_cache)
        count = rebuild_index(
            paths.database,
            paths.lancedb,
            paths.embedding_manifest,
            provider,
        )
        result = {
            "indexed": count,
            "model": provider.model_id,
            "revision": provider.model_revision,
        }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
