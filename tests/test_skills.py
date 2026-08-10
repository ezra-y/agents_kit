import json
import tempfile
import unittest
from pathlib import Path

from scripts.agents_kit.models import ContentMode, SkillSnapshot, SourceSpec
from scripts.agents_kit.repository import Repository
from scripts.agents_kit.skills import (
    build_source_record,
    import_snapshot,
    move_skill,
    remove_skill,
    rename_skill,
    set_metadata,
    update_from_source,
)
from scripts.agents_kit.sources import SourceSession
from scripts.agents_kit.taxonomy import TaxonomyError
from tests.support import DEFAULT_TAGS, metadata_catalog, taxonomy_config

CONFIG = {
    **taxonomy_config(["tools", "web"]),
    "install_targets": {"global": [], "project": []},
    "mcp_install_targets": {"global": []},
    "defaults": {"source_policy": "review", "network_timeout_seconds": 60},
}


class SkillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "skills").mkdir()
        (self.root / "agents-kit.json").write_text(json.dumps(CONFIG), encoding="utf-8")
        (self.root / "active.txt").write_text("", encoding="utf-8")
        (self.root / "sources.json").write_text(
            json.dumps({"schema_version": 2, "skills": {}}), encoding="utf-8"
        )
        (self.root / "metadata.json").write_text(
            json.dumps(metadata_catalog({})), encoding="utf-8"
        )
        (self.root / "mcps.json").write_text(
            json.dumps({"schema_version": 1, "servers": {}}), encoding="utf-8"
        )
        self.repo = Repository(self.root)

        self.source = self.root / "fixture"
        self.source.mkdir()
        (self.source / "SKILL.md").write_text(
            "---\nname: alpha\ndescription: Alpha upstream\n---\n",
            encoding="utf-8",
        )

    def tearDown(self):
        self.temp.cleanup()

    def import_alpha(self):
        with SourceSession(timeout=5) as session:
            snapshot = session.snapshot(session.spec(str(self.source)))
            return import_snapshot(
                self.repo,
                snapshot,
                category="tools",
                name=None,
                description="中文说明",
                trigger="需要 alpha 时",
                recommendation=3,
                tags=DEFAULT_TAGS,
                policy="review",
            )

    def test_import_local_skill_and_metadata(self):
        result = self.import_alpha()

        self.assertTrue((self.root / "skills/tools/alpha/SKILL.md").is_file())
        self.assertEqual(result.changed, {"skills", "metadata"})
        self.assertIsNone(self.repo.source_record("alpha"))
        self.assertEqual(self.repo.metadata_record("alpha")["description"], "中文说明")
        self.assertEqual(self.repo.metadata_record("alpha")["tags"], DEFAULT_TAGS)

    def test_source_record_contains_managed_content_mode(self):
        with SourceSession(timeout=5) as session:
            snapshot = session.snapshot(session.spec(str(self.source)))

        record = build_source_record(snapshot, policy="review")

        self.assertEqual(record["provider"], "local")
        self.assertEqual(record["content_mode"], "directory")
        self.assertNotIn("source_name", record)

    def test_metadata_noop_is_idempotent(self):
        self.import_alpha()

        result = set_metadata(
            self.repo,
            "alpha",
            description="中文说明",
            trigger="需要 alpha 时",
            recommendation=3,
        )

        self.assertEqual(result.changed, set())

    def test_metadata_rejects_unregistered_tag(self):
        self.import_alpha()

        with self.assertRaises(TaxonomyError):
            set_metadata(
                self.repo,
                "alpha",
                tags=["role/builder", "focus/not-registered"],
            )

    def test_rename_updates_active_and_dependencies(self):
        self.import_alpha()
        self.repo.write_active(["alpha"])
        self.repo.set_source_record(
            "alpha",
            {
                "provider": "http",
                "locator": {"url": "https://example.com/alpha/SKILL.md"},
                "content_mode": "skill_file",
                "policy": "review",
                "resolved": {
                    "revision": None,
                    "content_sha256": Repository.hash_file(
                        self.repo.require_skill("alpha").path / "SKILL.md"
                    ),
                },
            },
        )
        beta_source = self.root / "skills/web/beta"
        beta_source.mkdir(parents=True)
        (beta_source / "SKILL.md").write_text(
            "---\nname: beta\ndescription: Beta\n---\n", encoding="utf-8"
        )
        metadata = self.repo.read_metadata()
        metadata["skills"]["beta"] = {
            "description": "Beta",
            "trigger": "",
            "recommendation": 3,
            "dependencies": ["alpha"],
            "tags": DEFAULT_TAGS,
        }
        self.repo.write_metadata(metadata)
        self.repo.refresh()

        rename_skill(self.repo, "alpha", "alpha-new")

        self.assertIn("alpha-new", self.repo.inventory())
        self.assertEqual(self.repo.read_active(), ["alpha-new"])
        self.assertEqual(
            self.repo.metadata_record("beta")["dependencies"],
            ["skill:standalone/alpha-new"],
        )
        self.assertEqual(self.repo.source_record("alpha-new")["source_name"], "alpha")

    def test_move_and_remove(self):
        self.import_alpha()

        move_skill(self.repo, "alpha", "web")
        self.assertEqual(self.repo.require_skill("alpha").category, "web")

        remove_skill(self.repo, "alpha")
        self.assertNotIn("alpha", self.repo.inventory())
        self.assertIsNone(self.repo.metadata_record("alpha"))

    def test_single_file_source_update_preserves_skill_attachments(self):
        self.import_alpha()
        destination = self.repo.require_skill("alpha").path
        references = destination / "references"
        references.mkdir()
        (references / "keep.md").write_text("keep\n", encoding="utf-8")
        staged = self.root / "updated"
        staged.mkdir()
        (staged / "SKILL.md").write_text(
            "---\nname: alpha\ndescription: Updated upstream\n---\n",
            encoding="utf-8",
        )
        snapshot = SkillSnapshot(
            path=staged,
            declared_name="alpha",
            description="Updated upstream",
            content_sha256=Repository.hash_file(staged / "SKILL.md"),
            content_mode=ContentMode.SKILL_FILE,
            revision='"next"',
            spec=SourceSpec(
                provider="http",
                locator={"url": "https://example.com/alpha/SKILL.md"},
            ),
        )
        self.repo.set_source_record(
            "alpha",
            {
                "provider": "http",
                "locator": snapshot.spec.locator,
                "content_mode": "skill_file",
                "policy": "review",
                "resolved": {
                    "revision": None,
                    "content_sha256": Repository.hash_file(destination / "SKILL.md"),
                },
            },
        )

        update_from_source(self.repo, "alpha", snapshot)

        self.assertTrue((references / "keep.md").is_file())
        self.assertIn(
            "Updated upstream",
            (destination / "SKILL.md").read_text(encoding="utf-8"),
        )
        self.assertNotIn("source_name", self.repo.source_record("alpha"))


if __name__ == "__main__":
    unittest.main()
