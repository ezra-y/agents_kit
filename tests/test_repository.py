import json
import tempfile
import unittest
from pathlib import Path

from scripts.agents_kit.repository import Repository, RepositoryError

CONFIG = {
    "schema_version": 1,
    "categories": ["tools", "web"],
    "install_targets": {
        "global": [{"id": "agents", "path": "~/.agents/skills", "mode": "symlink"}],
        "project": [{"id": "claude", "path": ".claude/skills", "mode": "copy"}],
    },
    "defaults": {"source_policy": "review", "network_timeout_seconds": 60},
}


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "skills" / "tools" / "alpha").mkdir(parents=True)
        (self.root / "skills" / "tools" / "alpha" / "SKILL.md").write_text(
            "---\nname: alpha\ndescription: test\n---\n", encoding="utf-8"
        )
        (self.root / "agents-kit.json").write_text(json.dumps(CONFIG), encoding="utf-8")
        (self.root / "active.txt").write_text("alpha\n", encoding="utf-8")
        (self.root / "sources.json").write_text(
            json.dumps({"skills": {}}), encoding="utf-8"
        )
        (self.root / "metadata.json").write_text(
            json.dumps(
                {
                    "skills": {
                        "alpha": {
                            "description": "Alpha",
                            "trigger": "",
                            "recommendation": 3,
                        }
                    }
                }
            ),
            encoding="utf-8",
        )
        self.repo = Repository(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_inventory_stops_at_skill_root(self):
        nested = self.root / "skills" / "tools" / "alpha" / "example"
        nested.mkdir()
        (nested / "SKILL.md").write_text("---\n", encoding="utf-8")

        inventory = self.repo.inventory()

        self.assertEqual(list(inventory), ["alpha"])

    def test_write_if_changed_is_idempotent(self):
        path = self.root / "sample.txt"
        self.assertTrue(self.repo.write_text_if_changed(path, "same\n"))
        first_mtime = path.stat().st_mtime_ns
        self.assertFalse(self.repo.write_text_if_changed(path, "same\n"))
        self.assertEqual(path.stat().st_mtime_ns, first_mtime)

    def test_duplicate_skill_names_fail(self):
        duplicate = self.root / "skills" / "web" / "alpha"
        duplicate.mkdir(parents=True)
        (duplicate / "SKILL.md").write_text("---\n", encoding="utf-8")

        with self.assertRaises(RepositoryError):
            self.repo.inventory(refresh=True)


if __name__ == "__main__":
    unittest.main()
