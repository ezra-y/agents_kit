---
name: pp-agent-capture
description: "macOS screen capture, window recording, GIF conversion, and agent evidence bundles from the terminal. Built on ScreenCaptureKit for window-level targeting ffmpeg cannot do. Use when the user wants a screenshot of a specific window or app, a screen recording, a GIF conversion, a before/after diff, an evidence bundle for a PR, OCR text from a window, a terminal VHS recording, a Remotion render, or wants to watch a UI for changes. Requires macOS Screen Recording permission on first run."
author: "Matt Van Horn"
license: "Apache-2.0"
argument-hint: "<command> [args] | install cli|mcp"
allowed-tools: "Read Bash"
metadata:
  openclaw:
    requires:
      bins:
        - agent-capture-pp-cli
    install:
      - kind: go
        bins: [agent-capture-pp-cli]
        module: github.com/mvanhorn/printing-press-library/library/developer-tools/agent-capture/cmd/agent-capture-pp-cli
---
# Agent Capture - Printing Press CLI

## Prerequisites: Install the CLI

This skill drives the `agent-capture-pp-cli` binary. **You must verify the CLI is installed before invoking any command from this skill.** If it is missing, install it first:

1. Install via the Printing Press installer. It defaults binaries to `$HOME/.local/bin` on macOS/Linux and `%LOCALAPPDATA%\Programs\PrintingPress\bin` on Windows:
   ```bash
   npx -y @mvanhorn/printing-press-library install agent-capture --cli-only
   ```
2. Verify: `agent-capture version`
3. Ensure the reported install directory is on `$PATH` for the agent/runtime that will invoke this skill.

If the `npx` install fails (no Node, offline, etc.), fall back to a direct Go install (requires Go 1.26.5 or newer):

```bash
go install github.com/mvanhorn/printing-press-library/library/developer-tools/agent-capture/cmd/agent-capture-pp-cli@latest
```

If `agent-capture version` reports "command not found" after install, the runtime
cannot see the binary directory on `$PATH`. Do not proceed with skill commands
until verification succeeds.

## When to Use This CLI

Reach for this when the user wants:

- screenshot a specific window or app (`screenshot`, `batch` for multiple)
- record video of a window, app, display, or region (`record`)
- convert a recording to an optimized GIF (`convert`)
- do a full capture + record + GIF pipeline in one command (`pipeline`)
- diff against a baseline screenshot (`diff`) for before/after evidence
- bundle screenshots + recording + GIF as evidence for a PR or bug report (`evidence`)
- find the right window by fuzzy-matching its title (`find`)
- stitch multiple screenshots into an animated GIF (`stitch`)
- extract text from a window using macOS Vision OCR (`ocr`)
- record a terminal session via VHS tape files (`vhs`)
- render Remotion compositions to video or stills (`remotion`)
- monitor a UI by periodic screenshots (`watch`)
- save and replay capture configs (`preset`)

Skip it on non-macOS hosts; the CLI uses ScreenCaptureKit (macOS only). On first run it will prompt for Screen Recording permission; the `permissions` command guides that flow.

## Argument Parsing

Parse `$ARGUMENTS`:

1. **Empty, `help`, or `--help`** -> show `agent-capture --help`
2. **Starts with `install`** -> CLI installation (no MCP server ships today)
3. **Anything else** -> Direct Use (map to the best command and run it)
## Direct Use

1. Check installed: `which agent-capture`. If missing, offer CLI installation.
2. If permissions aren't granted, run `agent-capture permissions` first.
3. Use `agent-capture list` to see available capture targets (open windows, displays).
4. Use `agent-capture find <text>` to fuzzy-match a window title before capturing.
5. Execute with `--json` for structured output (agent-native default):
   ```bash
   agent-capture <command> [args] --json
   ```

## Required Workflow for Recording UI Actions

Use this sequence for transient UI, animations, and any recording that requires a
click or keyboard action. Do not start with the UI action.

1. **Locate the real target.**
   - Run `agent-capture health --json`.
   - Enumerate targets with `agent-capture list windows --json` and
     `agent-capture list displays --json`.
   - Match the window using its ID, app, bundle identifier, title, and bounds.
     Negative coordinates are normal on multi-display Macs.
   - When names are duplicated or the target is uncertain, capture a still of the
     candidate window and inspect it before proceeding.
   - Bring the target window to the front, then capture the selected display or
     region and inspect that still too. An accessibility tree or isolated window
     screenshot does not prove that the window is visible in the real recording
     surface. Do not start recording while the target is behind another window, on
     another Space, or outside the selected display or region.
