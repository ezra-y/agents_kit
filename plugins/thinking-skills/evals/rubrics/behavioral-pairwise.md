# Tier 3 — Behavioral Pairwise Judge

Two AI assistants answered the SAME problem. One had a "thinking skill" (a
mental-model guide) injected into its context; the other did not. You do NOT
know which is which — they are labelled **A** and **B** in randomized order.

Judge which response reasons better about THIS problem. You are not grading
length, formatting, or confidence — grade the *quality of thinking*:

- Did it surface the non-obvious considerations the problem demands?
- Did it avoid the failure mode the problem is designed to expose
  (e.g. first-order-only thinking, confirming a prior, missing the constraint)?
- Is the conclusion better-justified and more decision-useful?
- Did it stay honest about uncertainty rather than over-claiming?

A response can lose for being longer-but-emptier. Reward genuine analytical lift,
not the mere presence of a framework's vocabulary (penalize "framework theater":
naming the model without doing the work).

## Output (JSON only)

```json
{
  "winner": "A" | "B" | "tie",
  "margin": "large" | "moderate" | "slight" | "none",
  "why": "<2-4 sentences: the specific reasoning difference that decided it>",
  "skill_vocab_without_substance": false
}
```
