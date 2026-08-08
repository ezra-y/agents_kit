# Reminders

Scheduled class reminders are optional. They support consistency but do not count as study.

## Ask Naturally

When reminder status is `unconfigured`, ask one open question:

```text
你希望什么时候上口语课？直接告诉我日期、重复方式和当地时间就行。
也可以说“先不设置，直接上课”。
```

Accept any schedule the host Scheduled-task system can represent. Ask for the timezone only when it
cannot be inferred. If the learner declines, persist that choice and do not ask again unless they
request a reminder.

## Create Or Update

1. Use the host scheduled-task tool named `automation_update`.
2. Use a standalone scheduled task, not a heartbeat.
3. Before creating, read the saved Automation ID and inspect existing tasks with the stable name
   `AI 口语教练上课提醒`.
4. Update an existing task instead of creating a duplicate.
5. Let the scheduled-task system represent the learner's complete recurrence request rather than
   narrowing it to a Skill-defined list.
6. Save the exact returned Automation ID, human schedule, timezone, and recurrence rule only after
   the tool succeeds.
7. Confirm the human schedule and destination without exposing raw recurrence syntax unless asked.

Use this task instruction:

```text
Use $ai-speaking-coach. Check whether the finalized lesson needed for this scheduled class exists.
If not, prepare one from the current course, due reviews, and unresolved errors. Then send one
concise invitation to start. Do not open the microphone, infer attendance, write learning events,
or create a second lesson for the same scheduled class.
```

If the tool is unavailable, do not save a fake Automation ID. Explain that reminder creation still
needs a host session with Scheduled tasks.
