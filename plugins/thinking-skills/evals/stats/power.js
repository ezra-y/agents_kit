#!/usr/bin/env node
'use strict';

/**
 * Statistical power / confidence analysis for the behavioral eval.
 * No deps. Reads outcome counts from the SQLite DB and answers:
 *   1. Is the current mean win-rate significantly > 50% (does the collection beat placebo)?
 *   2. Can we detect a 10pp lift from an intervention with the current dataset?
 *   3. What sample size IS needed — aggregate and per-skill?
 *
 * Usage: node evals/stats/power.js
 */

const path = require('path');
const { spawnSync } = require('child_process');
const DB = path.join(__dirname, '..', 'db', 'evals.db');

function sql(q) {
  const r = spawnSync('sqlite3', ['-json', DB, q], { encoding: 'utf8' });
  return r.stdout && r.stdout.trim() ? JSON.parse(r.stdout) : [];
}

// ---- stats primitives ----
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normCdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
const Z = { '0.05two': 1.959964, '0.05one': 1.644854, pow80: 0.841621, pow90: 1.281552 };

// exact two-sided binomial p-value vs p=0.5 (small n)
function binomExactTwoSided(k, n) {
  const pmf = i => Math.exp(lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1)) * Math.pow(0.5, n);
  const target = pmf(k); let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(i) <= target + 1e-12) p += pmf(i);
  return Math.min(1, p);
}
function lgamma(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
// normal-approx two-sided p vs 0.5 with continuity correction
function signTestNormal(k, n) {
  const z = (Math.abs(k - n / 2) - 0.5) / (0.5 * Math.sqrt(n));
  return 2 * (1 - normCdf(z));
}
function wilson(k, n, z = Z['0.05two']) {
  const p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}
// power of one-sample proportion test, H0:p0 vs true p1, two-sided alpha
function powerOneProp(n, p0, p1, z = Z['0.05two']) {
  const se0 = Math.sqrt(p0 * (1 - p0) / n), se1 = Math.sqrt(p1 * (1 - p1) / n);
  const crit = p0 + z * se0;
  return 1 - normCdf((crit - p1) / se1) + normCdf((2 * p0 - crit - p1) / se1);
}
function reqNOneProp(p0, p1, za = Z['0.05two'], zb = Z.pow80) {
  return Math.ceil(Math.pow(za * Math.sqrt(p0 * (1 - p0)) + zb * Math.sqrt(p1 * (1 - p1)), 2) / Math.pow(p1 - p0, 2));
}
// two independent proportions (e.g. old collection vs improved), n per group
function reqNTwoProp(p1, p2, za = Z['0.05two'], zb = Z.pow80) {
  const pb = (p1 + p2) / 2;
  return Math.ceil(Math.pow(za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2) / Math.pow(p2 - p1, 2));
}

function pctCI(c) { return `[${(c[0] * 100).toFixed(1)}%, ${(c[1] * 100).toFixed(1)}%]`; }

function main() {
  const rows = sql("SELECT winner, count(*) n FROM tier3_problem WHERE variant='main' AND pair='skill:placebo' GROUP BY winner");
  const c = Object.fromEntries(rows.map(r => [r.winner, r.n]));
  const W = c.skill || 0, L = c.placebo || 0, T = c.tie || 0;
  const N = W + L + T, decisive = W + L;
  const wrTies = (W + 0.5 * T) / N;

  console.log('================ BEHAVIORAL EVAL — POWER / CONFIDENCE ================\n');
  console.log(`Aggregate (main run, skill vs same-length placebo):`);
  console.log(`  skill wins ${W} · placebo wins ${L} · ties ${T} · N=${N} (decisive ${decisive})`);
  console.log(`  win-rate (ties=0.5): ${(wrTies * 100).toFixed(1)}%`);
  console.log(`  win-rate (ties dropped): ${(100 * W / decisive).toFixed(1)}%`);

  console.log(`\n--- Q1. Is the collection significantly better than placebo (>50%)? ---`);
  const pSign = signTestNormal(W, decisive);
  const ci = wilson(W, decisive);
  console.log(`  sign test ${W} vs ${L} (n=${decisive}) vs H0=50%: two-sided p ≈ ${pSign.toFixed(3)}  -> ${pSign < 0.05 ? 'SIGNIFICANT' : 'NOT significant'}`);
  console.log(`  95% Wilson CI on win-rate: ${pctCI(ci)}  (includes 50%: ${ci[0] <= 0.5 ? 'YES — cannot rule out no effect' : 'no'})`);

  console.log(`\n--- Q2. Per-skill at n=3: is ANY single skill detectable? ---`);
  for (const k of [3, 2]) {
    const p = binomExactTwoSided(k, 3);
    console.log(`  ${k}/3 wins (${(100 * k / 3).toFixed(0)}%): exact two-sided p = ${p.toFixed(3)} -> ${p < 0.05 ? 'significant' : 'NOT significant'}`);
  }
  console.log(`  => Even a perfect 3/3 skill (100%) is indistinguishable from a coin flip. No per-skill verdict is statistically valid at n=3.`);

  console.log(`\n--- Q3. Power of the CURRENT dataset (n≈${decisive}) ---`);
  for (const p1 of [0.60, 0.65, 0.70]) {
    console.log(`  detect true win-rate ${(p1 * 100).toFixed(0)}% vs 50%: power ≈ ${(powerOneProp(decisive, 0.5, p1) * 100).toFixed(0)}%`);
  }
  console.log(`  (80% power is the conventional minimum.)`);

  console.log(`\n--- Q4. Sample size to confidently detect a 10pp lift ---`);
  console.log(`  A) Aggregate "collection beats placebo by 10pp" (60% vs 50%), one-sample, 80% power:`);
  console.log(`       need N ≈ ${reqNOneProp(0.5, 0.60)} decisive comparisons  (have ${decisive})`);
  console.log(`     at 90% power: N ≈ ${reqNOneProp(0.5, 0.60, Z['0.05two'], Z.pow90)}`);
  console.log(`  B) Intervention lift "improved 66% vs current 56%", two independent arms, 80% power:`);
  console.log(`       need N ≈ ${reqNTwoProp(0.56, 0.66)} problems PER ARM  (paired same-problem design needs far fewer — see note)`);
  console.log(`  C) Paired design (old vs new skill judged head-to-head on the SAME problem): detecting new>old at 60%:`);
  console.log(`       need N ≈ ${reqNOneProp(0.5, 0.60)} paired problems with a decisive winner.`);

  console.log(`\n--- Q5. Per-skill: problems needed to detect a LARGE within-skill move ---`);
  for (const [from, to] of [[0.5, 0.80], [0.33, 0.80], [0.5, 0.70]]) {
    console.log(`  ${(from * 100).toFixed(0)}%→${(to * 100).toFixed(0)}% (a ${((to - from) * 100).toFixed(0)}pp move): N ≈ ${reqNOneProp(from, to)} problems/skill`);
  }

  console.log(`\n================ VERDICT ================`);
  console.log(`The current 108-problem set is UNDERPOWERED. It cannot (a) confirm the collection beats`);
  console.log(`placebo at all (CI includes 50%), (b) validate any per-skill verdict (n=3 → p≥0.25 even at 3/3),`);
  console.log(`or (c) detect a 10pp aggregate lift (power ~${(powerOneProp(decisive,0.5,0.60)*100).toFixed(0)}%). To validate a 10pp lift you need roughly`);
  console.log(`~${reqNOneProp(0.5,0.60)}+ decisive comparisons (≈3-4× today). Concentrated large per-skill moves (≥30pp) are`);
  console.log(`detectable with ~10-20 problems/skill — the realistic path: scale to ~10-12 problems/skill (~400),`);
  console.log(`use a PAIRED old-vs-new design, and pre-register the targeted skills.`);
}

main();
