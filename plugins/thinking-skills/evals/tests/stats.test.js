'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  scoreDistractor,
  pairedDiff,
  mcnemarFull,
  mcnemarMidp,
  summarize,
  clampProbability,
  clusterBootstrapPairedRiskDiff,
  clusterRandomizationTest,
  holmAdjustment,
  ratioBootstrapInterval,
  validatePowerConfig,
  meanPairedRiskDiff,
} = require('../lib/stats.js');

test('distractor scoring: fixed fixture computes correct FPR/FNR/net_utility', () => {
  // Fixture: 3 target (2 hit, 1 miss), 3 off-target (1 wrongly fires, 2 correctly silent)
  // target items: 2 TP, 1 FN
  // off-target items: 1 FP, 2 TN
  const items = [
    { target: true,  fired: true  }, // TP
    { target: true,  fired: true  }, // TP
    { target: true,  fired: false }, // FN
    { target: false, fired: true  }, // FP
    { target: false, fired: false }, // TN
    { target: false, fired: false }, // TN
  ];
  const result = scoreDistractor(items);
  // FNR = FN / (TP + FN) = 1/3 ≈ 0.333
  // FPR = FP / (FP + TN) = 1/3 ≈ 0.333
  // net_utility = (TP - FP) / N = (2 - 1) / 6 = 1/6 ≈ 0.166667
  assert.ok(Math.abs(result.fnr - 1/3) < 1e-3, `FNR should be 1/3, got ${result.fnr}`);
  assert.ok(Math.abs(result.fpr - 1/3) < 1e-3, `FPR should be 1/3, got ${result.fpr}`);
  assert.ok(Math.abs(result.net_utility - 1/6) < 1e-3, `net_utility should be 1/6, got ${result.net_utility}`);
  assert.strictEqual(result.tp, 2);
  assert.strictEqual(result.fn, 1);
  assert.strictEqual(result.fp, 1);
  assert.strictEqual(result.tn, 2);
  assert.strictEqual(result.n_target, 3);
  assert.strictEqual(result.n_offtarget, 3);
  assert.strictEqual(result.n_total, 6);
});

test('distractor scoring: empty array returns zeros', () => {
  const result = scoreDistractor([]);
  assert.strictEqual(result.fpr, 0);
  assert.strictEqual(result.fnr, 0);
  assert.strictEqual(result.net_utility, 0);
  assert.strictEqual(result.n_total, 0);
});

test('distractor scoring: all target items fire correctly', () => {
  const items = [
    { target: true, fired: true },
    { target: true, fired: true },
  ];
  const result = scoreDistractor(items);
  assert.strictEqual(result.fnr, 0);
  assert.strictEqual(result.fpr, 0); // no off-target items
  assert.strictEqual(result.net_utility, 1); // TP=2, FP=0, N=2 => (2-0)/2 = 1
});

test('distractor scoring: all off-target items fire incorrectly', () => {
  const items = [
    { target: false, fired: true },
    { target: false, fired: true },
  ];
  const result = scoreDistractor(items);
  assert.strictEqual(result.fpr, 1);
  assert.strictEqual(result.fnr, 0); // no target items
  assert.strictEqual(result.net_utility, -1); // TP=0, FP=2, N=2 => (0-2)/2 = -1
});

test('pairedDiff: mean_diff is exact on documented fixture', () => {
  const treatment = [1, 1, 0, 1, 0];
  const control = [0, 1, 0, 0, 0];
  const result = pairedDiff(treatment, control);
  assert.ok(Math.abs(result.mean_diff - 0.4) < 1e-6, `mean_diff should be 0.4, got ${result.mean_diff}`);
  assert.ok(Array.isArray(result.ci95) && result.ci95.length === 2);
  assert.ok(typeof result.correlation === 'number');
});

test('mcnemarMidp: mid-p < continuity-corrected on (8,2)', () => {
  const result = mcnemarFull(8, 2);
  assert.ok(result.midP < result.continuityCorrected, `midP ${result.midP} should be < continuityCorrected ${result.continuityCorrected}`);
});

test('summarize: preserves all five legacy fields', () => {
  const s = summarize(7, 3, 0);
  const required = ['win_rate', 'ci95', 'p_value', 'significant', 'powered'];
  for (const k of required) {
    assert.ok(k in s, `summarize() missing legacy field: ${k}`);
  }
  assert.strictEqual(s.wins, 7);
  assert.strictEqual(s.losses, 3);
  assert.strictEqual(s.ties, 0);
  assert.strictEqual(s.n, 10);
  assert.strictEqual(s.decisive, 10);
});

