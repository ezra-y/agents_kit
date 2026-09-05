# Deep Research Skill

> 🚦 **Hard cap: ≤7 parallel sub-agents at any moment.** Batch more dimensions across rounds instead of raising the cap. **Sub-agents may not spawn their own sub-agents** — recursive fan-out is the single most expensive failure mode (see Anti-pattern 6). If your platform ships a built-in "deep research" mode that fans out to dozens of agents, do not use it; use this controlled flow.

## Metadata

- **Type**: Workflow
- **Use when**: you need a deep, comprehensive, verifiable third-party investigation of a topic — and you want a *judgment* out of it, not a summary.
- **Output**: a single final report file in your chosen output directory.

## Core principles

1. **Primary sources first.** Find the original documents (official announcements, technical papers, founder blog posts, earnings-call transcripts). Read them closely *before* doing any broad search. Second-hand information evaporates insight one hop at a time.
2. **Argument-driven, not topic-driven.** The report's structure is a chain of reasoning (observation → analysis → judgment), not a taxonomy (market → competition → trends). Each chapter advances one claim with logical progression between them.
3. **Compare to find insight.** Pick 2–3 core cases and contrast them deeply. Convergence is itself a finding; the *reason* behind divergence is a bigger one.
4. **Label uncertainty.** Honestly separate what you *know*, what you *reasonably infer*, and what you're *unsure of*. Over-confident conclusions are a sign of sloppy analysis.
5. **Traceability.** Every citation keeps its URL; key citations keep an original excerpt.
6. **Single deliverable.** Produce one consolidated report. Do not persist intermediate sub-agent results.

## The key distinction: Wide vs Deep Research

**Wide Research** (information shuffling): search many sources → arrange them by topic → output a checklist. This is the LLM's default mode, and it produces *correct nonsense*.

**Deep Research** (analysis): read primary sources closely → extract contradictions and tensions → use an analytical frame to produce an original judgment. Depth comes from the cognitive dimension (which frame you look through), not the information dimension (how many angles you cover).

This workflow targets the latter.

## Model division of labor

Research sub-agents (the Phase 1/2 searching, extracting, summarizing) should run on a cheaper/faster model. These tasks are low in judgment density and high in information density — a smaller model performs on par at a fraction of the cost.

The main agent stays on your strongest model for Phase 0 (meta-thinking), Phase 3 (cross-verification), and Phase 4 (writing). Those steps need synthesis and judgment.

## Search-tool rule

All search and page-extraction operations, whether by the main agent or a sub-agent, follow one priority order:

1. **Prefer a dedicated search/extract tool** (a search MCP such as Tavily, or an equivalent) — it returns cleaner, more complete content.
2. **Fall back to built-in web search/fetch** only when the preferred tool is unavailable (connection failure, tool not loaded, error).
3. **Announce the fallback** when you switch, and say why.

---

## Workflow

### Phase 0: Meta-thinking & frame alignment (main agent only, never delegated)

**Goal**: question the question itself, define what a "good answer" looks like, and choose the analytical lens.

**Step 0a — Interrogate the question.** Before any search, answer three things:
1. Why is this being asked? What's the hidden assumption behind it, and is that assumption sound?
2. If you break the assumption, is there a *better* question? (e.g. "What does A acquiring B mean?" → "Why must A acquire B *now*, *this way*, rather than any alternative?")
3. Is there an obvious-but-wrong "standard answer"? If so, the report's value is in explaining exactly why it's wrong.

**Step 0b — Define the standard for a good answer.** Write it down explicitly. Usually:
- The reader ends up with at least one *judgment* they didn't have before (not information — judgment).
- The core claim, put in front of a room of practitioners, would start an argument rather than unanimous nods.
- There's an explicit "what I don't know" section that honestly marks the blind spots.

**Step 0c — Pick a frame, form hypotheses.**
1. State the core *question* (not the "topic" — the question).
2. Choose 1–2 analytical frames, e.g. value-chain analysis, Porter's Five Forces, technology-adoption curve, Jobs-to-be-Done, analogical reasoning (what's the closest historical case and how did it end?), counterfactual analysis.
3. Form 2–3 falsifiable hypotheses — at least one of which should be counterintuitive.

**Output**: the frame, initial hypotheses, and the "good-answer standard," held in working memory to guide every sub-agent prompt and the final self-check.

