<h1 align="center">agent-trajectory</h1>

<p align="center">English | <a href="README.zh.md">中文</a></p>

<p align="center"><img src="assets/trajectory-overview.png" alt="Session trajectory overview"></p>

<p align="center"><strong>See what your AI agent actually did — turn by turn, tool by tool, token by token.</strong></p>

`agent-trajectory` turns a Claude Code or Codex session log (or normalized
`agent-trajectory/v1` JSON from another host) into a trajectory viewer: a
per-turn ledger of every tool call with
its arguments, result, duration and status; a zoomable timeline with a
context-window usage curve; and an optional **learn tier** where an AI annotates
every step — what the turn set out to do, why each pivotal call was made, and a
short storyline of what actually happened, failures included.

Built for people learning how agents work under the hood, and for anyone who
wants to review what an agent did on their machine.

## Highlights

- **Two tiers.** *Raw* is pure log parsing — no model calls, instant.
  *Learn* adds AI-written annotations (per-turn goal, per-step why, per-turn
  storyline), grounded strictly in the parsed events so it can't invent steps.
- **Live mode.** `serve.py` watches the session log and updates the page while
  the agent works. Real-time, local, zero dependencies.
- **Ask AI.** Hover any step, press 问AI — the question lands in a notebook
  drawer. In live mode it's answered in-page by a local CLI (`claude -p` /
  `codex exec` / anything via `$AGENT_TRAJECTORY_ASK_CMD`); in a static page
  it's copied for pasting into any chat.
- **Self-contained output.** One HTML file, no network, no build step, light
  and dark, print-to-PDF ready. Send it to anyone.

## Quick start

```sh
# live view of your current session (run inside your project directory)
python3 serve.py --open

# or: one static HTML file
python3 parse_trajectory.py -o /tmp/traj.json
python3 render.py --data /tmp/traj.json -o trajectory.html
```

Everything is Python 3.9+ stdlib. Nothing leaves your machine.

### As an Agent Skill

The repo doubles as a skill: `SKILL.md` tells a host agent (Claude Code, Codex,
or anything that reads skills) how to run the pipeline and — for the learn
tier — how to write the annotations JSON. Install it wherever your agent looks
for skills, then say "show me this session's trajectory" or ask for the
"learn / annotated" version.

## How it works

```
session log (JSONL)          annotations (learn tier, AI-written)
      │                                  │
parse_trajectory.py  ──►  trajectory JSON (agent-trajectory/v1)
      │                                  │
      └── render.py ── static HTML ◄─────┘
      └── serve.py ─── live HTML + /api/trajectory + /api/ask + /export
```

Session discovery is automatic per host (newest session for the current
working directory):

| Host | Default location | Override |
|---|---|---|
| Claude Code | `~/.claude/projects/<munged-cwd>/*.jsonl` | `$CLAUDE_CONFIG_DIR` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` (matched by cwd) | `$CODEX_HOME` |
| any file | — | `--session <path>` / `$AGENT_TRAJECTORY_SESSION` |

## The normalized schema (`agent-trajectory/v1`)

```jsonc
{
  "schema": "agent-trajectory/v1",
  "host": "claude-code",
  "session": { "id": "...", "path": "...", "cwd": "...", "title": "..." },
  "context_window": 200000,          // tokens, when the host reports it
  "turns": [{
    "index": 1,
    "user_text": "...",              // what the user asked
    "started": 1755200000000, "ended": 1755200600000,
    "subagent_events": 0,            // sidechain traffic, tallied not expanded
    "events": [{
      "id": "t1e3",                  // stable anchor for annotations
      "kind": "tool",                // tool | assistant | thinking | user_note
                                     // | context | system | compaction
      "ts": 1755200001000,
      "tool": "Bash", "args": "{...}", "result": "...",
      "status": "ok",                // ok | error | null (no result recorded)
      "duration_ms": 2000,
      "context_tokens": 129097       // context footprint after this request
    }],
    "stats": { "events": 20, "tool_calls": 17, "errors": 1,
               "duration_ms": 681000, "context_end": 129097 }
  }]
}
```

Annotations are a separate JSON keyed by turn index and event id — see
`SKILL.md` for the exact contract and the honesty rules the annotating agent
must follow (grounded in parsed events; failures never smoothed over).

## Adding a host adapter

1. Write `parse_<host>(path)` in `parse_trajectory.py` returning the schema
   above (look at `parse_claude` / `parse_codex` — ~100 lines each).
2. Register it in `discover()` if sessions can be found automatically.
3. Add a fixture test in `tests/test_parse.py`.

The viewer, live server, annotations, and exports work unchanged.

## Design

Typography, color tokens, and the tool-category palette live in
[DESIGN.md](DESIGN.md). The categorical palette (MCP / Shell / Skill / File /
Web / Agent) passes a colorblind-safety and contrast validator in both light
and dark mode, and category color never appears without a text label.

## Development

```sh
python3 -m unittest discover -s tests   # run the full test suite
```

Notable engineering decisions, learned the hard way:

- **No infinite CSS animations.** A forever-running keyframe stalls screenshot
  pipelines in embedded browser panes. The LIVE dot blinks from JS only when
  data actually arrives.
- **The timeline is a virtualized canvas.** A single wide SVG/canvas layer
  (26k px) wedges compositors; instead a cheap spacer provides the scroll range
  and a viewport-sized sticky canvas redraws only the visible window.
- **Gap compression.** Idle gaps > 60 s collapse to a fixed sliver marked `≈`,
  so an 18-hour session doesn't become an ocean of blank pixels.
- **Token accounting differs per host.** Anthropic-style usage:
  context = `input + cache_read + cache_creation`. OpenAI-style usage:
  `cached_input_tokens` is a *subset* of `input_tokens` — don't add them.

## License

[MIT](LICENSE)
