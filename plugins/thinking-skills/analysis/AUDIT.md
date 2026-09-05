# Catalog audit (decision-ready)

| Field | Value |
|---|---|
| Authority | `analysis/evidence.json` |
| Evidence SHA-256 | `737c46067429dc19c247eb8a8fea7d1aed38a81cd411f78cda8fce9e968a53a3` |
| Evidence `registry_ref` | `evals/studies/registry.json` @ `phase6-cleanup-v1` / `a03a0f38d833e1e26062ca60c8c5a34d8cbe243a7be6b330ffdfe899f237aaf7` |
| Live registry SHA-256 (worktree) | `a03a0f38d833e1e26062ca60c8c5a34d8cbe243a7be6b330ffdfe899f237aaf7` |
| Workflow-gate commit | `1d63b0d0fe2f3272d98ea84370e55444ef560405` |
| Global validity / disposition | `provisional` / **`no_automatic_elevation`** |
| Elevate / AUTO-RETAIN | **0 / 0** |
| Active / deleted skills | **28 / 11** |
| Manual-only | **28** |

The live registry hash matches the claim-bearing pin in `analysis/evidence.json`. If this narrative disagrees with the JSON, **the JSON wins**.

No public “proven / validated / improves / eval-informed / auto-invoke” claim is authorized. Inferences are labeled.

---

## 1. Analysis frame

- **Decision gated:** delete / absorb / quarantine / retain / rewrite skills; keep or delete workflow machinery.
- **Units:** skill on a native task surface; workflow form end-to-end; harness artifact by unique utility.
- **Arms:** no-skill vs full_legacy vs lean; workflow vs non-workflow comparator and no-skill.
- **Primary outcome:** native task correctness. Secondaries: harm/overuse, tokens, calls, latency, cost.
- **Models:** Haiku `claude-haiku-4-5-20251001`, Sonnet `claude-sonnet-4-6`, Opus portfolio `claude-opus-4-8` / workflow freeze `claude-opus-4-6`.
- **Confirmatory bar** (`policy.confirmatory_requires`): matching prereg, eligible split, exact hashes, target N/power, complete health, successful replication, restore-tested archive **or** preserved provisional source.
- **Rule:** significant `measured_result` ≠ ELEVATE; keep `measured_result`, `statistical_status`, `replication_status`, `evidence_validity`, `product_disposition` separate.

---

## 2. Product verdict (compact)

1. **28 survivors, all manual-only** (`product_disposition_counts_active.manual_only_quarantine = 28`; no automatic invocation).
2. **11 deleted after mechanism absorption** (catalog cutover), not portfolio AUTO-DELETE replication.
3. **`portfolio-v1`:** `run_status=no_run`, `model_calls=0`, decision-ineligible → quarantine all 28. Zero-call is **not** a measured null effect.
4. **`workflow-v1`:** `run_status=no_run`, `model_calls=0`, pre-run power failure on 24 cases → **`delete_workflow_machinery`**. **Preserve** the workflow-v1 study bundle + evidence row.
5. **July historical estimates remain provisional** (scoring/placebo/archive defects). Best directional row: scientific-method **+4.0pp** — below +5pp utility margin → manual-only directional, not elevate.

---

## 3. Provenance (Git + Phase 0)

| Commit | Role |
|---|---|
| `1d63b0d…` | Workflow gate, zero calls; machinery delete disposition |
| `3d1f67d…` | Portfolio gate, zero calls |
| `c2e4a73…` | Lean rewrite of 28 |
| `733353c…` | 39→28 cutover + quarantine; sole exact full_legacy body source for **16** skills |
| `a59144c…` | July confirmation commit in Phase-0 snapshot (dirty worktree; **not** global full_legacy source) |

**Phase-0 ledger:** `evals/studies/catalog-cutover/manifest.json`
SHA-256 `7dd830f53b88fa5cf23f8f801204b8d06710a54b6aa1c83ac3f9233f0da85042`
Counts: 391 artifacts / 370 unique SHA; dispositions preserve 216, bundle 55, non_evidence_scratch 99, exact_duplicate 21; July primary targets 7; skill bodies 39.
Policy: no verbatim model outputs in Git; uncertain → `preserve_in_place`; no archive → keep source + provisional.

