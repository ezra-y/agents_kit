import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from scripts.agents_kit import ui
from scripts.agents_kit.repository import Repository
from tests.support import metadata_catalog, taxonomy_config


class UiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "agents-kit.json").write_text(
            json.dumps(
                {
                    **taxonomy_config(["tools"]),
                    "install_targets": {"global": [], "project": []},
                    "mcp_install_targets": {"global": []},
                    "defaults": {
                        "source_policy": "review",
                        "network_timeout_seconds": 60,
                    },
                }
            ),
            encoding="utf-8",
        )
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
        skill = self.root / "skills/tools/alpha"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(
            "---\nname: alpha\ndescription: Alpha\n---\n", encoding="utf-8"
        )
        self.html = self.root / "docs/index.html"
        self.html.parent.mkdir()
        self.html.write_text("<!doctype html><title>Catalog</title>", encoding="utf-8")
        self.repo = Repository(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_open_skill_uses_finder_without_a_shell(self):
        with (
            patch.object(ui.sys, "platform", "darwin"),
            patch.object(ui.subprocess, "run") as run,
        ):
            result = ui.open_skill(self.repo, "alpha")

        run.assert_called_once_with(
            ["/usr/bin/open", str(self.repo.root / "skills/tools/alpha")], check=True
        )
        self.assertTrue(result["opened"])

    def test_server_serves_catalog_and_routes_known_skill(self):
        server = ui.create_server(self.repo, self.html)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            with urllib.request.urlopen(base + "/") as response:
                self.assertIn(b"Catalog", response.read())
            with urllib.request.urlopen(
                base + "/skills/tools/alpha/SKILL.md"
            ) as response:
                self.assertIn(b"name: alpha", response.read())
            with self.assertRaises(urllib.error.HTTPError) as escaped:
                urllib.request.urlopen(base + "/skills/%2e%2e/metadata.json")
            self.assertEqual(escaped.exception.code, 404)

            request = urllib.request.Request(
                base + "/api/skills/alpha/open",
                method="POST",
                headers={"X-Agents-Kit-UI": "1"},
            )
            with (
                patch.object(
                    ui,
                    "open_skill",
                    return_value={
                        "skill": "alpha",
                        "path": str(self.root / "skills/tools/alpha"),
                        "opened": True,
                        "command": ["/usr/bin/open"],
                    },
                ) as opener,
                urllib.request.urlopen(request) as response,
            ):
                payload = json.loads(response.read())

            opener.assert_called_once_with(self.repo, "alpha")
            self.assertTrue(payload["ok"])

            blocked = urllib.request.Request(
                base + "/api/skills/alpha/open", method="POST"
            )
            with self.assertRaises(urllib.error.HTTPError) as forbidden:
                urllib.request.urlopen(blocked)
            self.assertEqual(forbidden.exception.code, 403)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
