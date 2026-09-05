import unittest
from pathlib import Path

import yaml

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

    def test_verify_checks_existing_plugin_test_directories(self):
        workflow = SYNC_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("git diff --exit-code -- 'docs/*.md'", workflow)
        data = yaml.load(workflow, Loader=yaml.BaseLoader)
        directories = [
            ROOT / step["working-directory"]
            for job in data["jobs"].values()
            for step in job["steps"]
            if "working-directory" in step
        ]
        self.assertTrue(directories)
        for directory in directories:
            self.assertTrue(
                directory.is_dir(), f"Workflow directory missing: {directory}"
            )
            self.assertTrue((directory / "pyproject.toml").is_file())
            self.assertTrue((directory / "tests").is_dir())


if __name__ == "__main__":
    unittest.main()