test('summarize: powered is false without explicit power config even if CI excludes null', () => {
  // 20/0 decisive → CI far above 0.5, but still not decision-powered
  const s = summarize(20, 0, 0);
  assert.strictEqual(s.ci_excludes_null, true);
  assert.strictEqual(s.powered, false);
  assert.strictEqual(s.decision_eligible, false);
});

test('summarize: decision_eligible only with validated power config + achieved flag', () => {
  const cfg = {
    family_size: 84,
    alpha_family: 0.05,
    target_power: 0.90,
    margin: 0.05,
    seed: 42,
    method: 'cluster-bootstrap-holm',
    achieved_power_ok: true,
  };
  const s = summarize(20, 0, 0, cfg);
  assert.strictEqual(s.powered, true);
  assert.strictEqual(s.decision_eligible, true);
});

test('mcnemarFull: exposes validation-compatible alias fields cc and midp', () => {
  const result = mcnemarFull(8, 2);
  // Aliases must be present
  assert.ok('cc' in result, 'mcnemarFull must expose cc alias');
  assert.ok('midp' in result, 'mcnemarFull must expose midp alias');
  // Aliases match the canonical fields
  assert.strictEqual(result.cc, result.continuityCorrected, 'cc alias must equal continuityCorrected');
  assert.strictEqual(result.midp, result.midP, 'midp alias must equal midP');
  // Original fields still present
  assert.ok('continuityCorrected' in result, 'continuityCorrected must remain');
  assert.ok('midP' in result, 'midP must remain');
  // midp < cc for (8,2)
  assert.ok(result.midp < result.cc, `midp ${result.midp} should be < cc ${result.cc}`);
});

test('mcnemarFull: legacy mcnemar scalar unchanged on (8,2) ~0.114', () => {
  const { mcnemar } = require('../lib/stats.js');
  const p = mcnemar(8, 2);
  assert.ok(Math.abs(p - 0.114) < 0.003, `legacy mcnemar(8,2) should be ~0.114, got ${p}`);
});

test('clampProbability: clamps to [0,1] and rejects non-finite', () => {
  assert.strictEqual(clampProbability(-0.2), 0);
  assert.strictEqual(clampProbability(1.5), 1);
  assert.strictEqual(clampProbability(0.3), 0.3);
  assert.strictEqual(clampProbability(null), null);
  assert.strictEqual(clampProbability(NaN), null);
});

test('clusterBootstrapPairedRiskDiff: deterministic for fixed seed', () => {
  const obs = [
    { treatment: 1, control: 0, leakage_family: 'f1', item_id: 'a' },
    { treatment: 1, control: 0, leakage_family: 'f1', item_id: 'a' }, // nested trial
    { treatment: 0, control: 0, leakage_family: 'f2', item_id: 'b' },
    { treatment: 1, control: 1, leakage_family: 'f3', item_id: 'c' },
    { treatment: 1, control: 0, leakage_family: 'f4', item_id: 'd' },
  ];
  const a = clusterBootstrapPairedRiskDiff(obs, { seed: 7, resamples: 500 });
  const b = clusterBootstrapPairedRiskDiff(obs, { seed: 7, resamples: 500 });
  assert.strictEqual(a.estimate, b.estimate);
  assert.deepStrictEqual(a.ci, b.ci);
  assert.strictEqual(a.n_clusters, 4);
  assert.ok(a.estimate > 0);
});

test('clusterBootstrapPairedRiskDiff: hierarchical nesting resamples items within family', () => {
  // Two families; family f1 has two items with opposite effects.
  // Flat family-only resampling would always keep both items together and
  // never vary their relative weight. Hierarchical item-level resampling
  // changes the estimate distribution — CI should be non-degenerate.
  const obs = [
    { treatment: 1, control: 0, leakage_family: 'f1', item_id: 'a1', trial: 0 },
    { treatment: 1, control: 0, leakage_family: 'f1', item_id: 'a1', trial: 1 },
    { treatment: 0, control: 1, leakage_family: 'f1', item_id: 'a2', trial: 0 },
    { treatment: 0, control: 1, leakage_family: 'f1', item_id: 'a2', trial: 1 },
    { treatment: 1, control: 0, leakage_family: 'f2', item_id: 'b1', trial: 0 },
    { treatment: 1, control: 0, leakage_family: 'f2', item_id: 'b1', trial: 1 },
  ];
  const { buildHierarchy } = require('../lib/stats.js');
  const h = buildHierarchy(obs);
  assert.strictEqual(h.length, 2, 'two families');
  assert.strictEqual(h.find(f => f.key === 'fam:f1').items.length, 2, 'f1 has two items');
  const r = clusterBootstrapPairedRiskDiff(obs, { seed: 11, resamples: 1000 });
  assert.strictEqual(r.method, 'hierarchical-cluster-bootstrap-paired-rd');
  assert.strictEqual(r.n_clusters, 2);
  assert.strictEqual(r.n_items, 3);
  // Nested resampling produces a CI with positive width
  assert.ok(r.ci[1] > r.ci[0], `expected non-degenerate CI, got ${r.ci}`);
});

