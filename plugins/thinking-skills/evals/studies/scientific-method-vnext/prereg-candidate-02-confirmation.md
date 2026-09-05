## Objective

Independently test whether the exact frozen Candidate 02 skill improves strict single-file fault localization by at least 5 percentage points versus production no-skill while using no more median total tokens than the current lean skill.

## Status of Prior Evidence

Candidate 02 was selected post hoc from a decision-ineligible 28-item pilot. It showed 57.14% accuracy versus 50.00% no-skill, a +7.14pp paired difference with 3 wins and 1 loss (`p = .617`). This weak, directional evidence is used only to select the candidate. No prior pilot row contributes to this confirmation.

## Frozen Inputs

- Solver: `claude-sonnet-4-6`, high effort.
- Dataset: local `ScaleAI/SWE-bench_Pro` ingest, SHA-256 `8f1f441483bd2ad1ded1e135b7904452b85b4afd115a9653ea502264f0ea45d0`.
- No-skill control: production `none`.
- Current lean SHA-256: `fc0440edac8f2fc4787d7fd1daa5d465de1115dac1e8e282741908ccaf28026d`.
- Candidate 02 SHA-256: `83c7664471ef0593d3e4aeb706f0c70f275669f513647e9c0f130a647754bfa3`.
- Confirmation: the untouched 100 IDs from v5, IDs SHA-256 `1065220658bdb6a1d1c0a09a84d22d6feff2622221f1329a6e2cab01947bd767`, prompt SHA-256 `d131d797be46a96758526a1ba2d733e3db1ccf71b5d70ca73c19c334dc41339d`.
- Replication, used only after a passing confirmation: the untouched disjoint 100 IDs from v5, IDs SHA-256 `78bb87912357ba99964bb94fe8bca9172e4f96756d7d117bb0cc6a745c1e86a8`, prompt SHA-256 `894be32d45ec2bd8696351cb4b1e6e54b3024c5e4593256068d78a93f883315c`.
- The valid v5 calibration is inherited unchanged: 60% no-skill accuracy, 20/20 complete, zero failures.

## Design

Run `none`, current `lean`, and frozen `candidate-02` on the same 100 confirmation items. Randomize arm order deterministically per item. Each observation uses the strict terminal repository-relative path scorer and records parsed output, correctness, response hash, raw archive URI, latency, complete token fields, calls, and estimated cost.

## Health Policy

- A returned response without a valid strict terminal path remains an intention-to-treat incorrect outcome. It is not retried and does not invalidate an otherwise complete run.
- A transport, timeout, or solver failure receives at most one bounded retry. An exhausted non-parse failure makes the run decision-ineligible and stops new work; only already in-flight items may finish.
- All 300 planned arm-item observations must be present. Conditional accuracy is diagnostic only.

## Confirmation Gates

Candidate 02 passes only if all are true:

1. 100 paired observations versus no-skill.
2. Intention-to-treat lift versus no-skill is at least +5pp.
3. Two-sided exact paired McNemar `p < .05`.
4. Median total tokens are no higher than current lean.
5. Complete run health under the policy above.

No multiplicity correction is required because exactly one candidate is tested. A failed gate ends the study. A passing confirmation may proceed to the frozen replication split only after reviewing confirmation cost and health.

## Cost and Stopping

- Confirmation hard cap: 330 model calls and USD 35 estimated cost.
- Concurrency: four.
- Stop before a call that would exceed either cap.
- Checkpoint every observation and never reuse a response across arms.
