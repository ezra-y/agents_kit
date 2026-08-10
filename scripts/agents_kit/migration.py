from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .models import AssetRef, ChangeSet, Effect

if TYPE_CHECKING:
    from .repository import Repository


def migrate_legacy_state(repo: Repository) -> ChangeSet:
    changed: set[str] = set()

    metadata = repo.read_metadata()
    normalized_metadata: dict[str, Any] = {}
    for key, record in metadata["skills"].items():
        ref = _skill_ref(repo, key)
        updated = dict(record)
        dependencies = updated.get("dependencies")
        if isinstance(dependencies, list):
            updated["dependencies"] = [
                _skill_ref(repo, dependency).canonical for dependency in dependencies
            ]
        normalized_metadata[ref.canonical] = updated
    metadata["skills"] = normalized_metadata
    if repo.write_metadata(metadata):
        changed.add("metadata")

    sources = repo.read_sources()
    normalized_sources = {
        _skill_ref(repo, key).canonical: record
        for key, record in sources["skills"].items()
    }
    sources["skills"] = normalized_sources
    if repo.write_sources(sources):
        changed.add("sources")

    desired = repo.read_desired_installations()
    if repo.write_desired_installations(desired):
        changed.add("desired_installations")

    return ChangeSet(
        changed=changed,
        effects={Effect.DOCS_BUILD, Effect.CHECK} if changed else set(),
        details={
            "metadata": len(normalized_metadata),
            "skill_sources": len(normalized_sources),
            "targets": sorted(desired["targets"]),
        },
    )


def _skill_ref(repo: Repository, value: str) -> AssetRef:
    if value.startswith("skill:"):
        return AssetRef.parse(value)
    try:
        return repo.resolve_skill_ref(value)
    except RuntimeError:
        return AssetRef.standalone_skill(value)
