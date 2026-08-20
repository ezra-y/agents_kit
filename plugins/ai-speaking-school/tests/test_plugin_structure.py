from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SKILLS = [
    "speaking-head-teacher",
    "speaking-live-teacher",
    "speaking-teaching-assistant",
    "speaking-learning-analyst",
]


def test_manifest_and_no_hook_or_mcp():
    manifest = json.loads((ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
    assert manifest["skills"] == "./skills/"
    assert not (ROOT / "hooks").exists()
    assert not (ROOT / ".mcp.json").exists()


def test_skill_frontmatter_and_resources():
    for skill in SKILLS:
        root = ROOT / "skills" / skill
        text = (root / "SKILL.md").read_text(encoding="utf-8")
        assert text.startswith("---\n")
        _, front, body = text.split("---", 2)
        data = yaml.safe_load(front)
        assert data["name"] == skill
        assert data["description"].strip()
        assert body.strip()
        assert (root / "references").is_dir()
        assert (root / "scripts").is_dir()


def test_no_runtime_authoring_links():
    for skill in SKILLS:
        for path in (ROOT / "skills" / skill).rglob("*"):
            if path.is_file() and path.suffix in {".md", ".py", ".json"}:
                text = path.read_text(encoding="utf-8")
                assert "../../authoring" not in text
                assert "../../../authoring" not in text


def test_shared_copies_match_sources():
    mapping = json.loads((ROOT / "authoring" / "shared-map.json").read_text(encoding="utf-8"))
    for skill, config in mapping.items():
        for name in config["runtime"]:
            assert (ROOT / "authoring" / "shared-runtime" / name).read_bytes() == (ROOT / "skills" / skill / "scripts" / "_shared" / name).read_bytes()
        for name in config["references"]:
            assert (ROOT / "authoring" / "shared-references" / name).read_bytes() == (ROOT / "skills" / skill / "references" / "_shared" / name).read_bytes()
