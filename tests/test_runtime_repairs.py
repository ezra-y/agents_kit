import json
import os
import runpy
import shutil
import subprocess
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from scripts.agents_kit import (
    automation,
    checks,
    docs,
    installation,
    plugins,
    runtime,
    skills,
    ui,
)
from scripts.agents_kit.models import CheckReport, Effect
from tests import test_plugins as fixtures


class RuntimeRepairTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.PluginTests()
        self.case.setUp()
        self.repo = self.case.repo
        self.root = self.case.root

    def tearDown(self):
        self.case.tearDown()

    def install(self):
        plugins.import_plugin_snapshot(
            self.repo,
            self.case._snapshot(),
            category="tools",
            targets=("claude", "codex"),
            tags=["role/builder", "focus/example"],
        )
        return self.repo.require_plugin("example-plugin").root

    def enable_claude(self):
        desired = self.repo.read_desired_installations()
        desired["targets"]["claude"]["plugins"] = [
            {"ref": "plugin:example-plugin", "distribution": "skills-dir"}
        ]
        self.repo.write_desired_installations(desired)

    def test_plugin_skill_is_active_in_list_show_and_catalog(self):
        self.install()
        self.enable_claude()
        active = skills.list_skills(self.repo, active_only=True)
        self.assertEqual([row["name"] for row in active], ["review"])
        self.assertEqual(active[0]["activation"], {"claude": "plugin"})
        self.assertEqual(
            skills.show_skill(self.repo, "review")["active_targets"], ["claude"]
        )
        self.assertEqual(docs.collect_rows(self.repo)[0]["status"], "随插件启用")

    def test_update_refreshes_inherited_version_and_paths_but_keeps_custom_fields(self):
        source = self.case.upstream / ".claude-plugin/plugin.json"
        original = json.loads(source.read_text())
        original.update(version="1.0.0", skills=["./skills/review"])
        source.write_text(json.dumps(original))
        root = self.install()
        local_path = root / ".codex-plugin/plugin.json"
        local = json.loads(local_path.read_text())
        local.update(
            description="Custom description", interface={"displayName": "My plugin"}
        )
        local_path.write_text(json.dumps(local))
        new_skill = self.case.upstream / "skills/new-review"
        new_skill.mkdir()
        (new_skill / "SKILL.md").write_text(
            "---\nname: new-review\ndescription: New review\n---\n"
        )
        original.update(
            version="1.1.0", skills=["./skills/review", "./skills/new-review"]
        )
        source.write_text(json.dumps(original))
        change = plugins.update_plugin_from_snapshot(
            self.repo, "example-plugin", self.case._snapshot()
        )
        updated = json.loads(local_path.read_text())
        self.assertEqual(updated["version"], "1.1.0")
        self.assertEqual(len(updated["skills"]), 2)
        self.assertEqual(updated["description"], "Custom description")
        self.assertEqual(updated["interface"], {"displayName": "My plugin"})
        self.assertIn(Effect.GLOBAL_APPLY, change.effects)

    def test_inventory_union_but_availability_uses_client_manifest(self):
        root = self.install()
        extra = root / "skills/codex-only"
        extra.mkdir()
        (extra / "SKILL.md").write_text(
            "---\nname: codex-only\ndescription: Codex only\n---\n"
        )
        for target, paths in [
            ("claude", ["./skills/review"]),
            ("codex", ["./skills/review", "./skills/codex-only"]),
        ]:
            p = root / f".{target}-plugin/plugin.json"
            data = json.loads(p.read_text())
            data["skills"] = paths
            p.write_text(json.dumps(data))
        self.repo.refresh()
        self.assertEqual(len(plugins._embedded_skill_paths(root)), 2)
        self.assertEqual(len(plugins._embedded_skill_paths(root, target="claude")), 1)
        self.assertEqual(len(plugins._embedded_skill_paths(root, target="codex")), 2)

    def test_disabled_old_codex_plugin_gets_native_reinstall_action(self):
        root = self.install()
        p = root / ".codex-plugin/plugin.json"
        data = json.loads(p.read_text())
        data["version"] = "2.0.0"
        p.write_text(json.dumps(data))
        responses = [
            {"marketplaces": [{"name": "agents-kit"}]},
            {
                "installed": [
                    {
                        "name": "example-plugin",
                        "marketplaceName": "agents-kit",
                        "installed": True,
                        "enabled": False,
                        "version": "1.0.0",
                    }
                ]
            },
        ]
        with (
            patch.object(installation.shutil, "which", return_value="codex"),
            patch.object(installation, "_run_json", side_effect=responses),
            patch.object(installation, "_codex_cache_matches", return_value=True),
        ):
            actions = installation._codex_marketplace_plan(
                self.repo,
                {
                    "plugins": [
                        {"ref": "plugin:example-plugin", "distribution": "marketplace"}
                    ]
                },
                enabled=True,
            )
        self.assertEqual(actions[0]["action"], "plugin_refresh")
        self.assertIn("停用", actions[0]["reason"])
        self.assertIn("版本", actions[0]["reason"])
        self.assertEqual(actions[0]["command"][1:3], ["plugin", "add"])

    def test_same_version_changed_files_refresh_but_pycache_does_not(self):
        root = self.install()
        home = self.root / "codex-home"
        cache = home / "plugins/cache/agents-kit/example-plugin/1.0.0"
        shutil.copytree(root, cache)
        with patch.dict(os.environ, {"CODEX_HOME": str(home)}):
            self.assertTrue(
                installation._codex_cache_matches(
                    self.repo, "example-plugin", "agents-kit", "1.0.0"
                )
            )
            (root / "__pycache__").mkdir()
            (root / "__pycache__/demo.pyc").write_bytes(b"temporary")
            self.assertTrue(
                installation._codex_cache_matches(
                    self.repo, "example-plugin", "agents-kit", "1.0.0"
                )
            )
            (root / "skills/review/SKILL.md").write_text("changed body")
            self.assertFalse(
                installation._codex_cache_matches(
                    self.repo, "example-plugin", "agents-kit", "1.0.0"
                )
            )

    def test_native_failure_is_reported_even_when_link_exists(self):
        self.install()
        self.enable_claude()
        installed = [
            {
                "id": "example-plugin@skills-dir",
                "enabled": False,
                "errors": ["Name occupied by another source"],
            }
        ]
        with patch.object(runtime, "read_json", return_value=installed):
            report = runtime.plugin_report(self.repo)
        self.assertFalse(report["ok"])
        self.assertIn("Name occupied", ";".join(report["problems"]))

    def test_native_codex_missing_skill_is_not_reported_as_success(self):
        self.install()
        state = self.repo.read_desired_installations()
        state["targets"]["codex"]["plugins"] = [
            {"ref": "plugin:example-plugin", "distribution": "marketplace"}
        ]
        self.repo.write_desired_installations(state)
        installed = {
            "installed": [{"pluginId": "example-plugin@agents-kit", "enabled": True}]
        }
        with (
            patch.object(runtime, "read_json", return_value=installed),
            patch.object(runtime, "codex_skills", return_value=[]),
        ):
            report = runtime.plugin_report(self.repo)
        self.assertFalse(report["ok"])
        self.assertEqual(
            report["plugins"][0]["missing_skills"], ["example-plugin:review"]
        )

    def test_claude_bad_relative_path_is_caught_by_repo_check(self):
        root = self.install()
        path = root / ".claude-plugin/plugin.json"
        data = json.loads(path.read_text())
        data["skills"] = ["skills/"]
        path.write_text(json.dumps(data))
        self.repo.refresh()
        report = CheckReport()
        checks._check_plugins(self.repo, self.repo.skill_registry(), report)
        self.assertTrue(any("./" in problem for problem in report.problems))

    def test_plugin_file_http_route_and_traversal(self):
        self.install()
        html = self.root / "index.html"
        html.write_text("catalog")
        server = ui.create_server(self.repo, html)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        base = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            with opener.open(
                base + "/plugins/example-plugin/skills/review/SKILL.md"
            ) as response:
                self.assertEqual(response.status, 200)
                self.assertIn(b"name: review", response.read())
            with self.assertRaises(urllib.error.HTTPError) as caught:
                opener.open(base + "/plugins/%2e%2e/metadata.json")
            self.assertEqual(caught.exception.code, 404)
            caught.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_sync_skip_never_fetches_or_changes_last_success(self):
        with patch.dict(
            os.environ, {"AGENTS_KIT_STATE_HOME": str(self.root / "state")}
        ):
            old = {
                "repository": str(self.repo.root),
                "last_success_at": "earlier",
                "status": "success",
            }
            self.repo.write_json_if_changed(automation.state_path(self.repo), old)
            with patch.object(
                automation, "_run", side_effect=["main", " M work.py"]
            ) as runner:
                result = automation.sync(self.repo)
            self.assertEqual(result["status"], "skipped")
            self.assertEqual(result["last_success_at"], "earlier")
            self.assertEqual(runner.call_count, 2)
            self.assertEqual(automation.read_status(self.repo)["changed_files"], 1)

    def test_equal_revision_still_reconciles_install_and_checks_runtime(self):
        commands = []

        def run(repo, args, timeout=120):
            commands.append(args)
            if args[:3] == ["git", "branch", "--show-current"]:
                return "main"
            if args[0] == "git":
                return "same" if args[1] in {"rev-parse", "merge-base"} else ""
            return json.dumps({"sections": {"runtime": {"ok": True}}})

        with (
            patch.dict(os.environ, {"AGENTS_KIT_STATE_HOME": str(self.root / "state")}),
            patch.object(automation, "_run", side_effect=run),
        ):
            result = automation.sync(self.repo)
        self.assertEqual(result["status"], "success")
        self.assertTrue(any(args[1:3] == ["global", "apply"] for args in commands))
        self.assertTrue(any("--runtime" in args for args in commands))

    def test_failed_runtime_check_does_not_record_sync_success(self):
        def run(repo, args, timeout=120):
            if "--runtime" in args:
                raise RuntimeError("skill missing")
            if args[:3] == ["git", "branch", "--show-current"]:
                return "main"
            return (
                "same"
                if args[0] == "git" and args[1] in {"rev-parse", "merge-base"}
                else ""
            )

        with (
            patch.dict(os.environ, {"AGENTS_KIT_STATE_HOME": str(self.root / "state")}),
            patch.object(automation, "_run", side_effect=run),
        ):
            result = automation.sync(self.repo)
        self.assertEqual(result["status"], "failed")
        self.assertIsNone(result["last_success_at"])
        self.assertEqual(result["phase"], "实际加载验收")

    @unittest.skipUnless(
        shutil.which("node"), "Node is required for the real catalog click handler"
    )
    def test_duplicate_names_open_the_selected_plugins_body(self):
        rows = []
        for owner, body in [
            ("one", "FIRST_UNIQUE_BODY"),
            ("two", "SECOND_UNIQUE_BODY"),
        ]:
            rows.append(
                {
                    "kind": "skill",
                    "name": "tdd",
                    "ref": f"skill:plugin/{owner}/tdd",
                    "owner": "plugin",
                    "ownerId": owner,
                    "cat": "tools",
                    "catLabel": "Tools",
                    "body": body,
                    "desc": "Test",
                    "how": "",
                    "tags": [],
                    "rec": 3,
                    "active": True,
                    "status": "随插件启用",
                    "repo": "",
                    "url": "",
                    "files": [],
                    "nfiles": 0,
                    "lines": 1,
                    "rel": f"plugins/{owner}/skills/tdd",
                }
            )
        script = docs.JS.replace("__DATA__", json.dumps(rows)).replace(
            "__RECLABEL__", json.dumps({3: "Test"})
        )
        harness = r"""
import assert from 'node:assert/strict';
import vm from 'node:vm';
let onClick;
const elements = {};
const document = {
  getElementById(id) {
    return elements[id] ||= {value:'', hidden:false, textContent:'', innerHTML:'',
      addEventListener(event, handler) { if(id==='tb' && event==='click') onClick=handler; }};
  },
  querySelectorAll() { return []; }
};
vm.runInNewContext(SCRIPT, {document, location:{protocol:'file:'}, window:{alert(){}}, console});
for (const [owner, expected, rejected] of [['one','FIRST_UNIQUE_BODY','SECOND_UNIQUE_BODY'], ['two','SECOND_UNIQUE_BODY','FIRST_UNIQUE_BODY']]) {
  let html='';
  const row={dataset:{ref:'skill:plugin/'+owner+'/tdd'}, nextElementSibling:null, insertAdjacentHTML(_,value){html=value;}};
  const button={closest(){return row;},setAttribute(){},querySelector(){return {textContent:''};}};
  onClick({target:{closest(selector){return selector==='.sname'?button:null;}}});
  assert.ok(html.includes(expected));
  assert.ok(!html.includes(rejected));
}
""".replace("SCRIPT", json.dumps(script))
        result = subprocess.run(
            ["node", "--input-type=module", "-e", harness],
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_cloud_update_mode_never_runs_local_installers(self):
        cli = runpy.run_path(
            str(Path(__file__).resolve().parents[1] / "scripts/agents-kit")
        )
        parser = cli["build_parser"]()
        args = parser.parse_args(
            ["source", "update", "--all", "--auto-docs", "--yes", "--repo-only"]
        )
        self.assertTrue(args.repo_only)
        context = cli["Context"](self.repo, parser)
        change = cli["ChangeSet"](
            changed={"plugins"}, effects={cli["Effect"].GLOBAL_APPLY}
        )
        with (
            patch.object(cli["installation"], "apply_global") as apply,
            patch.object(cli["runtime"], "plugin_report") as native,
        ):
            result = context.finish(change, apply_clients=False)
        apply.assert_not_called()
        native.assert_not_called()
        self.assertEqual(result["effects"], {})

    def test_generated_cli_help_is_stable_across_terminal_widths(self):
        cli = runpy.run_path(
            str(Path(__file__).resolve().parents[1] / "scripts/agents-kit")
        )
        with patch.dict(os.environ, {"COLUMNS": "50"}):
            narrow = cli["full_help"](cli["build_parser"]())
        with patch.dict(os.environ, {"COLUMNS": "160"}):
            wide = cli["full_help"](cli["build_parser"]())
        self.assertEqual(narrow, wide)
        self.assertIn("{status,sync,", narrow.splitlines()[0])
        self.assertTrue(narrow.splitlines()[0].endswith(" ..."))
