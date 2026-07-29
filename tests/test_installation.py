import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.agents_kit.installation import (
    InstallationError,
    apply_global,
    enable_global,
    install_project,
)
from scripts.agents_kit.repository import Repository
from tests.support import metadata_catalog, taxonomy_config


class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.global_one = self.root / "home/claude"
        self.global_two = self.root / "home/agents"
        config = {
            **taxonomy_config(["tools"]),
            "install_targets": {
                "global": [
                    {
                        "id": "claude",
                        "path": str(self.global_one),
                        "mode": "symlink",
                    },
                    {
                        "id": "agents",
                        "path": str(self.global_two),
                        "mode": "symlink",
                    },
                ],
                "project": [
                    {
                        "id": "claude",
                        "path": ".claude/skills",
                        "mode": "copy",
                    }
                ],
            },
            "mcp_install_targets": {"global": []},
            "defaults": {"source_policy": "review", "network_timeout_seconds": 60},
        }
        (self.root / "agents-kit.json").write_text(json.dumps(config), encoding="utf-8")
        (self.root / "active.txt").write_text("", encoding="utf-8")
        (self.root / "sources.json").write_text(
            json.dumps({"schema_version": 2, "skills": {}}), encoding="utf-8"
        )
        metadata = metadata_catalog(
            {
                "alpha": {
                    "description": "Alpha",
                    "trigger": "",
                    "recommendation": 3,
                    "dependencies": ["beta"],
                },
                "beta": {
                    "description": "Beta",
                    "trigger": "",
                    "recommendation": 3,
                },
            }
        )
        (self.root / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
        (self.root / "mcps.json").write_text(
            json.dumps({"schema_version": 1, "servers": {}}), encoding="utf-8"
        )
        for name in ("alpha", "beta"):
            path = self.root / "skills/tools" / name
            path.mkdir(parents=True)
            (path / "SKILL.md").write_text(
                f"---\nname: {name}\ndescription: {name}\n---\n",
                encoding="utf-8",
            )
        self.repo = Repository(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_global_enable_apply_and_prune(self):
        enable_global(self.repo, "alpha")
        result = apply_global(self.repo)

        self.assertEqual(result.details["linked"], 2)
        self.assertEqual(
            (self.global_one / "alpha").resolve(), self.repo.require_skill("alpha").path
        )
        self.assertEqual(
            (self.global_two / "alpha").resolve(), self.repo.require_skill("alpha").path
        )

        self.repo.write_active([])
        result = apply_global(self.repo)
        self.assertEqual(result.details["unlinked"], 2)
        self.assertFalse((self.global_one / "alpha").exists())

    def test_global_apply_refuses_entity_directory(self):
        self.repo.write_active(["alpha"])
        conflict = self.global_one / "alpha"
        conflict.mkdir(parents=True)

        with self.assertRaises(InstallationError):
            apply_global(self.repo)

        self.assertTrue(conflict.is_dir())

    def test_global_apply_reports_non_active_repository_skill(self):
        conflict = self.global_one / "alpha"
        conflict.mkdir(parents=True)

        with self.assertRaises(InstallationError):
            apply_global(self.repo)

        self.assertTrue(conflict.is_dir())

    def test_project_install_expands_dependencies(self):
        project = self.root / "project"
        project.mkdir()

        result = install_project(self.repo, "alpha", project=project, dry_run=False)

        self.assertEqual(result.details["skills"], ["alpha", "beta"])
        self.assertTrue((project / ".claude/skills/alpha/SKILL.md").is_file())
        self.assertTrue((project / ".claude/skills/beta/SKILL.md").is_file())

    def test_project_install_refuses_overwrite(self):
        project = self.root / "project"
        target = project / ".claude/skills/alpha"
        target.mkdir(parents=True)
        (target / "user.txt").write_text("keep", encoding="utf-8")

        with self.assertRaises(InstallationError):
            install_project(self.repo, "alpha", project=project)

        self.assertEqual((target / "user.txt").read_text(), "keep")

    def test_project_replace_keeps_existing_content_if_staging_fails(self):
        project = self.root / "project"
        target = project / ".claude/skills/alpha"
        target.mkdir(parents=True)
        (target / "user.txt").write_text("keep", encoding="utf-8")

        with (
            patch(
                "scripts.agents_kit.installation.shutil.copytree",
                side_effect=OSError("copy failed"),
            ),
            self.assertRaises(OSError),
        ):
            install_project(
                self.repo,
                "alpha",
                project=project,
                replace=True,
            )

        self.assertEqual((target / "user.txt").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
