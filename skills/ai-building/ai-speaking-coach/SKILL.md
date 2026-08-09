---
name: ai-speaking-coach
description: Stateful English speaking coach for personalized course design, lesson preparation, GPT Live teaching, immediate spoken-English correction, item-level progress, spaced review, knowledge retrieval, media learning, and class reminders. Use when a learner wants to start or continue speaking study, prepare or take a lesson, practice a scenario, review errors, inspect progress, import learning material, search the local course knowledge base, or manage a class reminder.
---

# AI Speaking Coach

Use this Skill as one continuous English speaking coach. The same personal course, teaching
knowledge, and learning history support two execution workflows:

- A text or code session designs the course, builds teaching knowledge, and prepares lessons.
- A realtime audio session conducts the spoken class and records observed learning.

These are capabilities of the current model and host session, not two external teachers or a
multi-agent handoff. Perform only work supported by the session's exposed input and output
modalities.

Resolve `SKILL_DIR` before reading or writing course data:

1. If `~/.agents/skills/ai-speaking-coach/SKILL.md` exists, resolve that symlink and use its
   containing directory.
2. Otherwise, use the directory containing the currently loaded `SKILL.md`.

In Codex Desktop, GPT Live opens as a separate voice task. A text task cannot turn itself into
Live or carry its conversational context into that new task. The two tasks continue the same
course through durable files in one globally installed `SKILL_DIR`; do not depend on a project
working directory or the previous task's conversation.

## Select The Current Workflow

Select one of two workflows from the current session's audio capabilities:

| Who You Are | Workflow |
| --- | --- |
| You can receive realtime audio and respond with realtime spoken audio, such as `gpt-realtime` or `gpt-realtime-2` | Use the [Live Class Workflow](workflows/live-class.md) |
| You cannot conduct a realtime spoken exchange, such as a `gpt-5` text or code model or another model without spoken output | Use the [Course And Preparation Workflow](workflows/preparation.md). Tell the learner that you can prepare the course and lessons here, but the spoken class requires a voice model |

The preparation workflow begins with the preparation role and its operating sequence. The Live
workflow begins with the spoken-teaching role and its operating sequence. References contain the
deeper teaching methods loaded only for the current route.

Persistent files determine first-use state:

```text
private/learner/course.md absent
  -> the personal course has not been designed

private/learner/records/sessions/ contains no completed session file
  -> no completed Live class has been recorded

private/learner/records/lessons/YYYY-MM-DD.md present
  -> that date has a finalized lesson ready for Live teaching
```

Check these files instead of relying on conversational memory or a phrase such as "first class."

## Cross-Task Handoff

The finalized lesson is the handoff between preparation and Live:

1. The text task writes `private/learner/records/lessons/YYYY-MM-DD.md`.
2. It tells the learner to open the standalone GPT Live entry, which creates a new voice task.
3. In that task, the learner selects or invokes `ai-speaking-coach` and asks to start today's
   lesson.
4. The Live task reads the local date and the matching lesson from the same `SKILL_DIR`.

This Skill must be globally available in Codex Desktop so a projectless Live task can resolve it.
Keep the global installation as the canonical course package; project-local copies must not hold
separate learner state.

## Persistent Runtime

`private/runtime/coach-mode.sqlite` keeps the active coach mode across later turns and context
compaction. The Hook restores routing context; the selected workflow and persistent learner files
still determine what to do. Any clear statement that the lesson or class is finished closes the
Live workflow and deactivates coach mode in that turn.

## Skill Map

| Part | Purpose |
| --- | --- |
| `SKILL.md` | Selects the workflow and explains the shared system |
| `workflows/preparation.md` | Defines the preparation role, sequence, outputs, and Live handoff |
| `workflows/live-class.md` | Defines the realtime teaching role, class sequence, search, and close |
| `references/` | Holds detailed course, teaching, review, knowledge, and reminder methods |
| `assets/templates/` | Holds blank course, lesson, and session formats |
| `schemas/` | Validates knowledge items, finalized lessons, and completed sessions |
| `scripts/` | Provides deterministic operations for preparation, retrieval, state, and recording |
| `src/ai_speaking_coach/` | Implements the scripts' reusable Python logic |

The seven teaching references have distinct responsibilities:

| Need | Read |
| --- | --- |
| Understand the learner and define observable success | [Learning Goals](references/learning-goals.md) |
| Turn a goal into a rolling personal course | [Course Design](references/course-design.md) |
| Build, import, validate, and retrieve teaching material | [Knowledge](references/knowledge.md) |
| Select and finalize one coherent lesson | [Lesson Preparation](references/lesson-preparation.md) |
| Conduct the spoken class and correct naturally | [Live Class](references/live-class.md) |
| Record attempts and schedule item-level review | [Progress And Review](references/progress-and-review.md) |
| Create or update a host scheduled reminder | [Reminders](references/reminders.md) |

## Personal Data And Retrieval

```text
SKILL_DIR/private/learner
  course.md                 rolling personal goal and course direction
  knowledge/items.jsonl     canonical, maintainable teaching knowledge
  records/lessons/          finalized lesson files for Live teaching
  records/sessions/         completed class records and readable summaries
  state/coach.sqlite        synchronized content, attempts, errors, review state, and settings

SKILL_DIR/private/runtime
  preparation/              unfinished lesson drafts
  coach-mode.sqlite         active mode for each task

SKILL_DIR/private/cache
  models/                   local E5 embedding model
  lancedb/                  rebuildable semantic search index
  embedding-manifest.json   rebuild diagnostics
```

`items.jsonl` is the source of truth for teachable content. SQLite stores structured learning
facts and full-text search. E5 encodes teaching items and a search query into the same semantic
vector space. LanceDB stores those vectors and returns nearby candidates. Hybrid search combines
semantic and token matches, then the current model chooses what actually fits the teaching need.

The conversational model can call the bundled search script. E5 and LanceDB are local retrieval
components, not another teacher, and search results never count as learning.

Run bundled commands from the Skill directory:

```bash
uv run --project "$SKILL_DIR" python "$SKILL_DIR/scripts/<script>.py"
```

Local retrieval needs no `OPENAI_API_KEY`. The host supplies the conversational model; the bundled
E5 encoder supplies local embeddings.

## Durable Outputs

- `private/learner/course.md` is the rolling course direction, not a daily lesson.
- `private/learner/knowledge/items.jsonl` is the extensible teaching source that serves the course.
- `private/learner/records/lessons/YYYY-MM-DD.md` is the finalized lesson read by Live teaching.
- `private/learner/records/sessions/` plus SQLite hold actual attempts, errors, mastery evidence,
  and item-specific `next_due_at` values.

Course design, lesson preparation, candidate selection, and retrieval do not create learning
events. Only observed learner work in a completed class changes progress and review state.

Personal data stays inside `private/`. Public exports keep empty structure, templates, sanitized
examples, code, schemas, and references while excluding learner records and rebuildable cache.
