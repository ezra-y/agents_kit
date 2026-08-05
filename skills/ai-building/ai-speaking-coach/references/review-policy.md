# Review Policy

Track every practiced content item separately.

## Learning States

- `unseen`: no valid practice event exists.
- `learning`: recognition or production is unreliable.
- `usable`: can retrieve and use it with little help in a familiar scene.
- `fluent`: retrieves naturally and transfers across scenes.

Use the grade from the current retrieval attempt:

- `forgot`: could not retrieve or use it.
- `hard`: retrieved with substantial delay or correction.
- `good`: retrieved correctly with minor effort.
- `easy`: immediate, natural, and transferable.

Do not mark a familiar-looking expression fluent without checking it in spoken use.

## Scheduling

The scheduler uses:

```text
R(t) = exp(-t / S)
```

`S` is item-specific memory stability. A successful review increases it; a lapse reduces it. The
next due time targets the configured retention probability rather than applying one fixed calendar
to every sentence.

Initial intervals:

- `forgot`: 8 hours.
- `hard`: 24 hours.
- `good`: 72 hours.
- `easy`: 168 hours.

Subsequent growth factors start at:

- `forgot`: 0.35.
- `hard`: 1.25.
- `good`: 2.0.
- `easy`: 3.0.

These are versioned defaults, not permanent truths. Calibrate them later from actual retention
history.

Only an actual attempt updates `last_reviewed_at`, stability, and `next_due_at`. Rebuild current
state from `session_items` after scheduler changes.
