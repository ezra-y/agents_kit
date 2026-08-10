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

    def commit_source(self, message):
        subprocess.run(["git", "-C", str(self.source), "add", "."], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(self.source),
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-qm",
                message,
            ],
            check=True,
        )

    def import_git_source(self, *, reference_text=None):
        subprocess.run(["git", "init", "-q", str(self.source)], check=True)
        (self.source / "SKILL.md").write_text(
            "---\n"
            "name: alpha\n"
            "description: Alpha\n"
            "---\n\n"
            "# Alpha\n\n" + "\n".join(f"Rule {index}" for index in range(1, 21)) + "\n",
            encoding="utf-8",
        )
        if reference_text is not None:
            reference = self.source / "references/guide.md"
            reference.parent.mkdir()
            reference.write_text(reference_text, encoding="utf-8")
        self.commit_source("initial")
        self.run_cli(
            "skill",
            "import",
            self.source.as_uri(),
            "--provider",
            "git",
            "--category",
            "tools",
            "--scope",
            "library",
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

    def test_source_check_classifies_skill_change_as_instructional_review(self):
        self.import_git_source()
        with (self.source / "SKILL.md").open("a", encoding="utf-8") as handle:
            handle.write("Rule 21\n")
        self.commit_source("small update")

        payload = json.loads(self.run_cli("source", "check", "alpha", "--json").stdout)

        result = payload["results"][0]
        self.assertEqual(result["status"], "review_required")
        self.assertEqual(result["merge_state"], "upstream_only")
        self.assertEqual(result["risk_class"], "instructional")
        self.assertEqual(result["decision"], "review_required")
        self.assertTrue(any("+Rule 21" in line for line in result["skill_diff"]))

    def test_source_check_requires_review_for_invalid_candidate(self):
        self.import_git_source()
        with (self.source / "SKILL.md").open("a", encoding="utf-8") as handle:
            handle.write("[missing](references/missing.md)\n")
        self.commit_source("broken link")

        payload = json.loads(self.run_cli("source", "check", "alpha", "--json").stdout)

        result = payload["results"][0]
        self.assertEqual(result["status"], "review_required")
        self.assertIn("candidate_validation_failed", result["reasons"])
        self.assertTrue(
            any(
                "Markdown 链接目标不存在" in problem
                for problem in result["validation_problems"]
            )
        )

    def test_source_check_requires_review_for_unknown_attachment_rewrite(self):
        self.import_git_source(
            reference_text="\n".join(
                f"Original reference {index}" for index in range(1, 21)
            )
            + "\n"
        )
        (self.source / "references/guide.md").write_text(
            "\n".join(f"New reference {index}" for index in range(1, 1001)) + "\n",
            encoding="utf-8",
        )
        self.commit_source("rewrite attachment")

        payload = json.loads(self.run_cli("source", "check", "alpha", "--json").stdout)

        result = payload["results"][0]
        self.assertEqual(result["status"], "review_required")
        self.assertEqual(result["risk_class"], "unknown")
        self.assertEqual(result["reasons"], [])

    def test_source_update_safe_does_not_apply_instruction_change(self):
        self.import_git_source()
        with (self.source / "SKILL.md").open("a", encoding="utf-8") as handle:
            handle.write("Rule 21\n")
        self.commit_source("small update")

        payload = json.loads(
            self.run_cli(
                "source",
                "update",
                "alpha",
                "--safe",
                "--yes",
                "--json",
            ).stdout
        )

        self.assertEqual(payload["results"][0]["status"], "review_required")
        self.assertFalse(payload["results"][0]["applied"])
        self.assertNotIn(
            "Rule 21",
            (self.root / "skills/tools/alpha/SKILL.md").read_text(encoding="utf-8"),
        )

    def test_source_update_safe_does_not_apply_binary_tree(self):
        self.import_git_source(reference_text="Unique reference\n")
        (self.source / "references/guide.md").unlink()
        (self.source / "references").rmdir()
        (self.source / "payload.bin").write_bytes(b"\xff\xfe\x00\x01")
        self.commit_source("replace source tree")

        payload = json.loads(
            self.run_cli(
                "source",
                "update",
                "alpha",
                "--safe",
                "--yes",
                "--json",
            ).stdout
        )

        result = payload["results"][0]
        self.assertEqual(result["status"], "review_required")
        self.assertEqual(result["risk_class"], "binary")
        self.assertFalse(result["applied"])
        self.assertTrue((self.root / "skills/tools/alpha/references/guide.md").exists())
        self.assertFalse((self.root / "skills/tools/alpha/payload.bin").is_file())

    def test_source_update_auto_docs_applies_readme_only_change(self):
        self.import_git_source()
        (self.source / "README.md").write_text("Upstream docs\n", encoding="utf-8")
        self.commit_source("docs update")

        payload = json.loads(
            self.run_cli(
                "source",
                "update",
                "alpha",
                "--auto-docs",
                "--yes",
                "--json",
            ).stdout
        )

        result = payload["results"][0]
        self.assertEqual(result["merge_state"], "upstream_only")
        self.assertEqual(result["risk_class"], "docs_only")
        self.assertEqual(result["decision"], "auto_apply")
        self.assertTrue(result["applied"])
        self.assertTrue((self.root / "skills/tools/alpha/README.md").is_file())

    def test_source_check_ignores_local_only_change(self):
        self.import_git_source()
        local = self.root / "skills/tools/alpha/SKILL.md"
        with local.open("a", encoding="utf-8") as handle:
            handle.write("Local customization\n")

        payload = json.loads(self.run_cli("source", "check", "alpha", "--json").stdout)

        result = payload["results"][0]
        self.assertEqual(result["status"], "unchanged")
        self.assertTrue(result["local_modified"])
        self.run_cli("check", "--json")

    def test_source_update_safe_reports_local_upstream_conflict(self):
        self.import_git_source()
        local = self.root / "skills/tools/alpha/SKILL.md"
        with local.open("a", encoding="utf-8") as handle:
            handle.write("Local customization\n")
        with (self.source / "SKILL.md").open("a", encoding="utf-8") as handle:
            handle.write("Upstream update\n")
        self.commit_source("upstream update")

        payload = json.loads(
            self.run_cli(
                "source",
                "update",
                "alpha",
                "--safe",
                "--yes",
                "--json",
            ).stdout
        )

        result = payload["results"][0]
        self.assertEqual(result["status"], "review_required")
        self.assertEqual(result["reasons"], ["local_upstream_conflict"])
        self.assertFalse(result["applied"])
        self.assertIn("Local customization", local.read_text(encoding="utf-8"))

    def test_source_report_renders_markdown(self):
        report = self.root / "source-check.json"
        report.write_text(
            json.dumps(
                {
                    "results": [
                        {
                            "skill": "alpha",
                            "status": "review_required",
                            "reasons": ["local_upstream_conflict"],
                            "changed_lines": 2,
                        }
                    ],
                    "failures": [],
                }
            ),
            encoding="utf-8",
        )

        result = self.run_cli(
            "source",
            "report",
            str(report),
            "--run-url",
            "https://example.com/run",
        )

        self.assertIn("# 上游技能审核", result.stdout)
        self.assertIn("本地与上游同时修改", result.stdout)
        self.assertIn("https://example.com/run", result.stdout)

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
            json.loads((self.root / "metadata.json").read_text())["skills"][
                "skill:standalone/alpha"
            ]["trigger"],
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