**Recovery ledger:** `evals/studies/catalog-cutover/recovery-ledger.json` records an unrecoverable cleanup incident: 14 frozen historical result artifacts without raw-response archives were deleted contrary to the Phase-0 disposition. Their paths, byte counts, SHA-256 values, and recovery attempts remain pinned. None is directly referenced by the current claim registry, but none may support a confirmatory or public claim unless exact bytes are restored.
Recovery-ledger SHA-256 `58775aec27b06e5145a5155de7cff1fbc5786b0ede2b6977634ebdba28077d65`.

**Body-hash snapshot (no body text):** `evals/studies/catalog-cutover/legacy-skills.json`
SHA-256 `19c0b68d1b1466ff314dc0623f3eb946f35172207ea458c83c6907ac56d24307`

---

## 4. Catalog cutover 39 → 28

| Deleted | Absorbed into |
|---|---|
| archetypes, feedback-loops, leverage-points | `systems` |
| bayesian, fermi-estimation | `probabilistic` |
| debiasing | `probabilistic`, `steel-manning` |
| dual-process | *(none)* |
| inversion | `pre-mortem` |
| model-selection | `model-router` |
| occams-razor | `scientific-method` |
| regret-minimization | `reversibility`, `opportunity-cost` |

All 11: `product_disposition=deleted_after_mechanism_absorption`.

**Survivors (28 bare ids):**
bounded-rationality, circle-of-competence, cynefin, effectuation, first-principles, five-whys-plus, jobs-to-be-done, kepner-tregoe, lindy-effect, map-territory, margin-of-safety, model-combination, model-router, ooda, opportunity-cost, pre-mortem, probabilistic, red-team, reversibility, scientific-method, second-order, socratic, steel-manning, systems, theory-of-constraints, thought-experiment, triz, via-negativa.

Historical status mix (active, provisional, non-confirmatory): unmeasured 14, null_or_no_lift 6, ceiling 4, directional_ns 1, negative 1, null_ns 1, significant_below_utility_margin 1.

**full_legacy recovery:** 16 available from prelean `733353c`; 12 missing (`missing_full_legacy_body` blocks lean-vs-full / ≤70% token gates): bounded-rationality, first-principles, kepner-tregoe, model-combination, model-router, opportunity-cost, pre-mortem, probabilistic, reversibility, scientific-method, steel-manning, systems.

---

## 5. Exact study citations

### 5.1 Legacy July (provisional; not replication-qualified)

Shared defect family (objective rows): permissive filename matching, active placebo, missing raw archive / parsed fields, incomplete usage & denominators, untracked source. Workflow rows also: padded arms, misnamed validated/verified, missing no-skill control.

