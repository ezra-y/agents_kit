import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.support import metadata_catalog, taxonomy_config

LAUNCHER = Path(__file__).resolve().parents[1] / "scripts" / "agents-kit"


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        config = {
            **taxonomy_config(["tools"]),
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
            "mcp_install_targets": {"global": []},
            "defaults": {"source_policy": "review", "network_timeout_seconds": 60},
        }
        (self.root / "agents-kit.json").write_text(json.dumps(config), encoding="utf-8")
        (self.root / "skills").mkdir()
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
            "--tag",
            "role/builder",
            "--tag",
            "focus/example",
            "--json",
        )
        payload = json.loads(result.stdout)

        self.assertEqual(payload["details"]["skill"], "alpha")
        self.assertTrue((self.root / "skills/tools/alpha/SKILL.md").is_file())
        self.assertTrue((self.root / "home/skills/alpha").is_symlink())
        self.assertTrue((self.root / "docs/index.html").is_file())

        status = json.loads(self.run_cli("status", "--json").stdout)
        self.assertEqual(status["skills"], 1)
        self.assertEqual(status["active"], 1)
        filtered = json.loads(
            self.run_cli("skill", "list", "--tag", "focus/example", "--json").stdout
        )
        self.assertEqual(filtered["count"], 1)

        opened = json.loads(
            self.run_cli("skill", "open", "alpha", "--dry-run", "--json").stdout
        )
        self.assertEqual(opened["skill"], "alpha")
        self.assertFalse(opened["opened"])

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
            "--tag",
            "role/builder",
            "--tag",
            "focus/example",
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
            "--tag",
            "role/builder",
            "--tag",
            "focus/example",
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
            "--tag",
            "role/builder",
            "--tag",
            "focus/example",
            "--json",
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "skills/tools/alpha").exists())

    def test_one_command_mcp_library_import(self):
        result = self.run_cli(
            "mcp",
            "import",
            "https://github.com/upstash/context7",
            "--name",
            "context7",
            "--description",
            "查询最新开发文档",
            "--tag",
            "开发",
            "--distribution",
            "npm",
            "--package",
            "@upstash/context7-mcp",
            "--version",
            "3.2.5",
            "--command",
            "npx",
            "--arg=-y",
            "--arg={package}@{version}",
            "--scope",
            "library",
            "--json",
        )
        payload = json.loads(result.stdout)

        self.assertEqual(payload["details"]["mcp"], "context7")
        catalog = json.loads((self.root / "mcps.json").read_text())
        self.assertEqual(
            catalog["servers"]["context7"]["distribution"]["version"], "3.2.5"
        )
        self.assertFalse(catalog["servers"]["context7"]["enabled"])
        self.assertTrue((self.root / "docs/mcps.md").is_file())


if __name__ == "__main__":
    unittest.main()
