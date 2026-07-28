import json
import tempfile
import unittest
from pathlib import Path

from scripts.agents_kit import checks, docs
from scripts.agents_kit.repository import Repository


class DocsAndChecksTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        config = {
            "schema_version": 1,
            "categories": ["tools"],
            "install_targets": {"global": [], "project": []},
            "defaults": {"source_policy": "review", "network_timeout_seconds": 60},
        }
        (self.root / "agents-kit.json").write_text(json.dumps(config), encoding="utf-8")
        (self.root / "active.txt").write_text("alpha\n", encoding="utf-8")
        skill = self.root / "skills/tools/alpha"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(
            "---\nname: alpha\ndescription: Alpha upstream\n---\n\n# Alpha\n",
            encoding="utf-8",
        )
        (self.root / "sources.json").write_text(
            json.dumps(
                {
                    "schema_version": 2,
                    "skills": {
                        "alpha": {
                            "provider": "http",
                            "locator": {"url": "https://example.com/alpha/SKILL.md"},
                            "content_mode": "skill_file",
                            "policy": "review",
                            "resolved": {
                                "revision": None,
                                "content_sha256": Repository.hash_file(
                                    skill / "SKILL.md"
                                ),
                            },
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        (self.root / "metadata.json").write_text(
            json.dumps(
                {
                    "skills": {
                        "alpha": {
                            "description": "中文说明",
                            "trigger": "需要时",
                            "recommendation": 3,
                        }
                    }
                }
            ),
            encoding="utf-8",
        )
        self.repo = Repository(self.root)
        self.help = "usage: agents-kit ..."

    def tearDown(self):
        self.temp.cleanup()

    def test_build_is_idempotent_and_html_is_untracked_path(self):
        first = docs.build(self.repo, command_help=self.help)
        second = docs.build(self.repo, command_help=self.help)

        self.assertIn("docs/skills.md", first["changed"])
        self.assertIn("build/docs/index.html", first["changed"])
        self.assertEqual(second["changed"], [])
        self.assertTrue((self.root / "build/docs/index.html").is_file())
        self.assertFalse((self.root / "docs/index.html").exists())
        self.assertEqual(docs.check(self.repo, command_help=self.help), [])

    def test_checks_use_docs_renderer_to_find_stale_files(self):
        docs.build(self.repo, command_help=self.help)
        metadata = self.repo.read_metadata()
        metadata["skills"]["alpha"]["description"] = "改过但没生成"
        self.repo.write_metadata(metadata)

        report = checks.run(self.repo, command_help=self.help, repo_only=True)

        self.assertFalse(report.ok)
        self.assertTrue(any("生成文档已过期" in problem for problem in report.problems))

    def test_clean_repository_passes_repo_only_checks(self):
        docs.build(self.repo, command_help=self.help)

        report = checks.run(self.repo, command_help=self.help, repo_only=True)

        self.assertTrue(report.ok, report.problems)

    def test_missing_skill_attachment_is_reported(self):
        skill = self.root / "skills/tools/alpha/SKILL.md"
        skill.write_text(
            skill.read_text(encoding="utf-8") + "\n[missing](references/missing.md)\n",
            encoding="utf-8",
        )

        report = checks.run(self.repo, command_help=self.help, repo_only=True)

        self.assertTrue(
            any("Markdown 链接目标不存在" in problem for problem in report.problems)
        )


if __name__ == "__main__":
    unittest.main()
