---
name: agent-trajectory
description: Turn a Claude Code or Codex session log (or normalized agent-trajectory/v1 JSON from another host) into a trajectory viewer — per-turn ledger of every tool call, zoomable timeline with context-usage curve, live-updating local server, in-page Ask-AI, HTML/PDF export, and an optional "learn" tier where the agent annotates each step with goals, whys, and a per-turn storyline for people studying how agents work.
---

# Agent Trajectory

Visualize what an agent actually did, turn by turn: every tool call with its
arguments, result, duration and status, a category-tagged ledger, and a
timeline with the context-window usage curve. Two tiers:

- **raw** (default): pure log parsing, no model calls, instant.
- **learn**: raw + AI-written annotations — a one-line goal per turn, a short
  "why" under pivotal tool calls, and a 2–4 sentence storyline per turn. For
  people learning how agents work under the hood.

Everything runs locally; the log never leaves the machine. All bundled files
live next to this SKILL.md — use absolute paths (`<skill-dir>` below). Work
files go in a temp dir (`<tmp>`).

## Choose the delivery mode first

- **Live** (preferred when the user wants to watch the current/ongoing
  session, says "real-time", or will keep working): run `serve.py` in the
  background and give the user the URL. The page follows the log as it grows.
- **Static** (preferred for a finished session, sharing, or archiving): run
  the parse → render pipeline and hand over one self-contained HTML file.

The live page has HTML (snapshot download) and PDF (print) export buttons, so
a live session can always be turned into a static artifact later.

## Live mode

```sh
python3 <skill-dir>/serve.py [--session <path>] [--annotations <tmp>/annotations.json] [--port 7469]
```

- Run it in the background; tell the user the URL (`http://127.0.0.1:<port>/`).
  If the host has an embedded browser/preview pane, open it there.
- Discovery is automatic (newest session for the current working directory,
  Claude Code and Codex). Same `--session` / `--host` overrides as the parser.
- The in-page **Ask AI** drawer answers questions through a local CLI —
  autodetected `claude -p` or `codex exec`, or `$AGENT_TRAJECTORY_ASK_CMD`
  (an argv-style command template where `{q}` becomes one argument). If none is
  available the page falls back to copy-to-clipboard; mention that.
- For the learn tier, write the annotations file (contract below) and pass
  `--annotations` — the server re-reads it on change, so annotations can be
  added while the page is already open.

## Static mode

### 1. Parse

```sh
python3 <skill-dir>/parse_trajectory.py -o <tmp>/trajectory.json
```

Useful flags: `--list` (show candidate session logs), `--session <path>`
(explicit log, any host; also `$AGENT_TRAJECTORY_SESSION`), `--host
claude|codex`, `--cwd <dir>`. If discovery fails on an unsupported host,
locate the transcript yourself and pass `--session`; if there is no parseable
log at all, say which hosts are supported instead of fabricating data.

### 2. Decide the tier

Default **raw**. Use **learn** when the user asks for the teaching /
annotated / explained version (e.g. "教学档", "learn mode", "explain each
step"). If the user invoked this skill with no tier hint and the session is
small (< ~40 tool calls), prefer learn — it is the differentiating tier — and
say so.

### 3. (learn tier) Write annotations

Read `<tmp>/trajectory.json`, write `<tmp>/annotations.json`:

```json
{
  "lang": "<language of the conversation>",
  "turns": [
    {
      "index": 1,
      "goal": "one sentence: what this turn set out to do",
      "story": "2–4 sentences retelling what actually happened, including failures and pivots",
      "whys": { "<event id>": "one sentence: why the agent took this step" }
    }
  ]
}
```

Honesty rules — these keep annotations trustworthy:

- Ground every sentence in the parsed events (tool names, args, results,
  errors, user_note corrections). Never invent steps not present in the JSON.
- Write in the conversation's language.
- `whys` are sparse: the 5–10 pivotal calls per turn (first probe of a new
  direction, a failure, the fix, the verification), keyed by event `id`.
- Failures and dead ends are the most instructive parts; never smooth them
  over in `story`.
- A turn with no tool calls still gets `goal` and `story` (no `whys`).

### 4. Render

```sh
python3 <skill-dir>/render.py --data <tmp>/trajectory.json [--annotations <tmp>/annotations.json] -o ./agent-trajectory-<yyyymmdd-HHMM>.html
```

Write the output into the current working directory (or where the user asked).

### 5. Present

- If the host can render or attach files in its own UI (e.g. Claude Code
  desktop renders HTML inline), send the file that way.
- Otherwise open it in the default browser (`open` / `xdg-open`) or print the
  absolute path.
- Mention the built-ins once: click a row for full arguments/result, sidebar
  turn navigator and category filters, search, wheel-zoom on the timeline,
  Annotations toggle (learn ↔ raw in place), HTML/PDF export, Ask AI drawer.

## Normalized JSON (adapter contract)

`parse_trajectory.py` emits `agent-trajectory/v1`; to support another host,
produce this shape and feed it to `render.py`/`serve.py` (or add an adapter
function — see README):

```
{ schema, host, session: {id, path, cwd, title},
  context_window: int|null,
  turns: [ { index, user_text, started, ended, subagent_events,
             events: [ { id, kind: tool|assistant|thinking|user_note|context|system|compaction,
                         ts, tool?, args?, result?, status?, duration_ms?,
                         text?, context_tokens? } ],
             stats: {events, tool_calls, errors, duration_ms, context_end} } ] }
```

## Notes

- Long content is clipped in the report (marker: `…[+N chars]`); the full text
  stays in the original log.
- The context curve is the model's actual per-request context footprint;
  compaction drops show as cliffs. Idle gaps > 60 s are compressed out of the
  timeline and marked `≈`.
- Subagent (sidechain) traffic is tallied per turn, not expanded.
