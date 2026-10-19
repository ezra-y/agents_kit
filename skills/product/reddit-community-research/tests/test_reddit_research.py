import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts import reddit_research as data

FIXTURES = Path(__file__).parent / "fixtures"


class ResearchDataTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.db = data.connect(self.root / "research.sqlite", create=True)
        self.addCleanup(self.db.close)
        data.import_data(self.db, FIXTURES / "posts.json", FIXTURES / "comments.json")

    def finding(self, source_id, need_id, statement, quote):
        return {
            "id": source_id + ":" + need_id,
            "source_id": source_id,
            "kind": "pain",
            "attribution": "API服务",
            "statement": statement,
            "need_id": need_id,
            "evidence": [{"source_id": source_id, "quote": quote}],
        }

    def test_import_preserves_original_and_deduplicates_ids(self):
        data.import_data(self.db, FIXTURES / "posts.json", FIXTURES / "comments.json")
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM records").fetchone()[0], 12
        )
        originals = json.loads((FIXTURES / "comments.json").read_text())
        for original in originals:
            row = data.get_record(self.db, "t1_" + original["id"])
            self.assertEqual(json.loads(row["raw"]), original)
        discussion = data.thread(self.db, "1wgp50b")
        self.assertEqual(discussion["saved_comments"], 3)
        self.assertEqual(discussion["missing_parent_ids"], [])

    def test_read_findings_preserves_analysis_and_full_source_across_batches(self):
        data.import_data(
            self.db,
            FIXTURES / "reading-posts.json",
            FIXTURES / "reading-comments.json",
        )
        findings = list(data.read_rows(FIXTURES / "reading-findings.jsonl"))
        first = data.read_findings(self.db, findings, start=0, limit=1)
        self.assertEqual(first["findings"], findings[:1])
        self.assertEqual(first["next_start"], 1)
        self.assertEqual(first["total"], 2)
        self.assertEqual(first["missing_parent_ids"], [])
        comment = json.loads((FIXTURES / "reading-comments.json").read_text())[0]
        self.assertEqual(first["sources"]["t1_pdwmtfu"]["raw"], comment)
        self.assertIn("t3_1wtdt4n", first["sources"])

        output = self.root / "reading.json"
        subprocess.run(
            [
                sys.executable,
                data.__file__,
                "read-findings",
                "--db",
                str(self.root / "research.sqlite"),
                "--findings",
                str(FIXTURES / "reading-findings.jsonl"),
                "--start",
                "1",
                "--limit",
                "1",
                "--out",
                str(output),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        second = json.loads(output.read_text())
        self.assertEqual(second["findings"], findings[1:])
        self.assertIsNone(second["next_start"])
        post = next(
            item
            for item in json.loads((FIXTURES / "reading-posts.json").read_text())
            if item["id"] == "1wzgmom"
        )
        self.assertEqual(second["sources"]["t3_1wzgmom"]["raw"], post)

    def test_read_findings_includes_author_updates_with_reply_context(self):
        finding = self.finding(
            "t3_1wgp50b",
            "input-billing",
            "输入计费数量超出预期",
            "gets billed almost 100k",
        )
        reading = data.read_findings(self.db, [finding])
        originals = {
            "t1_" + item["id"]: item
            for item in json.loads((FIXTURES / "comments.json").read_text())
        }
        self.assertEqual(
            reading["sources"]["t1_p9wkrb4"]["raw"], originals["t1_p9wkrb4"]
        )
        self.assertEqual(
            reading["sources"]["t1_p9w3m9d"]["raw"], originals["t1_p9w3m9d"]
        )

    def test_batches_preserve_every_character_and_independent_comments(self):
        directory = self.root / "batches"
        result = data.export_batches(
            self.db, directory, max_chars=1600, record_chars=60
        )
        self.assertGreater(result["batches"], 1)
        parts = {}
        for path in sorted(directory.glob("batch-*.jsonl")):
            for item in data.read_rows(path):
                parts.setdefault(item["source_id"], []).append(item)
        self.assertEqual(len(parts), 12)
        for source_id, items in parts.items():
            items.sort(key=lambda item: item["part"])
            self.assertEqual(
                "".join(item["text"] for item in items),
                data.record_text(data.get_record(self.db, source_id)),
            )
            self.assertEqual(len(items), items[0]["parts"])
        reply = parts["t1_p9wkrb4"][0]
        self.assertEqual(reply["parent_id"], "t1_p9w3m9d")
        self.assertIn("Qwen uses a lot", reply["reply_to_text"])

    def test_selected_comment_keeps_parent_post_and_reports_remaining_work(self):
        directory = self.root / "batches"
        data.export_batches(self.db, directory)
        source = data.get_record(self.db, "t1_pa147ts")
        screen = [
            {
                "source_id": source["id"],
                "part": 1,
                "decision": "keep",
                "evidence": "money deducted but no credits",
            }
        ]
        result = data.select_threads(self.db, screen, directory)
        self.assertEqual(result["post_ids"], ["t3_1wgoag8"])
        self.assertEqual(result["remaining_parts"], 11)
        self.assertEqual(result["processed_parts"], 1)

    def test_count_discussions_and_authors_from_expressions(self):
        findings = [
            self.finding(
                "t3_1wgoag8",
                "credit",
                "充值后余额未到账",
                "recently I added money and it was never credited to my account",
            ),
            self.finding(
                "t1_pa147ts",
                "credit",
                "扣款后余额未到账",
                "money deducted but no credits",
            ),
            self.finding(
                "t3_1wgp50b",
                "input-billing",
                "输入计费数量超出预期",
                "gets billed almost 100k",
            ),
            self.finding(
                "t1_p9wkrb4",
                "input-billing",
                "作者说明问题在输入长度",
                "Only about input length.",
            ),
        ]
        counts = {
            row["need_id"]: row
            for row in data.count_findings(
                self.db, findings, include_attributions=["API服务"]
            )
        }
        self.assertEqual(counts["credit"]["discussions"], 1)
        self.assertEqual(counts["credit"]["authors"], 2)
        self.assertEqual(counts["credit"]["expressing_comments"], 1)
        self.assertEqual(counts["input-billing"]["authors"], 1)
        self.assertEqual(counts["input-billing"]["discussions"], 1)

    def test_count_rejects_quote_from_another_actual_discussion(self):
        finding = self.finding(
            "t3_1wgoag8",
            "credit",
            "充值后余额未到账",
            "recently I added money and it was never credited to my account",
        )
        finding["evidence"].append(
            {"source_id": "t1_p9wkrb4", "quote": "Only about input length."}
        )
        with self.assertRaisesRegex(ValueError, "另一篇讨论"):
            data.count_findings(self.db, [finding], include_attributions=["API服务"])

    def test_count_requires_expression_sources_own_quote(self):
        finding = self.finding(
            "t3_1wgoag8",
            "credit",
            "充值后余额未到账",
            "recently I added money and it was never credited to my account",
        )
        finding["evidence"] = [
            {"source_id": "t1_pa147ts", "quote": "money deducted but no credits"}
        ]
        with self.assertRaisesRegex(ValueError, "自身的原话"):
            data.count_findings(self.db, [finding], include_attributions=["API服务"])

    def test_count_filters_attribution_before_grouping(self):
        data.import_data(self.db, FIXTURES / "scope-posts.json", None)
        api = self.finding(
            "t3_1wgoag8",
            "credit",
            "充值后余额未到账",
            "recently I added money and it was never credited to my account",
        )
        client = self.finding(
            "t3_1wmd8ez",
            "",
            "希望获得桌面工作界面",
            "I use Pi every day and wanted more than a terminal window",
        )
        client["kind"] = "need"
        client["attribution"] = "客户端"
        uncertain = self.finding(
            "t3_1wkg12p",
            "",
            "希望使用模型执行浏览器自动化",
            "Can I use openai model for browser automation?",
        )
        uncertain["kind"] = "need"
        uncertain["attribution"] = "待确认"
        result = data.count_findings(
            self.db, [api, client, uncertain], include_attributions=["API服务"]
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["finding_ids"], [api["id"]])
        self.assertEqual(result[0]["discussions"], 1)

        findings_path = self.root / "findings.jsonl"
        findings_path.write_text(
            "\n".join(json.dumps(item) for item in [api, client, uncertain]) + "\n"
        )
        output_path = self.root / "counts.json"
        subprocess.run(
            [
                sys.executable,
                data.__file__,
                "count",
                "--db",
                str(self.root / "research.sqlite"),
                "--findings",
                str(findings_path),
                "--include-attribution",
                "API服务",
                "--out",
                str(output_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(json.loads(output_path.read_text()), result)

        client["need_id"] = "desktop-workspace"
        result = data.count_findings(
            self.db, [api, client, uncertain], include_attributions=["客户端"]
        )
        self.assertEqual(result[0]["finding_ids"], [client["id"]])

    def test_count_requires_attribution_and_inclusion_scope(self):
        finding = self.finding(
            "t3_1wgoag8",
            "credit",
            "充值后余额未到账",
            "recently I added money and it was never credited to my account",
        )
        with self.assertRaisesRegex(ValueError, "纳入统计"):
            data.count_findings(self.db, [finding], include_attributions=[])
        del finding["attribution"]
        with self.assertRaisesRegex(ValueError, "缺少问题归属"):
            data.count_findings(self.db, [finding], include_attributions=["API服务"])

    def test_megathread_uses_explicit_question_instead_of_category_heading(self):
        post_id = "t3_1wflsa9"
        question = data.get_record(self.db, "t1_p9n6nme")
        reply = data.get_record(self.db, "t1_p9n8kdt")
        with self.assertRaisesRegex(ValueError, "独立问题的起点"):
            data.discussion_unit(self.db, question, {post_id})
        self.assertEqual(
            data.discussion_unit(self.db, question, {post_id}, question["id"]),
            question["id"],
        )
        self.assertEqual(
            data.discussion_unit(self.db, reply, {post_id}, question["id"]),
            question["id"],
        )
        self.assertEqual(
            data.discussion_unit(self.db, reply, {post_id}, reply["id"]), reply["id"]
        )
        with self.assertRaisesRegex(ValueError, "不在当前回复链"):
            data.discussion_unit(self.db, reply, {post_id}, "t1_p9n4i95")


if __name__ == "__main__":
    unittest.main()
