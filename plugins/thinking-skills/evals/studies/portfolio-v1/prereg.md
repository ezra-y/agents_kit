# Portfolio v1 preregistration (static freeze)

## Identity

- **study_id:** `portfolio-v1`
- **study_version:** `2026-07-16-freeze`
- **created_at:** `2026-07-16T00:00:00.000Z`
- **seed:** `portfolio-v1-2026-07-16`
- **input_registry_source:** `evals/studies/registry.json` at Git commit `c2e4a73a6aded6c53d419f1f3d2a011fea91946f` (`registry_version: phase2-cutover-v1`, SHA-256 `d28daeb10339b80363c28eb2dd8f694fcb4de2541d300df1c06f475f79a73a46`)
  The post-gate registry is a separate output reference; it is not part of this preregistration input freeze.
- **artifacts:**
  - `evals/studies/portfolio-v1/prereg.md` (this file)
  - `evals/studies/portfolio-v1/manifest.json`
  - `evals/studies/portfolio-v1/cases.json` (IDs and source hashes only)
  - `evals/studies/portfolio-v1/aggregate.json` (zero-call, pre-run gate outcome)
  - `evals/studies/portfolio-v1/items.jsonl` (empty because no calls were eligible)

## Decision gated

What to delete, merge, quarantine, retain, or rewrite among the **exactly 28** active survivor skills. Automatic invocation (`disable-model-invocation: false`) is allowed **only** after AUTO-RETAIN LEAN passes on untouched replication. This freeze records the design **before** any portfolio solver calls.

## Non-negotiable freezes

1. **Primary arms (disposition):** `none`, `full_legacy`, `lean`.
2. **Diagnostic arms (never disposition):** `equal_budget_placebo`, `wrong_neighbor`.
3. **Workflow arm:** out of scope for this portfolio freeze (Phase 5 separate).
4. **Screening:** models ["claude-haiku-4-5-20251001","claude-opus-4-8"]; **3** nested trials per case; heldout split only; cannot elevate or delete.
5. **Replication (sole disposition dataset):** models ["claude-haiku-4-5-20251001","claude-sonnet-4-6","claude-opus-4-8"]; **5** nested trials per case; untouched replication split.
6. **Arm order seed:** `portfolio-v1-2026-07-16` (deterministic per item×trial when runners support `armOrderSeed`).
7. **No verbatim model responses** in git; commit hashes/archive refs only.
8. **No skill prompt bodies** in portfolio-v1 cases; cases are ID/reference metadata.
9. **Applicability-labelled binary-decision datasets are not native reasoning-outcome evidence** for unrelated primary metrics (pairwise quality, fault localization accuracy, F1, Brier, etc.).
10. **Judge panel is blocked:** `calibration_status=blocked_missing_human_labels`, `decision_eligible=false`. All judged/pairwise primary metrics are **no-run / manual-only** until a calibrated panel exists.
11. **Staged portfolio budget ceiling:** **USD 2000** total across all 28 skills. Equal per-skill share ceiling ≈ USD 71.42. Reaching a cost/N/call cap without power → quarantine, never elevate.
12. **Do not claim ≥90% power** under this frozen design: independent-proportion diagnostic at p0=.50, p1=.55, one-sided α=.05/84, 90% power requires **n≈4,078 independent cases per arm**; full 28×3×3×5×4078 replication ≈ **5,138,280** calls before diagnostics/cluster inflation — plainly beyond USD 2,000. Nested trials are not independent.


## Frozen conservative sample-size diagnostic (not a power claim)

This is a **conservative/diagnostic feasibility bound only**. It does **not** claim that portfolio-v1 achieves ≥90% power.

**Independent-proportion approximation** (two-sample one-sided proportion difference):

| Parameter | Frozen value |
|-----------|-------------:|
| Control rate (p_0) | 0.50 |
| Treatment rate (p_1) | 0.55 |
| Margin | +5 pp |
| One-sided α | 0.05/84 ≈ 5.952381e-4 |
| Target power | 0.90 |
| Required independent cases **per arm** | **≈ 4,078** |

