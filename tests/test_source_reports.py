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
                    "reasons": [
                        "low_content_similarity",
                        "content_change_too_large",
                    ],
                    "similarity": 0.95,
                    "content_similarity": 0.72,
                    "changed_lines": 840,
                    "added_paths": ["references/new.md"],
                    "removed_paths": [],
                    "changed_files": [
                        {
                            "path": "references/guide.md",
                            "added_lines": 700,
                            "deleted_lines": 140,
                            "changed_lines": 840,
                            "similarity": 0.4,
                            "status": "modified",
                        }
                    ],
                    "validation_problems": [
                        "beta: Markdown 链接目标不存在 references/missing.md"
                    ],
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
        self.assertIn("全部内容变化较大", markdown)
        self.assertIn("变化超过 500 行", markdown)
        self.assertIn(
            "https://github.com/example/skills/tree/abc123/skills/beta",
            markdown,
        )
        self.assertIn("`references/guide.md`：+700 / -140", markdown)
        self.assertIn("Markdown 链接目标不存在", markdown)
        self.assertIn("```diff", markdown)
        self.assertIn("agents-kit source update beta --yes", markdown)


if __name__ == "__main__":
    unittest.main()
