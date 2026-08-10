import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.agents_kit import marketplace, plugins
from scripts.agents_kit.installation import (
    InstallationError,
    apply_global,
    enable_global,
    global_plan,
    validate_desired_installations,
)
from scripts.agents_kit.models import AssetRef, SourceSpec
from scripts.agents_kit.repository import Repository, RepositoryError
from tests.support import metadata_catalog, taxonomy_config


class PluginTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.global_skills = self.root / "home/skills"
        config = {
            **taxonomy_config(["tools"]),
            "install_targets": {
                "global": [
                    {
                        "id": "claude",
                        "platform": "claude",
                        "path": str(self.global_skills),
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
        (self.root / "active.txt").write_text("", encoding="utf-8")
        (self.root / "sources.json").write_text(
            json.dumps({"schema_version": 3, "skills": {}, "plugins": {}}),
            encoding="utf-8",
        )
        (self.root / "metadata.json").write_text(
            json.dumps(metadata_catalog({})), encoding="utf-8"
        )
        (self.root / "mcps.json").write_text(
            json.dumps({"schema_version": 1, "servers": {}}), encoding="utf-8"
        )
        (self.root / "skills").mkdir()
        self.upstream = self.root / "upstream/example-plugin"
        self._write_upstream_plugin()
        self.repo = Repository(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def _write_upstream_plugin(self):
        (self.upstream / ".claude-plugin").mkdir(parents=True)
        (self.upstream / ".claude-plugin/plugin.json").write_text(
            json.dumps(
                {
                    "name": "example-plugin",
                    "description": "Example plugin",
                }
            ),
            encoding="utf-8",
        )
        skill = self.upstream / "skills/review"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(
            "---\nname: review\ndescription: Review things\n---\n",
            encoding="utf-8",
        )
        future = self.upstream / "future-component"
        future.mkdir()
        (future / "data.txt").write_text("preserve me\n", encoding="utf-8")

    def _snapshot(self):
        return plugins.inspect_plugin_directory(
            self.upstream,
            revision="abc123",
            source_spec=SourceSpec(
                provider="git",
                locator={
                    "url": "https://example.com/plugins.git",
                    "path": "example-plugin",
                },
            ),
        )

    def test_import_preserves_full_tree_and_migrates_identical_skill(self):
        standalone = self.root / "skills/tools/review"
        standalone.mkdir(parents=True)
        (standalone / "SKILL.md").write_text(
            (self.upstream / "skills/review/SKILL.md").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        metadata = self.repo.read_metadata()
        metadata["skills"]["review"] = {
            "description": "Review",
            "trigger": "",
            "recommendation": 3,
            "tags": ["role/builder", "focus/example"],
        }
        self.repo.write_metadata(metadata)
        self.repo.refresh()

        result = plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude", "codex"),
            tags=["role/builder", "focus/example"],
        )

        self.assertIn("review", result.details["migrated_standalone_skills"])
        self.assertFalse(standalone.exists())
        plugin_root = self.root / "plugins/example-plugin"
        self.assertEqual(
            (plugin_root / "future-component/data.txt").read_text(),
            "preserve me\n",
        )
        sidecar = json.loads(
            (plugin_root / "agents-kit.plugin.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            sidecar["targets"]["claude"]["manifest"]["authority"], "upstream"
        )
        self.assertEqual(sidecar["targets"]["codex"]["manifest"]["authority"], "local")
        self.assertIn(
            "skill:plugin/example-plugin/review",
            self.repo.read_metadata()["skills"],
        )
        self.assertIn("example-plugin", self.repo.read_sources()["plugins"])

    def test_import_invalid_skill_metadata_leaves_repository_unchanged(self):
        (self.upstream / "skills/review/SKILL.md").write_text(
            "---\nname: review\n---\n",
            encoding="utf-8",
        )
        metadata_before = self.repo.metadata_path.read_bytes()
        sources_before = self.repo.sources_path.read_bytes()

        with self.assertRaisesRegex(plugins.PluginError, "description 为空"):
            plugins.import_plugin_snapshot(
                self.repo,
                self._snapshot(),
                category="tools",
                targets=("claude",),
                tags=["role/builder", "focus/example"],
            )

        self.assertFalse((self.root / "plugins/example-plugin").exists())
        self.assertEqual(self.repo.metadata_path.read_bytes(), metadata_before)
        self.assertEqual(self.repo.sources_path.read_bytes(), sources_before)

    def test_local_plugin_import_keeps_native_manifest_local(self):
        snapshot = plugins.inspect_plugin_directory(
            self.upstream,
            revision=None,
            source_spec=SourceSpec(
                provider="local",
                locator={"path": str(self.upstream)},
            ),
        )

        plugins.import_plugin_snapshot(
            self.repo,
            snapshot,
            category="tools",
            targets=("claude",),
            tags=["role/builder", "focus/example"],
        )

        sidecar = json.loads(
            (self.root / "plugins/example-plugin/agents-kit.plugin.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(sidecar["upstream_targets"], [])
        self.assertEqual(
            sidecar["targets"]["claude"]["manifest"]["authority"],
            "local",
        )
        self.assertIn(
            ".claude-plugin/plugin.json",
            sidecar["local_paths"],
        )
        self.assertNotIn("example-plugin", self.repo.read_sources()["plugins"])

    def test_same_local_skill_name_is_ambiguous_but_qualified_refs_work(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude",),
            tags=["role/builder", "focus/example"],
        )
        standalone = self.root / "skills/tools/review"
        standalone.mkdir(parents=True)
        (standalone / "SKILL.md").write_text(
            "---\nname: review\ndescription: Other review\n---\n",
            encoding="utf-8",
        )
        metadata = self.repo.read_metadata()
        metadata["skills"]["skill:standalone/review"] = {
            "description": "Other review",
            "trigger": "",
            "recommendation": 3,
            "tags": ["role/builder", "focus/example"],
        }
        self.repo.write_metadata(metadata)
        self.repo.refresh()

        with self.assertRaises(RepositoryError):
            self.repo.require_skill("review")
        self.assertEqual(
            self.repo.require_skill("skill:standalone/review").owner_kind,
            "standalone",
        )
        self.assertEqual(
            self.repo.require_skill("skill:plugin/example-plugin/review").owner_kind,
            "plugin",
        )

    def test_embedded_skill_defaults_to_plugin_only(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude",),
            tags=["role/builder", "focus/example"],
        )

        with self.assertRaises(InstallationError):
            enable_global(
                self.repo,
                "skill:plugin/example-plugin/review",
                target="claude",
            )

    def test_marketplace_build_does_not_rewrite_native_manifests(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude", "codex"),
            tags=["role/builder", "focus/example"],
        )
        plugin_root = self.root / "plugins/example-plugin"
        claude_manifest = plugin_root / ".claude-plugin/plugin.json"
        codex_manifest = plugin_root / ".codex-plugin/plugin.json"
        before = (claude_manifest.read_bytes(), codex_manifest.read_bytes())

        marketplace.build(self.repo)

        self.assertEqual(
            before,
            (claude_manifest.read_bytes(), codex_manifest.read_bytes()),
        )
        claude_index = json.loads(
            (self.root / ".claude-plugin/marketplace.json").read_text()
        )
        codex_index = json.loads(
            (self.root / ".agents/plugins/marketplace.json").read_text()
        )
        self.assertEqual(
            [item["name"] for item in claude_index["plugins"]],
            ["example-plugin"],
        )
        self.assertEqual(codex_index["plugins"], [])

    def test_codex_full_target_emits_required_marketplace_policy(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude", "codex"),
            tags=["role/builder", "focus/example"],
        )
        sidecar_path = self.root / "plugins/example-plugin/agents-kit.plugin.json"
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        sidecar["targets"]["codex"]["support"] = "full"
        sidecar["targets"]["codex"].pop("limitations", None)
        sidecar_path.write_text(json.dumps(sidecar), encoding="utf-8")
        self.repo.refresh()

        marketplace.build(self.repo)

        index = json.loads((self.root / ".agents/plugins/marketplace.json").read_text())
        entry = index["plugins"][0]
        self.assertEqual(entry["category"], "Developer Tools")
        self.assertEqual(entry["policy"]["installation"], "AVAILABLE")
        self.assertEqual(entry["policy"]["authentication"], "ON_INSTALL")
        self.assertEqual(
            entry["source"],
            {
                "source": "local",
                "path": "./plugins/example-plugin",
            },
        )

    def test_codex_probe_failure_stops_before_installation(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude", "codex"),
            tags=["role/builder", "focus/example"],
        )
        sidecar_path = self.root / "plugins/example-plugin/agents-kit.plugin.json"
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        sidecar["targets"]["codex"]["support"] = "full"
        sidecar["targets"]["codex"].pop("limitations", None)
        sidecar_path.write_text(json.dumps(sidecar), encoding="utf-8")
        desired = self.repo.read_desired_installations()
        desired["targets"]["codex"]["plugins"] = [
            {
                "ref": "plugin:example-plugin",
                "distribution": "marketplace",
            }
        ]
        self.repo.write_desired_installations(desired)
        self.repo.refresh()
        failed_probe = subprocess.CompletedProcess(
            args=["codex"],
            returncode=1,
            stdout="",
            stderr="probe failed",
        )

        with (
            patch(
                "scripts.agents_kit.installation.shutil.which",
                return_value="/usr/bin/codex",
            ),
            patch(
                "scripts.agents_kit.installation.subprocess.run",
                return_value=failed_probe,
            ),
            self.assertRaisesRegex(InstallationError, "probe failed"),
        ):
            apply_global(self.repo, target="codex")

        self.assertFalse((self.global_skills / "example-plugin").exists())

    def test_projection_detects_cross_kind_destination_collision(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude",),
            tags=["role/builder", "focus/example"],
        )
        standalone = self.root / "skills/tools/example-plugin"
        standalone.mkdir(parents=True)
        (standalone / "SKILL.md").write_text(
            "---\nname: example-plugin\ndescription: Same destination\n---\n",
            encoding="utf-8",
        )
        metadata = self.repo.read_metadata()
        metadata["skills"]["skill:standalone/example-plugin"] = {
            "description": "Same destination",
            "trigger": "",
            "recommendation": 3,
            "tags": ["role/builder", "focus/example"],
        }
        self.repo.write_metadata(metadata)
        desired = self.repo.read_desired_installations()
        desired["targets"]["claude"]["skills"] = [
            AssetRef.standalone_skill("example-plugin").canonical
        ]
        desired["targets"]["claude"]["plugins"] = [
            {
                "ref": AssetRef.plugin("example-plugin").canonical,
                "distribution": "skills-dir",
            }
        ]
        self.repo.write_desired_installations(desired)
        self.repo.refresh()

        plan = global_plan(self.repo, target_filter="claude")

        self.assertTrue(
            any("投射路径冲突" in conflict for conflict in plan["conflicts"])
        )

    def test_desired_plugin_distribution_matrix_is_enforced(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude",),
            tags=["role/builder", "focus/example"],
        )
        desired = self.repo.read_desired_installations()
        desired["targets"]["claude"]["plugins"] = [
            {
                "ref": "plugin:example-plugin",
                "distribution": "marketplace",
            }
        ]

        validation = validate_desired_installations(self.repo, desired)

        self.assertTrue(
            any("不支持 distribution" in problem for problem in validation["problems"])
        )
        self.repo.write_desired_installations(desired)
        with self.assertRaisesRegex(InstallationError, "不支持 distribution"):
            apply_global(self.repo, target="claude")
        self.assertFalse((self.global_skills / "example-plugin").exists())

    def test_claude_full_plugin_is_projected_as_managed_skills_dir_link(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude",),
            tags=["role/builder", "focus/example"],
        )
        desired = self.repo.read_desired_installations()
        desired["targets"]["claude"]["plugins"] = [
            {
                "ref": "plugin:example-plugin",
                "distribution": "skills-dir",
            }
        ]
        self.repo.write_desired_installations(desired)

        result = apply_global(self.repo, target="claude")

        link = self.global_skills / "example-plugin"
        self.assertTrue(link.is_symlink())
        self.assertEqual(
            link.resolve(), (self.root / "plugins/example-plugin").resolve()
        )
        self.assertEqual(result.details["linked"], 1)

    def test_plugin_update_separates_merge_state_from_risk_and_preserves_local_manifest(
        self,
    ):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude", "codex"),
            tags=["role/builder", "focus/example"],
        )
        local_manifest = self.root / "plugins/example-plugin/.codex-plugin/plugin.json"
        local_manifest.write_text(
            json.dumps(
                {
                    "name": "example-plugin",
                    "description": "Locally adapted",
                    "skills": "./skills/",
                }
            ),
            encoding="utf-8",
        )
        expected_local_manifest = local_manifest.read_bytes()
        (self.upstream / "CHANGELOG.md").write_text(
            "Upstream documentation\n", encoding="utf-8"
        )
        updated_snapshot = self._snapshot()

        comparison = plugins.classify_plugin_update(
            self.repo, "example-plugin", updated_snapshot
        )

        self.assertEqual(comparison["merge_state"], "upstream_only")
        self.assertEqual(comparison["risk_class"], "docs_only")
        self.assertEqual(comparison["decision"], "auto_apply")

        plugins.update_plugin_from_snapshot(
            self.repo, "example-plugin", updated_snapshot
        )

        self.assertEqual(local_manifest.read_bytes(), expected_local_manifest)
        self.assertTrue((self.root / "plugins/example-plugin/CHANGELOG.md").is_file())

    def test_readme_update_requires_review(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude",),
            tags=["role/builder", "focus/example"],
        )
        (self.upstream / "README.md").write_text(
            "Behavior may depend on this file\n", encoding="utf-8"
        )

        comparison = plugins.classify_plugin_update(
            self.repo, "example-plugin", self._snapshot()
        )

        self.assertEqual(comparison["risk_class"], "unknown")
        self.assertEqual(comparison["decision"], "review_required")

    def test_plugin_identity_drift_is_rejected_before_update(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude",),
            tags=["role/builder", "focus/example"],
        )
        plugin_root = self.root / "plugins/example-plugin"
        before = self.repo.hash_directory(plugin_root)
        (self.upstream / ".claude-plugin/plugin.json").write_text(
            json.dumps(
                {
                    "name": "different-plugin",
                    "description": "Different plugin",
                }
            ),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(plugins.PluginError, "Plugin 身份漂移"):
            plugins.update_plugin_from_snapshot(
                self.repo,
                "example-plugin",
                self._snapshot(),
            )

        self.assertEqual(self.repo.hash_directory(plugin_root), before)

    def test_update_metadata_preflight_fails_before_plugin_replacement(self):
        for child in (self.upstream / "skills").iterdir():
            if child.is_dir():
                for path in sorted(child.rglob("*"), reverse=True):
                    if path.is_file():
                        path.unlink()
                    elif path.is_dir():
                        path.rmdir()
                child.rmdir()
        (self.upstream / "skills").rmdir()
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude",),
            tags=["role/builder", "focus/example"],
        )
        plugin_root = self.root / "plugins/example-plugin"
        before = self.repo.hash_directory(plugin_root)
        source_before = self.repo.sources_path.read_bytes()
        skill = self.upstream / "skills/new-skill"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(
            "---\nname: new-skill\ndescription: New skill\n---\n",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(plugins.PluginError, "没有可继承的 metadata"):
            plugins.update_plugin_from_snapshot(
                self.repo,
                "example-plugin",
                self._snapshot(),
            )

        self.assertEqual(self.repo.hash_directory(plugin_root), before)
        self.assertEqual(self.repo.sources_path.read_bytes(), source_before)
        self.assertFalse((plugin_root / "skills/new-skill").exists())

    def test_sidecar_rejects_local_and_upstream_authority_overlap(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude",),
            tags=["role/builder", "focus/example"],
        )
        sidecar_path = self.root / "plugins/example-plugin/agents-kit.plugin.json"
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        sidecar["local_paths"].append(".claude-plugin/plugin.json")
        sidecar_path.write_text(json.dumps(sidecar), encoding="utf-8")

        with self.assertRaisesRegex(plugins.PluginError, "authority 冲突"):
            plugins.load_plugin_spec(sidecar_path.parent)

    def test_upstream_collision_with_local_manifest_authority_is_blocked(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self._snapshot(),
            category="tools",
            targets=("claude", "codex"),
            tags=["role/builder", "focus/example"],
        )
        (self.upstream / ".codex-plugin").mkdir()
        (self.upstream / ".codex-plugin/plugin.json").write_text(
            json.dumps({"name": "example-plugin"}),
            encoding="utf-8",
        )

        comparison = plugins.classify_plugin_update(
            self.repo, "example-plugin", self._snapshot()
        )

        self.assertEqual(comparison["decision"], "blocked")
        self.assertIn(".codex-plugin/plugin.json", comparison["authority_conflicts"])


if __name__ == "__main__":
    unittest.main()
