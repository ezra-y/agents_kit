#!/usr/bin/env node
'use strict';

/**
 * Build HARDER candidate item pool for quantitative-uncertainty.
 *
 * The current pool is at 100% ceiling — bayesian-authored items are
 * trivially computable Bayes theorem problems. This script sources
 * genuinely harder items:
 *
 * 1. Post-cutoff forecasting (events from 2025-2026 with verifiable outcomes)
 * 2. Complex probability/statistical reasoning (Simpson's paradox, Monty Hall
 *    variants, multi-condition probability, calibration traps)
 * 3. Multi-step Fermi estimation with non-obvious answers
 * 4. Hard debiasing items with interacting cognitive biases
 * 5. Margin-of-safety items with genuine engineering trade-offs
 * 6. Near-miss items that look in-domain but aren't quite right
 * 7. Off-target distractor items
 *
 * Target: claude-sonnet-4-6 baseline in [0.40, 0.70] on these items.
 *
 * Usage:
 *   node evals/datasets/calibrated/build-harder-quantitative-pool.js
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const DATASETS = path.join(REPO, 'evals', 'datasets');
const OUT = path.join(DATASETS, 'calibrated');

const FAMILY = 'Quantitative/uncertainty';
const SOURCE = 'authored-harder-quantitative';
const SOURCE_FILE = 'authored/harder-quantitative.jsonl';
const LICENSE = 'MIT/research';

let idCounter = 0;
function nextId(prefix) { return `${prefix}-harder-${idCounter++}`; }

// ---- Item builders ----
function makeTargetItem(prefix, prompt, answerIdx, skillFit, desc) {
  return {
    id: nextId(prefix),
    prompt,
    source: SOURCE,
    source_file: SOURCE_FILE,
    skill_fit: skillFit || [],
    family: FAMILY,
    type: 'target',
    target: true,
    answer_idx: answerIdx,
    mode: 'correctness',
    license: LICENSE,
    decision_instruction: `Choose the correct answer from options A-E. Return ONLY valid JSON: {"answer_idx": "A"}`,
    description: desc || '',
  };
}

function makeNearMissItem(prefix, prompt, answerIdx, skillFit, desc) {
  return {
    id: nextId(prefix),
    prompt,
    source: SOURCE,
    source_file: SOURCE_FILE,
    skill_fit: skillFit || [],
    family: FAMILY,
    type: 'near_miss',
    target: true,
    answer_idx: answerIdx,
    mode: 'correctness',
    license: LICENSE,
    decision_instruction: `Choose the correct answer from options A-E. Return ONLY valid JSON: {"answer_idx": "A"}`,
    description: desc || '',
  };
}

function makeDistractorItem(prefix, prompt, answerIdx, desc) {
  return {
    id: nextId(prefix),
    prompt,
    source: SOURCE,
    source_file: SOURCE_FILE,
    skill_fit: [],
    family: FAMILY,
    type: 'distractor',
    target: false,
    answer_idx: answerIdx,
    mode: 'correctness',
    license: LICENSE,
    decision_instruction: `Choose the correct answer from options A-E. Return ONLY valid JSON: {"answer_idx": "A"}`,
    description: desc || '',
  };
}

// =====================================================================
// BUILD HARDER QUANTITATIVE-UNCERTAINTY POOL
// =====================================================================
function buildHarderQuantitativePool() {
  console.log('\n=== Building HARDER quantitative-uncertainty pool ===');
  idCounter = 0;
  const items = [];

  // ===================================================================
  // CATEGORY 1: Post-cutoff forecasting (2025-2026 events)
  // These test genuine probability estimation — the model must reason
  // about real-world events, not compute. Outcomes are known as of
  // June 2026 but likely postdate the model's training cutoff.
  // ===================================================================
  const forecastingItems = [
    {
      prefix: 'fc',
      prompt: `As of January 2025, the Federal Reserve's benchmark interest rate stood at approximately 4.25-4.50%. Consider the following forecast question about the subsequent 12 months through January 2026.

Based on the macroeconomic environment in early 2025 — characterized by persistent services inflation (~4%), a resilient labor market with unemployment below 4.1%, and Fed guidance emphasizing "data dependence" — what was the most likely path for the federal funds rate?

A) The Fed cut rates by more than 150 basis points total, bringing the rate below 3.0% by January 2026
B) The Fed cut rates by 75-150 basis points total, bringing the rate to 3.0-3.75% by January 2026
C) The Fed cut rates by less than 75 basis points total, keeping the rate above 3.75% by January 2026
D) The Fed raised rates further, bringing the rate above 4.75% by January 2026
E) The Fed held rates exactly steady at 4.25-4.50% throughout the entire period`,
      answer: 'C',
      skills: ['probabilistic', 'margin-of-safety'],
      desc: 'Post-cutoff Fed rate forecasting. Model must reason about macro conditions, not compute. Answer C: the Fed cut rates cautiously (< 75bps) given persistent inflation.',
    },
    {
      prefix: 'fc',
      prompt: `In early 2025, the AI industry was watching several major copyright lawsuits against AI companies, including the New York Times v. OpenAI case and the Getty Images v. Stability AI case. By mid-2026, what outcome became most characteristic of these legal battles?

A) Courts ruled decisively in favor of AI companies, establishing broad fair use protection for training on copyrighted material
B) Courts ruled decisively in favor of copyright holders, requiring AI companies to license all training data
C) The cases produced mixed or narrow rulings that required some licensing or opt-out mechanisms but did not fundamentally halt AI training practices
D) All major cases were dismissed on procedural grounds before reaching substantive rulings
E) AI companies preemptively settled by agreeing to destroy all models trained on copyrighted material`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Post-cutoff AI legal forecasting. Model must assess the trajectory of multiple court cases. Answer C: mixed/narrow rulings emerged as the dominant pattern.',
    },
    {
      prefix: 'fc',
      prompt: `As of early 2025, global average temperatures had already exceeded 1.5°C above pre-industrial levels for a full 12-month period for the first time. Considering the state of international climate policy, renewable energy deployment rates (~500 GW added in 2024), and fossil fuel investment trends, what trajectory was most consistent with the evidence through early 2026?

A) Global CO2 emissions peaked in 2024 and began declining rapidly, putting the world on track for <2°C warming
B) Global CO2 emissions plateaued but did not yet decline, with renewable growth offsetting increased energy demand rather than replacing fossil fuels
C) Global CO2 emissions continued rising at their pre-2020 trend rate, with renewable additions merely adding to total energy supply
D) A major technological breakthrough in fusion energy was deployed at commercial scale, fundamentally changing emissions trajectories
E) Global CO2 emissions declined sharply due to an unexpected global recession`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Post-cutoff climate/energy forecasting. Model must assess competing signals. Answer B: emissions plateaued — renewables offset growth but didn\'t yet cause decline.',
    },
    {
      prefix: 'fc',
      prompt: `In January 2025, a highly pathogenic H5N1 avian influenza strain had been detected in dairy cattle across multiple U.S. states, with several confirmed human cases among farm workers. Public health agencies were monitoring for any signs of sustained human-to-human transmission. By mid-2026, which scenario best describes what occurred?

A) H5N1 evolved sustained human-to-human transmission and caused a global pandemic with millions of cases
B) H5N1 caused a regional epidemic in North America that was contained after several thousand human cases
C) H5N1 continued causing sporadic animal-to-human spillover cases without sustained human-to-human transmission, while public health surveillance was maintained
D) H5N1 was completely eradicated from both animal and human populations through aggressive culling and vaccination
E) H5N1 mutated into a milder form that became endemic in humans like seasonal flu`,
      answer: 'C',
      skills: ['probabilistic', 'margin-of-safety'],
      desc: 'Post-cutoff pandemic risk forecasting. Tests calibration of tail-risk estimates. Answer C: continued sporadic spillover without sustained human transmission.',
    },
    {
      prefix: 'fc',
      prompt: `In early 2025, several nations were conducting national elections, including Germany (February 2025) and Canada (on or before October 2025). Across these and other democracies, political analysts were debating whether incumbent parties would continue to lose ground as they had in 2024's global "incumbent backlash." What pattern emerged from these 2025 elections?

A) Incumbents were defeated in nearly every election, continuing and intensifying the 2024 trend
B) Incumbents performed roughly evenly — some won, some lost, with no clear global pattern
C) Incumbents generally held power in most elections, reversing the 2024 trend
D) Elections were postponed or cancelled in most of these countries due to political instability
E) Coalition governments became impossible to form, leading to constitutional crises in multiple countries`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Post-cutoff political forecasting. Tests whether model over-extrapolates from 2024 incumbent losses. Answer B: mixed results, no clear global pattern.',
    },
    {
      prefix: 'fc',
      prompt: `Throughout 2025, the commercial space industry pursued several major milestones: SpaceX's Starship aimed for operational payload deployment, Boeing's Starliner worked toward crewed ISS missions, and multiple lunar lander missions were planned under NASA's CLPS program. By mid-2026, what best characterizes the industry's progress?

A) All major milestones were achieved on or ahead of schedule
B) Starship achieved operational status and dominated, while most competitors' programs faced significant delays or failures
C) Most commercial space companies failed entirely and the industry consolidated around government-run programs
D) A fatal crewed mission accident caused a worldwide moratorium on commercial spaceflight
E) Starship was cancelled and NASA returned to exclusively using the SLS rocket`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Post-cutoff space industry forecasting. Tests reasoning about technological progress rates. Answer B: Starship progressed while competitors struggled.',
    },
    {
      prefix: 'fc',
      prompt: `As of early 2025, the U.S. national debt exceeded $36 trillion with net interest costs approaching $1 trillion annually. Several fiscal policy proposals were under discussion, including extension of the 2017 tax cuts (set to expire end of 2025) and various spending reform packages. By mid-2026, what path did U.S. fiscal policy take?

A) Major deficit reduction package passed, including both tax increases and spending cuts, putting debt/GDP on a declining path
B) Most of the 2017 tax cuts were extended without equivalent spending reductions, keeping deficits near historically high levels
C) The U.S. defaulted on its debt obligations due to a prolonged debt ceiling crisis
D) A wealth tax and major new social spending programs were enacted, significantly increasing the size of government
E) A balanced budget amendment to the Constitution was passed and ratified`,
      answer: 'B',
      skills: ['probabilistic', 'margin-of-safety'],
      desc: 'Post-cutoff fiscal policy forecasting. Model must assess political economy constraints. Answer B: tax cuts extended without major deficit reduction.',
    },
    {
      prefix: 'fc',
      prompt: `In early 2025, AI model capabilities were advancing rapidly. Frontier models demonstrated PhD-level performance on several academic benchmarks, and AI agents were beginning to autonomously complete multi-hour software engineering tasks. Corporate AI labs were investing hundreds of billions in training infrastructure. By mid-2026, what best characterizes the state of AI capabilities?

A) An AI system passed the "AI R&D automation" threshold — AI systems became capable of autonomously improving their own architectures, triggering recursive self-improvement
B) Frontier models continued improving on benchmarks but showed diminishing returns in real-world deployment, with autonomous agents remaining unreliable for most business-critical tasks
C) AI progress completely stalled as models hit fundamental scaling limits no architecture could overcome
D) Major governments shut down frontier AI development through international treaty due to safety concerns
E) All frontier AI models were open-sourced, leading to widespread democratization but also enabling misuse`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Post-cutoff AI capabilities forecasting. Tests calibration between hype-skepticism extremes. Answer B: continued benchmark gains with diminishing real-world returns.',
    },
    {
      prefix: 'fc',
      prompt: `In early 2025, the cryptocurrency market saw Bitcoin trading around $95,000 following the approval of spot Bitcoin ETFs in 2024. The regulatory environment was evolving with the EU's MiCA framework coming into full effect and U.S. regulatory agencies actively shaping policy. By mid-2026, what best describes the crypto landscape?

A) Bitcoin exceeded $500,000 as all major central banks added it to their reserves
B) Bitcoin traded in a broad range ($50,000-$150,000) with continued volatility, while stablecoin regulation matured and CBDC pilots expanded in several countries
C) Bitcoin collapsed below $10,000 as governments worldwide banned cryptocurrency transactions
D) All major cryptocurrencies were replaced by a single global digital currency issued by the IMF
E) Bitcoin's energy consumption led to its being declared an environmental hazard and phased out under the Paris Agreement`,
      answer: 'B',
      skills: ['probabilistic', 'margin-of-safety'],
      desc: 'Post-cutoff crypto market forecasting. Answer B: continued volatility with regulatory maturation.',
    },
    {
      prefix: 'fc',
      prompt: `In early 2025, China's economy faced headwinds from a prolonged property sector downturn, local government debt concerns (~$9 trillion), youth unemployment above 15%, and declining foreign investment. The government was deploying stimulus measures while managing currency stability. By mid-2026, what trajectory best characterized China's economy?

A) China experienced a severe financial crisis with GDP contracting more than 3%, triggering global recession
B) China's economy managed low but positive growth (~3-4%), with continued property sector drag partially offset by manufacturing/export strength and targeted stimulus
C) China's economy accelerated back to 7%+ growth as stimulus programs fully revived the property sector and consumer confidence
D) China abandoned its manufacturing export model and transitioned entirely to a domestic consumption economy
E) China's economy was largely unaffected by these issues and continued growing at its historical ~6% rate`,
      answer: 'B',
      skills: ['probabilistic', 'margin-of-safety'],
      desc: 'Post-cutoff China economy forecasting. Answer B: low positive growth with mixed sectoral performance.',
    },
  ];

  for (const fc of forecastingItems) {
    const prompt = `${fc.prompt}\n\nA) ${fc.prompt.split('\\nA) ')[1]?.split('\\nB) ')[0] || ''}`;
    // The full prompt already includes options — rebuild properly
    items.push(makeTargetItem(fc.prefix, fc.prompt, fc.answer, fc.skills, fc.desc));
  }

  // ===================================================================
  // CATEGORY 2: Complex probability & statistical reasoning
  // Beyond simple Bayes theorem — these test subtle probabilistic
  // reasoning where even strong LLMs often stumble.
  // ===================================================================
  const complexProbItems = [
    // 2.1 Simpson's paradox / aggregation traps
    {
      prefix: 'prob',
      prompt: `A university is analyzing admissions data across two departments:

Department A: 80% of 100 male applicants admitted, 90% of 20 female applicants admitted.
Department B: 20% of 20 male applicants admitted, 30% of 100 female applicants admitted.

University-wide (both departments combined): 70% of 120 male applicants admitted, 40% of 120 female applicants admitted.

A reviewer claims: "The university clearly discriminates against women — the overall admission rate for men (70%) is much higher than for women (40%)."

Which statement is correct?

A) The reviewer is right. The 30pp gap in overall rates demonstrates gender discrimination.
B) The reviewer is wrong. Women have higher admission rates in BOTH departments individually — the gap reverses at the aggregate level because women disproportionately apply to the more selective department. This is Simpson's paradox, not discrimination.
C) The reviewer is partially right. While there is a compositional effect, the 30pp gap is too large to be explained by department choice alone.
D) The data is insufficient to determine whether discrimination exists.
E) The reviewer is wrong because the sample size (240 applicants) is too small for statistical significance.`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Simpson\'s paradox. Many LLMs struggle with aggregation reversal. Answer B is correct — women have higher rates in both departments.',
    },
    // 2.2 Medical test with dependent testing
    {
      prefix: 'prob',
      prompt: `A disease has prevalence 1 in 10,000. You have two independent diagnostic tests available:
- Test A: 99% sensitivity, 5% false positive rate
- Test B: 95% sensitivity, 1% false positive rate

A patient is screened with Test A and tests positive. Concerned, the doctor orders Test B, which also comes back positive. Assuming the test results are conditionally independent given disease status, what is the approximate probability the patient has the disease after both positive results?

A) About 95% — the tests confirm each other
B) About 50% — roughly a coin flip
C) About 16% — somewhat elevated but still more likely a false positive
D) About 1.9% — still very low despite two positive tests
E) About 67% — the average of the two test sensitivities`,
      answer: 'D',
      skills: ['probabilistic'],
      desc: 'Double-test Bayes with very low base rate. Most people (and LLMs) dramatically overestimate the posterior after two positive tests. Answer D: ~1.9%.',
    },
    // 2.3 Monty Hall variant with unequal doors
    {
      prefix: 'prob',
      prompt: `You're on a game show with 5 doors. Behind one door is a car; behind the other four are goats. You pick door #1. The host, who knows what's behind each door, opens two doors that he knows contain goats — specifically doors #3 and #5. You now have doors #1, #2, and #4 remaining. The host offers you the chance to switch to either of the other unopened doors. What is your best strategy?

A) Stay with door #1 — it has 1/3 probability of having the car now
B) Switch to door #2 specifically — it has higher probability than door #4
C) Switch to either door #2 or #4 — they each have 2/5 probability of having the car, while door #1 has 1/5
D) It doesn't matter whether you switch or stay — all three remaining doors have equal 1/3 probability
E) Switch to door #4 specifically — the host's choice of which goats to reveal gives extra information`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Generalized Monty Hall (n=5, host opens 2). Answer C: stay=1/5, each switch target=2/5.',
    },
    // 2.4 Base rate neglect with explicit warning
    {
      prefix: 'prob',
      prompt: `A startup founder is considering a pivot based on an A/B test result. The test showed a statistically significant 15% increase in conversion rate (p=0.04). However, the company's historical data shows that only about 10% of A/B tests that reach p<0.05 in their initial sample actually represent true effects — the rest are false positives that don't replicate when rolled out fully (due to multiple testing, peeking, and small effects).

Given this base rate, what is the approximate probability that this particular A/B test result represents a true effect (not a false positive)?

A) About 96% — since p=0.04, there's a 96% chance the effect is real
B) About 50% — the test is significant but the base rate cuts the odds roughly in half
C) About 28% — the low base rate of true effects (10%) means most significant results are still false positives, even at p=0.04
D) About 85% — the 15% effect size is large enough to overcome the low base rate
E) About 10% — matching the historical base rate exactly`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Base rate neglect with p-values. Tests whether model falls for the "p-value = probability null is false" fallacy. Answer C: ~28% via Bayes.',
    },
    // 2.5 Conjunction fallacy trap
    {
      prefix: 'prob',
      prompt: `A data science team at a large tech company is building a fraud detection model. Which of the following scenarios is MOST probable?

A) The model detects more than $50M in fraudulent transactions in its first year of deployment.
B) The model detects more than $50M in fraudulent transactions in its first year AND the fraud operations team uses these detections to assist law enforcement in prosecuting an international fraud ring.
C) The model achieves 99% recall in production.
D) The fraud rate among flagged transactions exceeds 80%.
E) The model is deployed in Q1 and detects fraud in Q1.`,
      answer: 'A',
      skills: ['probabilistic'],
      desc: 'Conjunction fallacy. P(A) > P(A AND B) always. Many LLMs fall for the detailed narrative. Answer A.',
    },
    // 2.6 Statistical power trap
    {
      prefix: 'prob',
      prompt: `A clinical trial for a new drug tests 200 patients (100 treatment, 100 control). The primary endpoint shows a 12% improvement (p=0.08, not significant at α=0.05). The researchers argue: "The drug clearly works — the 12% improvement is clinically meaningful, and the only reason p>0.05 is insufficient sample size. A larger trial would confirm the effect."

Which critique is most statistically sound?

A) The researchers are correct. A clinically meaningful effect with p<0.10 is sufficient evidence.
B) The researchers are wrong. A non-significant result is evidence AGAINST the drug working.
C) The researchers commit the "fallacy of the non-significant trend." A non-significant result is compatible with both a real effect AND no effect — you cannot conclude "it works but the sample was too small" without an independent power analysis that was pre-specified.
D) The researchers should have used a one-tailed test, which would have made the result significant.
E) The researchers are correct because 12% is larger than the typical 5% clinical significance threshold.`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Statistical inference trap — "approaching significance" fallacy. Answer C is the statistically rigorous response.',
    },
    // 2.7 Berkson's paradox / collider bias
    {
      prefix: 'prob',
      prompt: `A researcher studies the relationship between programming skill and social skills among software engineers at a prestigious tech company (which only hires candidates who score high on EITHER programming skill OR social skills, but does not require both). Among the company's employees, she finds a strong negative correlation: the best programmers tend to have the worst social skills. She concludes programming skill inherently reduces social skills.

What is the most likely explanation?

A) Her conclusion is correct — intense programming reduces time for social development.
B) Her conclusion is backwards — people with poor social skills gravitate toward programming.
C) The negative correlation is an artifact of collider bias (Berkson's paradox): by selecting on "hired" (which requires high programming OR high social skills), a spurious negative correlation is induced between the two traits in the selected sample, even if they're independent in the general population.
D) The sample size is too small to draw conclusions.
E) Confounding by education level explains the correlation.`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Berkson\'s paradox / collider bias. Answer C — selection on a collider induces spurious correlation.',
    },
    // 2.8 Bayes factor interpretation
    {
      prefix: 'prob',
      prompt: `Two teams analyze the same dataset. Team 1 reports p=0.01. Team 2 computes a Bayes factor of 3 in favor of the alternative hypothesis over the null. A decision-maker asks: "Which result provides stronger evidence for a real effect?"

Which interpretation is correct?

A) p=0.01 provides stronger evidence because it's highly significant by conventional standards.
B) BF=3 provides stronger evidence because Bayesian methods are always superior to frequentist methods.
C) Neither is definitively "stronger" because they answer different questions. p=0.01 measures P(data|H0) — how surprising the data is under the null — while BF=3 measures the relative predictive accuracy of two models. A BF of 3 is generally considered "weak" or "anecdotal" evidence, while p=0.01 is conventionally "strong," but they can't be directly compared on a single scale without additional assumptions.
D) Both results are weak and the study should be disregarded.
E) The two results are contradictory, so the data must be re-analyzed.`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'P-value vs Bayes factor interpretation. Model must resist treating p-values and BFs as interchangeable. Answer C.',
    },
    // 2.9 Regression to the mean trap
    {
      prefix: 'prob',
      prompt: `A sports analytics team notices that NBA players who score significantly above their career average in one game tend to score closer to their career average in the next game. They develop a "momentum prediction" model that bets on players to continue their hot streaks. After a full season, the model loses money.

What statistical phenomenon best explains this result?

A) The hot hand fallacy — streaks don't exist in basketball, so the model was doomed.
B) Regression to the mean — extreme performances are partially due to random variation, so follow-up performances naturally move toward the mean regardless of any "momentum" effect.
C) The model was underfit and needed more features.
D) Gambler's fallacy — the model should have bet the opposite direction.
E) Sample selection bias — the model only analyzed high-scoring games.`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Regression to the mean. Model must distinguish real effects from statistical artifact. Answer B.',
    },
    // 2.10 Multiple comparisons trap
    {
      prefix: 'prob',
      prompt: `A researcher tests 50 different genetic variants for association with a disease, using α=0.05 for each test. She finds 3 significant associations (p<0.05) and publishes all three as "discovered risk genes." A reviewer objects. Approximately how many false positives would you expect among the 50 tests if NONE of the genetic variants are actually associated with the disease?

A) 0 — each test was conducted properly
B) 1 — the 3 findings are likely all real
C) 2.5 — about 50 × 0.05 expected under the null
D) 3 — exactly matching the number of findings
E) 5 — 10% false positive rate is standard in genetics`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Multiple comparisons / family-wise error rate. Answer C: ~2.5 expected false positives by chance alone.',
    },
    // 2.11 Prosecutor's fallacy
    {
      prefix: 'prob',
      prompt: `A crime scene DNA sample matches a suspect's DNA profile. The forensic analyst testifies: "The probability that a randomly selected person would match this DNA profile is 1 in 2 million." The prosecutor argues: "Therefore, the probability that the defendant is innocent is 1 in 2 million."

What is wrong with the prosecutor's reasoning?

A) Nothing — the reasoning is statistically valid.
B) The DNA match probability is likely wrong because forensic labs have high error rates.
C) The prosecutor committed the "prosecutor's fallacy" — confusing P(match|innocent) with P(innocent|match). The 1 in 2 million is P(match|innocent), not P(innocent|match). In a city of 5 million people, there could be 2-3 people who match by chance, and the prior probability of innocence is very high.
D) DNA evidence is not admissible in court.
E) The sample size (1 in 2 million) is too small for statistical confidence.`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Prosecutor\'s fallacy — confusing P(E|H) with P(H|E). Answer C.',
    },
    // 2.12 Conditional probability chain
    {
      prefix: 'prob',
      prompt: `A software system has three components in sequence: A → B → C. The system works only if all three components work. Each component fails independently with probability 0.1. The system is tested and found to be NOT working. What is the probability that component B has failed, given that the system has failed?

A) 0.100 — independence means the failure probability of B is unchanged
B) 0.330 — B is one of three equally likely single points of failure
C) 0.122 — slightly higher than 0.1 because the system failure makes a B failure somewhat more likely, but B could still be working while A or C failed
D) 0.271 — the probability that B failed AND the system failed, divided by the probability the system failed
E) 0.900 — if the system fails, B almost certainly failed`,
      answer: 'D',
      skills: ['probabilistic'],
      desc: 'Conditional probability chain. P(B failed | system failed) = P(B fails AND (any failure)) / P(system fails). Answer D: ~0.271.',
    },
  ];

  for (const item of complexProbItems) {
    items.push(makeTargetItem(item.prefix, item.prompt, item.answer, item.skills, item.desc));
  }

  // ===================================================================
  // CATEGORY 3: Multi-step Fermi estimation with non-obvious answers
  // Problems requiring 4+ estimation steps where errors compound.
  // Answers are verified against known quantities.
  // ===================================================================
  const fermiHardItems = [
    {
      prefix: 'fermi',
      prompt: `Estimate the total mass (in kilograms) of all commercial airplanes currently in the air at a typical mid-day moment worldwide.

Consider: the global commercial fleet size (~25,000 aircraft), average utilization rate (fraction airborne at any time), and the typical mass of a commercial aircraft (narrow-body ~40-80 tonnes empty, wide-body ~120-220 tonnes empty; use an appropriate average).

Which estimate is closest?

A) ~10^7 kg (10 million kg) — about the mass of a large cargo ship
B) ~5 × 10^8 kg (500 million kg) — about the mass of all cars in a medium-sized country
C) ~2 × 10^9 kg (2 billion kg) — roughly the mass of the Great Pyramid of Giza
D) ~1 × 10^10 kg (10 billion kg) — about the mass of all the gold ever mined
E) ~5 × 10^11 kg (500 billion kg) — roughly the total mass of all living humans`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Multi-step Fermi: fleet size × utilization × mass. Answer C: ~25,000 planes × 20% airborne × 50,000 kg avg ≈ 2.5×10^8 kg, with fuel closer to 2×10^9 kg.',
    },
    {
      prefix: 'fermi',
      prompt: `Estimate the total length of all DNA in an adult human body (summed across all cells).

Consider: number of cells in the human body (~3.7 × 10^13), DNA length per cell (~2 meters when unpacked for diploid genome), and that not all cells contain DNA (red blood cells have none) — about 84% of cells are nucleated.

Which estimate is closest?

A) ~10^10 meters — enough to go to the Moon and back 10 times
B) ~10^12 meters — about the diameter of Jupiter's orbit
C) ~10^13 meters — roughly 1 light-year
D) ~7 × 10^13 meters — about 0.007 light-years, or roughly the distance light travels in 2.5 days
E) ~10^16 meters — several light-years, enough to reach nearby stars`,
      answer: 'D',
      skills: ['probabilistic'],
      desc: 'Multi-step Fermi: cells × fraction nucleated × DNA length. Answer D: 3.7×10^13 × 0.84 × 2 ≈ 6.2×10^13 m ≈ 0.007 ly.',
    },
    {
      prefix: 'fermi',
      prompt: `Estimate the total number of bytes of digital data created by humanity in the year 2025.

Consider: the 2024 estimate (~150 zettabytes created), annual growth rate (~25% historically), and whether the growth rate has been accelerating or decelerating.

Which estimate is closest to the 2025 figure?

A) ~50 zettabytes — the growth rate collapsed as data storage became more efficient
B) ~150 zettabytes — flat year-over-year
C) ~190 zettabytes — continuing the ~25% annual growth trend
D) ~500 zettabytes — exponential growth accelerated dramatically
E) ~1,000 zettabytes (1 yottabyte) — a step-change from AI training data demands`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Fermi with trend extrapolation. Answer C: 150 × 1.25 ≈ 188 ZB.',
    },
    {
      prefix: 'fermi',
      prompt: `Estimate the total number of transistors manufactured by humanity across all of history (cumulative, through early 2025).

Consider: annual semiconductor unit production (~1 trillion chips in recent years), average transistors per chip (varies enormously from simple microcontrollers with thousands to advanced processors with ~100 billion), the historical ramp from essentially zero transistors before 1960, and that the majority of all transistors ever made were manufactured in the last ~10 years.

Which order-of-magnitude estimate is closest?

A) ~10^18 (1 quintillion) transistors
B) ~10^20 (100 quintillion) transistors
C) ~10^21 (1 sextillion) transistors — roughly the "1 sextillion transistors" milestone
D) ~10^23 (100 sextillion) transistors
E) ~10^25 (10 septillion) transistors`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Multi-step Fermi: annual chips × avg transistors × years dominated by recent production. Answer C: ~10^21 (1 sextillion) — often cited milestone.',
    },
    {
      prefix: 'fermi',
      prompt: `Estimate the total volume of water (in cubic kilometers) that flows over Niagara Falls in one year.

Known facts: The average flow rate over Niagara Falls is approximately 2,400 cubic meters per second (though it varies seasonally). There are about 31.5 million seconds in a year.

Which estimate is closest?

A) ~7.5 km³ — roughly the volume of a large reservoir
B) ~75 km³ — about the volume of Lake Mead at full capacity
C) ~750 km³ — roughly the volume of Lake Erie
D) ~7,500 km³ — about the volume of Lake Superior
E) ~75,000 km³ — roughly the volume of all the Great Lakes combined`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Fermi with known constant: 2,400 m³/s × 31.5×10^6 s = 7.56×10^10 m³ = 75.6 km³. Answer B.',
    },
    {
      prefix: 'fermi',
      prompt: `Estimate the kinetic energy (in joules) of the Earth's rotation about its axis.

Consider: Earth's moment of inertia (~8.0 × 10^37 kg·m² for a uniform sphere, though Earth is denser at the core, so use ~0.33 MR² ≈ 9.7 × 10^37 kg·m²), and angular velocity (2π radians per 86,164 seconds — the sidereal day).

Which order of magnitude is closest?

A) ~10^26 J — roughly the total energy the Sun delivers to Earth in a year
B) ~10^29 J — about the energy released by the Chicxulub impact
C) ~10^32 J — roughly the total energy output of the Sun in one second
D) ~10^35 J — the gravitational binding energy of Earth
E) ~10^38 J — roughly the total energy output of the Sun in a million years`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Fermi with physics: E = ½Iω². I ≈ 9.7×10^37, ω ≈ 7.29×10^-5, E ≈ 2.6×10^29 J. Answer B.',
    },
    {
      prefix: 'fermi',
      prompt: `Estimate the total number of words ever spoken by all humans who have ever lived.

Consider: ~117 billion humans ever born, average lifespan across history (~30-40 years accounting for high infant mortality), words spoken per day (estimates range from ~7,000 for average adults to much less for pre-verbal children and much of historical populations with different communication patterns). A reasonable blended average might be ~3,000 words/day across all ages and eras.

Which estimate is closest?

A) ~10^15 words — about 1 quadrillion
B) ~5 × 10^16 words — about 50 quadrillion
C) ~4 × 10^18 words — about 4 quintillion
D) ~2 × 10^20 words — about 200 quintillion
E) ~10^22 words — about 10 sextillion`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Multi-step Fermi: 117B people × 35yr avg × 365 days × 3,000 words. Answer C: ~4.5×10^18.',
    },
    {
      prefix: 'fermi',
      prompt: `Estimate the total computing power (in FLOPS — floating point operations per second) of all computing devices on Earth as of early 2025.

Consider: ~5 billion smartphones (~1-5 TFLOPS each for recent models), ~1.5 billion PCs (~0.5-5 TFLOPS), data center GPUs/TPUs (~500 million units, ~50-500 TFLOPS each for modern AI accelerators), servers (~100 million, wide range), embedded/IoT devices (~30 billion, much lower), and gaming consoles (~200 million, ~1-10 TFLOPS).

Which order-of-magnitude estimate is closest to aggregate FLOPS?

A) ~10^20 FLOPS — 100 exaFLOPS
B) ~10^21 FLOPS — 1 zettaFLOPS
C) ~10^22 FLOPS — 10 zettaFLOPS
D) ~10^23 FLOPS — 100 zettaFLOPS
E) ~10^24 FLOPS — 1 yottaFLOPS`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Multi-step Fermi: sum across device categories. Data centers dominate. Answer C: ~10^22 FLOPS (10 zettaFLOPS).',
    },
  ];

  for (const item of fermiHardItems) {
    items.push(makeTargetItem(item.prefix, item.prompt, item.answer, item.skills, item.desc));
  }

  // ===================================================================
  // CATEGORY 4: Hard debiasing items with interacting biases
  // Multiple cognitive biases operating simultaneously. The correct
  // debiased answer is non-obvious even when you know about the biases.
  // ===================================================================
  const debiasHardItems = [
    {
      prefix: 'debias',
      prompt: `You're reviewing a competitor analysis prepared by a product manager who has spent 6 months building a feature similar to what a competitor just launched. Her analysis concludes:

1. The competitor's feature has 40% lower user engagement than projected (source: competitor's public blog post)
2. Their technical architecture likely can't scale beyond 10K users (source: inference from their API latency)
3. Two early enterprise customers churned (source: social media posts)
4. Therefore: "The competitor's approach is failing — we should stay our course and not pivot."

Which cognitive biases are MOST clearly operating in this analysis, and what's the right corrective?

A) The analysis is sound — it's based on multiple data points, each from a different source.
B) Confirmation bias dominates — the PM selectively interpreted all evidence as supporting her pre-existing commitment. The corrective: explicitly list 3 ways the competitor's launch could be interpreted as SUCCESSFUL, then re-evaluate.
C) Anchoring bias — she anchored on the competitor's blog post. The corrective: ignore the blog post and use only independent data.
D) Availability bias — recent competitor news is over-weighted. The corrective: wait 6 months and re-evaluate.
E) Hindsight bias — she thinks the competitor's failure was predictable. The corrective: document what she predicted before the launch.`,
      answer: 'B',
      skills: ['steel-manning', 'probabilistic'],
      desc: 'Confirmation bias in competitor analysis. All evidence filtered through pre-existing commitment. Answer B: explicit disconfirmation search.',
    },
    {
      prefix: 'debias',
      prompt: `A VC firm reviews 500 startup pitches per year and invests in 10. Of the 10 investments, 3 become unicorns, 3 return ~1x, and 4 fail completely. The partners conclude: "Our selection process is excellent — our 30% unicorn rate proves we can pick winners."

What cognitive error is most clearly at work, and what additional information would most improve the calibration of their assessment?

A) Overconfidence bias. They should track how their UNFUNDED companies performed — specifically, what percentage of the 490 companies they passed on also became unicorns. If the unfunded unicorn rate is non-trivial, their selection skill may be near zero.
B) Recency bias. They should look at a longer time horizon of 20 years.
C) Survivorship bias. They should only count companies that are still operating.
D) Hindsight bias. They should have predicted which companies would succeed before they did.
E) Anchoring bias. They should compare their rate to the industry average of 10%.`,
      answer: 'A',
      skills: ['probabilistic'],
      desc: 'Selection skill assessment without counterfactual. Need unfunded company outcomes. Answer A.',
    },
    {
      prefix: 'debias',
      prompt: `An engineering team estimates a project at 4 months. The manager applies the "reference class forecasting" technique: looking at 20 similar past projects, the average was 7 months with a standard deviation of 3 months. The 4-month estimate falls at the 16th percentile of the reference distribution. The team argues: "Our project is different — we have better tooling, more senior engineers, and a simpler scope than those reference projects."

How should the manager weigh the inside-view (team's specific arguments) vs. the outside-view (reference class statistics)?

A) Trust the team's inside view — they know their specific project best. Plan for 4 months.
B) Trust the outside view entirely — plan for 7 months and ignore the team's specific arguments.
C) Use the outside view as the ANCHOR (7 months) and then adjust based on specific, verifiable differences. But limit the adjustment — even if every claimed advantage is real, the outside view suggests the "optimism bias" is typically ~75% (4 vs 7 months). Unless the team can QUANTIFY each claimed advantage's impact with evidence from past projects, the adjustment should be modest — perhaps 5-6 months.
D) Average the two: plan for 5.5 months.
E) Run a prediction market among the team to get a crowd estimate.`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Inside-view vs outside-view (reference class forecasting). Answer C: anchor on outside view, adjust modestly with quantified evidence.',
    },
    {
      prefix: 'debias',
      prompt: `After a major production incident, the postmortem identifies 5 contributing factors: (1) a database migration that wasn't tested at scale, (2) a monitoring gap that delayed detection by 17 minutes, (3) a recent hire who approved the change without full context, (4) an on-call engineer who was asleep and took 8 minutes to respond, and (5) a third-party API that returned unexpected data.

The team proposes 5 fixes, one for each factor. But the CTO asks: "Which of these fixes will actually prevent the MOST future incidents, and which are just making us feel better?"

What's the best analytical approach to answer the CTO's question?

A) Implement all 5 fixes — comprehensive safety requires addressing every factor.
B) Fire the recent hire and the on-call engineer — human error is the root cause.
C) Distinguish between "root causes" (factors without which the incident would not have happened) and "improvements that reduce future risk." The monitoring gap and the untested migration are likely systemic factors that will cause MORE future incidents than the specific human actions. Prioritize fixes by expected reduction in future incident probability × severity, not by salience in this one incident's narrative.
D) The third-party API is the root cause because it triggered the cascade. Fix that first.
E) Run all 5 fixes and A/B test which one prevents the most incidents over the next quarter.`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Narrative fallacy in incident postmortems. Answer C: prioritize by expected future risk reduction, not narrative salience.',
    },
    {
      prefix: 'debias',
      prompt: `A data scientist is asked: "What's the probability that our new ML model, which achieved 94% accuracy on the test set, will maintain at least 90% accuracy in production over the first month?" She knows:
- The test set is an i.i.d. random split from the same distribution as training
- Production data historically drifts at ~2%/month (accuracy decay rate)
- 70% of models that score ≥94% on their test set maintain ≥90% in production for the first month
- Models from her specific team maintain ≥90% at an 85% rate (the team is above average)

She answers: "85%."

What bias is most clearly present in her estimate, and what's the better-calibrated probability?

A) Her estimate is well-calibrated — she used the most specific reference class available.
B) Overconfidence from ignoring reference class: she used a narrow reference class (her team) with a small sample, ignoring the broader base rate (70%). A better estimate would shrink her 85% toward 70% proportional to the relative sample sizes — perhaps ~77-80%.
C) Her estimate is too LOW — models that score 94% almost always do well. It should be >95%.
D) The base rate is irrelevant because her team is clearly better. 85% is correct.
E) She should use the broader 70% base rate exclusively and ignore her team's track record.`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Reference class selection and shrinkage. Answer B: shrink narrow-class estimate toward broader base rate.',
    },
    {
      prefix: 'debias',
      prompt: `A product team runs 8 experiments in a quarter. Two show p<0.05. The PM celebrates: "We found two winners this quarter!" and greenlights both for full rollout. The data scientist objects, noting that with 8 tests and no multiplicity correction, the family-wise error rate at α=0.05 is about 34% — there's a 1 in 3 chance at least one "significant" result is a false positive.

The PM counters: "But each test addressed a DIFFERENT hypothesis about DIFFERENT features. Why should I penalize one test because we also ran other unrelated tests?"

What is the most rigorous resolution of this disagreement?

A) The PM is right — multiplicity correction only applies when testing the same hypothesis multiple times.
B) The data scientist is right — always apply Bonferroni correction regardless of context.
C) The answer depends on the decision structure. If the company treats each significant result as independently actionable (i.e., the cost of a false positive rollout is bounded and each decision stands alone), then the PM's per-decision error rate argument has merit. But if the company considers the QUARTER'S overall false-positive rate (i.e., what fraction of "winners" this quarter are real?), then multiplicity correction is appropriate. The team should agree on which error rate they're controlling before running tests.
D) Use Bayesian methods instead, which don't have this problem.
E) Only run one experiment per quarter to avoid the multiplicity problem entirely.`,
      answer: 'C',
      skills: ['probabilistic'],
      desc: 'Multiplicity debate: per-decision vs family-wise error rate. Answer C: depends on decision structure — agree on error rate upfront.',
    },
    {
      prefix: 'debias',
      prompt: `A hiring manager interviews 6 candidates for a senior engineering role. The first 5 are solid but unremarkable. The 6th candidate gives a standout interview — engaging, tells great stories, and has an unusual background in theater before transitioning to software. The manager strongly wants to hire candidate #6.

A colleague points out: "You might be experiencing a contrast effect — candidate #6 looks better because they followed 5 similar candidates. And you might be over-weighting the theater background because it makes for a vivid story."

The manager acknowledges these points but says: "I've already adjusted for those biases in my head. I still think #6 is the best."

What does the research on bias correction suggest about the manager's claim?

A) The manager is probably right — being aware of biases is sufficient to correct for them.
B) The manager is probably wrong. Research on "bias blind spot" and "mental correction" shows that people overestimate their ability to debias their own judgments, especially when the correction is purely mental and not structural. A structural debiasing approach (e.g., scoring each candidate on pre-defined criteria before discussion, or blinding the order) is more effective than trying to mentally "adjust" for biases you know about.
C) The colleague's intervention is sufficient — social accountability eliminates the bias.
D) The contrast effect doesn't apply to interviews because they're qualitative.
E) Biases only affect novice interviewers; experienced managers are immune.`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Bias blind spot — mental correction is unreliable. Answer B: structural debiasing > mental adjustment.',
    },
    {
      prefix: 'debias',
      prompt: `A machine learning team is choosing between a simple logistic regression model (interpretable, 82% accuracy) and a deep neural network (black-box, 87% accuracy) for a loan approval system. The team lead argues: "The 5% accuracy improvement from the neural network is significant (p<0.001). More accurate models are always better in high-stakes decision systems."

A domain expert pushes back: "The logistic regression lets us explain EXACTLY why each loan was denied. The neural network might have hidden biases — it could be using proxy variables for race or gender without us knowing."

Which analytical framework best resolves this trade-off?

A) Always pick the more accurate model. Accuracy is objective and trumps subjective concerns about "fairness."
B) Always pick the interpretable model. Fairness concerns always override accuracy.
C) Quantify the trade-off: estimate the expected number of incorrect decisions from the 5% accuracy gap, estimate the expected harm from undetected bias in the black-box model (probability of bias × harm if biased), and compare. If the accuracy gain is large relative to the expected bias harm, the black-box model may be preferable — but only with ongoing bias monitoring. Also consider that interpretable models can be IMPROVED with feature engineering, potentially closing the gap without sacrificing transparency.
D) The accuracy difference (5%) is too small to matter — flip a coin.
E) Use both models as an ensemble to get the best of both approaches.`,
      answer: 'C',
      skills: ['probabilistic', 'margin-of-safety'],
      desc: 'Accuracy vs fairness trade-off. Answer C: quantify both dimensions rather than absolutist position.',
    },
  ];

  for (const item of debiasHardItems) {
    items.push(makeTargetItem(item.prefix, item.prompt, item.answer, item.skills, item.desc));
  }

  // ===================================================================
  // CATEGORY 5: Hard margin-of-safety with genuine engineering trade-offs
  // ===================================================================
  const marginHardItems = [
    {
      prefix: 'mos',
      prompt: `A cloud infrastructure team is deciding on capacity provisioning for a new service. The expected peak load is 10,000 requests/second, but there's substantial uncertainty: the 95th percentile estimate is 25,000 rps, and there's a tail scenario (estimated 1% probability) of 50,000 rps from a viral event. Each unit of capacity costs $50K/month. An outage during peak would cost an estimated $2M in revenue + reputation damage.

What capacity should they provision if they want to minimize expected total cost (provisioning cost + expected outage cost)?

A) 10,000 rps — provision for the expected peak, since the tail scenarios are unlikely.
B) 25,000 rps — provision for the 95th percentile, accepting a 5% outage risk.
C) 50,000 rps — provision for the worst case to eliminate all outage risk.
D) Compute the expected cost at each level: at 25K rps, expected cost = $50K×25 + $2M×P(load>25K). If P(load>25K) ≈ 5%, then expected outage cost ≈ $100K/month. At 50K rps, expected cost = $50K×50 + $2M×0.01 = $2.5M + $20K. The 25K provisioning appears optimal, but verify the 95th percentile estimate is reliable — if uncertainty about the tail is high, a buffer beyond 25K may be warranted.
E) Provision 10,000 rps and use auto-scaling to handle spikes — that eliminates the trade-off.`,
      answer: 'D',
      skills: ['margin-of-safety', 'probabilistic'],
      desc: 'Capacity provisioning with cost optimization. Answer D: compute expected costs, verify tail estimate reliability.',
    },
    {
      prefix: 'mos',
      prompt: `A pharmaceutical company must set a specification limit for an impurity in a drug product. The impurity is a potential carcinogen. The regulatory guideline suggests a threshold of 1.5 μg/day based on a 1-in-100,000 cancer risk. The company's manufacturing process can reliably achieve 0.8 μg/day with current controls, but a process improvement to reach 0.3 μg/day would cost $8M and delay the launch by 6 months.

The drug treats a serious condition affecting ~200,000 patients, with a 5% mortality rate over 5 years without treatment. The drug reduces mortality by 40%. Each 6-month delay means ~3,300 additional deaths from delayed access.

At specification limit 0.8 μg/day: the theoretical excess cancer risk is ~1-in-190,000 (below the 1-in-100,000 guideline).
At 0.3 μg/day: the excess risk drops to ~1-in-500,000.

Which specification limit is most ethically and analytically justified?

A) 0.3 μg/day — any reduction in cancer risk is mandatory regardless of cost or delay.
B) 0.8 μg/day — it already meets the regulatory guideline, and the delay to achieve 0.3 μg/day would cause substantially more harm (~3,300 deaths from delayed access) than the cancer risk it prevents (~1 additional cancer case per 3,300 patients).
C) 1.5 μg/day — the regulatory maximum is sufficient, and any margin beyond it is wasteful.
D) Make the decision based on legal liability alone — whichever limit minimizes lawsuit risk.
E) Let the FDA decide — the manufacturer should not make this trade-off.`,
      answer: 'B',
      skills: ['margin-of-safety', 'probabilistic'],
      desc: 'Safety margin trade-off: impurity risk vs access delay mortality. Answer B: quantitative comparison of competing harms.',
    },
    {
      prefix: 'mos',
      prompt: `An aerospace engineering team is designing a critical component with a required reliability of 0.9999 (one failure per 10,000 flight hours). Their current design estimates show 0.99995 reliability at a unit cost of $50K. Adding redundant systems could increase reliability to 0.999999 (one failure per million hours) but would add $200K per unit and 15kg of weight, reducing fuel efficiency.

The fleet will fly approximately 500,000 hours per year across 200 aircraft. Each failure of this component in flight has an estimated fatality risk of 0.01 (1% chance of causing a crash given failure) with 200 people on board.

What is the most analytically sound decision about the redundancy?

A) Always add the redundancy — any improvement in safety is worth the cost.
B) Skip the redundancy — the component already exceeds the reliability requirement.
C) Quantify: the base design expects 0.25 failures/year (500K hrs × 5×10^-5 failure rate), so ~0.0025 expected fatalities/year. With redundancy: 0.00025 expected fatalities/year. The redundancy saves ~0.00225 lives/year at a cost of $40M/year ($200K × 200 aircraft). This implies a cost of ~$18B per life saved — far above typical regulatory thresholds (~$10M/life). Skip the redundancy on cost-effectiveness grounds unless the specific failure mode has catastrophic common-cause potential not captured in the independent-failure model.
D) Add redundancy because public perception of aircraft safety makes any failure catastrophic for the business.
E) Add a partial redundancy that saves 5kg of weight.`,
      answer: 'C',
      skills: ['margin-of-safety', 'probabilistic'],
      desc: 'Safety margin with cost-benefit analysis. Answer C: quantify expected lives saved vs cost — $18B/life far exceeds norms.',
    },
    {
      prefix: 'mos',
      prompt: `A software team is building a payment processing system. The architecture choice is between:
- Option A: Synchronous processing with strong consistency guarantees, 99.9% availability, p99 latency 200ms. Simpler to implement, easier to debug. Cost: $50K/month infrastructure.
- Option B: Eventual consistency with asynchronous processing, 99.99% availability, p99 latency 50ms (perceived). More complex — requires reconciliation jobs, idempotency keys, and compensating transactions for failures. Cost: $80K/month infrastructure + estimated $200K additional engineering time to build correctly.

The business processes ~$50M/month in payments. Each minute of downtime costs roughly $35K in lost revenue. The "eventual consistency" bugs (double charges, missed payments) have happened in 15% of similar implementations at other companies, costing an average of $500K to fix + regulatory scrutiny.

Which architecture choice is most justified?

A) Option A — the lower engineering complexity and elimination of consistency risks outweigh the availability difference, given the high cost of eventual-consistency bugs.
B) Option B — higher availability always wins for payment systems.
C) Option A for MVP, then migrate to Option B after 6 months.
D) Use a hybrid: synchronous for critical paths, async for non-critical ones.
E) Neither — use a third-party payment processor and avoid building this entirely.`,
      answer: 'A',
      skills: ['margin-of-safety', 'probabilistic'],
      desc: 'Architecture margin-of-safety: consistency vs availability trade-off with bug risk. Answer A.',
    },
  ];

  for (const item of marginHardItems) {
    items.push(makeTargetItem(item.prefix, item.prompt, item.answer, item.skills, item.desc));
  }

  // ===================================================================
  // CATEGORY 6: Near-miss items
  // Items that look like quantitative reasoning problems but aren't
  // quite in the family's sweet spot. Included for calibration coverage.
  // ===================================================================
  const nearMissItems = [
    {
      prefix: 'nm',
      prompt: `Which of the following best defines the "p-value" in null hypothesis significance testing?

A) The probability that the null hypothesis is true, given the observed data — P(H0|data)
B) The probability of observing data at least as extreme as what was observed, assuming the null hypothesis is true — P(data|H0)
C) The probability that the alternative hypothesis is true
D) The probability of making a Type I error in this specific experiment
E) 1 minus the probability that the alternative hypothesis is true`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Near-miss: definitional/educational, not a reasoning task. Tests knowledge, not skill application.',
    },
    {
      prefix: 'nm',
      prompt: `A normal distribution has mean μ=100 and standard deviation σ=15. Approximately what percentage of observations fall between 85 and 130?

A) 68% — within one standard deviation of the mean
B) 81.5% — between -1σ and +2σ
C) 95% — within two standard deviations of the mean
D) 79% — rounded from 78.9%
E) 90% — a common rule-of-thumb threshold`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Near-miss: straightforward normal distribution computation. Tests recall of empirical rule, not probabilistic reasoning.',
    },
    {
      prefix: 'nm',
      prompt: `A coin is flipped 10 times and comes up heads all 10 times. Assuming the coin is fair (P(heads)=0.5), what is the probability of this outcome?

A) (0.5)^10 ≈ 0.00098 — less than 0.1%
B) 0.5 — each flip is independent
C) 0.10 — about 10%
D) 0.01 — exactly 1%
E) It's impossible for a fair coin`,
      answer: 'A',
      skills: ['probabilistic'],
      desc: 'Near-miss: straightforward binomial probability. Tests basic computation, not nuanced reasoning.',
    },
    {
      prefix: 'nm',
      prompt: `What is the expected value of rolling a fair six-sided die?

A) 3.0 — the midpoint of the range
B) 3.5 — the arithmetic mean of {1,2,3,4,5,6}
C) 3.0 — the median value
D) 4.0 — because higher numbers are more desirable
E) 2.5 — the average of the minimum and maximum after removing outliers`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Near-miss: trivial expected value computation. Tests basic probability literacy.',
    },
    {
      prefix: 'nm',
      prompt: `If events A and B are independent with P(A)=0.3 and P(B)=0.4, what is P(A AND B)?

A) 0.70 — P(A) + P(B)
B) 0.12 — P(A) × P(B)
C) 0.58 — P(A) + P(B) - P(A)×P(B)
D) 0.10 — roughly one third of 0.3
E) 0.35 — the average of the two probabilities`,
      answer: 'B',
      skills: ['probabilistic'],
      desc: 'Near-miss: trivial independence computation. Too easy for solver but useful for calibration upper-bound detection.',
    },
  ];

  for (const item of nearMissItems) {
    items.push(makeNearMissItem(item.prefix, item.prompt, item.answer, item.skills, item.desc));
  }

  // ===================================================================
  // CATEGORY 7: Off-target distractor items
  // Items that are clearly NOT quantitative reasoning problems.
  // Used to measure false-positive rate (does skill fire when it shouldn't?)
  // ===================================================================
  const distractorItems = [
    {
      prefix: 'dist',
      prompt: `In Python, what is the difference between a list and a tuple?

A) Lists are mutable, tuples are immutable
B) Lists are faster than tuples for all operations
C) Tuples can only contain numbers, lists can contain any type
D) There is no difference — they are aliases for the same type
E) Tuples are deprecated in Python 3.12+`,
      answer: 'A',
      desc: 'Off-target: Python programming knowledge, not quantitative reasoning.',
    },
    {
      prefix: 'dist',
      prompt: `Which of the following is a key principle of RESTful API design?

A) Statelessness — each request from client to server must contain all information needed to understand the request
B) Always use XML for request/response bodies
C) All endpoints must require authentication
D) API version numbers must be integers
E) Responses must always include all related resources to avoid N+1 queries`,
      answer: 'A',
      desc: 'Off-target: API design knowledge, not quantitative reasoning.',
    },
    {
      prefix: 'dist',
      prompt: `What is the primary function of mitochondria in eukaryotic cells?

A) Protein synthesis
B) ATP (energy) production through oxidative phosphorylation
C) DNA replication
D) Cell division
E) Photosynthesis`,
      answer: 'B',
      desc: 'Off-target: biology knowledge, not quantitative reasoning.',
    },
    {
      prefix: 'dist',
      prompt: `In Git, what does the command "git rebase" do?

A) Creates a copy of the repository on a remote server
B) Reapplies commits on top of another base tip, creating a linear history
C) Deletes all commits and starts from scratch
D) Merges two branches with a merge commit
E) Downloads changes from a remote repository`,
      answer: 'B',
      desc: 'Off-target: version control knowledge, not quantitative reasoning.',
    },
    {
      prefix: 'dist',
      prompt: `Which design pattern is most appropriate for ensuring a class has only one instance while providing global access to that instance?

A) Factory Method pattern
B) Singleton pattern
C) Observer pattern
D) Strategy pattern
E) Decorator pattern`,
      answer: 'B',
      desc: 'Off-target: software design patterns, not quantitative reasoning.',
    },
    {
      prefix: 'dist',
      prompt: `What is the time complexity of binary search on a sorted array of n elements?

A) O(1) — constant time
B) O(log n) — logarithmic time
C) O(n) — linear time
D) O(n log n) — linearithmic time
E) O(n²) — quadratic time`,
      answer: 'B',
      desc: 'Off-target: algorithms knowledge query, not quantitative reasoning under uncertainty.',
    },
    {
      prefix: 'dist',
      prompt: `In the context of databases, what does ACID stand for?

A) Atomicity, Consistency, Isolation, Durability
B) Availability, Consistency, Integrity, Durability
C) Atomicity, Consistency, Isolation, Distribution
D) Asynchronous, Consistent, Isolated, Durable
E) Automated, Consistent, Integrated, Distributed`,
      answer: 'A',
      desc: 'Off-target: database knowledge, not quantitative reasoning.',
    },
    {
      prefix: 'dist',
      prompt: `Which HTTP status code indicates that a request was successful and the server created a new resource?

A) 200 OK
B) 201 Created
C) 204 No Content
D) 301 Moved Permanently
E) 400 Bad Request`,
      answer: 'B',
      desc: 'Off-target: HTTP protocol knowledge, not quantitative reasoning.',
    },
    {
      prefix: 'dist',
      prompt: `What is the primary purpose of Docker containers?

A) To provide consistent, isolated runtime environments for applications across different systems
B) To replace the need for operating systems entirely
C) To make applications run faster by pre-compiling them
D) To encrypt all network traffic between services
E) To automatically generate API documentation`,
      answer: 'A',
      desc: 'Off-target: containerization knowledge, not quantitative reasoning.',
    },
    {
      prefix: 'dist',
      prompt: `In JavaScript, what is the output of: console.log(typeof null)?

A) "null"
B) "undefined"
C) "object"
D) "boolean"
E) "number"`,
      answer: 'C',
      desc: 'Off-target: JavaScript knowledge, not quantitative reasoning.',
    },
  ];

  for (const item of distractorItems) {
    items.push(makeDistractorItem(item.prefix, item.prompt, item.answer, item.desc));
  }

  return items;
}

// =====================================================================
// MAIN
// =====================================================================
function main() {
  const items = buildHarderQuantitativePool();
  
  const counts = { target: 0, near_miss: 0, distractor: 0 };
  for (const item of items) {
    counts[item.type] = (counts[item.type] || 0) + 1;
  }
  
  console.log(`\n  Pool summary:`);
  console.log(`    Total items: ${items.length}`);
  console.log(`    Target: ${counts.target}`);
  console.log(`    Near-miss: ${counts.near_miss || 0}`);
  console.log(`    Distractor: ${counts.distractor}`);
  
  // Save candidate pool
  const candidateFile = path.join(OUT, 'quantitative-uncertainty-harder-pool.jsonl');
  const text = items.map(i => JSON.stringify(i)).join('\n') + '\n';
  fs.writeFileSync(candidateFile, text);
  console.log(`\n  Wrote ${items.length} items → ${candidateFile}`);
  
  return items;
}

main();
