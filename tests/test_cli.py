import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

LAUNCHER = Path(__file__).resolve().parents[1] / "scripts" / "agents-kit"


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        config = {
            "schema_version": 1,
            "categories": ["tools"],
            "install_targets": {
                "global": [
                    {
                        "id": "agents",
                        "path": str(self.root / "home/skills"),
                        "mode": "symlink",
                    }
                ],
                "project": [
                    {
                        "id": "claude",
                        "path": ".claude/skills",
                        "mode": "copy",
                    }
                ],
            },
            "defaults": {"source_policy": "review", "network_timeout_seconds": 60},
        }
        (self.root / "agents-kit.json").write_text(json.dumps(config), encoding="utf-8")
        (self.root / "skills").mkdir()
        (self.root / "active.txt").write_text("", encoding="utf-8")
        (self.root / "sources.json").write_text(
            json.dumps({"schema_version": 2, "skills": {}}), encoding="utf-8"
        )
        (self.root / "metadata.json").write_text(
            json.dumps({"skills": {}}), encoding="utf-8"
        )
        self.source = self.root / "source"
        self.source.mkdir()
        (self.source / "SKILL.md").write_text(
            "---\nname: alpha\ndescription: Alpha\n---\n", encoding="utf-8"
        )

    def tearDown(self):
        self.temp.cleanup()

    def run_cli(self, *args, check=True):
        env = {**os.environ, "AGENTS_KIT_HOME": str(self.root)}
        result = subprocess.run(
            [str(LAUNCHER), *args],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        if check and result.returncode:
            self.fail(result.stderr or result.stdout)
        return result

    def test_one_command_local_import_and_status(self):
        result = self.run_cli(
            "skill",
            "import",
            str(self.source),
            "--category",
            "tools",
            "--scope",
            "global",
            "--description",
            "中文说明",
            "--trigger",
            "需要时",
            "--json",
        )
        payload = json.loads(result.stdout)

        self.assertEqual(payload["details"]["skill"], "alpha")
        self.assertTrue((self.root / "skills/tools/alpha/SKILL.md").is_file())
        self.assertTrue((self.root / "home/skills/alpha").is_symlink())
        self.assertTrue((self.root / "build/docs/index.html").is_file())

        status = json.loads(self.run_cli("status", "--json").stdout)
        self.assertEqual(status["skills"], 1)
        self.assertEqual(status["active"], 1)

    def test_remove_requires_yes_in_noninteractive_mode(self):
        self.run_cli(
            "skill",
            "import",
            str(self.source),
            "--category",
            "tools",
            "--scope",
            "library",
            "--description",
            "中文说明",
            "--json",
        )

        result = self.run_cli("skill", "remove", "alpha", "--json", check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--yes", json.loads(result.stdout)["error"])
        self.assertTrue((self.root / "skills/tools/alpha").is_dir())

    def test_repository_write_is_not_blocked_by_unrelated_global_conflict(self):
        self.run_cli(
            "skill",
            "import",
            str(self.source),
            "--category",
            "tools",
            "--scope",
            "library",
            "--description",
            "中文说明",
            "--json",
        )
        (self.root / "active.txt").write_text("alpha\n", encoding="utf-8")
        conflict = self.root / "home/skills/alpha"
        conflict.mkdir(parents=True)

        result = self.run_cli(
            "skill",
            "metadata",
            "set",
            "alpha",
            "--trigger",
            "新的触发方式",
            "--json",
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(
            json.loads((self.root / "metadata.json").read_text())["skills"]["alpha"][
                "trigger"
            ],
            "新的触发方式",
        )
        check = self.run_cli("check", "--json", check=False)
        self.assertNotEqual(check.returncode, 0)

    def test_project_import_validates_destination_before_repository_write(self):
        result = self.run_cli(
            "skill",
            "import",
            str(self.source),
            "--category",
            "tools",
            "--scope",
            "project",
            "--project",
            str(self.root / "missing-project"),
            "--description",
            "中文说明",
            "--json",
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "skills/tools/alpha").exists())


if __name__ == "__main__":
    unittest.main()
