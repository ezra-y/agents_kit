# Class Reminders

Scheduled reminders are optional. They support consistency but do not count as study.

## First-Time Question

When `scripts/class_reminder.py status` returns `unconfigured`, ask:

```text
你希望多久上一次口语课：每天、每两天，还是每周固定几天？通常几点方便？
我会按你的本地时区设置提醒。也可以说“先不设置，直接上课”。
```

Ask for the timezone only when it cannot be inferred confidently. Do not combine this with the
entire learner-profile interview in one turn.

If the status command fails during an explicitly stated first use, ask the same question. Keep the
technical failure out of the welcome unless it prevents creation after the learner answers. Never
interpret a failed check as proof that a reminder already exists.

If the learner declines, run `scripts/class_reminder.py dismiss`. Do not ask again unless the
learner requests a reminder.

## Create Or Update

1. Run `scripts/class_reminder.py plan` with cadence, time, timezone, and any weekdays.
2. Search for and use the Codex scheduled-task tool named `automation_update`.
3. Prefer a heartbeat returning to the current task so the teacher-student context remains
   available. Use a standalone recurring task only when the learner explicitly wants independent
   runs.
4. Use the stable name `AI 口语教练上课提醒`.
5. Before creating, read the persisted automation ID and inspect existing scheduled tasks for that
   name. View and update an existing reminder instead of creating a duplicate.
6. Use the `rrule` returned by the script.
7. After the tool succeeds, run `scripts/class_reminder.py save` with the returned automation ID and
   the same schedule arguments.
8. Confirm the human-readable cadence, local time, timezone, and reminder destination.

Use this durable heartbeat prompt:

```text
Use $ai-speaking-coach in this task. This is the learner's scheduled class reminder. Check whether
today's finalized lesson already exists. If it does not, prepare and finalize one from the current
learning plan, due reviews, and unresolved errors. Then send one concise invitation to start the
class. Do not open the microphone, mark content learned, record a missed class, or create a second
lesson for the same date.
```

If the scheduled-task tool is unavailable, preserve no fake automation ID and explain that the
reminder still needs to be created in a Codex or ChatGPT desktop/web session with Scheduled tasks.

## Cadence Mapping

- `daily`: every day at the selected local time.
- `every_other_day`: every two days, anchored at the next valid local occurrence.
- `weekly`: selected weekday codes such as `MO`, `WE`, and `FR`.

The script emits an RFC 5545 recurrence rule with an explicit timezone and start time. Never ask the
learner to edit or understand the raw rule.

Scheduled runs may prepare a lesson and send a reminder. They must not start recording, infer
attendance, or update `session_items`, `errors`, or review state without an actual class.
