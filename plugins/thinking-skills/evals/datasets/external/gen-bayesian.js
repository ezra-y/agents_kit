#!/usr/bin/env node
'use strict';
/**
 * Generator for the bayesian base-rate-reasoning correctness eval.
 * Each item supplies prevalence/base-rate + true-positive-rate (sensitivity) +
 * false-positive-rate (1 - specificity), OR a prior + likelihoods. We compute the
 * TRUE posterior P(H|E) = TPR*p / (TPR*p + FPR*(1-p)) exactly, then build 4 lettered
 * options that include: (1) the correct posterior, (2) the base-rate-neglect distractor
 * = the sensitivity/TPR (classic wrong answer), (3-4) plausible-but-wrong values.
 * The correct option bucket is chosen so exactly one option clearly contains the posterior.
 */
const fs = require('fs');
const path = require('path');

// Deterministic letter rotation so the correct answer varies across A-E.
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function pct(x, dp = 0) {
  const v = x * 100;
  if (dp === 0) return `${Math.round(v)}%`;
  return `${v.toFixed(dp)}%`;
}
function fmtPosterior(post) {
  // human-friendly percent string for options
  const v = post * 100;
  if (v < 1) return `${v.toFixed(2)}%`;
  if (v < 10) return `${v.toFixed(1)}%`;
  return `${v.toFixed(1).replace(/\.0$/, '')}%`;
}

/**
 * Build an item.
 * spec: {
 *   id, base (prior p), tpr (sensitivity P(E|H)), fpr (P(E|notH)),
 *   prompt(scenarioText, optionsBlock), distractors: [strings],  // wrong option labels
 *   correctLetterIdx: which letter (0-4) gets the correct option
 * }
 */
function build(spec) {
  const { base, tpr, fpr } = spec;
  const num = tpr * base;
  const den = num + fpr * (1 - base);
  const posterior = num / den; // P(H|E)
  const postStr = fmtPosterior(posterior);

  // Correct option text is a tight range that brackets the posterior.
  const correctOpt = spec.correctOptText(posterior, postStr);
  // Wrong options: must include base-rate-neglect distractor = TPR (sensitivity).
  const wrongs = spec.wrongOpts(posterior, tpr, fpr, base);

  // Each spec supplies exactly 4 wrong options (so total options = 5, letters A-E).
  if (wrongs.length !== 4) throw new Error(`item ${spec.id}: expected 4 wrong options, got ${wrongs.length}`);
  const wrongs4 = wrongs;

  // Collision guard: no wrong option may share a numeric value with the posterior bucket.
  const postPct = +(posterior * 100).toFixed(2);
  for (const w of wrongs4) {
    for (const m of (w.match(/([\d.]+)%/g) || [])) {
      if (Math.abs(parseFloat(m) - postPct) < 0.8) throw new Error(`item ${spec.id}: wrong option '${w}' (${m}) collides with posterior ${postPct}%`);
    }
  }

  // Assemble 5 options, placing correct at the chosen index.
  const opts = wrongs4.slice();
  const ci = spec.correctLetterIdx;
  opts.splice(ci, 0, correctOpt);
  if (opts.length !== 5) throw new Error(`item ${spec.id}: expected 5 options, got ${opts.length}`);

  const lettered = opts.map((o, i) => `${LETTERS[i]}) ${o}`).join('\n');
  const answer_idx = LETTERS[ci];

  const prompt = spec.scenario.trim() + `\n\n` + lettered;

  return {
    id: spec.id,
    mode: 'correctness',
    prompt,
    answer_idx,
    skill_fit: ['probabilistic'],
    posterior: +posterior.toFixed(4),
  };
}

// Helper builders for option text -------------------------------------------
const tightRange = (lo, hi) => (post, postStr) => `about ${postStr} (between ${lo} and ${hi})`;
const exactish = (post, postStr) => `about ${postStr}`;

// ---------------------------------------------------------------------------
// Item specifications. base = base rate, tpr = sensitivity, fpr = false-positive rate.
// correctLetterIdx rotates 0..4 to vary the correct letter.
// ---------------------------------------------------------------------------
const specs = [];
let counter = 0;
function addItem(s) {
  counter++;
  s.id = `bayes-${counter}`;
  specs.push(s);
}

