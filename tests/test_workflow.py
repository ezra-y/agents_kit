import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SYNC_WORKFLOW = ROOT / ".github/workflows/sync.yml"


class WorkflowTests(unittest.TestCase):
    def test_sync_stages_every_plugin_state_root(self):
        workflow = SYNC_WORKFLOW.read_text(encoding="utf-8")

        for path in (
            "skills/",
            "plugins/",
            "sources.json",
            "metadata.json",
            "desired-installations.json",
            ".claude-plugin/",
            ".agents/",
            "docs/",
        ):
            self.assertIn(path, workflow)
        self.assertIn("git diff --cached --check", workflow)
        self.assertIn("scripts/agents-kit check --repo-only", workflow)

    def test_verify_checks_all_generated_docs_and_plugin_tests(self):
        workflow = SYNC_WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("git diff --exit-code -- 'docs/*.md'", workflow)
        self.assertIn(
            "plugins/ai-speaking-coach/skills/ai-speaking-coach",
            workflow,
        )
        self.assertIn("plugins/ai-speaking-coach", workflow)


if __name__ == "__main__":
    unittest.main()