**Implied full replication call volume** (before diagnostics, judges, screening, or cluster inflation):

```text
28 skills × 3 deployment models × 3 primary arms × 5 nested trials × 4,078 cases
  = 5,138,280 solver calls
```

That volume is **plainly beyond the USD 2,000** portfolio ceiling under any realistic unit-cost model used in this freeze.

**Critical caveat:** nested trials are **not** independent observations of new cases. The independent-proportion (n≈4{,}078) already ignores clustering; a hierarchical/cluster-aware design would require still more independent cases. Nested trials must not be counted as independent N for power.

**Disposition implication:** under this frozen design, power is **infeasible**; reaching N/call/cost caps yields **manual-only quarantine**, never AUTO-RETAIN / ELEVATE. Do not claim 90% power.

## full_legacy body provenance (critical)

`catalog-cutover/legacy-skills.json` stores **body hashes after YAML frontmatter** and **omits body text**. It is **not** a runnable skill body archive.

**Repo HEAD / Phase-0 recorded commit is not a global full_legacy body source.** The Phase-0 worktree was dirty; modified skill bodies at snapshot time are not recoverable from a single commit for every skill.

Exact recoverable full_legacy bodies exist **only** where the body at Phase-2 prelean commit `733353cf9b9080742ab0ba7d298fad710c9d0f1a` hashes to the snapshot row:

| Class | Count | Skills |
|-------|------:|--------|
| `full_legacy_body_available: true` | 16 | circle-of-competence, cynefin, effectuation, five-whys-plus, jobs-to-be-done, lindy-effect, map-territory, margin-of-safety, ooda, red-team, second-order, socratic, theory-of-constraints, thought-experiment, triz, via-negativa |
| `full_legacy_body_available: false` | 12 | bounded-rationality, first-principles, kepner-tregoe, model-combination, model-router, opportunity-cost, pre-mortem, probabilistic, reversibility, scientific-method, steel-manning, systems |

For the **16**: source is commit `733353cf9b9080742ab0ba7d298fad710c9d0f1a` + path `skills/thinking-<id>/SKILL.md`; body SHA-256 matches snapshot; recovery `git show 733353cf9b9080742ab0ba7d298fad710c9d0f1a:<path>`.

For the **12**: `source.commit` and `source.path` are **null**; blocker `missing_full_legacy_body`. Snapshot body hash is retained for audit only. **Lean-vs-full noninferiority and lean input-token ≤70% of full (and related full-relative cost margins) cannot run** for these 12.

## Phase 4 disposition thresholds (frozen)

| Gate | Value |
|------|------:|
| Utility margin (lean vs none point) | +5 pp |
| Multiplicity-adjusted one-sided 95% lower bound vs none | > 0 |
| Cross-model noninferiority lower bound | > −3 pp |
| Lean vs full_legacy noninferiority lower bound | > −3 pp (**requires** `full_legacy_body_available`) |
| Hard-negative / wrong-neighbor lower bound | > −2 pp |
| DELETE upper 95% bound vs none (all three models) | < +3 pp |
| Lean input tokens vs full_legacy | ≤ 0.70 (**requires** `full_legacy_body_available`) |
| Lean calls / output tokens / latency / cost vs full_legacy | ≤ +10% / ratio ≤ 1.10 (**requires** `full_legacy_body_available`) |
| Directional-only zone (manual-only) | [3, 5] pp |
| Efficacy hypotheses | 84 (28 skills × 3 deployment models) |
| Bootstrap resamples | 10000 |
| Confirmatory completeness | 1.0 (or preregistered failure policy + sensitivity) |
| Power target (design intent only) | 0.90 — **not achieved by frozen N** |

### AUTO-RETAIN LEAN

Requires **all** of:

- On ≥1 deployment model: replication lean-vs-none point ≥ +5pp, multiplicity-adjusted one-sided 95% LB > 0, adjusted p < .05.
- Every other evaluated deployment model: adjusted LB > −3pp (missing/underpowered/adverse → quarantine).
- Lean-vs-full LB > −3pp; hard-negative/wrong-neighbor LB > −2pp.
- Lean input tokens ≤ 70% of full; calls/output/latency/cost within +10% of full.
- Judge/data/power/completeness eligibility all pass.
- full_legacy body available when full-relative gates are required (always for AUTO-RETAIN as written).

Only a full pass removes `disable-model-invocation`.

### MINIMIZE FURTHER

Nonterminal; bisection on heldout only; ships auto only after replication satisfies every AUTO gate.

### DELETE

Best valid skill arm replication upper 95% bound vs none < +3pp on Haiku, Sonnet, and Opus; no ceiling/data/judge caveat; hard-negative utility nonpositive; workflow N/A unless preregistered workflow candidate.

### MANUAL-ONLY QUARANTINE

Every other outcome, including underpowered, non-native data, judge-blocked, missing full_legacy body, missing source, model-discordant, directional-only (3–5pp), or cap-limited. **This is the freeze disposition for all 28 skills.**

## Unit of analysis and statistics

- Semantic leakage family / cluster is the independent unit; nested trials are repeated measures.
- Disposition statistic: hierarchical cluster-bootstrap paired risk-difference, 10,000 resamples, fixed seed `portfolio-v1-2026-07-16`, plus cluster-aware randomization p-value.
- Exact McNemar is secondary diagnostic only.
- Report per-model and pooled estimates; pooling is descriptive and cannot override a negative/missing/underpowered stratum.
- Holm correction over all 84 declared skill×model efficacy hypotheses; harm/wrong-neighbor is a separate family.

## Export fields (required on any future result)

Every claim-bearing export MUST distinguish:

- `measured_result`
- `statistical_status`
- `replication_status`
- `evidence_validity`
- `product_disposition`

A statistically significant row MUST NOT silently become ELEVATE.

## Arms and controls

| Arm | Role | Body source |
|-----|------|-------------|
| none | primary control | production request, no skill body |
| full_legacy | primary | **Only if** `full_legacy_body_available`: prelean commit `733353cf9b9080742ab0ba7d298fad710c9d0f1a` body matching snapshot hash. Else non-executable. |
| lean | primary | current `skills/<dir>/SKILL.md` hash in manifest |
| equal_budget_placebo | diagnostic | inert `<context-padding>` tokens to lean input budget |
| wrong_neighbor | diagnostic | plausible incorrect skill for harm/overuse |

Randomize arm order by seed `portfolio-v1-2026-07-16`. Do not reuse solver conversations across arms. Temperature/effort/tool policy identical across arms.

## Models

- small: `claude-haiku-4-5-20251001`
- mid: `claude-sonnet-4-6`
- frontier: `claude-opus-4-8`

## Judge panel (blocked)

- Models: ["gpt-5.5-pro","gemini-3.1-pro-preview","deepseek-v4-pro"]
- Status: **blocked_missing_human_labels**
- decision_eligible: **false**
- Policy while blocked: all judged studies **manual_only**; do not run solver calls that require the panel for primary disposition.

## Data policy

- Heldout min positives (screening): 20
- Hard negatives / near-neighbor min: 10
- Replication min: 10 (design); confirmatory still requires power/eligibility
- High-ceiling datasets (>90% no-skill) cannot support no-lift deletion without harder native cases
- If no credible native source exists → quarantine and record evidence gap
- **Binary-decision applicability** rows (mode `binary-decision`, gold = skill warranted yes/no) are recorded in `cases.json` as reference IDs only and marked **non-native** for unrelated primary metrics
- Identical source path+sha256 entries are **deduplicated** in manifest/cases

## Budget and cost model (frozen assumptions)

Portfolio ceiling: **USD 2000**.

