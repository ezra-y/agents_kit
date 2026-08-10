from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .plugins import manifest_data

if TYPE_CHECKING:
    from .repository import Repository


class MarketplaceError(RuntimeError):
    pass


def expected_indexes(repo: Repository) -> dict[Path, dict[str, Any]]:
    claude_plugins: list[dict[str, Any]] = []
    codex_plugins: list[dict[str, Any]] = []
    for plugin_id, spec in sorted(repo.plugin_inventory().items()):
        claude = spec.targets.get("claude")
        if claude and claude.support in {"full", "partial"}:
            manifest = manifest_data(spec.root, "claude") or {}
            claude_plugins.append(
                {
                    "name": plugin_id,
                    "description": str(manifest.get("description") or plugin_id),
                    "source": f"./plugins/{plugin_id}",
                }
            )
        codex = spec.targets.get("codex")
        if codex and codex.support in {"full", "partial"}:
            manifest = manifest_data(spec.root, "codex") or {}
            policy = codex.marketplace
            codex_plugins.append(
                {
                    "name": plugin_id,
                    "source": {
                        "source": "local",
                        "path": f"./plugins/{plugin_id}",
                    },
                    "policy": {
                        "installation": policy.get("installation", "AVAILABLE"),
                        "authentication": policy.get("authentication", "ON_INSTALL"),
                    },
                    "category": policy.get("category", "Developer Tools"),
                    **(
                        {"description": str(manifest.get("description") or plugin_id)}
                        if manifest.get("description")
                        else {}
                    ),
                }
            )
    return {
        repo.root / ".claude-plugin/marketplace.json": {
            "name": "agents-kit",
            "description": "Ezra's shared Claude and Codex capability registry.",
            "owner": {"name": "Ezra"},
            "plugins": claude_plugins,
        },
        repo.root / ".agents/plugins/marketplace.json": {
            "name": "agents-kit",
            "description": "Ezra's shared Claude and Codex capability registry.",
            "interface": {"displayName": "Agents Kit"},
            "plugins": codex_plugins,
        },
    }


def build(repo: Repository) -> dict[str, Any]:
    changed: list[str] = []
    for path, data in expected_indexes(repo).items():
        if repo.write_json_if_changed(path, data):
            changed.append(str(path.relative_to(repo.root)))
    return {"changed": changed, "indexes": len(expected_indexes(repo))}


def check(repo: Repository) -> list[str]:
    stale: list[str] = []
    for path, expected in expected_indexes(repo).items():
        if not path.is_file():
            stale.append(str(path.relative_to(repo.root)))
            continue
        try:
            actual = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            stale.append(str(path.relative_to(repo.root)))
            continue
        if actual != expected:
            stale.append(str(path.relative_to(repo.root)))
    return stale


def status(repo: Repository) -> dict[str, Any]:
    indexes = expected_indexes(repo)
    return {
        "marketplace": "agents-kit",
        "plugins": len(repo.plugin_inventory()),
        "indexes": {
            str(path.relative_to(repo.root)): {
                "exists": path.is_file(),
                "stale": str(path.relative_to(repo.root)) in check(repo),
                "plugins": len(data["plugins"]),
            }
            for path, data in indexes.items()
        },
    }
