# Tier 1 — Reasoning-Quality Rubric (artifact grading)

You are grading a single Claude Code "thinking skill" — a `SKILL.md` file that
encodes a mental model (e.g. first-principles, inversion, Cynefin). The skill is
injected into an AI agent's context to improve how it reasons about a problem.

Grade ONLY the content quality of the artifact, on the five dimensions below.
This is NOT a structural/format check — ignore whether it has the "right"
headers. Judge whether the *substance* would make a capable AI agent reason
better. Score each dimension 1–5 (integer). Be a harsh, specific critic.

## Dimensions

1. **fidelity** — Does it represent the source mental model correctly and
   attribute it honestly? Penalize misstatements, pop-science distortions, or
   claims the framework cannot support.

2. **applicability** — Does it give an AI agent a concrete, followable procedure
   it could actually execute on a real task (not just describe the idea)? Reward
   decision criteria, worked steps, and clear inputs/outputs.

3. **actionability** — Are the examples realistic and transferable to software /
   product / agentic work? Reward worked examples with a visible payoff; penalize
   abstract filler, restating the definition, or examples that don't show the
   model changing a decision.

4. **discrimination** — Does it tell the agent when NOT to use it, its failure
   modes, and how it differs from neighboring models? A skill that fires
   everywhere is noise. Reward explicit boundaries and anti-patterns.

5. **discoverability** — Would the `description:` frontmatter cause the right
   auto-invocation? Is it specific, trigger-rich, and ≤200 chars? Penalize vague,
   overlong, or generic descriptions.

## Output (JSON only)

```json
{
  "skill": "<name>",
  "scores": {"fidelity": 0, "applicability": 0, "actionability": 0, "discrimination": 0, "discoverability": 0},
  "weakest_dimension": "<name>",
  "one_line_verdict": "<<=200 chars>",
  "top_fix": "<the single highest-leverage improvement>",
  "would_mislead": false,
  "mislead_note": "<if would_mislead true, how it could push an agent to a worse decision; else empty>"
}
```