Per-solver-call unit cost assumptions (short binary/task envelopes; diagnostic only for budgeting):

- `claude-haiku-4-5-20251001`: USD 0.004
- `claude-sonnet-4-6`: USD 0.02
- `claude-opus-4-8`: USD 0.08

These are planning caps, not measured prices. Per-skill `max_cost_usd` ≤ equal share. Sum of per-skill caps ≤ portfolio ceiling.

## Per-skill freeze summary

All 28 skills at freeze:

| Field | Value |
|-------|-------|
| run_status | no_run |
| product_disposition | manual_only_quarantine |
| statistical_status | unmeasured_preregistered_no_run |
| replication_status | not_run |
| evidence_validity | preregistered_blocked |
| elevate_count | 0 |
| full_legacy_body_available true | 16 |
| full_legacy_body_available false | 12 |

### Universal / common blockers

1. `power_infeasible_under_frozen_design`
2. Judge-required skills: `judge_panel_blocked`
3. Skills with only applicability binary-decision data: `non_native_applicability_labels`
4. Skills with empty sources: `missing_native_dataset`
5. Skills with inadequate splits: `inadequate_splits` / heldout or replication below minima
6. Skills without recoverable full_legacy body: `missing_full_legacy_body` (12 skills; blocks full-relative noninferiority/token gates)

Skill-level detail, hashes, ordered case IDs, and per-skill max N/calls/cost live in `manifest.json` and `cases.json`.

## Confirmatory eligibility (future runs)

A confirmatory claim requires **all** of: matching this preregistration hash, eligible replication split, exact dataset/skill/prompt/solver hashes, target N/power for the multiplicity-adjusted rule, complete health (attempted/completed/parse/transport/scored denominators), successful replication, and restore-tested raw archive or preserved source with provisional flag. Smoke artifacts and n≪powered N are ineligible. AUTO-RETAIN additionally requires executable full_legacy for full-relative gates.

## Explicit non-claims

- No skill is ELEVATE / AUTO-RETAIN at this freeze.
- Historical July scientific-method +4.0pp is directional-only provisional, not portfolio replication.
- This preregistration does **not** authorize model calls; survivors remain manual-only until every gate passes.
- Budget ceiling is not a commitment to spend; default is no-run while blocked.
- Snapshot hashes alone do not constitute a full_legacy arm.

## Deterministic validation command

After writing artifacts, validate with:

