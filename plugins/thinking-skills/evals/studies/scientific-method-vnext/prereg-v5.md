# Scientific-Method vNext Preregistration

## Objective

Identify a scientific-method instruction variant that improves strict single-file fault localization by at least 5 percentage points versus production no-skill while using no more median total tokens than the current lean skill.

## Arms

- `none`: production no-skill control.
- `lean`: current shipped `skills/thinking-scientific-method/SKILL.md`.
- `candidate-01` through `candidate-06`: one isolated mechanism change each.

The pilot runs all eight arms on the same items with deterministic per-item arm-order randomization. Confirmation and replication run `none`, `lean`, and only candidates advanced by the preceding gate.

## Hypotheses

1. A clue-first fast path prevents unnecessary differential ceremony when issue text already localizes ownership.
2. Static-evidence mode treats issue-text clues as observations when tools are intentionally unavailable.
3. Requiring implementation-owner paths and one final path improves localization precision.
4. Two contenders by default reduces dilution and completion tokens.
5. A compact `Evidence → Contenders → Discriminator → Localization` output reduces prompt and completion tokens without losing useful reasoning.
6. Reducing parsimony to one tiebreaker sentence removes low-value prompt tokens.

Routing-boundary wording is evaluated separately and is not part of the forced-treatment fault-localization claim.

## Dataset and Frozen Splits

- Version 1–3 source: `princeton-nlp/SWE-bench_Verified`.
- Version 4 source: `ScaleAI/SWE-bench_Pro`, selected after the Verified/Sonnet stratum hit a 90% ceiling. Its license metadata is currently unknown, so prompts and raw responses remain ignored local artifacts and are not redistributed.
- Eligible items must have mode `swe-localize`, at least one non-test source-file label, and no exact gold path or basename in the issue prompt.
- The eligibility rule uses labels only to remove direct answer leakage, never model outcomes.
- A deterministic hash seed freezes four disjoint splits before any calls:
  - calibration: 20 items
  - pilot: 40 items
  - confirmation: 100 items
  - replication: 100 items

Calibration runs no-skill only. Continue only if strict no-skill accuracy is 40–70%.

## Metrics

Primary:

- Intention-to-treat strict file-localization accuracy.
- Paired risk difference versus `none`.
- Exact paired McNemar p-value.

Efficiency:

- Median input, output, and total tokens per task.
- Median latency and estimated cost per task.
- Total calls and estimated cost.

Parse and solver failures remain in the denominator as incorrect. A run with incomplete health is not decision-eligible.

## Gates

Pilot:

- Reject a candidate if accuracy is lower than `lean`.
- Reject a candidate if median total tokens exceed `lean` by more than 5%.
- Rank survivors by lift versus `none`, then token ratio, and advance at most two.
- Pilot significance is descriptive only.

Confirmation:

- At least 100 paired items.
- Lift versus `none` at least +5pp.
- Holm-adjusted paired p-value below .05 across advanced candidates.
- Median total tokens no higher than `lean`.
- Complete, decision-eligible run health.

Replication:

- Untouched disjoint split with at least 100 paired items.
- The same quality, multiplicity, token, and health gates as confirmation.
- A candidate passes only if it clears both confirmation and replication.

## Cost and Stopping

- Calibration hard caps: 22 calls (20 observations plus at most two transport retries) and USD 5 estimated cost.
- Pilot hard caps: 320 calls and USD 40 estimated cost.
- Confirmation hard caps: 400 calls and USD 60 estimated cost.
- Replication hard caps: 400 calls and USD 60 estimated cost.
- Stop before the next call when a cap is reached.
- Do not run confirmation or replication when no candidate advances.

## Evidence

Each observation records the strict parsed path, correctness, prompt and response hashes, calls, latency, full token fields, estimated cost, and an ignored local raw-response archive URI. Results are checkpointed per observation and may be resumed without reusing responses across arms.

## Registered Adaptation

Version 1 used `claude-sonnet-4-6` at high effort. Its independent 20-item no-skill calibration scored 90% (18/20), outside the preregistered 40–70% band, so no candidate arm was run. The complete local calibration artifact remains under `evals/results/local/scientific-method-vnext/calibration`, while `manifest-v1.json` and `splits-v1.json` preserve its registered metadata.

Version 2 changes only the solver stratum to `claude-haiku-4-5-20251001` at high effort and writes to a separate results root. The source dataset, eligibility rule, frozen split IDs, candidate files, arm-order seed, metrics, gates, and stopping rules are unchanged. Version 2 must independently pass calibration before any candidate call.

Version 2 reached 50% intention-to-treat accuracy but was not decision-eligible: two transport failures and two Markdown-formatted final answers produced 20% incomplete health. No candidate arm was run. Version 3 keeps the Haiku solver and all frozen design choices, adds a scorer-level instruction requiring a plain unformatted terminal `ANSWER:` line, and permits one bounded retry for transport/timeout failures only. Parse failures are never retried. Version 3 writes to a new results root and must independently clear both the difficulty and health gates.

Version 3 remained in-band by intention-to-treat accuracy but failed health because repeated Haiku transport errors exhausted the bounded call budget; no candidate arm was run. It also exposed and fixed a bookkeeping defect where pre-call budget stops were incorrectly counted as model calls.

Version 4 returns to `claude-sonnet-4-6` at high effort and changes the dataset to the substantially newer and broader SWE-bench Pro task set. One to three non-test implementation files are accepted as gold, while the solver must still return exactly one path. The harder-item leakage rule, candidate files, stage sizes, gates, terminal-answer correction, bounded retries, and evidence fields remain unchanged. Version 4 regenerates and pins new source-specific split IDs before its independent calibration.

Version 4 cleared calibration at 55% with complete health. Its pilot was stopped immediately after the first exhausted transport failure made complete run health impossible: 4 of 40 item envelopes were checkpointed, with 32 attempted observations, 31 completed and scored, and one failure. Those data are diagnostic only and no candidate was advanced. Version 5 keeps the solver, source, eligibility rule, six isolated candidate files, stage sizes, metrics, and gates unchanged. It uses a new frozen split seed and excludes every version 4 calibration and pilot item ID, preventing any previously observed item from entering a version 5 arm. Version 5 permits one bounded retry for transient solver/transport failures (`DROID_ATTEMPTS=2`); parse failures remain unretried. To account for concurrent retry reservations, only the calibration call cap rises from 22 to 24 and the pilot cap from 320 to 340. Version 5 writes to a new results root and must independently clear calibration and complete-health gates before its pilot.