// We compute posterior inside build(); here we craft scenario + option sets.
// For each, we always include the TPR (sensitivity) as the base-rate-neglect distractor.

// 1. Rare disease, classic mammogram-style. base 0.01
addItem({
  base: 0.01, tpr: 0.90, fpr: 0.09,
  correctLetterIdx: 0,
  scenario: `A disease affects 1% of a screened population. A diagnostic test correctly flags 90% of people who truly have the disease, and wrongly flags 9% of healthy people. A randomly screened person tests positive. What is the probability they actually have the disease?`,
  correctOptText: (p, s) => `about ${s} (roughly 1 in 11)`,
  wrongOpts: (p, tpr) => [`90% (the test's true-positive rate)`, `about 50%`, `about 81%`, `about 1% (the underlying base rate)`],
});

// 2. HIV-style very rare. base 0.001 (1 in 1000)
addItem({
  base: 0.001, tpr: 0.99, fpr: 0.01,
  correctLetterIdx: 2,
  scenario: `Roughly 1 in 1,000 people in a low-risk group carries a particular infection. A screening test detects 99% of true carriers and produces a positive result in 1% of non-carriers. Someone from this group tests positive. How likely is it that they are truly a carrier?`,
  correctOptText: (p, s) => `about ${s} (under 1 in 10)`,
  wrongOpts: () => [`99% (the test's detection rate)`, `about 50%`, `about 91%`, `about 0.1% (the underlying base rate)`],
});

// 3. Common condition. base 0.30
addItem({
  base: 0.30, tpr: 0.85, fpr: 0.20,
  correctLetterIdx: 4,
  scenario: `In a clinic where 30% of presenting patients have a given condition, a test correctly identifies 85% of patients who have it and falsely flags 20% of those who do not. A patient tests positive. What is the probability the patient has the condition?`,
  correctOptText: (p, s) => `about ${s} (between 60% and 65%)`,
  wrongOpts: () => [`85% (the sensitivity)`, `about 30% (the base rate)`, `about 50%`, `about 78%`],
});

// 4. Fraud flag, rare. base 0.002
addItem({
  base: 0.002, tpr: 0.95, fpr: 0.03,
  correctLetterIdx: 1,
  scenario: `A bank's fraud model reviews transactions of which 0.2% are actually fraudulent. The model catches 95% of genuine fraud and flags 3% of legitimate transactions as suspicious. A transaction is flagged. What is the probability it is actually fraudulent?`,
  correctOptText: (p, s) => `about ${s} (around 6%)`,
  wrongOpts: () => [`95% (the model's catch rate)`, `about 50%`, `about 30%`, `about 0.2% (the underlying base rate)`],
});

// 5. Spam filter. base 0.40
addItem({
  base: 0.40, tpr: 0.98, fpr: 0.05,
  correctLetterIdx: 3,
  scenario: `Across an inbox, 40% of incoming messages are spam. A filter labels 98% of true spam as spam and mislabels 5% of legitimate mail as spam. A message gets labeled spam. What is the probability it really is spam?`,
  correctOptText: (p, s) => `about ${s} (between 92% and 94%)`,
  wrongOpts: () => [`98% (the filter's true-positive rate)`, `about 40% (the base rate)`, `about 80%`, `about 67%`],
});

// 6. Security alert, rare intrusion. base 0.0005
addItem({
  base: 0.0005, tpr: 0.99, fpr: 0.02,
  correctLetterIdx: 0,
  scenario: `An intrusion-detection system monitors sessions of which only 0.05% are genuine attacks. It detects 99% of real attacks and raises an alert on 2% of benign sessions. An alert fires. What is the probability this session is a genuine attack?`,
  correctOptText: (p, s) => `about ${s} (well under 3%)`,
  wrongOpts: () => [`99% (the detection rate)`, `about 50%`, `about 25%`, `about 0.05% (the underlying base rate)`],
});

