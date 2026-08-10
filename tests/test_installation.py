import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.agents_kit.installation import (
    InstallationError,
    apply_global,
    enable_global,
    global_plan,
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
        change = enable_global(self.repo, "alpha")
        self.assertEqual(change.details["dependencies"], ["beta"])
        result = apply_global(self.repo)

        # alpha 及其依赖 beta，各链到 2 个目标
        self.assertEqual(result.details["linked"], 4)
        self.assertEqual(
            (self.global_one / "alpha").resolve(), self.repo.require_skill("alpha").path
        )
        self.assertEqual(
            (self.global_two / "beta").resolve(), self.repo.require_skill("beta").path
        )

        # 停用 alpha 后，没人需要 beta，依赖链接一并回收
        self.repo.write_active([])
        result = apply_global(self.repo)
        self.assertEqual(result.details["unlinked"], 4)
        self.assertFalse((self.global_one / "alpha").exists())
        self.assertFalse((self.global_one / "beta").exists())

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

    def test_global_apply_records_partial_target_execution(self):
        link = self.global_one / "alpha"
        plan = {
            "missing": [],
            "conflicts": [],
            "actions": [
                {
                    "action": "link",
                    "kind": "skill",
                    "platform": "claude",
                    "ref": "skill:standalone/alpha",
                    "target": str(link),
                    "source": str(self.repo.require_skill("alpha").path),
                }
            ],
            "marketplace_actions": [
                {
                    "action": "plugin_add",
                    "platform": "codex",
                    "plugin": "example-plugin",
                    "marketplace": "agents-kit",
                    "command": ["codex", "plugin", "add", "example-plugin"],
                }
            ],
            "desired_plugins_by_target": {
                "claude": [],
                "codex": ["example-plugin"],
            },
        }
        state_home = self.root / "state"
        with (
            patch(
                "scripts.agents_kit.installation.global_plan",
                return_value=plan,
            ),
            patch(
                "scripts.agents_kit.installation._execute_marketplace_action",
                side_effect=InstallationError("codex failed"),
            ),
            patch.dict(
                os.environ,
                {"AGENTS_KIT_STATE_HOME": str(state_home)},
            ),
            self.assertRaisesRegex(InstallationError, "codex failed"),
        ):
            apply_global(self.repo)

        self.assertTrue(link.is_symlink())
        receipt = json.loads(
            (state_home / "agents-kit/receipts.json").read_text(encoding="utf-8")
        )
        self.assertEqual(receipt["schema_version"], 2)
        self.assertEqual(receipt["execution"]["status"], "partial")
        self.assertEqual(
            receipt["execution"]["targets"]["claude"]["status"],
            "complete",
        )
        self.assertEqual(
            receipt["execution"]["targets"]["codex"]["status"],
            "failed",
        )

    def test_global_plan_expands_dependencies_from_hand_edited_active(self):
        # 直接手改 active.txt（不经过 enable）也必须得到依赖
        self.repo.write_active(["alpha"])
        plan = global_plan(self.repo)
        self.assertEqual(plan["explicit"], ["alpha"])
        self.assertEqual(plan["dependencies"], ["beta"])
        self.assertIn("beta", plan["wanted"])

    def test_global_plan_reports_missing_dependency(self):
        metadata = self.repo.read_metadata()
        metadata["skills"]["alpha"]["dependencies"] = ["ghost"]
        self.repo.write_metadata(metadata)
        self.repo.write_active(["alpha"])
        plan = global_plan(self.repo)
        self.assertIn("ghost", plan["missing"])
        with self.assertRaises(InstallationError):
            apply_global(self.repo)

    def test_global_plan_detects_dependency_cycle(self):
        metadata = self.repo.read_metadata()
        metadata["skills"]["alpha"]["dependencies"] = ["beta"]
        metadata["skills"]["beta"]["dependencies"] = ["alpha"]
        self.repo.write_metadata(metadata)
        self.repo.write_active(["alpha"])
        with self.assertRaises(InstallationError):
            global_plan(self.repo)

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
