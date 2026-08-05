# Database And Session Contract

SQLite `runtime/coach.sqlite` is the source of truth for personal learning history.

Core tables:

- `learner_profile`: one learner's name, goals, interests, topics, and language mode.
- `content_items`: runtime copy of approved and review-pending knowledge items.
- `sessions`: one completed or recoverable class.
- `session_items`: one actual learning or review event per practiced content item.
- `review_state`: current memory state and next due time for each learned item.
- `errors`: important observed errors and their correction state.

Do not write arbitrary SQL from model output. Use the bundled scripts and migrations.

## Session JSON

`record_session.py` accepts a JSON file shaped like:

```json
{
  "id": "session-2026-08-06-1930",
  "started_at": "2026-08-06T19:30:00+08:00",
  "ended_at": "2026-08-06T20:00:00+08:00",
  "topic": "making weekend plans",
  "lesson_path": "runtime/lessons/2026-08-06.md",
  "notes": "Short teacher observation.",
  "items": [
    {
      "item_id": "pattern220-p0179",
      "activity": "new",
      "grade": "good",
      "status_after": "usable",
      "correction_count": 1,
      "studied_at": "2026-08-06T19:42:00+08:00"
    }
  ],
  "errors": [
    {
      "id": "error-2026-08-06-001",
      "item_id": "pattern220-p0179",
      "occurred_at": "2026-08-06T19:40:00+08:00",
      "user_said": "Do you want go with me?",
      "natural_version": "Would you like to come with me?",
      "error_type": "grammar",
      "note": "Missing to after want.",
      "next_due_at": "2026-08-07T19:40:00+08:00"
    }
  ]
}
```

Allowed grades: `forgot`, `hard`, `good`, `easy`.

Allowed status after practice: `learning`, `usable`, `fluent`.

Allowed error types: `chinglish`, `awkward`, `grammar`, `collocation`, `pronunciation`, `prosody`,
and `pragmatics`.

Only content actually heard, retrieved, spoken, or used in a meaningful exchange belongs in
`session_items`. Merely appearing in a lesson or search result does not count.
