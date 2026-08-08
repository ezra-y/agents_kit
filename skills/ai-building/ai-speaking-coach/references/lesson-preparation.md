# Lesson Preparation

The strong Codex model prepares and finalizes the lesson. GPT Live teaches it.

## Inputs

Use:

- Due review items from SQLite.
- Unresolved and repeated errors.
- Current status for each content item.
- Long-uncovered and unseen course content.
- Learner profile, goals, interests, and recent topics.
- The primary outcome, active target tasks, current bottleneck, and latest adaptation evidence in
  `runtime/learning-plan.md`, when present.
- A clear communication goal for today.
- Hybrid retrieval candidates from local E5 and LanceDB.

## Selection Order

1. Direction: choose one active target task and one current bottleneck from the plan.
2. Required: include due retrieval and high-value unresolved errors, favoring items that fit the
   target task while preserving genuinely urgent reviews.
3. Input: choose a short listening demand the learner can mostly follow but cannot yet handle
   independently.
4. Output: define an information exchange, decision, explanation, or repair task rather than a
   recital.
5. Focus: add only the language, naturalness, or pronunciation work needed for the bottleneck.
6. Transfer: change one meaningful variable and require familiar language to be retrieved again.
7. Judgment: remove candidates that would make the scene forced or overloaded.

SQLite determines what cannot be forgotten. LanceDB supplies relevant candidates. The strong model
decides the final teaching combination.

Prepare 30 to 50 candidates for a 30-minute class, then divide them into:

- Quick checks for short expressions the learner may already know.
- Focus practice for new, weak, awkward, or repeatedly missed content.
- Optional extensions if the learner moves quickly.

Do not expect 40 unfamiliar items to receive deep practice in one class.

## Final Lesson

Run `scripts/prepare_lesson.py` to create `runtime/preparation/YYYY-MM-DD.md`, then write the final
lesson spec as JSON and pass it to `scripts/finalize_lesson.py`.

The JSON contract is:

```json
{
  "date": "2026-08-06",
  "topic": "making weekend plans",
  "communication_goal": "Invite a new friend to do something together.",
  "scene": "Two classmates finish class and discuss their weekend.",
  "target_task": "Agree on one weekend activity and settle the time and place.",
  "current_bottleneck": "Asking natural follow-up questions without translating first.",
  "success_evidence": [
    "The learner reaches an agreement with no model-provided sentence.",
    "The learner asks at least one relevant follow-up in time."
  ],
  "input_task": "Understand the friend's availability and one preference.",
  "transfer_task": "Repeat with a different activity and one scheduling conflict.",
  "required_reviews": [],
  "error_repairs": [],
  "focus_targets": ["pattern220-p0179"],
  "quick_checks": ["pattern220-p0041"],
  "optional_extensions": ["pattern220-p0180"],
  "live_notes": []
}
```

The final lesson must include:

- Topic and real communication goal.
- A concise scene and roles.
- The target task, current bottleneck, and observable success evidence.
- A listening demand and a meaningful transfer variation.
- Stable IDs for required reviews.
- Stable IDs for target expressions and patterns.
- Known errors to watch for.
- Quick checks and optional extensions.
- Enough usage notes and examples for GPT Live to teach accurately.
- Permission to reduce or extend content based on live performance.

Do not write a minute-by-minute schedule or a complete dialogue script. Do not update learning state
during preparation.
