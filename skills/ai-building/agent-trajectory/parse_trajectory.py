#!/usr/bin/env python3
"""Parse an agent session log into a normalized trajectory JSON.

Supported hosts:
  claude  - Claude Code (~/.claude/projects/<project>/<session>.jsonl)
  codex   - Codex CLI / Desktop (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)

Zero dependencies (Python 3.9+ stdlib only). No paths are hardcoded beyond
each host's documented default location, and every location can be overridden:

  --session <path>              explicit log file (skips discovery)
  --host claude|codex|auto      which adapter to use (default: auto)
  --cwd <dir>                   project dir used for discovery (default: $PWD)
  $CLAUDE_CONFIG_DIR            overrides ~/.claude
  $CODEX_HOME                   overrides ~/.codex

Output schema: agent-trajectory/v1 (see README section in SKILL.md).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "agent-trajectory/v1"

# Trim limits keep the report small; full content stays in the original log.
MAX_USER = 1500
MAX_TEXT = 1200
MAX_THINKING = 300
MAX_ARGS = 400
MAX_RESULT = 500


def clip(text, limit):
    """Trim text to limit, marking the cut so readers know it is a preview."""
    if text is None:
        return None
    text = str(text).strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + f" …[+{len(text) - limit} chars]"


def parse_ts(value):
    """ISO-8601 string -> epoch milliseconds, or None."""
    if not value:
        return None
    try:
        return int(datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def read_jsonl(path):
    """Yield parsed JSON objects, skipping unparseable lines."""
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                value = json.loads(line)
                if isinstance(value, dict):
                    yield value
            except json.JSONDecodeError:
                continue


def compact_json(value, limit):
    """One-line JSON preview of tool arguments."""
    try:
        s = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        s = str(value)
    return clip(s, limit)


def log_activity(path):
    """Return (first timestamp, record count) for a sidechain JSONL."""
    first = None
    count = 0
    for event in read_jsonl(path):
        count += 1
        if first is None:
            first = parse_ts(event.get("timestamp"))
    return first, count


def assign_subagent_activity(turns, started, count):
    """Attribute a child log to the parent turn active when it started."""
    if not turns or not count:
        return
    target = turns[0]
    if started is not None:
        for turn in turns:
            if turn.get("started") is not None and turn["started"] <= started:
                target = turn
            else:
                break
    target["subagent_events"] += count


# ---------------------------------------------------------------- claude ----


def claude_home():
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")


def claude_project_dir(cwd):
    """Claude Code encodes the project cwd by replacing /, . and _ with -."""
    return claude_home() / "projects" / re.sub(r"[/._]", "-", str(cwd))


def claude_candidates(cwd):
    d = claude_project_dir(cwd)
    if not d.is_dir():
        return []
    return sorted(d.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)


def flatten_result_content(content):
    """tool_result content may be a string or a list of typed blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
                elif block.get("type") == "image":
                    parts.append("[image]")
                else:
                    parts.append(json.dumps(block, ensure_ascii=False)[:120])
            else:
                parts.append(str(block))
        return "\n".join(parts)
    return json.dumps(content, ensure_ascii=False) if content is not None else ""