2. **Choose the capture boundary.**
   - Use `--window-id` when the complete action remains inside one window.
   - Use the verified display or region when the action crosses windows, overlays,
     popovers, or window boundaries. A window recording cannot prove what happened
     outside that window.
3. **Start recording before touching the UI.**
   - Start `agent-capture record` with a fixed duration in a reusable background or
     PTY session.
   - Choose a duration that covers tool scheduling as well as the animation. When
     UI actions happen through later computer-control calls, allow at least 120
     seconds unless measured local latency proves a shorter duration is safe.
   - Read the session output and wait until it prints
     `Recording window:<id> ...`, `Recording display:<id> ...`, or
     `Recording region:...`.
   - This line is the ready handshake. Do not click, type, switch apps, or trigger
     the animation before it appears.
4. **Trigger only the planned action after ready.**
   - Re-read the current UI state with the computer-control tool.
   - When possible, perform the exact open click, wait for the stable state, read
     fresh UI state, perform the planned close action, and wait for completion
     inside one computer-control call. This avoids losing the recording window to
     latency between separate tool calls.
   - Confirm that the intended window and control actually responded. Do not infer
     success from the click command alone.
5. **Finish the recording cleanly.**
   - The current recorder is duration based and has no separate stop command.
   - Wait for the recording process to exit normally with code `0`; do not send
     `Ctrl-C`, which can leave an incomplete movie.
6. **Validate before analysis.**
   - Use `ffprobe` to verify the file is decodable, has nonzero duration and frames,
     and has dimensions consistent with the selected target.
   - Inspect a contact sheet or extracted frames to confirm the target, cursor, and
     complete action are visible.
   - Treat recordings made before ready, recordings of the wrong display/window,
     missed clicks, obstructed animations, or incomplete transitions as invalid.
     Re-record them instead of drawing conclusions from them.

Example window recording:

```bash
agent-capture record \
  --window-id <WINDOW_ID> \
  --duration 120 \
  --fps 60 \
  --quality high \
  --cursor \
  --json \
  /absolute/path/open-close.mov
```

## Notable Commands

| Command | What it does |
|---------|--------------|
| `screenshot` | Capture a window, app, display, or region |
| `record` | Record video of a window, app, display, or region |
| `pipeline` | Record + convert + optimize in one command |
| `convert` | Video -> optimized GIF (two-pass palette) |
| `diff` | Capture + diff against a baseline |
| `evidence` | Full bundle (screenshots + recording + GIF) for a PR |
| `batch` | Screenshot multiple apps in one invocation |
| `find` | Fuzzy search open window titles |
| `list` | List available capture targets |
| `ocr` | Extract text from a window using macOS Vision |
| `stitch` | Combine screenshots into an animated GIF |
| `vhs` | Run a VHS tape file for terminal recording |
| `remotion` | Render Remotion compositions |
| `watch` | Periodic capture for UI monitoring |
| `preset` | Save / load capture configs |
| `permissions` | Guide Screen Recording permission setup |
| `health` | Machine-readable CI / agent preflight |

Run any command with `--help` for full flag documentation.

## Agent Mode

Add `--agent` to any command. Expands to: `--json --compact --no-input --no-color --yes`.

- **Pipeable** — JSON on stdout, errors on stderr
- **Filterable** — `--select` keeps a subset of fields, with dotted-path support (see below)
- **Previewable** — `--dry-run` shows the request without sending
- **Cacheable** — GET responses cached for 5 minutes, bypass with `--no-cache`
- **Non-interactive** — never prompts, every input is a flag


### Filtering output

`--select` accepts dotted paths to descend into nested responses; arrays traverse element-wise:

```bash
<cli>-pp-cli <command> --agent --select id,name
<cli>-pp-cli <command> --agent --select items.id,items.owner.name
```

Use this to narrow huge payloads to the fields you actually need — critical for deeply nested API responses.


## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Usage error (wrong arguments) |
| 3 | Target not found (no matching window or display) |
| 4 | Permissions missing (Screen Recording not granted) |
| 5 | Capture error (ScreenCaptureKit failure, ffmpeg failure) |
