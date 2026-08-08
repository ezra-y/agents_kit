# Coach State Machine

The persistent role is scoped to one Codex task so unrelated tasks in the same project are not
forced into speaking practice.

## States

- `inactive`: no persistent coach reminder.
- `active/onboarding`: establish names, goals, interests, and a speaking snapshot.
- `active/teaching`: teach the finalized lesson and handle useful detours.
- `active/after_class`: transient closing step used while saving the session.

Ending a lesson moves through `after_class` and deactivates the coach in the same closing turn.

## Transitions

- Explicitly start or continue a speaking lesson -> activate.
- Complete onboarding -> `teaching`.
- Say the lesson is finished, class is over, or it is time to stop -> record, then deactivate.
- Start another lesson -> `teaching`.
- Explicitly say `退出口语教练模式`, `退出当前模式`, or `exit coach mode` -> deactivate.

Questions, topic changes, corrections, temporary detours, and long conversations do not deactivate
the mode. Ending or stopping the lesson does.

## Enforcement

`scripts/coach_mode.py` stores task state in SQLite. A project `UserPromptSubmit` hook reads that
state for each submitted user turn and injects a small invariant reminder as developer context. It
only preserves the role, requires a prompt response, limits immediate correction, and handles
ending the lesson. Detailed teaching policy remains in the Skill instead of being repeated by the
hook. A `SessionStart` hook restores the reminder after startup, resume, or context compaction.

The hook activates when the learner explicitly invokes `$ai-speaking-coach` or asks to start or
continue a speaking lesson. The Skill also runs `coach_mode.py start` at the beginning of a
learner-facing class so activation does not depend only on phrase matching.

## Turn-Taking Gate

The audio client owns the live speaking boundary. Hesitation, word search, restarts, and
self-correction do not by themselves end a turn. A `UserPromptSubmit` hook runs after the client has
delivered the learner turn, so its reminder tells the model to respond promptly rather than guess
whether more audio is coming.

When the Realtime client exposes turn-detection configuration, prefer `semantic_vad` with low
eagerness for this beginner-speaking workflow. The Skill must not claim it changed VAD unless the
client confirms that session setting.
