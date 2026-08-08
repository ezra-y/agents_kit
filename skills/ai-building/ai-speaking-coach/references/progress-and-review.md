# Progress And Review

This document defines what a completed class changes and how item-level review is scheduled. It
does not assign the learner a global proficiency label.

## Record Actual Work

Create a learning event only when the learner actually heard, retrieved, spoke, or used an item in
a meaningful exchange. Appearing in a lesson, candidate list, or search result is not practice.

At class end, record:

- The session time, topic, lesson, and concise teacher observation.
- Each practiced item, whether it was new or review, and the observed performance.
- High-value errors worth revisiting.
- A readable class summary.

The session payload must pass `schemas/session.schema.json` and be written through
`scripts/record_session.py`.

## Item States

- `learning`: recognition or production remains unreliable.
- `usable`: retrieves and uses the item with little help in a familiar scene.
- `fluent`: retrieves naturally and transfers across scenes.

Judge the current attempt as:

- `forgot`: could not retrieve or use it.
- `hard`: retrieved with substantial delay, prompting, or correction.
- `good`: used correctly with minor effort.
- `easy`: immediate, natural, and transferable.

Do not mark a familiar-looking item fluent without checking spoken use.

## Review Scheduling

The scheduler uses:

```text
R(t) = exp(-t / S)
```

`S` is item-specific memory stability. A successful review increases it; a lapse reduces it. The
next due time targets the configured retention probability instead of applying one fixed calendar
to every sentence.

Initial defaults:

| Grade | First interval |
| --- | --- |
| `forgot` | 8 hours |
| `hard` | 24 hours |
| `good` | 72 hours |
| `easy` | 168 hours |

Subsequent starting growth factors are `0.35`, `1.25`, `2.0`, and `3.0` in the same order. These
versioned defaults should later be calibrated from real retention history.

Only an actual attempt updates `last_reviewed_at`, stability, and `next_due_at`. Rebuild review
state from session items after scheduler changes.

## Error Review

Record errors that are meaning-changing, clearly unnatural, repeated, tied to the current target,
or important for pronunciation and pragmatics. Save what the learner said, one natural version,
the error type, a concise note, and the next review time.

Next lesson preparation gives priority to due items, repeated unresolved errors, and weak content
that fits the current target task.
