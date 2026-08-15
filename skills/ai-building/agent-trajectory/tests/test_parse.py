"""Unit tests for parse_trajectory adapters and render embedding.

Run from the repo root:  python3 -m unittest discover -s tests
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import parse_trajectory as pt
from render import build_html, embed


def write_jsonl(path, events):
    path.write_text("\n".join(json.dumps(e, ensure_ascii=False) for e in events), encoding="utf-8")


def claude_user(text, ts, **extra):
    e = {"type": "user", "timestamp": ts, "sessionId": "s1", "cwd": "/proj",
         "message": {"role": "user", "content": text}, "origin": {"kind": "human"}}
    e.update(extra)
    return e


def claude_assistant(blocks, ts, usage=None):
    return {"type": "assistant", "timestamp": ts, "sessionId": "s1",
            "message": {"role": "assistant", "content": blocks, "usage": usage or {}}}


def claude_result(tool_use_id, content, ts, is_error=False):
    return {"type": "user", "timestamp": ts, "sessionId": "s1",
            "message": {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": tool_use_id,
                 "content": content, "is_error": is_error}]}}


class ClaudeAdapterTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.dir = Path(tempfile.mkdtemp())
        self.log = self.dir / "session.jsonl"

    def parse(self, events):
        write_jsonl(self.log, events)
        return pt.finalize(pt.parse_claude(self.log))

    def test_turns_tools_durations_and_errors(self):
        data = self.parse([
            {"type": "ai-title", "aiTitle": "T", "sessionId": "s1"},
            claude_user("first question", "2026-01-01T00:00:00Z"),
            claude_assistant([
                {"type": "thinking", "thinking": "hmm"},
                {"type": "text", "text": "on it"},
                {"type": "tool_use", "id": "tu1", "name": "Bash", "input": {"command": "ls"}},
            ], "2026-01-01T00:00:01Z",
                usage={"input_tokens": 10, "cache_read_input_tokens": 90, "output_tokens": 5}),
            claude_result("tu1", "file.txt", "2026-01-01T00:00:03Z"),
            claude_assistant([
                {"type": "tool_use", "id": "tu2", "name": "Read", "input": {"file_path": "x"}},
            ], "2026-01-01T00:00:04Z"),
            claude_result("tu2", "boom", "2026-01-01T00:00:05Z", is_error=True),
            claude_user("second question", "2026-01-01T00:01:00Z"),
        ])
        self.assertEqual(len(data["turns"]), 2)
        t1 = data["turns"][0]
        self.assertEqual(t1["stats"]["tool_calls"], 2)
        self.assertEqual(t1["stats"]["errors"], 1)
        bash = next(e for e in t1["events"] if e.get("tool") == "Bash")
        self.assertEqual(bash["status"], "ok")
        self.assertEqual(bash["duration_ms"], 2000)
        self.assertEqual(bash["result"], "file.txt")
        self.assertEqual(bash["context_tokens"], 100)  # input + cache read
        read = next(e for e in t1["events"] if e.get("tool") == "Read")
        self.assertEqual(read["status"], "error")
        self.assertEqual(data["session"]["title"], "T")

    def test_meta_and_command_events_do_not_open_turns(self):
        data = self.parse([
            claude_user("real turn", "2026-01-01T00:00:00Z"),
            # isMeta injection (skill load) stays inside the turn
            claude_user("Base directory for this skill: /x", "2026-01-01T00:00:01Z",
                        isMeta=True, origin=None),
            # command stdout stays inside the turn
            claude_user("<local-command-stdout>done</local-command-stdout>", "2026-01-01T00:00:02Z"),
            # slash command with args opens a cleaned turn
            claude_user("<command-name>/goal</command-name><command-message>goal</command-message>"
                        "<command-args>do the thing</command-args>", "2026-01-01T00:00:03Z"),
            # bare command invocation does not open a turn
            claude_user("<command-name>/clear</command-name><command-args></command-args>",
                        "2026-01-01T00:00:04Z"),
        ])
        self.assertEqual(len(data["turns"]), 2)
        self.assertEqual(data["turns"][1]["user_text"], "/goal do the thing")
        kinds = [e["kind"] for e in data["turns"][0]["events"]]
        self.assertEqual(kinds.count("context"), 2)

    def test_queue_note_dedupe_and_notifications(self):
        data = self.parse([
            claude_user("turn one", "2026-01-01T00:00:00Z"),
            {"type": "queue-operation", "operation": "enqueue", "timestamp": "2026-01-01T00:00:01Z",
             "content": "mid-turn correction"},
            {"type": "queue-operation", "operation": "enqueue", "timestamp": "2026-01-01T00:00:02Z",
             "content": "<task-notification>noise</task-notification>"},
            {"type": "queue-operation", "operation": "enqueue", "timestamp": "2026-01-01T00:00:03Z",
             "content": "turn two opener"},
            claude_user("turn two opener", "2026-01-01T00:00:04Z"),
        ])
        self.assertEqual(len(data["turns"]), 2)
        notes = [e for e in data["turns"][0]["events"] if e["kind"] == "user_note"]
        self.assertEqual(len(notes), 1)  # correction kept, duplicate + notification dropped
        self.assertEqual(notes[0]["text"], "mid-turn correction")

    def test_queue_dedupe_requires_full_message_match(self):
        prefix = "x" * 80
        data = self.parse([
            claude_user("turn one", "2026-01-01T00:00:00Z"),
            {"type": "queue-operation", "operation": "enqueue",
             "timestamp": "2026-01-01T00:00:01Z", "content": prefix + " note"},
            claude_user(prefix + " opener", "2026-01-01T00:00:02Z"),
        ])
        notes = [e for e in data["turns"][0]["events"] if e["kind"] == "user_note"]
        self.assertEqual([e["text"] for e in notes], [prefix + " note"])

    def test_sidechain_tally(self):
        data = self.parse([
            claude_user("go", "2026-01-01T00:00:00Z"),
            {"type": "assistant", "timestamp": "2026-01-01T00:00:01Z", "isSidechain": True,
             "message": {"content": [{"type": "text", "text": "subagent"}]}},
        ])
        self.assertEqual(data["turns"][0]["subagent_events"], 1)
        self.assertEqual(data["turns"][0]["stats"]["events"], 0)

    def test_compaction_stays_inside_current_turn(self):
        data = self.parse([
            claude_user("turn one", "2026-01-01T00:00:00Z"),
            {"type": "system", "subtype": "compact_boundary",
             "timestamp": "2026-01-01T00:00:01Z", "sessionId": "s1"},
            claude_user("summary", "2026-01-01T00:00:02Z", isCompactSummary=True),
            claude_user("turn two", "2026-01-01T00:00:03Z"),
        ])
        self.assertEqual(len(data["turns"]), 2)
        self.assertIn("compaction", [e["kind"] for e in data["turns"][0]["events"]])

    def test_external_subagent_log_is_tallied(self):
        child = self.dir / "session" / "subagents" / "agent-1.jsonl"
        child.parent.mkdir(parents=True)
        write_jsonl(child, [
            {"type": "user", "timestamp": "2026-01-01T00:00:01Z"},
            {"type": "assistant", "timestamp": "2026-01-01T00:00:02Z"},
        ])
        data = self.parse([claude_user("go", "2026-01-01T00:00:00Z")])
        self.assertEqual(data["turns"][0]["subagent_events"], 2)


class CodexAdapterTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.dir = Path(tempfile.mkdtemp())
        self.log = self.dir / "sessions" / "2026" / "01" / "01" / "rollout-test.jsonl"
        self.log.parent.mkdir(parents=True)

    def parse(self, events):
        write_jsonl(self.log, events)
        return pt.finalize(pt.parse_codex(self.log))

    def test_turns_calls_context_and_compaction(self):
        child = self.dir / "sessions" / "2026" / "01" / "02" / "rollout-child.jsonl"
        child.parent.mkdir(parents=True)
        write_jsonl(child, [
            {"type": "session_meta", "timestamp": "2026-01-01T00:00:04Z",
             "payload": {"id": "child", "parent_thread_id": "c1"}},
            {"type": "event_msg", "timestamp": "2026-01-01T00:00:05Z",
             "payload": {"type": "agent_message", "message": "child work"}},
        ])
        data = self.parse([
            {"type": "session_meta", "timestamp": "2026-01-01T00:00:00Z",
             "payload": {"id": "c1", "session_id": "c1", "cwd": "/proj"}},
            {"type": "event_msg", "timestamp": "2026-01-01T00:00:01Z",
             "payload": {"type": "user_message",
                         "message": "# Files mentioned\n## My request:\nplease analyse"}},
            {"type": "event_msg", "timestamp": "2026-01-01T00:00:02Z",
             "payload": {"type": "task_started", "model_context_window": 400000}},
            {"type": "event_msg", "timestamp": "2026-01-01T00:00:03Z",
             "payload": {"type": "token_count",
                         "info": {"last_token_usage": {"input_tokens": 1000,
                                                       "cached_input_tokens": 900}}}},
            {"type": "response_item", "timestamp": "2026-01-01T00:00:04Z",
             "payload": {"type": "function_call", "call_id": "f1", "name": "exec_command",
                         "arguments": "{\"cmd\":\"ls\"}"}},
            {"type": "response_item", "timestamp": "2026-01-01T00:00:06Z",
             "payload": {"type": "function_call_output", "call_id": "f1", "output": "ok out"}},
            {"type": "compacted", "timestamp": "2026-01-01T00:00:07Z", "payload": {}},
            {"type": "event_msg", "timestamp": "2026-01-01T00:00:08Z",
             "payload": {"type": "agent_message", "message": "done"}},
        ])
        self.assertEqual(len(data["turns"]), 1)
        self.assertEqual(data["context_window"], 400000)
        turn = data["turns"][0]
        self.assertEqual(turn["user_text"], "please analyse")  # boilerplate stripped
        call = next(e for e in turn["events"] if e["kind"] == "tool")
        self.assertEqual(call["duration_ms"], 2000)
        self.assertEqual(call["status"], "ok")
        # cached tokens are a subset of input_tokens, not additive
        self.assertEqual(call["context_tokens"], 1000)
        self.assertIn("compaction", [e["kind"] for e in turn["events"]])
        self.assertEqual(turn["subagent_events"], 2)

    def test_process_exit_is_an_error(self):
        data = self.parse([
            {"type": "session_meta", "timestamp": "2026-01-01T00:00:00Z",
             "payload": {"id": "c1", "cwd": "/proj"}},
            {"type": "event_msg", "timestamp": "2026-01-01T00:00:01Z",
             "payload": {"type": "user_message", "message": "run"}},
            {"type": "response_item", "timestamp": "2026-01-01T00:00:02Z",
             "payload": {"type": "function_call", "call_id": "f1", "name": "exec_command",
                         "arguments": "{}"}},
            {"type": "response_item", "timestamp": "2026-01-01T00:00:03Z",
             "payload": {"type": "function_call_output", "call_id": "f1",
                         "output": "Chunk\nProcess exited with code 128\nOutput:\nfatal"}},
        ])
        call = data["turns"][0]["events"][0]
        self.assertEqual(call["status"], "error")
        self.assertEqual(data["turns"][0]["stats"]["errors"], 1)
        self.assertEqual(data["turns"][0]["stats"]["duration_ms"], 2000)


class InfraTest(unittest.TestCase):
    def test_project_dir_munging(self):
        d = pt.claude_project_dir("/Users/x/Downloads/dsh_agent_look")
        self.assertTrue(str(d).endswith("-Users-x-Downloads-dsh-agent-look"))

    def test_embed_escapes_script_close(self):
        html = ('<script id="trajectory-data" type="application/json">{}</script>'
                '<script id="annotations-data" type="application/json">null</script>')
        out = embed(html, "trajectory-data", {"x": "</script><script>alert(1)"})
        self.assertNotIn("</script><script>alert", out)
        self.assertIn("\\u003c/script>", out)

    def test_embed_escapes_script_comment_state(self):
        html = ('<script id="trajectory-data" type="application/json">{}</script>'
                '<script id="annotations-data" type="application/json">null</script>'
                '<script id="live-config" type="application/json">{}</script>')
        out = build_html({"turns": [], "x": "<!--<script>"}, template=self._template(html))
        self.assertNotIn("<!--<script>", out)
        self.assertIn("\\u003c!--\\u003cscript>", out)

    def test_clip_marks_truncation(self):
        s = pt.clip("a" * 50, 10)
        self.assertTrue(s.startswith("aaaaaaaaaa"))
        self.assertIn("[+40 chars]", s)

    def test_non_object_jsonl_records_are_ignored(self):
        import tempfile
        path = Path(tempfile.mkdtemp()) / "events.jsonl"
        path.write_text("[]\n{}\n", encoding="utf-8")
        self.assertEqual(list(pt.read_jsonl(path)), [{}])

    def _template(self, text):
        import tempfile
        path = Path(tempfile.mkdtemp()) / "template.html"
        path.write_text(text, encoding="utf-8")
        return path


if __name__ == "__main__":
    unittest.main()