test('clusterRandomizationTest: null-ish data yields high p; strong signal lower p', () => {
  const nullish = [
    { treatment: 1, control: 1, item_id: 'a' },
    { treatment: 0, control: 0, item_id: 'b' },
    { treatment: 1, control: 1, item_id: 'c' },
  ];
  const strong = [
    { treatment: 1, control: 0, item_id: 'a' },
    { treatment: 1, control: 0, item_id: 'b' },
    { treatment: 1, control: 0, item_id: 'c' },
    { treatment: 1, control: 0, item_id: 'd' },
    { treatment: 1, control: 0, item_id: 'e' },
    { treatment: 1, control: 0, item_id: 'f' },
  ];
  const pNull = clusterRandomizationTest(nullish, { seed: 1, resamples: 1000 });
  const pStrong = clusterRandomizationTest(strong, { seed: 1, resamples: 1000 });
  assert.ok(pNull.p_value > 0.2, `nullish p should be high, got ${pNull.p_value}`);
  assert.ok(pStrong.p_value < 0.05, `strong p should be small, got ${pStrong.p_value}`);
});

test('holmAdjustment: adjusts family of p-values monotonically', () => {
  const adj = holmAdjustment([0.001, 0.04, 0.03]);
  assert.strictEqual(adj.length, 3);
  assert.ok(adj[0].p_adjusted <= adj[1].p_adjusted || adj[0].p <= adj[1].p);
  // Smallest raw p gets rank 1
  const ranks = adj.map(a => a.rank).sort();
  assert.deepStrictEqual(ranks, [1, 2, 3]);
  assert.ok(adj.every(a => a.p_adjusted >= a.p - 1e-12));
  assert.ok(adj.every(a => a.p_adjusted <= 1));
});

test('ratioBootstrapInterval: deterministic ratio CI', () => {
  const obs = [
    { numerator: 80, denominator: 100, item_id: 'a' },
    { numerator: 70, denominator: 100, item_id: 'b' },
    { numerator: 90, denominator: 100, item_id: 'c' },
  ];
  const r1 = ratioBootstrapInterval(obs, { seed: 3, resamples: 400 });
  const r2 = ratioBootstrapInterval(obs, { seed: 3, resamples: 400 });
  assert.deepStrictEqual(r1.ci, r2.ci);
  assert.ok(Math.abs(r1.estimate - 0.8) < 1e-9);
  assert.ok(r1.ci[0] <= r1.estimate && r1.estimate <= r1.ci[1]);
});

test('validatePowerConfig: requires family size, power, margin, seed, method', () => {
  const bad = validatePowerConfig({});
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.length >= 3);

  const good = validatePowerConfig({
    family_size: 84,
    alpha_family: 0.05 / 84,
    target_power: 0.90,
    margin: 0.05,
    seed: 123,
    method: 'cluster-bootstrap-holm',
  });
  assert.strictEqual(good.ok, true);
});

test('validatePowerConfig: rejects fractional H, infinite power, nonpositive margin', () => {
  assert.strictEqual(validatePowerConfig({
    family_size: 2.5,
    alpha_family: 0.05,
    target_power: 0.90,
    margin: 0.05,
    seed: 1,
    method: 'x',
  }).ok, false);

  assert.strictEqual(validatePowerConfig({
    family_size: 10,
    alpha_family: 0.05,
    target_power: Infinity,
    margin: 0.05,
    seed: 1,
    method: 'x',
  }).ok, false);

  assert.strictEqual(validatePowerConfig({
    family_size: 10,
    alpha_family: 0.05,
    target_power: 0.90,
    margin: 0,
    seed: 1,
    method: 'x',
  }).ok, false);

  assert.strictEqual(validatePowerConfig({
    family_size: 10,
    alpha_family: 0.05,
    target_power: 0.90,
    margin: -0.01,
    seed: 1,
    method: 'x',
  }).ok, false);

  assert.strictEqual(validatePowerConfig({
    family_size: 10,
    alpha_family: 0.05,
    target_power: 0.90,
    margin: 0.05,
    seed: '',
    method: 'x',
  }).ok, false);
});

test('meanPairedRiskDiff: simple average of treatment-control', () => {
  const obs = [
    { treatment: 1, control: 0 },
    { treatment: 1, control: 1 },
    { treatment: 0, control: 0 },
  ];
  assert.ok(Math.abs(meanPairedRiskDiff(obs) - (1 / 3)) < 1e-12);
});
