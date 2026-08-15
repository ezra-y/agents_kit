# Design Tokens

The viewer is a single HTML file; every token below lives in `:root` of
`assets/template.html`. Change them there — nothing else hardcodes a color or
size.

## Typography

System font stacks only (zero network requests, native rendering on every OS).

| Token | Value | Used for |
|---|---|---|
| base size | **16px** | body text, user messages, annotations |
| `--fs-meta` | 13px | chips, durations, axis labels, badges |
| `--fs-mono` | 13.5px | tool args, results, code |
| `--fs-h1` | 21px | session title |
| `--fs-h2` | 12px uppercase | panel titles |
| line height | 1.65 body · 1.5 mono | |

Mono stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

## Neutrals

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#f4f4f6` | `#121216` |
| `--surface` | `#ffffff` | `#1b1b21` |
| `--surface-2` | `#f8f8fa` | `#22222a` |
| `--ink` | `#17171c` | `#ecedf2` |
| `--ink-2` | `#55555e` | `#a3a4b0` |
| `--ink-3` | `#82828c` | `#75757f` |
| `--line` | `#e4e4ea` | `#2d2d36` |
| `--accent` | `#5150c4` | `#9c9bf0` |
| `--accent-soft` | `#eeeefb` | `#282840` |

Status (reserved, never used as category colors): ok `#237a4b`/`#6fc793`,
error `#b93a2e`/`#e2837a`, warn `#96650a`/`#d3a94a`.

## Tool category palette

Six categories + a neutral. Both modes pass the dataviz six-check validator
(lightness band, chroma floor, CVD separation, normal-vision floor, contrast
vs surface); category color never appears without its text label.

| Category | Matches | Light | Dark |
|---|---|---|---|
| `mcp` | `mcp__*` (badge shows server name) | `#8A55C9` | `#A272E0` |
| `shell` | Bash, exec_command, terminal | `#B26312` | `#CC8130` |
| `skill` | Skill loads (badge shows skill name) | `#C24B8E` | `#D65F9F` |
| `file` | Read/Write/Edit/apply_patch/Notebook | `#2E7DD1` | `#5A96D6` |
| `web` | search/fetch/browser/computer use | `#1F8A70` | `#2FA97F` |
| `agent` | Task/subagent/workflow delegation | `#96650A` | `#BA8A14` |
| `other` | everything else (Todo, Plan, misc) | `--ink-3` | `--ink-3` |

## Spacing & shape

4px scale (4/8/12/16/20/24/32). Radius: 8px controls, 12px cards, 999px pills.
Shadows only on floating layers (tooltip, drawer, toast).

## Layout

- ≤ 960px (side-panel case): single column, sticky compact toolbar.
- \> 960px: sticky left sidebar (256px) — session card, turn navigator,
  category filters, search. Content column max 980px.
- \> 1600px: content column may grow to 1120px; the rest stays margin —
  line length caps at ~90ch for readability.
- The overview strip and every `pre` scroll **internally**; the page itself
  never scrolls horizontally.