// 7. Quality defect screen. base 0.05
addItem({
  base: 0.05, tpr: 0.92, fpr: 0.04,
  correctLetterIdx: 2,
  scenario: `On a production line, 5% of units are defective. An automated inspector correctly rejects 92% of defective units and wrongly rejects 4% of good units. A unit is rejected. What is the probability it is truly defective?`,
  correctOptText: (p, s) => `about ${s} (between 53% and 56%)`,
  wrongOpts: () => [`92% (the inspector's true-positive rate)`, `about 5% (the base rate)`, `about 75%`, `about 88%`],
});

// 8. A/B-test "real effect" signal. base 0.10 (prior a variant beats control)
addItem({
  base: 0.10, tpr: 0.80, fpr: 0.05,
  correctLetterIdx: 4,
  scenario: `Historically, 10% of tested variants genuinely beat the control. An analytics pipeline produces a "significant win" signal for 80% of variants that truly win, but also for 5% of variants that do not. A variant gets a "win" signal. What is the probability it is a genuine winner?`,
  correctOptText: (p, s) => `about ${s} (around 64%)`,
  wrongOpts: () => [`80% (the true-detection rate)`, `about 10% (the base rate)`, `about 40%`, `about 75%`],
});

// 9. Drug test, rare use. base 0.04
addItem({
  base: 0.04, tpr: 0.97, fpr: 0.05,
  correctLetterIdx: 1,
  scenario: `In a workforce, 4% of employees use a banned substance. A drug screen returns positive for 97% of users and for 5% of non-users. An employee tests positive. What is the probability they actually used the substance?`,
  correctOptText: (p, s) => `about ${s} (around 45%)`,
  wrongOpts: () => [`97% (the test's sensitivity)`, `about 4% (the base rate)`, `about 65%`, `about 90%`],
});

// 10. Loan default anomaly. base 0.08
addItem({
  base: 0.08, tpr: 0.88, fpr: 0.10,
  correctLetterIdx: 3,
  scenario: `Among loan applicants, 8% will default. A risk model flags 88% of future defaulters and 10% of applicants who will repay. An applicant is flagged high-risk. What is the probability they will actually default?`,
  correctOptText: (p, s) => `about ${s} (between 42% and 45%)`,
  wrongOpts: () => [`88% (the model's true-positive rate)`, `about 8% (the base rate)`, `about 70%`, `about 90%`],
});

// 11. Cancer screen, moderate-rare. base 0.02
addItem({
  base: 0.02, tpr: 0.93, fpr: 0.07,
  correctLetterIdx: 0,
  scenario: `A cancer affects 2% of a screened cohort. The screen detects 93% of true cases and yields a positive result for 7% of cancer-free people. A patient screens positive. What is the probability they have the cancer?`,
  correctOptText: (p, s) => `about ${s} (around 21%)`,
  wrongOpts: () => [`93% (the screen's detection rate)`, `about 50%`, `about 70%`, `about 2% (the base rate)`],
});

// 12. Phishing URL classifier. base 0.15
addItem({
  base: 0.15, tpr: 0.96, fpr: 0.08,
  correctLetterIdx: 2,
  scenario: `Of links employees click, 15% lead to phishing pages. A classifier flags 96% of true phishing links and 8% of safe links. A link is flagged. What is the probability it is genuinely phishing?`,
  correctOptText: (p, s) => `about ${s} (between 67% and 70%)`,
  wrongOpts: () => [`96% (the classifier's true-positive rate)`, `about 15% (the base rate)`, `about 85%`, `about 88%`],
});

// 13. Rare genetic variant. base 0.005
addItem({
  base: 0.005, tpr: 0.98, fpr: 0.03,
  correctLetterIdx: 4,
  scenario: `A genetic variant occurs in 0.5% of people. A lab assay correctly identifies 98% of carriers and gives a false positive in 3% of non-carriers. A sample tests positive. What is the probability the person carries the variant?`,
  correctOptText: (p, s) => `about ${s} (around 14%)`,
  wrongOpts: () => [`98% (the assay's sensitivity)`, `about 50%`, `about 33%`, `about 0.5% (the base rate)`],
});

