import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.agents_kit import mcps
from scripts.agents_kit.repository import Repository
from tests.support import metadata_catalog, taxonomy_config


class McpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        config = {
            **taxonomy_config(["tools"]),
            "install_targets": {"global": [], "project": []},
            "mcp_install_targets": {"global": [{"id": "codex"}, {"id": "claude"}]},
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
        self.repo = Repository(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def record(self):
        return {
            "description": "测试 MCP",
            "tags": ["开发"],
            "recommendation": 4,
            "source": {"url": "https://example.com/mcp", "policy": "review"},
            "distribution": {
                "type": "npm",
                "package": "example-mcp",
                "version": "1.2.3",
            },
            "runtime": {
                "command": "/usr/bin/printf",
                "args": ["{package}@{version}"],
            },
            "environment": {
                "TEST_TOKEN": {
                    "required": True,
                    "source": {
                        "type": "command",
                        "argv": ["/usr/bin/printf", "secret"],
                    },
                }
            },
            "targets": ["codex", "claude"],
            "enabled": False,
        }

    def test_import_and_runtime_are_driven_by_catalog(self):
        change = mcps.import_server(self.repo, "example", self.record())

        self.assertEqual(change.changed, {"mcps.json"})
        argv, environment = mcps.runtime_spec(self.repo, "example")
        self.assertEqual(argv[1], "example-mcp@1.2.3")
        self.assertEqual(environment["TEST_TOKEN"], "secret")

    def test_invalid_target_is_rejected(self):
        record = self.record()
        record["targets"] = ["unknown"]

        with self.assertRaises(mcps.McpError):
            mcps.import_server(self.repo, "example", record)

    def test_disabling_keeps_record(self):
        record = self.record()
        record["enabled"] = True
        mcps.import_server(self.repo, "example", record)

        mcps.set_enabled(self.repo, "example", False)

        self.assertFalse(mcps.show_server(self.repo, "example")["enabled"])

    def test_apply_does_not_install_disabled_server_runtime(self):
        mcps.import_server(self.repo, "example", self.record())

        with (
            mock.patch.object(mcps, "ensure_distribution") as ensure,
            mock.patch.object(
                mcps,
                "_target_state",
                return_value={"exists": False, "managed": False},
            ),
        ):
            mcps.apply(self.repo, ["example"])

        ensure.assert_not_called()

    def test_remove_from_explicit_targets_only_removes_managed_entries(self):
        with (
            mock.patch.object(
                mcps,
                "_target_state",
                side_effect=[
                    {"exists": True, "managed": True},
                    {"exists": True, "managed": False},
                ],
            ),
            mock.patch.object(mcps, "_remove_target") as remove,
        ):
            result = mcps.remove_from_targets(
                self.repo,
                "example",
                targets=["codex", "claude"],
            )

        self.assertEqual(
            result["actions"],
            [{"target": "codex", "mcp": "example", "action": "remove"}],
        )
        remove.assert_called_once_with("codex", "example")

    def test_user_config_check_is_passive_and_uses_exact_command(self):
        home = self.root / "config"
        home.mkdir()
        launcher = str(self.repo.root / "scripts/agents-kit")
        (home / ".claude.json").write_text(
            json.dumps(
                {
                    "mcpServers": {
                        "example": {
                            "command": launcher,
                            "args": ["mcp", "run", "example"],
                        }
                    }
                }
            )
        )
        with (
            mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(home)}),
            mock.patch.object(mcps.subprocess, "run") as run,
        ):
            state = mcps._target_state(self.repo, "claude", "example")
        self.assertEqual(state, {"exists": True, "managed": True, "enabled": True})
        run.assert_not_called()
        (home / ".claude.json").write_text("not JSON")
        with (
            mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(home)}),
            self.assertRaises(mcps.McpError),
        ):
            mcps._target_state(self.repo, "claude", "example")

    def test_codex_user_scope_preserves_disabled_state(self):
        home = self.root / "codex"
        home.mkdir()
        (home / "config.toml").write_text(
            "[mcp_servers.example]\ncommand = "
            + json.dumps(str(self.repo.root / "scripts/agents-kit"))
            + '\nargs = ["mcp", "run", "example"]\nenabled = false\n'
        )
        with (
            mock.patch.dict(os.environ, {"CODEX_HOME": str(home)}),
            mock.patch.object(mcps.subprocess, "run") as run,
        ):
            state = mcps._target_state(self.repo, "codex", "example")
        self.assertTrue(state["managed"])
        self.assertFalse(state["enabled"])
        run.assert_not_called()

    def test_batch_conflict_causes_no_install_or_client_mutation(self):
        record = self.record()
        record["enabled"] = True
        mcps.import_server(self.repo, "example", record)
        with (
            mock.patch.object(
                mcps,
                "_target_state",
                side_effect=[
                    {"exists": False, "managed": False},
                    {"exists": True, "managed": False},
                ],
            ),
            mock.patch.object(mcps, "ensure_distribution") as install,
            mock.patch.object(mcps, "_add_target") as add,
            self.assertRaises(mcps.McpError),
        ):
            mcps.apply(self.repo)
        install.assert_not_called()
        add.assert_not_called()


if __name__ == "__main__":
    unittest.main()
