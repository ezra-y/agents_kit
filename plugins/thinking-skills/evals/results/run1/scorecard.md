# Thinking Skills — Eval Scorecard

Run: `run1`

## Headline numbers
- **Tier 0 structural:** strict 90% vs substance-aware 92% (the strict number undercounts content-rich skills).
- **Tier 1 rubric (gemini-3.1-pro-preview):** mean 4.22/5; 6 skills flagged as potentially misleading.
- **Tier 2 routing (claude-sonnet-4-6):** lenient 99% / strict-unique 90%; positive 100%, negative 100%, ambiguous 94%.
- **Tier 3 behavioral (length-controlled, headline pair skill:placebo; solver claude-sonnet-4-6 / judge gemini-3.1-pro-preview):** mean win-rate 56%; proven 22/36.

## Per-skill (sorted by behavioral win-rate, weakest first)

| Skill | Behavioral win-rate | Lift | Verdict | Rubric /5 | Weakest dim | Structural strict→loose |
|---|---|---|---|---|---|---|
| thinking-regret-minimization | 0% | -3 | regresses | 2.8 | actionability | 94→92 |
| thinking-debiasing | 0% | -3 | regresses | 3 | actionability | 72→83 |
| thinking-triz | 0% | -3 | regresses | 4.4 | discrimination | 89→83 |
| thinking-systems | 33% | -1 | regresses | 3.8 | discrimination | 78→83 |
| thinking-leverage-points | 33% | -1 | regresses | 4.2 | discrimination | 83→92 |
| thinking-feedback-loops | 33% | -1 | regresses | 4.2 | discoverability | 83→83 |
| thinking-inversion | 33% | -1 | regresses | 4.4 | discrimination | 83→92 |
| thinking-opportunity-cost | 33% | -1 | regresses | 4.6 | discrimination | 94→100 |
| thinking-lindy-effect | 33% | -1 | regresses | 4.6 | actionability | 100→100 |
| thinking-jobs-to-be-done | 33% | -1 | regresses | 4.6 | discrimination | 94→92 |
| thinking-occams-razor | 33% | -1 | regresses | 4.8 | actionability | 89→100 |
| thinking-five-whys-plus | 33% | -1 | regresses | 4.8 | discrimination | 100→100 |
| thinking-bayesian | 50% | 0 | unproven-tie | 3.8 | actionability | 89→92 |
| thinking-margin-of-safety | 50% | 0 | unproven-tie | 4.8 | discrimination | 94→92 |
| thinking-circle-of-competence | 67% | 1 | proven | 2.4 | applicability | 94→92 |
| thinking-socratic | 67% | 1 | proven | 3.8 | discrimination | 78→92 |
| thinking-map-territory | 67% | 1 | proven | 4 | discrimination | 83→92 |
| thinking-second-order | 67% | 1 | proven | 4.2 | discrimination | 78→92 |
| thinking-archetypes | 67% | 1 | proven | 4.2 | discrimination | 83→83 |
| thinking-effectuation | 67% | 1 | proven | 4.2 | actionability | 94→92 |
| thinking-via-negativa | 67% | 1 | proven | 4.2 | discrimination | 94→92 |
| thinking-ooda | 67% | 1 | proven | 4.4 | applicability | 89→92 |
| thinking-scientific-method | 67% | 1 | proven | 4.4 | discrimination | 94→92 |
| thinking-probabilistic | 67% | 1 | proven | 4.6 | discrimination | 100→100 |
| thinking-red-team | 67% | 1 | proven | 4.6 | discrimination | 94→92 |
| thinking-steel-manning | 67% | 1 | proven | 4.6 | discrimination | 94→92 |
| thinking-kepner-tregoe | 67% | 1 | proven | 4.8 | discrimination | 78→83 |
| thinking-cynefin | 67% | 1 | proven | 4.8 | discoverability | 100→100 |
| thinking-reversibility | 67% | 1 | proven | 4.8 | discoverability | 100→100 |
| thinking-bounded-rationality | 67% | 1 | proven | 4.8 | discoverability | 89→83 |
| thinking-fermi-estimation | 67% | 1 | proven | 4.8 | discrimination | 89→83 |
| thinking-pre-mortem | 100% | 3 | proven | 3.2 | applicability | 89→92 |
| thinking-model-router | — | — | — | 3.4 | actionability | 78→83 |
| thinking-dual-process | 100% | 3 | proven | 3.8 | applicability | 89→100 |
| thinking-first-principles | 100% | 3 | proven | 3.8 | actionability | 94→92 |
| thinking-model-combination | — | — | — | 4.4 | actionability | 94→100 |
| thinking-model-selection | — | — | — | 4.4 | actionability | 100→100 |
| thinking-theory-of-constraints | 100% | 3 | proven | 4.4 | discrimination | 94→92 |
| thinking-thought-experiment | 100% | 3 | proven | 4.6 | discrimination | 100→100 |

## Unproven / regressing (behavioral lift ≤ 0)
- **thinking-debiasing** — win-rate 0%, regresses
- **thinking-regret-minimization** — win-rate 0%, regresses
- **thinking-triz** — win-rate 0%, regresses
- **thinking-feedback-loops** — win-rate 33%, regresses
- **thinking-five-whys-plus** — win-rate 33%, regresses
- **thinking-inversion** — win-rate 33%, regresses
- **thinking-jobs-to-be-done** — win-rate 33%, regresses
- **thinking-leverage-points** — win-rate 33%, regresses
- **thinking-lindy-effect** — win-rate 33%, regresses
- **thinking-occams-razor** — win-rate 33%, regresses
- **thinking-opportunity-cost** — win-rate 33%, regresses
- **thinking-systems** — win-rate 33%, regresses
- **thinking-bayesian** — win-rate 50%, unproven-tie
- **thinking-margin-of-safety** — win-rate 50%, unproven-tie

## Flagged as potentially misleading (Tier 1)
- **thinking-circle-of-competence** — Asking an LLM to evaluate its 'track record' or whether it has 'led teams before' will likely cause it to hallucinate a human persona rather than accurately assessing its actual epistemological boundaries.
- **thinking-regret-minimization** — Instructing an AI to 'project to age 80' will trigger bizarre roleplay or hallucinations, and applying human career examples to code tasks is incoherent.
- **thinking-pre-mortem** — It instructs the AI to facilitate a human team meeting ('Gather the team', 'Silent brainstorming'), which could cause the agent to halt execution and ask the user to schedule a meeting.
- **thinking-bayesian** — By providing math formulas for debugging, it encourages the agent to hallucinate arbitrary exact probabilities (e.g., P(database error)=0.20) and do math on them, creating a false sense of rigor for unjustified conclusions.
- **thinking-first-principles** — Fails to warn about the high cognitive/time cost of this model, potentially leading the agent to waste time reinventing standard, efficient software conventions (like standard REST/CRUD patterns).
- **thinking-socratic** — Without explicit constraints, an AI agent might adopt a pure 'coaching' persona, endlessly interrogating the user with meta-questions instead of writing code or making decisions.

## Over-length descriptions (>200 chars — hurts auto-invocation)
- thinking-leverage-points: 213
- thinking-kepner-tregoe: 233
- thinking-systems: 204
- thinking-feedback-loops: 276
- thinking-red-team: 214
- thinking-bounded-rationality: 236
- thinking-fermi-estimation: 201
- thinking-triz: 223
