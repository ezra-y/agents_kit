# Lesson Preparation

This document governs one finalized lesson. The preparation teacher uses it after the personal
course already exists.

## Inputs

Read:

- `private/learner/course.md`.
- Due review items and unresolved high-value errors from SQLite.
- Recent session evidence and learner preferences.
- Approved teaching content returned by local retrieval.
- The requested date and any learner-requested topic.

## Select One Coherent Lesson

1. Choose one active target task and one current bottleneck from the course.
2. Include genuinely due retrieval and important error repair, favoring items that fit the task.
3. Define a short listening demand the learner can mostly follow but cannot yet handle
   independently.
4. Define a meaningful information exchange, decision, explanation, or repair task.
5. Add only the language, naturalness, or pronunciation work needed for the bottleneck.
6. Change one meaningful variable so familiar language must be retrieved again.
7. Remove candidates that make the scene forced or overloaded.

SQLite determines what should not be forgotten. Retrieval supplies relevant candidates. The
preparation teacher decides the final combination.

For a normal 30-minute lesson, prepare 30 to 50 candidates and organize them as:

- Quick checks for short or possibly familiar content.
- Focus practice for new, weak, awkward, or repeatedly missed content.
- Optional extensions when the learner moves quickly.

This is a candidate pool, not a requirement to teach 40 unfamiliar items deeply.

## Finalize

Run `scripts/prepare_lesson.py` to write
`private/runtime/preparation/YYYY-MM-DD.md`. Then create a final spec that passes
`schemas/final-lesson.schema.json` and run `scripts/finalize_lesson.py`.

The finalized lesson should contain:

- Topic, scene, roles, and a real communication goal.
- Target task, current bottleneck, and observable success evidence.
- Listening demand and meaningful transfer variation.
- Stable IDs for required review, focus targets, quick checks, and extensions.
- Known errors to watch for.
- Enough usage examples and notes for accurate Live teaching.
- Permission to reduce support or extend the task from live performance.

Write the result to `private/learner/records/lessons/YYYY-MM-DD.md`. Do not create a complete
dialogue script, minute-by-minute schedule, or learning event during preparation.