```bash
node -e "
const fs=require('fs');const c=require('crypto');const {execSync}=require('child_process');
const reg=JSON.parse(fs.readFileSync('evals/studies/registry.json','utf8'));
const man=JSON.parse(fs.readFileSync('evals/studies/portfolio-v1/manifest.json','utf8'));
const cases=JSON.parse(fs.readFileSync('evals/studies/portfolio-v1/cases.json','utf8'));
const prereg=fs.readFileSync('evals/studies/portfolio-v1/prereg.md');
const legacy=JSON.parse(fs.readFileSync('evals/studies/catalog-cutover/legacy-skills.json','utf8'));
const sha=b=>c.createHash('sha256').update(b).digest('hex');
const PRELEAN='733353cf9b9080742ab0ba7d298fad710c9d0f1a';
const MISSING=new Set(['bounded-rationality','first-principles','kepner-tregoe','model-combination','model-router','opportunity-cost','pre-mortem','probabilistic','reversibility','scientific-method','steel-manning','systems']);
const ids=reg.catalog.survivors;
if(ids.length!==28) throw new Error('registry survivors != 28');
if(man.skills.length!==28) throw new Error('manifest skills != 28');
if(Object.keys(cases.skills).length!==28) throw new Error('cases skills != 28');
const mids=man.skills.map(s=>s.skill_id).sort().join(',');
if(mids!==[...ids].sort().join(',')) throw new Error('skill id set mismatch');
if(new Set(man.skills.map(s=>s.skill_id)).size!==28) throw new Error('duplicate skill ids');
if(man.summary.elevate_count!==0) throw new Error('elevate_count must be 0');
if(man.preregistration.sha256!==sha(prereg)) throw new Error('prereg sha mismatch');
if(man.legacy_full_arm && man.legacy_full_arm.commit && !man.legacy_full_arm.note?.includes('not a global')) {
  /* allow structured legacy_full_arm only if it does not claim global a591 body source */
}
if(man.legacy_full_arm?.claims_global_a591_body_source) throw new Error('false global a591 body source');
let avail=0, miss=0;
for(const s of man.skills){
  const p=s.hashes.lean_skill_md.path;
  const h=sha(fs.readFileSync(p));
  if(h!==s.hashes.lean_skill_md.sha256) throw new Error('lean hash drift '+s.skill_id);
  if(s.product_disposition!=='manual_only_quarantine') throw new Error('disposition '+s.skill_id);
  if(s.run_status!=='no_run') throw new Error('run_status '+s.skill_id);
  const fl=s.hashes.full_legacy;
  if(typeof fl.full_legacy_body_available!=='boolean') throw new Error('full_legacy_body_available missing '+s.skill_id);
  if(MISSING.has(s.skill_id)){
    if(fl.full_legacy_body_available!==false) throw new Error('expected missing body '+s.skill_id);
    if(fl.source?.commit!=null || fl.source?.path!=null) throw new Error('source must be null for missing '+s.skill_id);
    if(!s.blockers.some(b=>b.code==='missing_full_legacy_body')) throw new Error('missing blocker '+s.skill_id);
    if(s.gates_runnable.lean_vs_full_noninferiority!==false) throw new Error('noninf must be false '+s.skill_id);
    miss++;
  } else {
    if(fl.full_legacy_body_available!==true) throw new Error('expected available body '+s.skill_id);
    if(fl.source.commit!==PRELEAN) throw new Error('prelean commit '+s.skill_id);
    if(!fl.source.path) throw new Error('path required '+s.skill_id);
    const body=execSync('git show '+PRELEAN+':'+fl.source.path,{encoding:'utf8',maxBuffer:5e6});
    const m=body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
    const bodyOnly=m?body.slice(m[0].length):body;
    if(sha(bodyOnly)!==fl.body_sha256) throw new Error('prelean body hash '+s.skill_id);
    avail++;
  }
  const seen=new Set();
  for(const src of s.sources||[]){
    const k=src.path+'|'+src.sha256;
    if(seen.has(k)) throw new Error('duplicate source '+k);
    seen.add(k);
    if(!fs.existsSync(src.path)) throw new Error('missing source '+src.path);
    if(sha(fs.readFileSync(src.path))!==src.sha256) throw new Error('source hash '+src.path);
  }
  const cj=cases.skills[s.skill_id];
  if(!cj) throw new Error('cases missing '+s.skill_id);
  if(JSON.stringify(cj.heldout_ids)!==JSON.stringify(s.case_ids.heldout)) throw new Error('heldout mismatch '+s.skill_id);
  if(JSON.stringify(cj.replication_ids)!==JSON.stringify(s.case_ids.replication)) throw new Error('repl mismatch '+s.skill_id);
  if(cj.full_legacy_body_available!==fl.full_legacy_body_available) throw new Error('cases full_legacy flag '+s.skill_id);
}
if(avail!==16||miss!==12) throw new Error('avail/miss counts '+avail+'/'+miss);
if(/"prompt"\s*:/.test(JSON.stringify(cases))) throw new Error('prompt field in cases');
if(man.skills.some(s=>/elevate/i.test(s.product_disposition))) throw new Error('ELEVATE disposition');
console.log('portfolio-v1 OK',{skills:28,prereg_sha256:sha(prereg),elevate:0,full_legacy_available:avail,full_legacy_missing:miss});
"
```

## Change control

Any gate, arm, model, seed, split, disposition-rule, or full_legacy recovery change requires a new `study_version` and prereg hash **before** examining affected results. No post-hoc exceptions.