// 14. Manufacturing contamination. base 0.01
addItem({
  base: 0.01, tpr: 0.99, fpr: 0.02,
  correctLetterIdx: 1,
  scenario: `One percent of batches are contaminated. A purity test flags 99% of contaminated batches and 2% of clean batches. A batch is flagged. What is the probability it is actually contaminated?`,
  correctOptText: (p, s) => `about ${s} (around 1 in 3)`,
  wrongOpts: () => [`99% (the test's true-positive rate)`, `about 50%`, `about 66%`, `about 1% (the base rate)`],
});

// 15. Bot-account detection. base 0.20
addItem({
  base: 0.20, tpr: 0.90, fpr: 0.10,
  correctLetterIdx: 3,
  scenario: `On a platform, 20% of new signups are bots. A detector flags 90% of bots and 10% of real users. A signup is flagged as a bot. What is the probability it really is a bot?`,
  correctOptText: (p, s) => `about ${s} (between 68% and 70%)`,
  wrongOpts: () => [`90% (the detector's true-positive rate)`, `about 20% (the base rate)`, `about 50%`, `about 82%`],
});

// 16. Very rare terrorist-watchlist style. base 0.0001
addItem({
  base: 0.0001, tpr: 0.99, fpr: 0.01,
  correctLetterIdx: 0,
  scenario: `In a population, 1 in 10,000 individuals is on a target list. A facial-recognition match correctly identifies 99% of true targets and falsely matches 1% of everyone else. The system reports a match. What is the probability the matched person is truly a target?`,
  correctOptText: (p, s) => `about ${s} (about 1%)`,
  wrongOpts: () => [`99% (the match accuracy)`, `about 50%`, `about 10%`, `about 0.01% (the base rate)`],
});

// 17. Equipment failure prediction. base 0.03
addItem({
  base: 0.03, tpr: 0.85, fpr: 0.06,
  correctLetterIdx: 2,
  scenario: `Three percent of machines will fail within a week. A predictive-maintenance model flags 85% of machines that will fail and 6% of machines that will not. A machine is flagged. What is the probability it will actually fail within the week?`,
  correctOptText: (p, s) => `about ${s} (around 30%)`,
  wrongOpts: () => [`85% (the model's true-positive rate)`, `about 3% (the base rate)`, `about 60%`, `about 80%`],
});

// 18. Doping in athletes. base 0.06
addItem({
  base: 0.06, tpr: 0.94, fpr: 0.02,
  correctLetterIdx: 4,
  scenario: `Six percent of competing athletes are doping. An anti-doping test returns positive for 94% of dopers and 2% of clean athletes. An athlete tests positive. What is the probability the athlete is actually doping?`,
  correctOptText: (p, s) => `about ${s} (around 75%)`,
  wrongOpts: () => [`94% (the test's sensitivity)`, `about 6% (the base rate)`, `about 50%`, `about 90%`],
});

// 19. Counterfeit detection. base 0.005
addItem({
  base: 0.005, tpr: 0.92, fpr: 0.01,
  correctLetterIdx: 1,
  scenario: `Half a percent of bills passing through a machine are counterfeit. The machine flags 92% of counterfeits and 1% of genuine bills. A bill is flagged. What is the probability it is counterfeit?`,
  correctOptText: (p, s) => `about ${s} (around 32%)`,
  wrongOpts: () => [`92% (the flag rate for counterfeits)`, `about 50%`, `about 70%`, `about 0.5% (the base rate)`],
});

// 20. Email-phishing report, common. base 0.35
addItem({
  base: 0.35, tpr: 0.90, fpr: 0.15,
  correctLetterIdx: 3,
  scenario: `In a flagged review queue, 35% of reported emails are truly malicious. A secondary scanner confirms 90% of truly malicious emails and confirms 15% of benign ones. The scanner confirms an email as malicious. What is the probability it really is malicious?`,
  correctOptText: (p, s) => `about ${s} (between 76% and 78%)`,
  wrongOpts: () => [`90% (the scanner's true-positive rate)`, `about 35% (the base rate)`, `about 60%`, `about 85%`],
});

