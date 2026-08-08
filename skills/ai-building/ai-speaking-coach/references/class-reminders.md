# Class Reminders

Scheduled reminders are optional. They support consistency but do not count as study.

## First-Time Question

When `scripts/class_reminder.py status` returns `unconfigured`, ask:

```text
你希望什么时候上口语课？直接告诉我你想要的日期、重复方式和当地时间就行。
也可以说“先不设置，直接上课”。
```

Accept any schedule the Codex Scheduled-task system can represent, including custom and one-time
rules. Examples may clarify the question, but never describe a small example list as the Skill's
supported schedule types.

Ask for the timezone only when it cannot be inferred confidently. Do not combine this with the
entire learner-profile interview in one turn.

If the status command fails during an explicitly stated first use, ask the same question. Keep the
technical failure out of the welcome unless it prevents creation after the learner answers. Never
interpret a failed check as proof that a reminder already exists.

If the learner declines, run `scripts/class_reminder.py dismiss`. Do not ask again unless the
learner requests a reminder.

## Create Or Update

1. Search for and use the Codex scheduled-task tool named `automation_update`.
2. Resolve the current project ID when the tool requires one, then create the reminder with
   `kind: cron`, `executionEnvironment: local`, and the current local project.
3. This Skill deliberately uses a standalone Scheduled task. Do not substitute a heartbeat for the
   classroom reminder.
4. Use the stable name `AI 口语教练上课提醒`.
5. Before creating, read the persisted automation ID and inspect existing scheduled tasks for that
   name. View and update an existing reminder instead of creating a duplicate.
6. Let the Scheduled-task system translate the learner's complete request into its recurrence
   rule. Do not narrow it to a Skill-defined cadence enum.
7. After the tool succeeds, run `scripts/class_reminder.py save` with the exact human-readable
   schedule, timezone, returned recurrence rule, and automation ID.
8. Confirm the human-readable schedule, timezone, and destination. Do not show the raw recurrence
   rule unless the learner asks for it.

Use this durable scheduled-task prompt:

```text
Use $ai-speaking-coach. This is the learner's scheduled class reminder. Open the learner's speaking
coach project and check whether the lesson needed for this scheduled class already exists. If it
does not, prepare and finalize one from the current learning plan, due reviews, and unresolved
errors. Then send one concise invitation to start the class. Do not open the microphone, mark
content learned, record a missed class, or create a second lesson for the same scheduled class.
```

If the scheduled-task tool is unavailable, preserve no fake automation ID and explain that the
reminder still needs to be created in a Codex or ChatGPT desktop/web session with Scheduled tasks.

Scheduled runs may prepare a lesson and send a reminder. They must not start recording, infer
attendance, or update `session_items`, `errors`, or review state without an actual class.