def parse_claude(path):
    """Claude Code adapter: one JSONL of user/assistant/system events."""
    turns = []
    current = None
    open_calls = {}  # tool_use_id -> event dict, for result/duration pairing
    title = None
    session_id = None
    cwd = None

    def close_turn():
        if current is not None:
            current["ended"] = current["events"][-1]["ts"] if current["events"] else current["started"]
            turns.append(current)

    def new_turn(text, ts):
        nonlocal current
        close_turn()
        current = {
            "index": len(turns) + 1,
            "user_text": clip(text, MAX_USER),
            "started": ts,
            "ended": None,
            "events": [],
            "subagent_events": 0,
        }

    def ensure_turn(ts):
        nonlocal current
        if current is None:
            new_turn("(session resumed mid-turn)", ts)

    for e in read_jsonl(path):
        etype = e.get("type")
        if etype in ("ai-title", "custom-title"):
            title = e.get("customTitle") or e.get("aiTitle") or title
            session_id = session_id or e.get("sessionId")
            continue
        if etype == "queue-operation":
            # Mid-turn user messages arrive as queue enqueues, not user events.
            # Skip harness notifications; real duplicates of the next turn's
            # opening message are removed in a cleanup pass below.
            content = e.get("content")
            if (e.get("operation") == "enqueue" and content and current is not None
                    and not str(content).lstrip().startswith(("<task-notification", "[SYSTEM"))):
                current["events"].append({
                    "id": f"t{current['index']}e{len(current['events']) + 1}",
                    "kind": "user_note", "ts": parse_ts(e.get("timestamp")),
                    "text": clip(content, MAX_USER),
                })
            continue
        if etype not in ("user", "assistant", "system"):
            continue
        session_id = session_id or e.get("sessionId")
        cwd = cwd or e.get("cwd")
        ts = parse_ts(e.get("timestamp"))

        if e.get("isSidechain"):
            if current is not None:
                current["subagent_events"] += 1
            continue

        if etype == "system" and e.get("subtype") == "compact_boundary":
            ensure_turn(ts)
            current["events"].append({
                "id": f"t{current['index']}e{len(current['events']) + 1}",
                "kind": "compaction", "ts": ts, "text": "context compacted",
            })
            continue

        if etype == "user":
            msg = e.get("message", {})
            content = msg.get("content")
            # Only human-originated messages open a turn; other user-role events
            # (skill loads, command output injections, isMeta context) stay inside.
            origin_kind = (e.get("origin") or {}).get("kind")
            is_human = not e.get("isMeta") and origin_kind in (None, "human")
            if e.get("isCompactSummary"):
                ensure_turn(ts)
                if isinstance(content, str):
                    current["events"].append({
                        "id": f"t{current['index']}e{len(current['events']) + 1}",
                        "kind": "context", "ts": ts,
                        "text": clip(content, MAX_THINKING),
                    })
                continue
            if isinstance(content, str):
                # Slash-command records arrive wrapped in markers: show the
                # command plus its args as the turn text; command stdout and
                # bare invocations stay inside the current turn.
                if content.lstrip().startswith("<local-command-stdout"):
                    is_human = False
                m = re.match(r"\s*<command-name>(.*?)</command-name>", content, re.DOTALL)
                if m:
                    args = re.search(r"<command-args>(.*?)</command-args>", content, re.DOTALL)
                    arg_text = args.group(1).strip() if args else ""
                    content = (m.group(1).strip() + " " + arg_text).strip()
                    if not arg_text:
                        is_human = False
                if is_human:
                    new_turn(content, ts)
                else:
                    ensure_turn(ts)
                    current["events"].append({
                        "id": f"t{current['index']}e{len(current['events']) + 1}",
                        "kind": "context", "ts": ts,
                        "text": clip(content, MAX_THINKING),
                    })
                continue
            if isinstance(content, list):
                results = [b for b in content if isinstance(b, dict) and b.get("type") == "tool_result"]
                humans = [b for b in content if isinstance(b, dict) and b.get("type") in ("text", "image")]
                if results:
                    ensure_turn(ts)
                    for block in results:
                        call = open_calls.pop(block.get("tool_use_id"), None)
                        if call is None:
                            continue
                        call["result"] = clip(flatten_result_content(block.get("content")), MAX_RESULT)
                        call["status"] = "error" if block.get("is_error") else "ok"
                        if ts is not None and call["ts"] is not None:
                            call["duration_ms"] = max(0, ts - call["ts"])
                elif humans:
                    text = "\n".join(str(b.get("text", "[image]")) for b in humans)
                    if is_human:
                        new_turn(text, ts)
                    else:
                        ensure_turn(ts)
                        current["events"].append({
                            "id": f"t{current['index']}e{len(current['events']) + 1}",
                            "kind": "context", "ts": ts,
                            "text": clip(text, MAX_THINKING),
                        })
            continue

        if etype == "assistant":
            ensure_turn(ts)
            msg = e.get("message", {})
            usage = msg.get("usage") or {}
            context_tokens = None
            if usage:
                context_tokens = (
                    (usage.get("input_tokens") or 0)
                    + (usage.get("cache_read_input_tokens") or 0)
                    + (usage.get("cache_creation_input_tokens") or 0)
                )
            for block in msg.get("content", []):
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "thinking":
                    current["events"].append({
                        "id": f"t{current['index']}e{len(current['events']) + 1}",
                        "kind": "thinking", "ts": ts,
                        "text": clip(block.get("thinking"), MAX_THINKING),
                    })
                elif btype == "text":
                    current["events"].append({
                        "id": f"t{current['index']}e{len(current['events']) + 1}",
                        "kind": "assistant", "ts": ts,
                        "text": clip(block.get("text"), MAX_TEXT),
                        "context_tokens": context_tokens,
                        "output_tokens": usage.get("output_tokens"),
                    })
                elif btype == "tool_use":
                    event = {
                        "id": f"t{current['index']}e{len(current['events']) + 1}",
                        "kind": "tool", "ts": ts,
                        "tool": block.get("name"),
                        "args": compact_json(block.get("input"), MAX_ARGS),
                        "result": None, "status": None, "duration_ms": None,
                        "context_tokens": context_tokens,
                    }
                    current["events"].append(event)
                    if block.get("id"):
                        open_calls[block["id"]] = event
            continue

        if etype == "system" and e.get("level") == "error":
            ensure_turn(ts)
            current["events"].append({
                "id": f"t{current['index']}e{len(current['events']) + 1}",
                "kind": "system", "ts": ts,
                "text": clip(e.get("error") or "system error", MAX_TEXT),
                "status": "error",
            })

    close_turn()
    subagents = path.parent / path.stem / "subagents"
    if subagents.is_dir():
        for child in subagents.glob("*.jsonl"):
            assign_subagent_activity(turns, *log_activity(child))
    return {
        "host": "claude-code",
        "session": {"id": session_id, "path": str(path), "cwd": cwd, "title": title},
        "context_window": None,
        "turns": turns,
    }