// 21. Rare side effect. base 0.002
addItem({
  base: 0.002, tpr: 0.80, fpr: 0.05,
  correctLetterIdx: 0,
  scenario: `A rare adverse reaction occurs in 0.2% of patients on a drug. A monitoring algorithm flags 80% of true reactions and 5% of patients with unrelated symptoms. A patient is flagged. What is the probability they had the true adverse reaction?`,
  correctOptText: (p, s) => `about ${s} (around 3%)`,
  wrongOpts: () => [`80% (the algorithm's detection rate)`, `about 50%`, `about 16%`, `about 0.2% (the base rate)`],
});

// 22. Insider-trading anomaly. base 0.01
addItem({
  base: 0.01, tpr: 0.85, fpr: 0.04,
  correctLetterIdx: 2,
  scenario: `One percent of large trades involve insider information. A surveillance system flags 85% of true insider trades and 4% of legitimate large trades. A trade is flagged. What is the probability it involved insider information?`,
  correctOptText: (p, s) => `about ${s} (around 18%)`,
  wrongOpts: () => [`85% (the system's true-positive rate)`, `about 50%`, `about 1% (the base rate)`, `about 30%`],
});

// 23. Defective chip burn-in. base 0.10
addItem({
  base: 0.10, tpr: 0.95, fpr: 0.07,
  correctLetterIdx: 4,
  scenario: `Ten percent of chips have a latent defect. A burn-in test catches 95% of defective chips and fails 7% of good chips. A chip fails burn-in. What is the probability it is genuinely defective?`,
  correctOptText: (p, s) => `about ${s} (around 60%)`,
  wrongOpts: () => [`95% (the test's true-positive rate)`, `about 10% (the base rate)`, `about 40%`, `about 88%`],
});

// 24. Wildfire-smoke sensor. base 0.02
addItem({
  base: 0.02, tpr: 0.97, fpr: 0.10,
  correctLetterIdx: 1,
  scenario: `On any given monitored day, there is a 2% chance of an actual wildfire-smoke event in a region. A sensor network alerts on 97% of real events and on 10% of non-event days. An alert fires. What is the probability there is a genuine smoke event?`,
  correctOptText: (p, s) => `about ${s} (around 17%)`,
  wrongOpts: () => [`97% (the sensor's true-positive rate)`, `about 50%`, `about 2% (the base rate)`, `about 30%`],
});

// 25. Account-takeover login. base 0.001
addItem({
  base: 0.001, tpr: 0.90, fpr: 0.005,
  correctLetterIdx: 3,
  scenario: `One in 1,000 login attempts is an account takeover. A risk engine flags 90% of takeovers and 0.5% of legitimate logins. A login is flagged. What is the probability it is a genuine takeover?`,
  correctOptText: (p, s) => `about ${s} (around 15%)`,
  wrongOpts: () => [`90% (the engine's true-positive rate)`, `about 50%`, `about 0.1% (the base rate)`, `about 30%`],
});

// 26. Cheating-detection on exam. base 0.05
addItem({
  base: 0.05, tpr: 0.88, fpr: 0.03,
  correctLetterIdx: 0,
  scenario: `Five percent of online-exam sessions involve cheating. A proctoring model flags 88% of cheating sessions and 3% of honest sessions. A session is flagged. What is the probability cheating actually occurred?`,
  correctOptText: (p, s) => `about ${s} (around 61%)`,
  wrongOpts: () => [`88% (the model's true-positive rate)`, `about 5% (the base rate)`, `about 30%`, `about 80%`],
});

// 27. Pregnancy-test style, common. base 0.25
addItem({
  base: 0.25, tpr: 0.99, fpr: 0.02,
  correctLetterIdx: 2,
  scenario: `Among people taking a test, 25% truly have the target hormone present. The test is positive for 99% of those who do and 2% of those who do not. A test is positive. What is the probability the hormone is truly present?`,
  correctOptText: (p, s) => `about ${s} (between 93% and 95%)`,
  wrongOpts: () => [`99% (the test's sensitivity)`, `about 25% (the base rate)`, `about 75%`, `about 88%`],
});

