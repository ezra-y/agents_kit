# Preregistration: Tool-Enabled Single-Owner Localization v1

Status: frozen before any calibration, pilot, confirmation, or replication calls. One excluded Flask item (`pallets__flask-5014`) was used only to validate checkout and read-only tool feasibility.

## Goal and hypotheses

Test two independent additions to the shipped `thinking-scientific-method` skill under equal repository access:

1. **Clue-first:** extract rare issue clues before proposing hypotheses and spend the first observation on the clue most likely to map directly to an owner.
2. **Module-role prior:** map candidate files to runtime responsibilities and prefer the implementation owner over facades, callers, wrappers, tests, or compatibility layers unless evidence points elsewhere.

Each candidate changes exactly one sentence relative to the shipped skill. The primary null hypothesis for each candidate is no accuracy difference from the no-skill arm. The shipped skill is an additional practical comparator, not a substitute primary control.

## Dataset and eligibility

- Source: `princeton-nlp/SWE-bench_Verified`, default test split, MIT license.
- Unit: one GitHub issue at its exact `base_commit`.
- Include only tasks with exactly one implementation-owner file after excluding tests, docs, fixtures, examples, and generated or metadata files.
- Require owner path depth of at least three segments.
- Exclude tasks whose issue text contains the gold path or basename.
- Exclude every previously observed matching Verified item and the tool canary.
- Use at most one item per `(repo, base_commit)` across all stages.
- Freeze hash-ordered, disjoint splits before paid calls. Repository distribution follows the eligible population rather than balancing repositories artificially.

The frozen split sizes are 12 calibration, 30 pilot, 100 confirmation, and 100 replication items.

## Arms and equal-access contract

Calibration and pilot use four paired arms:

- `none`: no skill.
- `current`: the shipped skill.
- `clue-first`: the isolated clue-first candidate.
- `module-role`: the isolated module-role candidate.

Confirmation and replication use `none`, `current`, and only the single pilot-selected candidate.

Every arm receives the same issue text, exact detached checkout, model, effort, terminal answer contract, and read-only repository access. Droid is restricted to `Read`, `LS`, `Grep`, and `Glob` with no execution, editing, skills, network, or access outside the checkout. Repository instruction files are untrusted data and explicitly out of bounds. Each arm is instructed to make at most four repository observations and report `OBSERVATIONS_USED: N`.

## Outcome and ITT policy

The primary outcome is exact normalized match of the terminal repository-relative path against the single gold owner path.

- Missing or malformed terminal answers count incorrect under intention-to-treat.
- Missing observation telemetry or a reported count above four counts incorrect.
- Parse and observation-budget failures do not invalidate stage health.
- A transient timeout, transport error, or rate limit receives one bounded retry.
- An exhausted non-parse model failure, repository preparation failure, wrong checkout commit, dirty checkout, call-cap breach, or cost-cap breach invalidates the stage and stops new calls.
- All model calls, including retries, count against hard caps.

## Analysis

- Accuracy uses all assigned items, with ITT failures scored incorrect.
- Candidate comparisons against `none` and `current` are paired by item.
- Significance uses the two-sided exact McNemar/binomial test on discordant pairs.
- Total tokens are input + output + cache-read + cache-creation tokens.
- Per-repository results and reported observation counts are descriptive only.

## Stage gates

### Calibration

- 12 items × 4 arms.
- Proceed only if health is eligible and no-skill accuracy is between 20% and 85%, inclusive.
- Hard cap: 53 calls and $4 estimated cost.

### Pilot

- 30 fresh items × 4 arms.
- A candidate may advance only if it is at least +5 percentage points versus `none`, is not less accurate than `current`, and has median total tokens no more than 1.05× `none`.
- No pilot significance claim is made.
- If both candidates pass, select the larger lift versus `none`, then lower median tokens, then `clue-first` as the deterministic final tie-break.
- Hard cap: 132 calls and $10 estimated cost.

### Confirmation

- 100 fresh items × 3 arms.
- Pass only if the selected candidate is at least +5 percentage points versus `none`, has two-sided exact paired `p < .05`, is not less accurate than `current`, and has median total tokens no greater than `none`.
- Hard cap: 330 calls and $23 estimated cost.

### Replication

- Run only after confirmation passes.
- Repeat the confirmation gate independently on 100 untouched items.
- Hard cap: 330 calls and $23 estimated cost.

## Ship rule

Ship the selected sentence into `skills/thinking-scientific-method/SKILL.md` only if both confirmation and replication independently pass every gate. Otherwise leave the shipped skill unchanged. A shipped result is post-edit evidence only after final validators pass.
