import copy
import json
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.agents_kit import checks, plugins, source_reports, sources
from scripts.agents_kit.repository import Repository
from tests import test_cli as fixtures


class UpstreamCompletionTests(unittest.TestCase):
    def report(self):
        return {
            "results": [
                {
                    "skill": "alpha",
                    "status": "review_required",
                    "decision": "review_required",
                    "remote_sha256": "new",
                    "local_sha256": "old",
                    "changed_paths": ["SKILL.md"],
                }
            ],
            "failures": [],
        }

    def issue(self, report, state="OPEN"):
        return {
            "number": 1,
            "title": "上游技能待更新",
            "state": state,
            "body": source_reports.render_source_review_markdown(
                report, {}, run_url="https://example.com/old"
            ),
        }

    def test_run_id_revision_and_unchanged_rows_do_not_trigger_issue_write(self):
        report = self.report()
        current = self.issue(report)
        report["results"][0]["revision"] = "unrelated-upstream-commit"
        report["results"].append({"skill": "beta", "status": "unchanged"})
        with patch.object(
            source_reports, "_gh", return_value=json.dumps([current])
        ) as gh:
            result = source_reports.sync_review_issue(
                report, {}, repository="owner/repo", run_url="https://example.com/new"
            )
        self.assertEqual(result["action"], "unchanged")
        self.assertEqual(gh.call_count, 1)

    def test_same_count_new_content_updates_once_then_stays_quiet(self):
        old = self.report()
        report = copy.deepcopy(old)
        report["results"][0]["remote_sha256"] = "newer"
        with patch.object(
            source_reports, "_gh", side_effect=[json.dumps([self.issue(old)]), ""]
        ) as gh:
            result = source_reports.sync_review_issue(
                report, {}, repository="owner/repo"
            )
        self.assertEqual(result["action"], "update")
        args, kwargs = gh.call_args
        self.assertEqual(args[0][:2], ["issue", "edit"])
        self.assertNotIn("<details>", kwargs["body"])
        current = {**self.issue(report), "body": kwargs["body"]}
        with patch.object(
            source_reports, "_gh", return_value=json.dumps([current])
        ) as gh:
            self.assertEqual(
                source_reports.sync_review_issue(report, {}, repository="owner/repo")[
                    "action"
                ],
                "unchanged",
            )
            self.assertEqual(gh.call_count, 1)

    def test_failures_and_recovery_change_fingerprint(self):
        report = self.report()
        fingerprint = source_reports.review_fingerprint(report)
        report["failures"] = [{"skill": "beta", "error": "not found"}]
        self.assertNotEqual(source_reports.review_fingerprint(report), fingerprint)
        report["failures"] = []
        self.assertEqual(source_reports.review_fingerprint(report), fingerprint)

    def test_sorted_pending_and_applied_rows_do_not_create_noise(self):
        report = self.report()
        fingerprint = source_reports.review_fingerprint(report)
        report["results"].insert(
            0, {"skill": "done", "decision": "review_required", "applied": True}
        )
        self.assertEqual(source_reports.review_fingerprint(report), fingerprint)
        self.assertEqual(len(source_reports.pending_updates(report)), 1)

    def test_resolved_issue_closes_once_without_comment(self):
        current = self.issue(self.report())
        report = {"results": [], "failures": []}
        with patch.object(
            source_reports, "_gh", side_effect=[json.dumps([current]), ""]
        ) as gh:
            self.assertEqual(
                source_reports.sync_review_issue(report, {}, repository="owner/repo")[
                    "action"
                ],
                "close",
            )
            self.assertEqual(gh.call_args.args[0][:2], ["issue", "close"])
        current["state"] = "CLOSED"
        with patch.object(
            source_reports, "_gh", return_value=json.dumps([current])
        ) as gh:
            self.assertEqual(
                source_reports.sync_review_issue(report, {}, repository="owner/repo")[
                    "action"
                ],
                "unchanged",
            )
            gh.assert_called_once()

    def test_closed_issue_reopens_for_pending_work(self):
        report = self.report()
        with patch.object(
            source_reports,
            "_gh",
            side_effect=[json.dumps([self.issue(report, "CLOSED")]), "", ""],
        ) as gh:
            source_reports.sync_review_issue(report, {}, repository="owner/repo")
            self.assertEqual(gh.call_args.args[0][:2], ["issue", "reopen"])

    def test_incomplete_report_never_closes_issue(self):
        with patch.object(source_reports, "_gh") as gh, self.assertRaises(ValueError):
            source_reports.sync_review_issue(
                {"results": []}, {}, repository="owner/repo"
            )
        gh.assert_not_called()

    def test_notify_dry_run_does_not_write(self):
        with patch.object(source_reports, "_gh", return_value="[]") as gh:
            result = source_reports.sync_review_issue(
                self.report(), {}, repository="owner/repo", dry_run=True
            )
        self.assertEqual(result["action"], "create")
        gh.assert_called_once()

    def test_utf8_split_at_sample_boundary_is_text_in_both_classifiers(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "SKILL.md"
            path.write_bytes(b"a" * 8191 + "中文".encode())
            self.assertFalse(sources._path_is_binary(path))
            self.assertFalse(plugins._is_binary(path))
            path.write_bytes(b"a\x00b")
            self.assertTrue(sources._path_is_binary(path))
            path.write_bytes(b"a\xffb")
            self.assertTrue(plugins._is_binary(path))


class SourcePreflightTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.CliTests()
        self.case.setUp()
        self.case.import_git_source()
        self.repo = Repository(self.case.root)

    def tearDown(self):
        self.case.tearDown()

    def test_explicit_yes_never_installs_candidate_with_missing_attachment(self):
        local = self.repo.require_skill("alpha").path / "SKILL.md"
        before = local.read_bytes()
        remote = self.case.source / "SKILL.md"
        remote.write_text(remote.read_text() + "\n[missing](references/not-there.md)\n")
        self.case.commit_source("broken update")
        response = self.case.run_cli(
            "source", "update", "alpha", "--yes", "--repo-only", "--json", check=False
        )
        self.assertNotEqual(response.returncode, 0)
        result = json.loads(response.stdout)
        self.assertFalse(result["results"][0]["applied"])
        self.assertEqual(result["results"][0]["decision"], "blocked")
        self.assertEqual(local.read_bytes(), before)

    def test_upstream_sibling_not_installed_cannot_satisfy_dependency(self):
        candidate = self.case.root / "download/skills/alpha"
        candidate.mkdir(parents=True)
        sibling = candidate.parent / "not-installed"
        sibling.mkdir()
        (sibling / "SKILL.md").write_text("upstream only")
        (candidate / "references").mkdir()
        (candidate / "references/own.md").write_text("own reference")
        text = "---\nname: alpha\ndescription: alpha\n---\n[missing](../not-installed/SKILL.md)\n[own](references/own.md)\n"
        (candidate / "SKILL.md").write_text(text)
        problems = checks.candidate_skill_problems(
            "skill:standalone/alpha", candidate, self.repo.inventory()
        )
        self.assertTrue(
            any("not-installed" in problem for problem in problems), problems
        )
        self.assertFalse(any("own.md" in problem for problem in problems), problems)

    def test_edit_during_download_stops_batch_before_first_write(self):
        module = runpy.run_path(str(fixtures.LAUNCHER))
        parser = module["build_parser"]()
        args = parser.parse_args(["source", "update", "alpha", "--yes", "--repo-only"])
        context = module["Context"](self.repo, parser)
        first = {"merge_state": "upstream_only", "decision": "review_required"}
        second = {"merge_state": "diverged", "decision": "review_required"}
        with (
            patch.dict(
                module["command_source_update"].__globals__,
                {"_source_change": unittest.mock.Mock(side_effect=[first, second])},
            ),
            patch.object(module["skills"], "update_from_source") as write,
            self.assertRaises(module["CommandError"]),
        ):
            module["command_source_update"](args, context)
        write.assert_not_called()