| study_id | Canonical bundle files (path → SHA-256) | Measured | Status / disposition |
|---|---|---|---|
| `legacy-july-sci-method-larger-n` | source `evals/results/sci-method-larger-n/swe-scientific-method.json` → `7ca6ebedc7594925e347a05403ad1adb1f2144f8810db4f0fc1a283f73267471` · manifest `evals/studies/legacy-july-sci-method-larger-n/manifest.json` → `d1b39dcc5c311b0655afb0578d73c81299b31ffb59f9045eefe0f38116e0d831` · aggregate → `7b07d0ea155c082ba020789f56e26da842463d98d644bcc90eb540ffadf1f262` · items → `27befafa510c3ab2697108d31880d23c83b7a2c3548cbd8b68acd51139e85f0e` | fault_loc; skill 0.925 vs placebo 0.885; **Δ+4.0pp**; n_scored=426; McNemar cc p≈0.00048 | `significant_below_utility_margin` / `manual_only_directional_not_elevate` / provisional |
| `legacy-july-verdict-five-whys` | source → `6294dd990f8fd2d50ac97a23963cb1d14c60069b5cb0a8477e614fc04b31b697` · manifest `…/legacy-july-verdict-five-whys/manifest.json` → `d49b94a3b2f5d615b389046d83876fa610e06e8eb3dd53dd359849974863474f` · aggregate → `0aa7e3053e86aaefb3c45f78103d3884c741885a174b7c0ff24ff099df603f21` | Δ**+1.5pp**; n=199; p≈0.546 ns | `null_not_significant` / `manual_only_quarantine_no_lift` |
| `legacy-july-verdict-occams` | source → `eab1b50a29ec59f25ffb9052c9dad69c20f6c54511d001d8425f73c0c0e91d6b` · manifest `…/legacy-july-verdict-occams/manifest.json` → `12dbfe0e5f02965f7c6596a1ef611a855b86ef497eb6dc3790d98f08c524e55b` · aggregate → `adf26559dc08816371e0bf47763d948bcbf90ebf3de8beb04f067d3c4d96338c` | Δ**+0.5pp**; n=199; p=1 ns | `null_not_significant` / `manual_only_quarantine_no_lift` |
| `legacy-july-wf-confirm-behavioral` | source → `b4fcc8a743c4ce6b3d8c8cb2624b1686020b5c86f24e3e5cba7b509b78e1d454` · manifest `…/legacy-july-wf-confirm-behavioral/manifest.json` → `627038b1ebae569690711e1c01f22a001c724217625d94aa4c8940d40fd4bc98` · aggregate → `c2f76e9094141814f41ee0a95b269223b0a4caf6ec06357088ab802e281aecd6` | pairwise left_win 0.486; lift **−4pp**; p=0.797; pilot | `pilot_null` / workflow gate pending |
| `legacy-july-wf-confirm-haiku` | source → `9734cdc37a9751fc0d4e183f94bbbd400b817b698b938a367dc581b7caf19974` · manifest `…/legacy-july-wf-confirm-haiku/manifest.json` → `493c9eee0d60660a5d8d31221541fb83834a10382491fff78cb9f90b72e77c95` · aggregate → `37bf7ea1021518b278b7012abe41521c1fa613ed0a1f5ca836c7cbb1a61b2ee5` | n=364; Δ**−0.5pp**; p=0.845 | `inconclusive_null` / workflow gate pending |
| `legacy-july-wf-confirm-opus` | source → `cfa637a3d7f7fe0129703d94957dc837ed7fa8b10b16781649376d37a6087528` · manifest `…/legacy-july-wf-confirm-opus/manifest.json` → `73a2935eaca88ab49aefbb3fb7065037a05a24ed9f54a0797eaab132685c1eef` · aggregate → `05d52e0663630a575f01a549b140a8068541ec42ddb907cb9a3dd1bbb9a2f77b` | n=364; Δ**+0.3pp**; p=1 | `inconclusive_null` / workflow gate pending |
| `legacy-july-wf-confirm-sonnet` | source → `b33e52f9481f59024ae539a694c1d096decf46b50f684724c9f8f484ac90cf05` · manifest `…/legacy-july-wf-confirm-sonnet/manifest.json` → `8d7bb0a7e69eacb1f7471809cb88c469188f4f9c94c011e799ab9774dba32d11` · aggregate → `46d46f5e373a89d7b8f6a6e20af4253d2f15e6608d9c54d00bb161e9b6f7cbc8` | n=364; Δ**+0.3pp**; p=1 | `inconclusive_null` / workflow gate pending |

`[INFERENCE]` Evidence JSON lists legacy source SHA-256 but not per-bundle `manifest_sha256` fields; manifest/aggregate/item SHAs above are live worktree digests of the canonical bundle paths named in each study row.

**AUTO-RETAIN utility margin:** lean-vs-none point ≥ **+5pp** with multiplicity-adjusted one-sided 95% LB > 0. **3–5pp zone** (incl. scientific-method +4) = manual-only directional only.

### 5.2 `portfolio-v1` — zero-call no-run

| Artifact | SHA-256 |
|---|---|
| `evals/studies/portfolio-v1/prereg.md` | `f38cc1c34f7c1e185e687d6b8c2cb0d78c84cc91a501d40a934c56cd150a12c7` |
| `evals/studies/portfolio-v1/manifest.json` | `c1b257932dbee6ee40b254782dd258ef75f3512e5653aa51eb5d679037f266e9` |
| `evals/studies/portfolio-v1/aggregate.json` | `13b5ed5b02b7829225bd76054e8e206ae03df057963afeb32640eb5cd595a157` |
| `evals/studies/portfolio-v1/cases.json` | `cca4c87d289c0aae86be7659df26bf29018667ef5dd793b0a734a10a15e85e22` |
| `evals/studies/portfolio-v1/items.jsonl` | empty (0 eligible calls) |
| Input registry pin (`phase2-cutover-v1` @ `c2e4a73…`) | `d28daeb10339b80363c28eb2dd8f694fcb4de2541d300df1c06f475f79a73a46` |