// 28. Network-anomaly DDoS. base 0.008
addItem({
  base: 0.008, tpr: 0.96, fpr: 0.05,
  correctLetterIdx: 4,
  scenario: `Roughly 0.8% of traffic spikes are genuine DDoS attacks. A monitor flags 96% of real attacks and 5% of benign spikes. A spike is flagged. What is the probability it is a genuine attack?`,
  correctOptText: (p, s) => `about ${s} (around 13%)`,
  wrongOpts: () => [`96% (the monitor's true-positive rate)`, `about 50%`, `about 0.8% (the base rate)`, `about 30%`],
});

// 29. Rare structural defect (bridge inspection). base 0.003
addItem({
  base: 0.003, tpr: 0.90, fpr: 0.02,
  correctLetterIdx: 1,
  scenario: `Across inspected components, 0.3% have a critical structural defect. A scanner detects 90% of true defects and flags 2% of sound components. A component is flagged. What is the probability it has a critical defect?`,
  correctOptText: (p, s) => `about ${s} (around 12%)`,
  wrongOpts: () => [`90% (the scanner's detection rate)`, `about 50%`, `about 0.3% (the base rate)`, `about 25%`],
});

// 30. Chargeback fraud. base 0.015
addItem({
  base: 0.015, tpr: 0.92, fpr: 0.06,
  correctLetterIdx: 3,
  scenario: `About 1.5% of orders result in chargeback fraud. A model flags 92% of fraudulent orders and 6% of honest ones. An order is flagged. What is the probability it is fraudulent?`,
  correctOptText: (p, s) => `about ${s} (around 19%)`,
  wrongOpts: () => [`92% (the model's true-positive rate)`, `about 50%`, `about 1.5% (the base rate)`, `about 30%`],
});

// 31. Common: customer-churn signal. base 0.30
addItem({
  base: 0.30, tpr: 0.78, fpr: 0.18,
  correctLetterIdx: 0,
  scenario: `Thirty percent of subscribers will churn next quarter. A churn model flags 78% of true churners and 18% of those who will stay. A subscriber is flagged. What is the probability they will actually churn?`,
  correctOptText: (p, s) => `about ${s} (around 65%)`,
  wrongOpts: () => [`78% (the model's true-positive rate)`, `about 30% (the base rate)`, `about 50%`, `about 72%`],
});

// 32. Allergy test, moderate. base 0.12
addItem({
  base: 0.12, tpr: 0.85, fpr: 0.10,
  correctLetterIdx: 2,
  scenario: `Twelve percent of patients tested truly have a specific allergy. A skin test is positive for 85% of allergic patients and 10% of non-allergic ones. A patient tests positive. What is the probability they are truly allergic?`,
  correctOptText: (p, s) => `about ${s} (around 54%)`,
  wrongOpts: () => [`85% (the test's true-positive rate)`, `about 12% (the base rate)`, `about 70%`, `about 80%`],
});

// 33. Money-laundering alert, rare. base 0.004
addItem({
  base: 0.004, tpr: 0.93, fpr: 0.03,
  correctLetterIdx: 4,
  scenario: `Around 0.4% of monitored accounts are involved in money laundering. A transaction-monitoring system alerts on 93% of laundering accounts and 3% of clean accounts. An account triggers an alert. What is the probability it is genuinely involved in laundering?`,
  correctOptText: (p, s) => `about ${s} (around 11%)`,
  wrongOpts: () => [`93% (the system's true-positive rate)`, `about 50%`, `about 0.4% (the base rate)`, `about 30%`],
});

// 34. Rare hardware fault telemetry. base 0.007
addItem({
  base: 0.007, tpr: 0.88, fpr: 0.015,
  correctLetterIdx: 1,
  scenario: `About 0.7% of servers have an imminent disk fault. A telemetry model flags 88% of failing disks and 1.5% of healthy ones. A server is flagged. What is the probability its disk is truly failing?`,
  correctOptText: (p, s) => `about ${s} (around 29%)`,
  wrongOpts: () => [`88% (the model's true-positive rate)`, `about 50%`, `about 0.7% (the base rate)`, `about 15%`],
});

