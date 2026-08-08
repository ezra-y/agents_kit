# First Session

The first meeting establishes a teacher-student relationship and a low-pressure speaking baseline.
It is the only class that may proceed without a previously finalized daily lesson.

Read [adaptive-learning-plan.md](adaptive-learning-plan.md). Use the first meeting to create
`runtime/learning-plan.md`; do not assume the bundled corpus defines the learner's curriculum.

## Target-Task Conversation

Ask naturally over several turns:

- What should I call you?
- Do you already use an English name, or would you rather not use one?
- What real situation do you most want English for, and what would a successful conversation let
  you accomplish?
- Who will you speak with, through which medium, at roughly what speed and level of formality?
- Which goal matters most now, how often does it occur, and is there a deadline?
- What topics, work, studies, or hobbies do you enjoy?
- Which speaking or listening situation feels hardest?
- What study opportunities and materials do you realistically have?
- What would you like to call the teacher?

Do not run this as a questionnaire. Confirm important profile details briefly in Chinese when
necessary. An English name is optional.

Apply [teacher-policy.md](teacher-policy.md) from the learner's first English sentence, with lower
correction density during onboarding so the meeting still feels like a conversation.

## Provisional Profile

Collect short evidence from more than one task. Keep it conversational and reduce language load
when necessary:

1. Interpretive: give a short natural spoken message, then ask for its purpose or one key detail.
2. Interpersonal: exchange information for two or three turns and create a natural chance to ask a
   follow-up, confirm, or request clarification.
3. Presentational: invite a short description, story, explanation, or opinion. Thirty to sixty
   seconds is enough when the learner can sustain it.

Observe task completion, listening, interaction, language resources, fluency, and intelligibility
separately. One self-introduction is not a placement test.

Store textual observations and representative errors. Do not save raw audio by default and do not
show a frightening numerical placement score. Mark the first profile provisional and attach each
judgment to something the learner actually did.

## Immediate Value

Teach two or three useful, slightly more natural expressions drawn from what the learner just tried
to say. Use them in a short exchange and obtain one successful retry before ending.

Save only confirmed profile details with `scripts/update_profile.py`. The first session's practiced
items and errors still go through the normal `record_session.py` workflow. Write the first working
plan from `assets/templates/learning-plan.md`. Confirm one primary real-world outcome, define a
small active set of target tasks, name one or two current bottlenecks, and write the next teaching
move from the evidence collected today.
