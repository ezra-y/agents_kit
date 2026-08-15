"""Regression tests for the live server cache and local Ask endpoint."""

import http.client
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import serve


def write_codex_log(path, extra_message=""):
    events = [
        {"type": "session_meta", "timestamp": "2026-01-01T00:00:00Z",
         "payload": {"id": "s1", "cwd": str(path.parent)}},
        {"type": "event_msg", "timestamp": "2026-01-01T00:00:01Z",
         "payload": {"type": "user_message", "message": "hello"}},
    ]
    if extra_message:
        events.append(
            {"type": "event_msg", "timestamp": "2026-01-01T00:00:02Z",
             "payload": {"type": "agent_message", "message": extra_message}}
        )
    path.write_text(
        "\n".join(json.dumps(event) for event in events),
        encoding="utf-8",
    )


class DummyState:
    def __init__(self, cwd):
        self.session_path = Path(cwd) / "rollout-test.jsonl"
        self._cwd = Path(cwd)

    def ask_cwd(self):
        return self._cwd


class StateTest(unittest.TestCase):
    def test_session_and_annotations_have_independent_cache_stamps(self):
        root = Path(tempfile.mkdtemp())
        session = root / "rollout-test.jsonl"
        annotations = root / "annotations.json"
        write_codex_log(session)
        annotations.write_text('{"turns":[]}', encoding="utf-8")
        os.utime(session, ns=(1_000_000_000, 1_000_000_000))
        os.utime(annotations, ns=(2_000_000_000, 2_000_000_000))

        state = serve.State("codex", session, annotations)
        first, _, _ = state.snapshot()

        write_codex_log(session, "new result")
        os.utime(session, ns=(1_500_000_000, 1_500_000_000))
        second, data, _ = state.snapshot()

        self.assertGreater(second, first)
        self.assertEqual(data["turns"][0]["events"][-1]["text"], "new result")


class AskEndpointTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.state = DummyState(self.root)

    def request(self, builder, body, content_type="application/json", origin=None):
        server = serve.ThreadingHTTPServer(
            ("127.0.0.1", 0),
            serve.make_handler(self.state, builder, "test"),
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_address[1]
        headers = {"Content-Type": content_type}
        if origin is not None:
            headers["Origin"] = origin.format(port=port)
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            conn.request("POST", "/api/ask", body=body, headers=headers)
            response = conn.getresponse()
            return response.status, response.read().decode()
        finally:
            conn.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_cross_origin_request_is_rejected_before_command_build(self):
        called = threading.Event()

        def builder(_question):
            called.set()
            return [sys.executable, "-c", "print('should not run')"]

        status, _ = self.request(
            builder,
            '{"question":"hello"}',
            content_type="text/plain",
            origin="https://example.com",
        )
        self.assertEqual(status, 403)
        self.assertFalse(called.is_set())

    def test_same_origin_json_request_streams_answer(self):
        builder = lambda _q: [sys.executable, "-c", "print('answer')"]
        status, body = self.request(
            builder,
            '{"question":"hello"}',
            origin="http://127.0.0.1:{port}",
        )
        self.assertEqual(status, 200)
        self.assertIn("answer", body)

    def test_timeout_kills_silent_process(self):
        builder = lambda _q: [sys.executable, "-c", "import time; time.sleep(10)"]
        started = time.monotonic()
        with mock.patch.object(serve, "ASK_TIMEOUT", 0.1):
            status, body = self.request(
                builder,
                '{"question":"hello"}',
                origin="http://127.0.0.1:{port}",
            )
        self.assertEqual(status, 200)
        self.assertIn("ask timed out", body)
        self.assertLess(time.monotonic() - started, 2.5)

    def test_custom_command_keeps_quoted_question_as_one_argument(self):
        question = "two words *.txt $(do-not-run)"
        with mock.patch.dict(
            os.environ,
            {"AGENT_TRAJECTORY_ASK_CMD": 'echo "{q}"'},
        ):
            builder, name = serve.detect_ask_cmd()
        self.assertEqual(name, "echo")
        self.assertEqual(builder(question), ["echo", question])


if __name__ == "__main__":
    unittest.main()
