# Workflow value gate: `workflow-v1`

## Identity and frozen inputs

- **study_id:** `workflow-v1`
- **study_version:** `2026-07-16-freeze`
- **created_at:** `2026-07-16T00:00:00.000Z`
- **seed:** `workflow-v1-2026-07-16`
- **input registry:** `evals/studies/registry.json` at Git commit `3d1f67de41495a2fa979b196a76fc5a3e66235e0` (`phase4-portfolio-v1`, SHA-256 `7bf021d6dd4c34cd5bd91c74874114f98e1dc952ebb279021add62af8416c91e`)
- **runner:** `evals/run-agentic.js` SHA-256 `4b8aeaa3c83ea000a15d66ae05c4cd4ff2d8fc1dabec1a13d9ab82230e410cda`
- **pure evaluator:** `evals/lib/agentic.js` SHA-256 `cef02f317cf9749824b550e6bb893a23b0f3d577e91832ee402bf781aafabf58`
- **replication dataset:** `evals/datasets/workflow-cases-replication.jsonl` SHA-256 `3108849eae5636b7748cf800d49b25a9c5d9aaac78bd6986559ea5e2aaa7b0ef`
- **available replication cases:** 24 cases, 42 candidate nodes, 30 gold nodes

The input registry pin is immutable. A later registry update that records this outcome is a separate output reference and is not part of this preregistration freeze.

## Decision gated

Whether the agentic workflow runner, pure scheduler/scorer, workflow prompt registry, workflow-only datasets, tests, and any workflow form deserve to remain. The default is deletion unless untouched replication passes a predeclared quality or efficiency gate against both the frozen non-workflow comparator and no-skill.

## Corrected contracts required before any run

1. The executable is atomically named `evals/run-agentic.js`; the old `run-agentic-workflow.js` path is absent.
2. Hydration, branch scheduling, route scoring, case scoring, arm summaries, and contrasts are pure functions in `evals/lib/agentic.js`.
3. `case_success` requires the exact declared skill route, exact node route, correct branch choice, all gold node answers correct, and valid parsing.
4. Every arm owns independent solver calls. No typed output may be reused by a self-checked arm.
5. `dynamic_typed_self_checked` and `workflow_typed_self_checked` make a distinct semantic review call even when the first typed result parses.
6. The no-skill arm executes the same deterministic scheduler and byte-identical typed prompt wrapper without reading a skill guide; only the guide-block contents differ.

## Frozen arms

### Primary candidate

- `workflow_typed`: deterministic branch scheduler; each reached node runs the declared lean skill with typed output.

### Frozen comparators

- `dynamic_typed`: best machine-observable non-workflow arm eligible for comparison. It chooses a typed route from the case, candidate nodes, and skill catalog; unlike free-form `dynamic_loose`, its route and node outputs are directly scoreable.
- `workflow_none_typed`: no-skill control using the same deterministic scheduler and typed node I/O. Its prompt is identical to `workflow_typed` except that the guide block is empty.

### Diagnostic-only arms

- `dynamic_loose`, `workflow_loose`, `dynamic_typed_self_checked`, and `workflow_typed_self_checked` are not eligible to replace either frozen comparator in this version. Diagnostics cannot drive retention.

## Models, cases, independence, and ordering

- Deployment strata: `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, and `claude-opus-4-6`.
- Replication unit: one untouched workflow case.
- Use exactly the 24 ordered IDs and row hashes in `cases.json`.
- Each case × model × arm observation runs in a fresh independent session with no shared response, repair candidate, cache object, or conversational state.
- Arm order is deterministically randomized from the frozen seed and case/model identity; the order and seed must be recorded per observation.
- Source prompts and verbatim model responses are not committed. A decision-eligible run requires per-observation response SHA-256 plus a restore-tested access-controlled archive reference.

## Outcomes

### Primary quality outcome

`case_success`: exact declared skill route, exact node route, no over/under-routing, correct branch decisions, every gold node answer correct, and valid parse.

### Secondary outcomes

Route exactness, route Jaccard, branch correctness, invalid-output recovery, solver failures, calls, input/output/cache tokens, latency, and estimated cost. Cost metrics use cluster-aware one-sided ratio intervals at the workflow-case cluster.

## Multiplicity and terminal retention gates

Multiplicity covers both primary comparisons, three model strata, and every candidate workflow form. Missing or underpowered strata fail closed.

A workflow form is retained only if untouched replication passes one gate against **both** `dynamic_typed` and `workflow_none_typed`:

- **Quality:** point improvement at least +5 percentage points and multiplicity-adjusted one-sided quality lower bound above 0 against both comparators; one-sided 95% upper ratio bounds at most 1.25 for total tokens and estimated cost; every nonwinning deployment model has adjusted quality lower bound above -3pp.
- **Efficiency:** quality lower bound above -2pp; preregistered one-sided 95% upper bound at most 0.80 for the chosen total-token or latency ratio; every unchosen calls/token/latency/cost ratio upper bound at most 1.05; one-sided 95% upper bound for workflow minus baseline failure rate below +2pp against both comparators; every deployment model has adjusted quality lower bound above -3pp.

No post-hoc arm substitution, pooling, threshold change, or exception is allowed.

## Pre-run power and feasibility gate

The frozen replication set contains only 24 independent case clusters. Even under the optimistic unpaired Bernoulli approximation at 50% success, a one-sided 95% standard-error margin is about 16.8 percentage points (`1.645 × sqrt(0.25 / 24)`), before multiplicity adjustment. That cannot establish either a >0 lower bound for a +5pp quality effect or a >-2pp noninferiority bound for the efficiency gate. Pairing cannot guarantee rescue because the discordance rate is unknown and was not estimated from an independent corrected-engine pilot.

The study therefore fails the predeclared 90% power requirement before solver execution. The permitted action is a **zero-call no-run**, not an underpowered exploratory replication. The terminal product disposition is `delete_workflow_machinery`; the null/no-run record must remain in canonical evidence.

## Artifacts

- `evals/studies/workflow-v1/prereg.md`
- `evals/studies/workflow-v1/manifest.json`
- `evals/studies/workflow-v1/cases.json`
- `evals/studies/workflow-v1/aggregate.json`
- `evals/studies/workflow-v1/items.jsonl` (empty because no calls are eligible)