// 35. Spam-comment moderation, common. base 0.45
addItem({
  base: 0.45, tpr: 0.92, fpr: 0.12,
  correctLetterIdx: 3,
  scenario: `On a forum, 45% of submitted comments are spam. A moderation model flags 92% of spam comments and 12% of legitimate comments. A comment is flagged. What is the probability it really is spam?`,
  correctOptText: (p, s) => `about ${s} (between 86% and 88%)`,
  wrongOpts: () => [`92% (the model's true-positive rate)`, `about 45% (the base rate)`, `about 65%`, `about 90%`],
});

// 36. Rare biomarker, prior+likelihood framing. base 0.01
addItem({
  base: 0.01, tpr: 0.95, fpr: 0.10,
  correctLetterIdx: 0,
  scenario: `Before any testing, the chance a patient has a condition is 1%. A biomarker is present in 95% of patients with the condition and in 10% of patients without it. The biomarker is present. What is the updated probability the patient has the condition?`,
  correctOptText: (p, s) => `about ${s} (around 9%)`,
  wrongOpts: () => [`95% (the biomarker's true-positive rate)`, `about 50%`, `about 1% (the base rate)`, `about 30%`],
});

// 37. Vibration-based defect, moderate-rare. base 0.025
addItem({
  base: 0.025, tpr: 0.90, fpr: 0.05,
  correctLetterIdx: 2,
  scenario: `2.5% of pump units have a bearing defect. A vibration analysis flags 90% of defective pumps and 5% of healthy pumps. A pump is flagged. What is the probability it truly has a bearing defect?`,
  correctOptText: (p, s) => `about ${s} (around 32%)`,
  wrongOpts: () => [`90% (the analysis's true-positive rate)`, `about 2.5% (the base rate)`, `about 60%`, `about 85%`],
});

// 38. Rare bug-regression signal in CI. base 0.02
addItem({
  base: 0.02, tpr: 0.80, fpr: 0.03,
  correctLetterIdx: 4,
  scenario: `Two percent of merged commits introduce a real regression. A flaky CI heuristic flags 80% of true regressions and 3% of clean commits. A commit is flagged. What is the probability it introduced a real regression?`,
  correctOptText: (p, s) => `about ${s} (around 35%)`,
  wrongOpts: () => [`80% (the heuristic's true-positive rate)`, `about 2% (the base rate)`, `about 50%`, `about 77%`],
});

// 39. Rare disease, high specificity. base 0.001
addItem({
  base: 0.001, tpr: 0.95, fpr: 0.001,
  correctLetterIdx: 1,
  scenario: `A disease has a prevalence of 1 in 1,000. A high-specificity test detects 95% of true cases and gives a false positive in only 0.1% of healthy people. A person tests positive. What is the probability they have the disease?`,
  correctOptText: (p, s) => `about ${s} (around 49%)`,
  wrongOpts: () => [`95% (the test's sensitivity)`, `about 5%`, `about 99%`, `about 0.1% (the base rate)`],
});

// 40. Moderate fraud with both rates middling. base 0.10
addItem({
  base: 0.10, tpr: 0.70, fpr: 0.10,
  correctLetterIdx: 3,
  scenario: `Ten percent of insurance claims are fraudulent. An adjuster's model flags 70% of fraudulent claims and 10% of legitimate ones. A claim is flagged. What is the probability it is fraudulent?`,
  correctOptText: (p, s) => `about ${s} (around 44%)`,
  wrongOpts: () => [`70% (the model's true-positive rate)`, `about 10% (the base rate)`, `about 60%`, `about 65%`],
});

const out = specs.map(build);
const dest = path.join(__dirname, 'bayesian-authored.jsonl');
fs.writeFileSync(dest, out.map(o => JSON.stringify(o)).join('\n') + '\n', 'utf8');
console.log(`Wrote ${out.length} items to ${dest}`);

// Print base-rate range
const bases = specs.map(s => s.base).sort((a, b) => a - b);
console.log(`Base-rate range: ${bases[0]} (1 in ${Math.round(1 / bases[0])}) to ${bases[bases.length - 1]}`);