`run_status=no_run`; `model_calls=0`; `measured_result=null`; `statistical_status=unmeasured_preregistered_no_run`; `evidence_validity=preregistered_blocked`; disposition **manual_only_quarantine** ×28.
Power diagnostic: ~**4078** independent cases/arm; full replication ~**5.14M** calls ≫ USD 2000. Judge panel `blocked_missing_human_labels`.
Blockers: power infeasible, judge blocked, missing native data / non-native applicability labels, inadequate splits, missing full_legacy bodies.

### 5.3 `workflow-v1` — power-blocked; delete machinery; keep null record

| Artifact | SHA-256 |
|---|---|
| `evals/studies/workflow-v1/prereg.md` | `0f8dfba5b4c816b27a39e38dbb0aef344184415f1a349fc55cb5d21dffda1834` |
| `evals/studies/workflow-v1/manifest.json` | **`de711950f67f4af314599775963a9c95ff535d86c3ab507334c196c8ee5c29df`** (matches evidence study row) |
| `evals/studies/workflow-v1/aggregate.json` | `52a99319e7ebd999493ced21b911e70dd593ca1ea2fdd6c8c3bc5ebd0372249b` |
| `evals/studies/workflow-v1/cases.json` | `54638d7dbf74b350a5d1041bb2d141ce0c2818231ef9b3c05d715482564c6c1a` |
| `evals/studies/workflow-v1/items.jsonl` | empty file `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Input registry pin (`phase4-portfolio-v1` @ `3d1f67d…`) | `7bf021d6dd4c34cd5bd91c74874114f98e1dc952ebb279021add62af8416c91e` |

Frozen targets (for deletion, not a passed gate):
`evals/run-agentic.js` `4b8aeaa3c83ea000a15d66ae05c4cd4ff2d8fc1dabec1a13d9ab82230e410cda` ·
`evals/lib/agentic.js` `cef02f317cf9749824b550e6bb893a23b0f3d577e91832ee402bf781aafabf58` ·
`evals/datasets/workflow-cases-replication.jsonl` `3108849eae5636b7748cf800d49b25a9c5d9aaac78bd6986559ea5e2aaa7b0ef` (24 cases).

`run_status=no_run`; `model_calls=0`; `statistical_status=unmeasured_preregistered_power_blocked`; gates quality/efficiency **not_eligible**; disposition **`delete_workflow_machinery`**.
24 independent cases → optimistic unpaired 1-sided SE margin ≈16.8pp @ p=0.5 — cannot support +5pp quality LB>0 or −2pp efficiency bound.
Cleanup completed: the agentic/workflow runners, pure evaluator, prompt registry, workflow-only datasets/tests, stale specialized runners, duplicate/non-evidence result artifacts, obsolete DB/dashboard/review/experiment machinery, and superseded narratives were removed. The immutable `evals/studies/workflow-v1/**` no-run record and evidence `workflow_form` row remain. Exactly 94 historical result files remain because no durable raw-response archive makes them deletion-eligible.

---

## 6. Active-skill evidence (summary, not a 28-row dump)

All 28: `elevate=false`, `auto_retain=false`, portfolio `no_run`, final **`manual_only_quarantine`**.

| Highlight (provisional) | Δpp | historical statistical_status |
|---|---:|---|
| scientific-method (July bundle) | **+4** | significant_below_utility_margin → **not elevate** |
| red-team (scorecard) | +5 | directional_not_significant |
| first-principles (scorecard) | +6.7 | ceiling_or_near_ceiling |
| five-whys-plus (July) | +1.5 | null_not_significant |
| socratic (scorecard) | −6.9 | negative_or_adverse (still quarantine, not AUTO-DELETE) |
| margin-of-safety (scorecard) | −10 | null_or_no_lift |
| 14 skills | — | unmeasured |

Per-skill blocker detail and scorecard provenance live in `analysis/evidence.json` → `skills.*` / `portfolio_gate`.

---

## 7. Evidence validity gaps

1. No restore-tested raw-response archive for July sources.
2. Permissive SWE matching + incomplete denominators.
3. Active placebo (not production no-skill) on July objective rows.
4. Missing parsed answers / incomplete usage.
5. Judge panel blocked (`blocked_missing_human_labels`).
6. Non-native applicability labels used as if native outcomes.
7. Missing native datasets / split minima under portfolio freezes.
8. 12/28 missing full_legacy bodies.
9. Power infeasible (portfolio budget; workflow n=24).
10. Legacy workflow method defects (padding, misnamed validation, no no-skill arm).
11. External design articles are process inputs only—not repo evidence.
12. Fourteen frozen historical result payloads are no longer locally inspectable after an accidental cleanup deletion; metadata survives in the recovery ledger, but the payloads cannot be reconstructed or treated as archived evidence.

---

## 8. Provenance / licensing / raw-artifact policy

- **Recorded portfolio case-family license:** every license-tagged source family in `evals/studies/portfolio-v1/cases.json` and the matching portfolio manifest source rows is classified `license: repo-authored-internal` (e.g. `cynefin-classify`, `challenging-real-world-v1`, `scientific-method-hypothesis`, …). That is the only license string present in those portfolio bundles.
- **Externally sourced prompts/datasets** (including July fault-localization inputs under `evals/datasets/external/*` such as SWE-bench verified slices cited by `legacy-july-*` manifests) retain their **upstream** license and redistribution constraints. Study manifests for those rows **do not** currently record a `license` field → treat as **`unknown`**, not as permission to redistribute. Only pinned path/version, ordered item IDs, and SHA-256 hashes belong in Git for those materials—not prompt text, problem bodies, or model responses that may echo them.
- **Unknown stays unknown:** absence of a license field is not an implied open license; do not invent one for marketing or packaging.
- Commit item IDs, gold/parsed/scored values, failures, usage, `response_sha256`, and `archive_uri` — **never** verbatim model responses in Git (Phase-0 `no_verbatim_model_outputs_in_git`).
- Confirmatory runs need a durable access-controlled archive + restore/hash test (claim life + 1 year).
- Deletion class: bundle / exact_duplicate / non_evidence_scratch / external_archive / preserve_in_place. Unresolved → preserve. Local ignored cache + hash alone is not a sole confirmatory copy.

---

## 9. Claims barred

Until confirmatory gates all pass: any ELEVATE/AUTO-RETAIN/auto-invoke; public “proven/validated/improves”; treating +4pp scientific-method as production-ready; five-whys/Occam “confirmed”; workflow quality/efficiency superiority; model pooling that hides negative strata; nested trials as independent N; scorecard no-lift as AUTO-DELETE; empty `items.jsonl` as measured null; full_legacy recovery from `a59144c` for all skills; external article results as this catalog’s evidence; marketing tables not regenerable from `analysis/evidence.json` with eligible study IDs + hashes.

---

## 10. Remaining work

- Workflow-only machinery cleanup is complete; the workflow-v1 no-run study bundle and canonical evidence row remain.
- Keep `disable-model-invocation: true` until a **new** powered native replication clears AUTO-RETAIN.
- No underpowered exploratory runs under frozen designs; gate changes need new `study_version` + prereg hash first.
- Restore the 14 lost historical result artifacts only from exact SHA-256-matching external bytes. Do not regenerate or approximate them under their historical identities.
- `[INFERENCE]` Older `analysis/*.md` (except this file) are historical and must not override the evidence registry.

---

## 11. Decision table

| Question | Decision | Binding artifact |
|---|---|---|
| Ship count | 28 | `summary.active_skill_count` |
| Auto invoke? | **None** | `elevate_count=0`, `no_automatic_elevation` |
| Portfolio replication | **Not run** | `evals/studies/portfolio-v1/*` |
| Workflow retain? | **Delete machinery**; keep null study | `workflow_form` / workflow-v1 aggregate |
| Best historical + | scientific-method **+4pp provisional directional** | `legacy-july-sci-method-larger-n` |
| Confirmatory public claims? | **No** | `evidence_validity=provisional` |
