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

    def finding(
        self,
        source_id,
        need_id,
        statement,
        quote,
        *,
        action="expressing",
        action_evidence=None,
    ):
        record = {
            "id": source_id + ":" + need_id,
            "source_id": source_id,
            "kind": "pain",
            "attribution": "API服务",
            "action": action,
            "statement": statement,
            "need_id": need_id,
            "evidence": [{"source_id": source_id, "quote": quote}],
        }
        if action_evidence is not None:
            record["action_evidence"] = action_evidence
        return record

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
        self.assertEqual(counts["credit"]["score_total"], 3)
        self.assertEqual(counts["credit"]["scored_sources"], 2)
        self.assertEqual(counts["input-billing"]["score_total"], 1)
        self.assertEqual(counts["input-billing"]["scored_sources"], 2)

    def test_score_counts_each_expression_once_per_theme(self):
        credit = self.finding(
            "t3_1wgoag8",
            "payment-support",
            "充值后余额未到账",
            "recently I added money and it was never credited to my account",
        )
        support = self.finding(
            "t3_1wgoag8",
            "payment-support",
            "多次请求客服帮助仍未收到回应",
            "So it's been two weeks without a peep from them.",
        )
        support["id"] += ":support"
        support["evidence"].append(
            {"source_id": "t1_p9vxn5v", "quote": "Took me several weeks to get a response"}
        )
        comment = self.finding(
            "t1_pa147ts",
            "payment-support",
            "扣款未到账且客服未回应",
            "they are not responding money deducted but no credits",
        )
        switching = self.finding(
            "t1_pa147ts",
            "switching",
            "用户更换服务以处理充值与支持问题",
            "I moved to deepinfra.",
        )
        counts = {
            row["need_id"]: row
            for row in data.count_findings(
                self.db,
                [credit, support, comment, switching],
                include_attributions=["API服务"],
            )
        }
        self.assertEqual(len(counts["payment-support"]["finding_ids"]), 3)
        self.assertEqual(counts["payment-support"]["score_total"], 3)
        self.assertEqual(counts["payment-support"]["scored_sources"], 2)
        self.assertEqual(counts["switching"]["score_total"], 1)
        self.assertEqual(counts["switching"]["scored_sources"], 1)

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

    def test_count_skips_unassigned_findings_within_included_attribution(self):
        kept = self.finding(
            "t3_1wgoag8",
            "credit",
            "充值后余额未到账",
            "recently I added money and it was never credited to my account",
        )
        dropped = self.finding(
            "t1_pa147ts",
            "",
            "扣款后余额未到账",
            "money deducted but no credits",
        )
        result = data.count_findings(
            self.db, [kept, dropped], include_attributions=["API服务"]
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["finding_ids"], [kept["id"]])

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

    def test_batches_and_read_findings_expose_flair_ratio_and_contested_flags(self):
        posts_path = self.root / "extra-posts.json"
        comments_path = self.root / "extra-comments.json"
        posts_path.write_text(
            json.dumps(
                [
                    {
                        "id": "1wzzzz1",
                        "author": "BillingLead",
                        "author_flair_text": "Team Admin",
                        "link_flair_text": "Billing",
                        "created_utc": 1792000001,
                        "subreddit": "openrouter",
                        "score": 4,
                        "upvote_ratio": 0.54,
                        "num_comments": 18,
                        "title": "Per-project credit cap keeps failing",
                        "selftext": "We set a $50 cap and it still went past it; looking for an alternative gateway.",
                    },
                    {
                        "id": "1wzzzz2",
                        "author": "QuietUser",
                        "author_flair_text": "",
                        "link_flair_text": "",
                        "created_utc": 1792000002,
                        "subreddit": "LocalLLaMA",
                        "score": 1,
                        "upvote_ratio": 0.50,
                        "num_comments": 2,
                        "title": "Small note on routing",
                        "selftext": "Switched to our own litellm proxy yesterday.",
                    },
                ]
            ),
            encoding="utf-8",
        )
        comments_path.write_text(
            json.dumps(
                [
                    {
                        "id": "pzzzzz1",
                        "author": "HotTakeDev",
                        "author_flair_text": "Contributor",
                        "created_utc": 1792000010,
                        "subreddit": "LocalLLaMA",
                        "score": 0,
                        "controversiality": 1,
                        "body": "Hosted routers add latency for zero benefit.",
                        "link_id": "t3_1wzzzz2",
                        "parent_id": "t3_1wzzzz2",
                    }
                ]
            ),
            encoding="utf-8",
        )
        data.import_data(self.db, posts_path, comments_path)
        directory = self.root / "signal-batches"
        data.export_batches(self.db, directory)
        by_id = {
            row["source_id"]: row
            for path in sorted(directory.glob("batch-*.jsonl"))
            for row in data.read_rows(path)
        }
        self.assertEqual(by_id["t3_1wzzzz1"]["subreddit"], "openrouter")
        self.assertEqual(by_id["t3_1wzzzz1"]["author_flair"], "Team Admin")
        self.assertEqual(by_id["t3_1wzzzz1"]["post_flair"], "Billing")
        self.assertEqual(by_id["t3_1wzzzz1"]["post_upvote_ratio"], 0.54)
        self.assertTrue(by_id["t3_1wzzzz1"]["contested"])
        self.assertIsNone(by_id["t3_1wzzzz2"]["author_flair"])
        self.assertIsNone(by_id["t3_1wzzzz2"]["post_flair"])
        self.assertFalse(by_id["t3_1wzzzz2"]["contested"])
        self.assertTrue(by_id["t1_pzzzzz1"]["contested"])

        finding = self.finding(
            "t3_1wzzzz1",
            "cap",
            "项目预算上限失效",
            "set a $50 cap and it still went past it",
            action="seeking",
            action_evidence={
                "source_id": "t3_1wzzzz1",
                "quote": "looking for an alternative gateway",
            },
        )
        reading = data.read_findings(self.db, [finding])
        self.assertTrue(reading["sources"]["t3_1wzzzz1"]["contested"])

    def test_count_tracks_by_subreddit_actions_and_contested_posts(self):
        data.import_data(
            self.db,
            FIXTURES / "reading-posts.json",
            FIXTURES / "reading-comments.json",
        )
        contested_path = self.root / "contested.json"
        contested_path.write_text(
            json.dumps(
                [
                    {
                        "id": "1wcont1",
                        "author": "OpsOwner",
                        "created_utc": 1792100000,
                        "subreddit": "OpenRouter",
                        "score": 6,
                        "upvote_ratio": 0.58,
                        "num_comments": 24,
                        "title": "Support delays and billing disputes",
                        "selftext": "Ticket unanswered for ten days, any alternative API aggregator?",
                    }
                ]
            ),
            encoding="utf-8",
        )
        data.import_data(self.db, contested_path, None)
        findings = [
            self.finding(
                "t3_1wgoag8",
                "billing",
                "充值后余额未到账",
                "recently I added money and it was never credited to my account",
                action="expressing",
            ),
            self.finding(
                "t1_pa147ts",
                "billing",
                "扣款未到账转投其他平台",
                "money deducted but no credits",
                action="acted",
                action_evidence={
                    "source_id": "t1_pa147ts",
                    "quote": "I moved to deepinfra.",
                },
            ),
            self.finding(
                "t3_1wcont1",
                "billing",
                "工单长期无人回复正在寻找替代平台",
                "Ticket unanswered for ten days",
                action="seeking",
                action_evidence={
                    "source_id": "t3_1wcont1",
                    "quote": "any alternative API aggregator?",
                },
            ),
            self.finding(
                "t3_1wzgmom",
                "billing",
                "额度消耗过快已换用其他模型服务",
                "Codex usage dropping quicker than usual",
                action="acted",
                action_evidence={
                    "source_id": "t3_1wzgmom",
                    "quote": "I have switched to DeepSeek Flash",
                },
            ),
        ]
        counts = data.count_findings(self.db, findings, include_attributions=["API服务"])
        self.assertEqual(len(counts), 1)
        item = counts[0]
        self.assertEqual(item["discussions"], 3)
        self.assertEqual(item["contested_posts"], 1)
        self.assertEqual(
            item["actions"], {"acted": 2, "seeking": 1, "expressing": 0}
        )
        self.assertEqual(
            [sub["subreddit"] for sub in item["by_subreddit"]],
            ["openrouter", "hermesagent"],
        )
        self.assertEqual(item["by_subreddit"][0]["discussions"], 2)
        self.assertEqual(item["by_subreddit"][0]["contested_posts"], 1)
        self.assertEqual(
            item["by_subreddit"][0]["actions"],
            {"acted": 1, "seeking": 1, "expressing": 0},
        )
        self.assertEqual(item["by_subreddit"][1]["discussions"], 1)
        self.assertEqual(
            item["by_subreddit"][1]["actions"],
            {"acted": 1, "seeking": 0, "expressing": 0},
        )

    def test_count_validates_action_and_same_author_action_evidence(self):
        same_author_followup = self.finding(
            "t3_1wgp50b",
            "input-billing",
            "输入计费超出预期且作者继续追问原因",
            "gets billed almost 100k",
            action="seeking",
            action_evidence={
                "source_id": "t1_p9wkrb4",
                "quote": "Can you elaborate? What exactly does it explain?",
            },
        )
        counted = data.count_findings(
            self.db, [same_author_followup], include_attributions=["API服务"]
        )
        self.assertEqual(counted[0]["actions"]["seeking"], 1)

        wrong_author = self.finding(
            "t3_1wgoag8",
            "credit",
            "充值后未到账",
            "never credited to my account",
            action="acted",
            action_evidence={
                "source_id": "t1_pa147ts",
                "quote": "I moved to deepinfra.",
            },
        )
        with self.assertRaisesRegex(ValueError, "同一表达作者"):
            data.count_findings(
                self.db, [wrong_author], include_attributions=["API服务"]
            )

        missing_evidence = self.finding(
            "t1_pa147ts",
            "credit",
            "扣款未到账",
            "money deducted but no credits",
            action="acted",
        )
        with self.assertRaisesRegex(ValueError, "行动证据"):
            data.count_findings(
                self.db, [missing_evidence], include_attributions=["API服务"]
            )

        bad_quote = self.finding(
            "t1_pa147ts",
            "credit",
            "扣款未到账",
            "money deducted but no credits",
            action="acted",
            action_evidence={
                "source_id": "t1_pa147ts",
                "quote": "not in comment",
            },
        )
        with self.assertRaisesRegex(ValueError, "行动摘录"):
            data.count_findings(self.db, [bad_quote], include_attributions=["API服务"])

        extra_on_expressing = self.finding(
            "t1_pa147ts",
            "credit",
            "扣款未到账",
            "money deducted but no credits",
            action="expressing",
            action_evidence={
                "source_id": "t1_pa147ts",
                "quote": "I moved to deepinfra.",
            },
        )
        with self.assertRaisesRegex(ValueError, "纯表达"):
            data.count_findings(
                self.db, [extra_on_expressing], include_attributions=["API服务"]
            )

        invalid_action = self.finding(
            "t3_1wgoag8",
            "credit",
            "充值后未到账",
            "never credited to my account",
            action="unknown",
        )
        with self.assertRaisesRegex(ValueError, "行动等级"):
            data.count_findings(
                self.db, [invalid_action], include_attributions=["API服务"]
            )

    def test_collect_parser_accepts_multiple_subreddits_and_deduplicates(self):
        args = data.build_parser().parse_args(
            [
                "collect",
                "--db",
                str(self.root / "multi.sqlite"),
                "--subreddit",
                "r/openrouter",
                "--subreddit",
                "LocalLLaMA",
                "--subreddit",
                "OpenRouter",
                "--after",
                "2026-09-15",
                "--before",
                "2026-09-16",
            ]
        )
        self.assertEqual(
            data.parse_subreddits(args.subreddit), ["openrouter", "LocalLLaMA"]
        )
        with self.assertRaisesRegex(ValueError, "不能为空"):
            data.parse_subreddits(["r/ "])


if __name__ == "__main__":
    unittest.main()
