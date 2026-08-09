import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.support import metadata_catalog, taxonomy_config

LAUNCHER = Path(__file__).resolve().parents[1] / "scripts" / "agents-kit"


class ScoutTests(unittest.TestCase):
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
                "project": [],
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
        self.upstream = self.root / "upstream"
        for name in ("alpha", "beta"):
            self.write_upstream_skill(name)

    def tearDown(self):
        self.temp.cleanup()

    def write_upstream_skill(self, name):
        skill_dir = self.upstream / "skills" / name
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: {name.title()} skill\n---\n\n"
            f"# {name.title()}\n\nBody of {name}.\n",
            encoding="utf-8",
        )

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

    def save_index(self):
        return json.loads(
            self.run_cli(
                "source",
                "inspect",
                str(self.upstream),
                "--save",
                "--name",
                "demo",
                "--note",
                "测试来源",
                "--json",
            ).stdout
        )

    def scout_data(self):
        return json.loads((self.root / "scout.json").read_text(encoding="utf-8"))

    def catalog_doc(self):
        return (self.root / "docs/catalog.md").read_text(encoding="utf-8")

    def import_alpha(self):
        self.run_cli(
            "skill",
            "import",
            str(self.upstream),
            "--candidate",
            "skills/alpha",
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

    def test_inspect_without_save_does_not_write_index(self):
        payload = json.loads(
            self.run_cli("source", "inspect", str(self.upstream), "--json").stdout
        )

        self.assertEqual(len(payload["candidates"]), 2)
        self.assertFalse((self.root / "scout.json").exists())

    def test_save_writes_index_and_renders_catalog(self):
        payload = self.save_index()

        self.assertIn("scout", payload["changed"])
        self.assertEqual(payload["details"]["skills"], 2)
        record = self.scout_data()["sources"]["demo"]
        self.assertEqual([item["name"] for item in record["skills"]], ["alpha", "beta"])
        self.assertEqual(record["note"], "测试来源")
        self.assertFalse((self.root / "skills/tools/alpha").exists())

        rendered = self.catalog_doc()
        self.assertIn("一、未收录索引", rendered)
        self.assertIn("二、已收录、未常驻", rendered)
        self.assertIn("三、常驻", rendered)
        self.assertIn("Alpha skill", rendered)
        self.assertIn("`skills/beta`", rendered)

        html = (self.root / "docs/index.html").read_text(encoding="utf-8")
        self.assertIn('data-cat="未收录"', html)
        self.assertIn('"status": "仅索引"', html)
        self.run_cli("check", "--repo-only", "--json")

    def test_install_moves_skill_across_catalog_tiers(self):
        self.save_index()
        self.import_alpha()

        rendered = self.catalog_doc()
        alpha_index_row = next(
            line for line in rendered.splitlines() if "Alpha skill" in line
        )
        beta_index_row = next(
            line for line in rendered.splitlines() if "Beta skill" in line
        )
        self.assertIn("●", alpha_index_row)
        self.assertNotIn("●", beta_index_row)
        self.assertIn("| `alpha` | Tools | 中文说明 |", rendered)

        html = (self.root / "docs/index.html").read_text(encoding="utf-8")
        self.assertEqual(html.count('"name": "alpha"'), 1)
        self.assertIn('"status": "已收录"', html)
        self.assertIn('"status": "仅索引"', html)
        self.run_cli("check", "--repo-only", "--json")

    def test_refresh_index_follows_upstream_changes(self):
        self.save_index()
        self.write_upstream_skill("gamma")
        shutil.rmtree(self.upstream / "skills/alpha")

        payload = json.loads(
            self.run_cli("source", "inspect", "--refresh-index", "--json").stdout
        )

        self.assertEqual(payload["results"][0]["skills"], 2)
        record = self.scout_data()["sources"]["demo"]
        self.assertEqual([item["name"] for item in record["skills"]], ["beta", "gamma"])
        self.assertEqual(record["note"], "测试来源")

    def test_check_reports_broken_scout_record(self):
        self.save_index()
        data = self.scout_data()
        data["sources"]["demo"]["skills"] = []
        (self.root / "scout.json").write_text(json.dumps(data), encoding="utf-8")

        result = self.run_cli("check", "--repo-only", "--json", check=False)

        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertTrue(
            any("skills 必须是非空数组" in problem for problem in payload["problems"])
        )

    def test_virtualenv_symlinks_are_ignored_by_check(self):
        self.import_alpha()
        venv_bin = self.root / "skills/tools/alpha/.venv/bin"
        venv_bin.mkdir(parents=True)
        (venv_bin / "python").symlink_to("/usr/bin/python3")

        self.run_cli("docs", "build", "--json")
        self.run_cli("check", "--repo-only", "--json")


if __name__ == "__main__":
    unittest.main()
