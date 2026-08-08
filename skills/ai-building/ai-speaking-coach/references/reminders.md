# Reminders

Scheduled class reminders are optional. They support consistency but do not count as study.

## Ask Naturally

When reminder status is `unconfigured`, ask one open question:

```text
When would you like to have speaking class? Give me the date, recurrence, and local time.
You can also say, "Skip the reminder and start the lesson."
```

Accept any schedule the host Scheduled-task system can represent. Ask for the timezone only when it
cannot be inferred. If the learner declines, persist that choice and do not ask again unless they
request a reminder.

## Create Or Update

1. Use the host scheduled-task tool named `automation_update`.
2. Use a standalone scheduled task, not a heartbeat.
3. Before creating, read the saved Automation ID and inspect existing tasks with the stable name
   `AI Speaking Coach Class Reminder`.
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
