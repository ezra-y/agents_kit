#!/usr/bin/env python3
"""Live trajectory server: watch a session log, serve the viewer, answer Ask-AI.

Usage:
  python3 scripts/serve.py [--session <path>] [--host claude|codex|auto]
                           [--cwd <dir>] [--annotations <path>]
                           [--port 7469] [--open]

Endpoints (all bound to 127.0.0.1 only):
  GET  /                → viewer with current data embedded (live mode on)
  GET  /api/trajectory  → {mtime, data, annotations} or {unchanged: true}
  POST /api/ask         → streams a local AI CLI's answer to a question
  GET  /export          → self-contained static HTML snapshot (download)

Ask-AI runs a CLI already installed on this machine — `claude -p` or
`codex exec` — so answers never require an API key of their own. Override with
$AGENT_TRAJECTORY_ASK_CMD (an argv-style command template; `{q}` becomes one
argument), e.g.:  AGENT_TRAJECTORY_ASK_CMD='ollama run llama3 {q}'

Zero dependencies: stdlib only, same as the parser.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import signal
import subprocess
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import parse_trajectory as pt
from render import build_html

ASK_TIMEOUT = 240


def detect_ask_cmd():
    """Return (argv-template builder, display name) or (None, None)."""
    custom = os.environ.get("AGENT_TRAJECTORY_ASK_CMD")
    if custom:
        argv = shlex.split(custom)
        if not argv or not any("{q}" in part for part in argv):
            return None, None
        return (lambda q: [part.replace("{q}", q) for part in argv]), argv[0]
    if shutil.which("claude"):
        return (lambda q: ["claude", "-p", q]), "claude"
    if shutil.which("codex"):
        return (lambda q: ["codex", "exec", q]), "codex"
    return None, None


class State:
    """Parsed-data cache keyed on log/annotation file mtimes."""

    def __init__(self, host, session_path, ann_path):
        self.host = host
        self.session_path = Path(session_path)
        self.ann_path = Path(ann_path) if ann_path else None
        self.lock = threading.Lock()
        self.source_stamp = None
        self.revision = 0
        self.data = None
        self.annotations = None

    def current_stamp(self):
        session = self.session_path.stat()
        ann = self.ann_path.stat() if self.ann_path and self.ann_path.is_file() else None
        return (
            session.st_mtime_ns,
            session.st_size,
            None if ann is None else ann.st_mtime_ns,
            None if ann is None else ann.st_size,
        )

    def snapshot(self):
        """Re-parse only when a source file changed."""
        with self.lock:
            stamp = self.current_stamp()
            if stamp != self.source_stamp or self.data is None:
                parse = pt.parse_claude if self.host == "claude" else pt.parse_codex
                self.data = pt.finalize(parse(self.session_path))
                self.annotations = None
                if self.ann_path and self.ann_path.is_file():
                    try:
                        self.annotations = json.loads(self.ann_path.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        self.annotations = None
                self.source_stamp = stamp
                self.revision += 1
            return self.revision, self.data, self.annotations

    def ask_cwd(self):
        """Use the recorded project directory, with a safe local fallback."""
        _, data, _ = self.snapshot()
        cwd = (data.get("session") or {}).get("cwd")
        project = Path(cwd).expanduser() if cwd else None
        return project if project and project.is_dir() else self.session_path.parent


def build_page(state, live_cfg):
    mtime, data, ann = state.snapshot()
    return build_html(data, ann, {**live_cfg, "mtime": mtime})


def make_handler(state, ask_builder, ask_name):
    live_cfg = {"live": True, "poll": 1500, "ask": ask_builder is not None, "ask_cli": ask_name}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # quiet: one line, no per-poll spam
            if "/api/trajectory" not in (str(args[0]) if args else ""):
                super().log_message(fmt, *args)

        def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
            payload = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(payload)))
            if code >= 400:
                self.send_header("Connection", "close")
                self.close_connection = True
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(payload)

        def _same_origin(self):
            port = self.server.server_address[1]
            allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
            if self.headers.get("Host") not in allowed_hosts:
                return False
            origin = self.headers.get("Origin")
            return origin is None or origin in {f"http://{host}" for host in allowed_hosts}

        def do_GET(self):
            path, _, query = self.path.partition("?")
            if path == "/":
                page = build_page(state, live_cfg)
                self._send(200, page.encode(), "text/html; charset=utf-8")
            elif path == "/api/trajectory":
                params = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
                known = int(params.get("mtime", 0) or 0)
                mtime, data, ann = state.snapshot()
                if mtime == known:
                    self._send(200, {"unchanged": True})
                else:
                    self._send(200, {"mtime": mtime, "data": data, "annotations": ann})
            elif path == "/export":
                _, data, ann = state.snapshot()
                html = build_html(data, ann)
                self._send(200, html.encode(), "text/html; charset=utf-8",
                           {"Content-Disposition": 'attachment; filename="agent-trajectory.html"'})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/api/ask":
                self._send(404, {"error": "not found"})
                return
            if ask_builder is None:
                self._send(503, {"error": "no AI CLI found (claude/codex) and no AGENT_TRAJECTORY_ASK_CMD"})
                return
            if not self._same_origin():
                self._send(403, {"error": "cross-origin request rejected"})
                return
            if self.headers.get_content_type() != "application/json":
                self._send(415, {"error": "application/json required"})
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if length <= 0 or length > 64 * 1024:
                self._send(413, {"error": "request body too large"})
                return
            try:
                question = json.loads(self.rfile.read(length)).get("question", "").strip()
            except (AttributeError, json.JSONDecodeError, ValueError):
                question = ""
            if not question or len(question) > 8000:
                self._send(400, {"error": "bad question"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()

            def chunk(b):
                self.wfile.write(f"{len(b):x}\r\n".encode() + b + b"\r\n")

            proc = None
            timed_out = threading.Event()

            def stop_process():
                if proc is None or proc.poll() is not None:
                    return
                timed_out.set()
                try:
                    if os.name == "posix":
                        os.killpg(proc.pid, signal.SIGKILL)
                    else:
                        proc.kill()
                except ProcessLookupError:
                    pass

            try:
                proc = subprocess.Popen(
                    ask_builder(question), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    cwd=str(state.ask_cwd()), start_new_session=(os.name == "posix"),
                )
                timer = threading.Timer(ASK_TIMEOUT, stop_process)
                timer.start()
                try:
                    for line in iter(proc.stdout.readline, b""):
                        chunk(line)
                    proc.wait()
                    if timed_out.is_set():
                        chunk(f"\n(ask timed out after {ASK_TIMEOUT}s)\n".encode())
                    elif proc.returncode:
                        chunk(f"\n(ask exited with code {proc.returncode})\n".encode())
                finally:
                    timer.cancel()
                    if proc.poll() is None:
                        stop_process()
                        proc.wait()
                    if proc.stdout is not None:
                        proc.stdout.close()
            except OSError as err:
                try:
                    chunk(f"\n(ask error: {err})\n".encode())
                except OSError:
                    pass
            try:
                self.wfile.write(b"0\r\n\r\n")
            except OSError:
                pass

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", choices=["auto", "claude", "codex"], default="auto")
    ap.add_argument("--session", help="explicit session log path")
    ap.add_argument("--cwd", default=os.getcwd())
    ap.add_argument("--annotations", help="annotations JSON to serve alongside (re-read on change)")
    ap.add_argument("--port", type=int, default=7469)
    ap.add_argument("--open", action="store_true", help="open the page in the default browser")
    args = ap.parse_args()

    session = args.session or os.environ.get("AGENT_TRAJECTORY_SESSION")
    if session:
        path = Path(session).expanduser()
        host = args.host
        if host == "auto":
            host = "codex" if path.name.startswith("rollout-") else "claude"
    else:
        host, path = pt.discover(args.host, args.cwd)
    if not path.is_file():
        raise SystemExit(f"Session log not found: {path}")

    state = State(host, path, args.annotations)
    ask_builder, ask_name = detect_ask_cmd()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(state, ask_builder, ask_name))
    url = f"http://127.0.0.1:{args.port}/"
    print(f"agent-trajectory live: {url}")
    print(f"  session: {path}")
    print(f"  ask-AI:  {ask_name or 'unavailable (install claude/codex CLI or set AGENT_TRAJECTORY_ASK_CMD)'}")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
