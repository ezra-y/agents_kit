# First Session

The first meeting establishes a teacher-student relationship and a low-pressure speaking baseline.
It is the only class that may proceed without a previously finalized daily lesson.

Read [adaptive-learning-plan.md](adaptive-learning-plan.md). Use the first meeting to create
`runtime/learning-plan.md`; do not assume the bundled corpus defines the learner's curriculum.

## Conversation

Ask naturally over several turns:

- What should I call you?
- Do you already use an English name, or would you rather not use one?
- What real situation do you most want English for?
- What topics, work, studies, or hobbies do you enjoy?
- Which speaking or listening situation feels hardest?
- What would you like to call the teacher?

Do not run this as a questionnaire. Confirm important profile details briefly in Chinese when
necessary. An English name is optional.

The correction policy is active from the learner's first English sentence. Inspect the introduction
but correct at most one highest-value issue after the short turn. Require a retry for a
meaning-changing error, clear Chinglish, or the current focus; let minor slips pass so onboarding
still feels like a conversation.

## Speaking Snapshot

Invite 60 to 90 seconds of simple conversation. Observe:

- Whether the learner understands a slowly delivered natural question.
- Whether the learner can form a short response without translation.
- Whether the learner can sustain a turn with a follow-up.
- Representative grammar, naturalness, pronunciation, and rhythm issues.

Store textual observations and representative errors. Do not save raw audio by default and do not
show a frightening numerical placement score.

## Immediate Value

Teach two or three useful, slightly more natural expressions drawn from what the learner just tried
to say. Use them in a short exchange and obtain one successful retry before ending.

Save only confirmed profile details with `scripts/update_profile.py`. The first session's practiced
items and errors still go through the normal `record_session.py` workflow. Write the first working
plan from `assets/templates/learning-plan.md`, grounded in the conversation and speaking snapshot.
