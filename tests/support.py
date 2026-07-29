from __future__ import annotations

from copy import deepcopy
from typing import Any

DEFAULT_TAGS = ["role/builder", "focus/example"]


def taxonomy_config(categories: list[str]) -> dict[str, Any]:
    return {
        "schema_version": 2,
        "taxonomy_version": 1,
        "categories": {
            category: {
                "label": category.title(),
                "description": f"{category} test category",
            }
            for category in categories
        },
        "tag_namespaces": {
            "role": {
                "label": "Role",
                "min": 1,
                "max": 1,
                "values": [
                    "reference",
                    "guide",
                    "builder",
                    "reviewer",
                    "router",
                    "workflow",
                    "researcher",
                    "integration",
                ],
            },
            "focus": {
                "label": "Focus",
                "min": 1,
                "max": 3,
                "values": ["example", "testing"],
            },
            "platform": {
                "label": "Platform",
                "min": 0,
                "max": 2,
                "values": ["example"],
            },
            "stack": {
                "label": "Stack",
                "min": 0,
                "max": 2,
                "values": ["example"],
            },
            "output": {
                "label": "Output",
                "min": 0,
                "max": 2,
                "values": ["example", "report"],
            },
        },
        "max_tags": 8,
    }


def metadata_catalog(skills: dict[str, dict[str, Any]]) -> dict[str, Any]:
    normalized = deepcopy(skills)
    for record in normalized.values():
        record.setdefault("tags", list(DEFAULT_TAGS))
    return {
        "schema_version": 2,
        "taxonomy_version": 1,
        "skills": normalized,
    }
