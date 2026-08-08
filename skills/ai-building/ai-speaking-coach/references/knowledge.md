# Knowledge

This document defines how teachable content enters the personal knowledge source and how the two
teachers retrieve it. It does not decide the learner's curriculum priority.

## Canonical Content

`private/learner/knowledge/items.jsonl` is the maintainable source. Every line must pass
`schemas/knowledge-item.schema.json`.

Each item has a stable ID, type, approved teaching text, meaning, topics, examples, usage and
naturalness notes, source reference, approval state, and optional dialogue or media context.

- Keep one approved teaching version rather than an untouched source plus a second teaching copy.
- Mark uncertain, awkward, or unreviewed content unapproved.
- Preserve source identity and order.
- Never create duplicate IDs to force a target item count.

SQLite holds a synchronized content copy for history and joins. LanceDB holds a rebuildable search
index. Neither replaces the JSONL source.

## Build Or Extend The Knowledge

For documents and courseware:

1. Extract structured text.
2. Split by teachable meaning, not arbitrary character count.
3. Keep enough surrounding context to teach natural use.
4. Normalize the teaching text and review naturalness, register, and source accuracy.
5. Validate JSONL, sync SQLite, and rebuild the index.

For video and subtitles:

- Prefer reliable subtitles when available and transcribe only when needed.
- Preserve title, episode or source, speaker, and timestamps.
- Track one target line as the item and keep two to six turns as context.
- Review names, subtitle errors, slang, profanity, and scene-dependent meaning before approval.

Watching a clip or importing a line does not count as learning.

## Retrieval

FTS finds matching tokens. E5 converts passages and queries into the same semantic vector space.
LanceDB stores the vectors and finds nearby items. Hybrid retrieval combines lexical and semantic
candidates.

The retrieval order is:

```text
teacher intent
-> concise bilingual query with likely English wording
-> local E5 query vector
-> LanceDB vector and FTS candidates
-> model chooses relevant teaching content
```

Use a concise semantic query, not the learner's full conversational turn. Include a likely English
paraphrase when known.

The preparation teacher may retrieve broadly to build a coherent lesson. GPT Live retrieves only
for a precise need outside the finalized lesson, answers it, and returns to the current task.
Retrieval never decides curriculum priority and never marks a result learned.
