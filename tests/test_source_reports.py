import unittest

from scripts.agents_kit.source_reports import render_source_review_markdown


class SourceReportTests(unittest.TestCase):
    def test_markdown_report_contains_human_review_context(self):
        report = {
            "results": [
                {
                    "skill": "alpha",
                    "status": "safe_update",
                    "applied": True,
                    "changed_lines": 12,
                },
                {
                    "skill": "beta",
                    "status": "review_required",
                    "revision": "abc123",
                    "reasons": ["local_upstream_conflict"],
                    "similarity": 0.95,
                    "changed_lines": 12,
                    "skill_diff": [
                        "--- local/SKILL.md",
                        "+++ upstream/SKILL.md",
                        "@@ -1 +1 @@",
                        "-old",
                        "+new",
                    ],
                },
            ],
            "failures": [],
        }
        sources = {
            "beta": {
                "provider": "git",
                "locator": {
                    "url": "https://github.com/example/skills.git",
                    "ref": "main",
                    "path": "skills/beta",
                },
            }
        }

        markdown = render_source_review_markdown(
            report,
            sources,
            run_url="https://github.com/example/actions/runs/1",
        )

        self.assertIn("# 上游技能审核", markdown)
        self.assertIn("自动更新 | **1**", markdown)
        self.assertIn("待人工确认 | **1**", markdown)
        self.assertIn("本地与上游同时修改", markdown)
        self.assertIn("`SKILL.md` 12 行", markdown)
        self.assertIn(
            "https://github.com/example/skills/tree/abc123/skills/beta",
            markdown,
        )
        self.assertIn("```diff", markdown)
        self.assertIn("agents-kit source check beta --json", markdown)
        self.assertNotIn("agents-kit source update beta --yes", markdown)


if __name__ == "__main__":
    unittest.main()