### Phase 1: Primary-source close reading

**Goal**: find the 3–5 most important original documents and extract their core claims and contradictions.

1. Launch 1–2 sub-agents (cheaper model) dedicated to finding and closely reading primary sources: official announcements, press-conference transcripts, earnings calls, founder/CEO blog posts or interviews, technical papers, product docs, original analyst reports (not media paraphrases).
2. Each sub-agent's prompt must stress:
   - **Find the original, not someone's summary of the original.**
   - Read each source in full and extract: core claims, key data, internal contradictions, and *what is left unsaid* (silence is a signal).
   - Note the author's position and incentives (a CEO praising their own product is not evidence).

The goal here is depth on a few sources, not breadth.

**Search-tool instruction to append to every research sub-agent prompt:**

```
## Search-tool rule (hard constraint)
Prefer a dedicated search/extract tool (search MCP / equivalent) for all
search and page-extraction. Fall back to built-in web search/fetch only
when the preferred tool is unavailable. Announce any fallback and why.
```

### Phase 2: Comparison & breadth supplement

**Goal**: generate insight through contrast; fill in data and counter-evidence with breadth search.

1. Based on Phase 1, launch 2–3 sub-agents (cheaper model):
   - **Comparison agent**: pick 2–3 representative cases and contrast them deeply. Why did they choose differently? What divergence in assumptions does that reflect?
   - **Counter-evidence agent**: hunt specifically for the opposing case — failures, criticism. Add keywords like "criticism", "failure", "problem", "why not".
   - **Data agent**: supply quantitative data (market size, funding, user counts) — but data serves the argument, not the reverse.
2. Keep ≥50% overlap between dimensions so different agents surface different readings of the same fact.

Each sub-agent prompt must include: the Phase 0 frame and hypotheses; a clear comparison axis or counter-evidence direction; a requirement to return URLs and original excerpts (not just summaries); and a note that results are returned to the main agent, **not** written to files.

### Phase 3: Integration, cross-verification & argument construction (main agent)

**Goal**: build the argument chain from raw material, find contradictions, form an original judgment.

1. Compare all sub-agent returns:
   - Corroborated by multiple agents → high confidence.
   - Single-source → flag the source, prompt verification.
   - Contradictory → flag it specially and **analyze what the contradiction means**.
2. Revisit the Phase 0 hypotheses and test each: confirmed (by what evidence)? refuted (why — and does the refutation itself yield a new insight)? undecidable (mark honestly)?
3. Build the chain: observation → analysis → judgment → limits.
4. If a major gap or contradiction surfaces, launch a targeted sub-agent to verify.

### Phase 4: Write the final report (main agent only, never delegated)

**Writing principles**:
- **Argument-driven structure**: each chapter advances one claim; the reader should finish a chapter with a judgment, not a pile of facts.
- **Prose over tables**: unfold the argument in natural-language paragraphs. Tables are for reference data you'll re-consult, not for carrying insight.
- **Insight from contrast**: "A and B set out from opposite directions and converged on the same conclusion" is worth far more than "A did X, B did Y".
- **Label limits honestly**: state what the report *doesn't* cover, which conclusions are low-confidence, which assumptions might be wrong.
- **Quote the original** for key evidence, so the reader can check your reading.
- **Not an investment pitch deck**: not every conclusion has to be optimistic. Present upside and risk; let the reader judge.
- **Counterintuitive first**: if everyone would agree with a conclusion, spend more ink on why that consensus might be wrong.
- **Write for the smart outsider**: technical detail serves judgment, not display. One good analogy beats three parameter comparisons.
- **Re-check against Phase 0**: if the core claim would provoke zero argument among practitioners, rewrite it.

**Format**:
- Markdown.
- Every citation has a URL; key citations keep an original excerpt.
- **The report must end with a "Sources" section**: all original links used, in citation order, each with a title/description + URL. This is mandatory, not optional.

**Important**: produce only one final report file. Writing is done by the main agent (sub-agents lack the whole-argument context). Do not persist intermediate results.

## URL retention

Keep the URL for: direct quotes, any number/statistic/rating, the source of any positive or negative assessment, and official product/company descriptions.

Format:
```markdown
**Source description** (URL)
> original excerpt
```

Avoid: "someone said..." (no URL), "an article online criticizes..." (no URL), summarizing without quoting (unverifiable).

---