# ----------------------------------------------------------------- codex ----


def codex_home():
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")


def codex_candidates(cwd):
    """Rollout files whose session_meta cwd matches, newest first."""
    root = codex_home() / "sessions"
    if not root.is_dir():
        return []
    matched = []
    for p in sorted(root.rglob("rollout-*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                head = f.readline()
            meta = json.loads(head)
            if meta.get("type") == "session_meta" and meta.get("payload", {}).get("cwd") == str(cwd):
                matched.append(p)
        except (OSError, json.JSONDecodeError):
            continue
    return matched


def parse_codex(path):
    """Codex adapter: rollout JSONL of session_meta/event_msg/response_item."""
    turns = []
    current = None
    open_calls = {}  # call_id -> event dict
    session_id = None
    cwd = None
    context_window = None
    last_context = None

    def close_turn():
        if current is not None:
            current["ended"] = current["events"][-1]["ts"] if current["events"] else current["started"]
            turns.append(current)

    def new_turn(text, ts):
        nonlocal current
        close_turn()
        current = {
            "index": len(turns) + 1,
            "user_text": clip(text, MAX_USER),
            "started": ts,
            "ended": None,
            "events": [],
            "subagent_events": 0,
        }

    def ensure_turn(ts):
        if current is None:
            new_turn("(session resumed mid-turn)", ts)

    def add_event(ts, **fields):
        ensure_turn(ts)
        event = {"id": f"t{current['index']}e{len(current['events']) + 1}", "ts": ts}
        event.update(fields)
        current["events"].append(event)
        return event

    for e in read_jsonl(path):
        etype = e.get("type")
        payload = e.get("payload") or {}
        ts = parse_ts(e.get("timestamp"))

        if etype == "session_meta":
            session_id = session_id or payload.get("id") or payload.get("session_id")
            cwd = cwd or payload.get("cwd")
            continue

        if etype == "compacted":
            add_event(ts, kind="compaction", text="context compacted")
            continue

        if etype == "event_msg":
            ptype = payload.get("type")
            if ptype == "user_message":
                text = payload.get("message") or ""
                # Codex prepends attached-file boilerplate; keep the request part.
                marker = "## My request:"
                if marker in text:
                    text = text.split(marker, 1)[1]
                new_turn(text, ts)
            elif ptype == "task_started":
                context_window = payload.get("model_context_window") or context_window
            elif ptype == "agent_message":
                add_event(ts, kind="assistant", text=clip(payload.get("message"), MAX_TEXT),
                          context_tokens=last_context)
            elif ptype == "agent_reasoning":
                add_event(ts, kind="thinking", text=clip(payload.get("text"), MAX_THINKING))
            elif ptype == "token_count":
                info = (payload.get("info") or {}).get("last_token_usage") or {}
                if info:
                    # OpenAI-style usage: cached_input_tokens is a breakdown of
                    # input_tokens, not an addition to it.
                    last_context = info.get("input_tokens") or 0
            elif ptype == "error":
                add_event(ts, kind="system", text=clip(payload.get("message"), MAX_TEXT), status="error")
            continue

        if etype == "response_item":
            ptype = payload.get("type")
            if ptype in ("function_call", "custom_tool_call", "tool_search_call"):
                args = payload.get("arguments")
                if args is None:
                    args = payload.get("input")
                event = add_event(
                    ts, kind="tool", tool=payload.get("name") or ptype,
                    args=clip(args, MAX_ARGS) if isinstance(args, str) else compact_json(args, MAX_ARGS),
                    result=None, status=None, duration_ms=None,
                    context_tokens=last_context,
                )
                if payload.get("call_id"):
                    open_calls[payload["call_id"]] = event
            elif ptype in ("function_call_output", "custom_tool_call_output", "tool_search_output"):
                call = open_calls.pop(payload.get("call_id"), None)
                if call is not None:
                    output = payload.get("output")
                    if output is None and "tools" in payload:
                        output = compact_json(payload.get("tools"), MAX_RESULT)
                    call["result"] = clip(output, MAX_RESULT)
                    failed = isinstance(output, str) and re.search(
                        r"(?m)^(?:Exit code:\s*|Process exited with code\s+)[1-9]\d*\b",
                        output,
                    )
                    call["status"] = "error" if failed else "ok"
                    if ts is not None and call["ts"] is not None:
                        call["duration_ms"] = max(0, ts - call["ts"])
            continue

    close_turn()
    if session_id:
        sessions_root = next((parent for parent in path.parents if parent.name == "sessions"), None)
        children = (
            sessions_root.rglob("rollout-*.jsonl")
            if sessions_root is not None
            else path.parent.glob("rollout-*.jsonl")
        )
        for child in children:
            if child == path:
                continue
            try:
                with open(child, encoding="utf-8", errors="replace") as f:
                    meta = json.loads(f.readline())
            except (OSError, json.JSONDecodeError):
                continue
            payload = meta.get("payload") if isinstance(meta, dict) else None
            if not isinstance(payload, dict) or payload.get("parent_thread_id") != session_id:
                continue
            assign_subagent_activity(turns, *log_activity(child))
    return {
        "host": "codex",
        "session": {"id": session_id, "path": str(path), "cwd": cwd, "title": None},
        "context_window": context_window,
        "turns": turns,
    }


# ------------------------------------------------------------------ main ----


def finalize(data):
    """Fill per-turn stats and session totals."""
    # A queued message is logged twice: as an enqueue (user_note) and again as
    # the next turn's opening user event. Drop the duplicate note.
    turns = data["turns"]
    for i, turn in enumerate(turns[:-1]):
        opener = str(turns[i + 1].get("user_text") or "")
        turn["events"] = [
            e for e in turn["events"]
            if not (e.get("kind") == "user_note" and opener and str(e.get("text") or "") == opener)
        ]
    for turn in data["turns"]:
        tools = [e for e in turn["events"] if e.get("kind") == "tool"]
        errors = [e for e in turn["events"] if e.get("status") == "error"]
        contexts = [e["context_tokens"] for e in turn["events"] if e.get("context_tokens")]
        started, ended = turn.get("started"), turn.get("ended")
        completed = [
            e["ts"] + (e.get("duration_ms") or 0)
            for e in turn["events"]
            if e.get("ts") is not None
        ]
        if completed:
            ended = max([ended] + completed) if ended is not None else max(completed)
            turn["ended"] = ended
        turn["stats"] = {
            "events": len(turn["events"]),
            "tool_calls": len(tools),
            "errors": len(errors),
            "duration_ms": (ended - started) if started is not None and ended is not None else None,
            "context_end": contexts[-1] if contexts else None,
        }
    data["schema"] = SCHEMA
    data["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return data


def discover(host, cwd):
    """Return (host, path) of the newest matching session, or exit with help."""
    claude = claude_candidates(cwd) if host in ("auto", "claude") else []
    codex = codex_candidates(cwd) if host in ("auto", "codex") else []
    best = None
    for h, paths in (("claude", claude), ("codex", codex)):
        if paths:
            candidate = (h, paths[0])
            if best is None or candidate[1].stat().st_mtime > best[1].stat().st_mtime:
                best = candidate
    if best is None:
        sys.exit(
            f"No session log found for cwd {cwd}.\n"
            f"Searched: {claude_project_dir(cwd)} and {codex_home() / 'sessions'}.\n"
            "Pass --session <path> explicitly, or run from the project directory."
        )
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", choices=["auto", "claude", "codex"], default="auto")
    ap.add_argument("--session", help="explicit session log path (overrides discovery)")
    ap.add_argument("--cwd", default=os.getcwd(), help="project directory for discovery")
    ap.add_argument("--list", action="store_true", help="list candidate session logs and exit")
    ap.add_argument("-o", "--output", help="write JSON here instead of stdout")
    args = ap.parse_args()

    env_session = os.environ.get("AGENT_TRAJECTORY_SESSION")
    session = args.session or env_session

    if args.list:
        for h, paths in (("claude", claude_candidates(args.cwd)), ("codex", codex_candidates(args.cwd))):
            for p in paths[:10]:
                mtime = datetime.fromtimestamp(
                    p.stat().st_mtime, timezone.utc
                ).astimezone().isoformat(timespec="seconds")
                print(f"{h}\t{mtime}\t{p}")
        return

    if session:
        path = Path(session).expanduser()
        if not path.is_file():
            sys.exit(f"Session log not found: {path}")
        host = args.host
        if host == "auto":
            host = "codex" if path.name.startswith("rollout-") else "claude"
    else:
        host, path = discover(args.host, args.cwd)

    data = parse_claude(path) if host == "claude" else parse_codex(path)
    data = finalize(data)
    if not data["turns"]:
        sys.exit(
            f"No parseable Claude Code or Codex turns found in {path}.\n"
            "Pass the matching --host, or convert another log to agent-trajectory/v1."
        )
    out = json.dumps(data, ensure_ascii=False, indent=1)
    if args.output:
        Path(args.output).write_text(out, encoding="utf-8")
        total = sum(t["stats"]["tool_calls"] for t in data["turns"])
        print(f"{data['host']}: {len(data['turns'])} turns, {total} tool calls -> {args.output}")
    else:
        print(out)


if __name__ == "__main__":
    main()