## Execution discipline: where it's easiest to cut corners

These are the mistakes that recur in real runs. Check yourself against them before every research task.

### Anti-pattern 1: Skipping Phase 0 and fanning out to search immediately

The most common and most fatal. Without hypotheses to guide them, sub-agents do breadth search and return fragments instead of argument material. Do it right: the main agent thinks independently first, writes down hypotheses and the good-answer standard, *then* designs sub-agent prompts around them.

**Detection signal**: if your sub-agent prompt contains no "hypothesis" or "claim to test," you skipped Phase 0.

### Anti-pattern 2: Using the sub-agent return structure as the report skeleton

Sub-agents return information organized by search dimension (features, pricing, reviews). Reuse that structure and you'll ship a topic taxonomy pretending to be analysis. Do it right: break the returns apart and reorganize by argument chain. Each chapter advances one claim; information is only the evidence.

**Detection signal**: if your chapter titles work as search keywords ("Pricing comparison", "Feature comparison", "Who it's for"), the structure is a filing cabinet, not an argument. Good titles carry a judgment ("Once capabilities converge, what's the new axis of competition?").

### Anti-pattern 3: Tables and bullets standing in for thought

Tables are for lookup, not argument. If an insight fits in a table, it probably isn't one. Do it right: tables only for reference data the reader re-consults (pricing, specs); the argument runs entirely in paragraphs.

**Detection signal**: delete every table and bullet list — if the remaining paragraphs can't stand on their own, there wasn't enough thinking.

### Anti-pattern 4: Conclusions that are too safe

"A suits group X, B suits group Y" needs no research to say. The report's value is giving the reader a judgment they didn't have, which means the conclusion must be *falsifiable*.

**Detection signal**: post your core conclusion to a professional group in the field. If no one would push back or debate, it's too safe.

### Anti-pattern 5: Mistaking breadth for depth

Ten dimensions at three sentences each loses to three dimensions at three paragraphs. Depth comes from the cognitive dimension (which frame you use), not the information dimension (how many angles you cover).

**Detection signal**: if the report is over 5,000 words but the core claim compresses to three sentences, it's too broad and too shallow.

### Anti-pattern 6: Recursive agent fan-out

A real incident this rule exists to prevent: the main agent spawned 3 agents → those became 13 → those became 50+ → **149 agents total, and a surprise API bill.** Given a broad research prompt, a sub-agent will naturally keep splitting dimensions and spawning more agents — a recursive explosion.

**Detection signal**: if you catch yourself writing "you may use the Agent tool to search further" in a sub-agent prompt, stop. It's about to blow up.

Do it right:
- **Sub-agents only search and summarize; they never spawn grand-children.** Write it explicitly in every sub-agent prompt.
- The main agent controls concurrency and batches more dimensions itself.
- Enforce a hard cap at the platform level if you can (e.g. a pre-tool hook limiting agent spawns per session). Don't rely on the cap — design against recursion in the first place.

## Post-writing self-check (run after Phase 4)

1. With all tables and bullets deleted, can the remaining paragraphs stand as a complete piece?
2. Does each chapter title carry a judgment (not just a topic word)?
3. Is the core conclusion falsifiable?
4. Is there at least one counterintuitive finding or judgment?
5. Did you explicitly state "what I don't know"?
6. Were the primary sources actually read closely (not just title + snippet)?
7. Can the structure be strung together as "because X → therefore Y → which means Z"?

If 3+ fail, rewrite the core argument.

## Traps & countermeasures

| Trap | Countermeasure |
|------|----------------|
| Only positive info surfaces | Search specifically for "criticism", "negative review", "scam", "overpriced" |
| Single source | Force sub-agents to find multiple independent sources |
| Over-summarizing loses detail | Require original excerpts, not just summaries |
| Dimensions too clean, no overlap | Deliberately blur the edges when designing dimensions |
| Sub-agent returns too shallow | Stress "depth", "specific", "original text" in the prompt |
| Intermediate files pile up | One final report only; no intermediate results |
| Skipping Phase 0 | Main agent must write hypotheses + good-answer standard before dispatching sub-agents |
| Sub-agent structure = report structure | Break returns apart, reorganize by argument chain |
| Tables replacing thought | Tables for reference data only; argument in paragraphs |
| Recursive agent spawning | Forbid the Agent tool in sub-agent prompts; hard-cap spawns per session |
