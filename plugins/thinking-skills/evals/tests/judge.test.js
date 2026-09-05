'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeJudgeWinner,
  tallyJudgeVotes,
  modelFamily,
  judgesExcludingSolver,
  decidePanelWinner,
  evaluateJudgeCalibration,
  DEFAULT_PANEL_MODELS,
  FROZEN_PANEL,
  JUDGE_CALIBRATION_THRESHOLDS,
  panelModels,
} = require('../lib/judge.js');

test('DEFAULT_PANEL_MODELS is the frozen three-family panel', () => {
  assert.deepStrictEqual([...DEFAULT_PANEL_MODELS], [
    'gpt-5.5-pro',
    'gemini-3.1-pro-preview',
    'deepseek-v4-pro',
  ]);
  assert.deepStrictEqual([...FROZEN_PANEL], [...DEFAULT_PANEL_MODELS]);
});

test('panelModels always returns frozen panel (env cannot override)', () => {
  const prevJ = process.env.JUDGES;
  const prevM = process.env.JUDGE_MODEL;
  process.env.JUDGES = 'claude-sonnet-4-6,claude-opus-4-8';
  process.env.JUDGE_MODEL = 'claude-haiku-4-5';
  try {
    assert.deepStrictEqual(panelModels(), [...DEFAULT_PANEL_MODELS]);
  } finally {
    if (prevJ === undefined) delete process.env.JUDGES; else process.env.JUDGES = prevJ;
    if (prevM === undefined) delete process.env.JUDGE_MODEL; else process.env.JUDGE_MODEL = prevM;
  }
});

test('normalizeJudgeWinner: preserves A/B and valid ties; null is missing', () => {
  assert.strictEqual(normalizeJudgeWinner('A'), 'A');
  assert.strictEqual(normalizeJudgeWinner('b'), 'B');
  assert.strictEqual(normalizeJudgeWinner('TIE'), 'tie');
  assert.strictEqual(normalizeJudgeWinner(' tie '), 'tie');
  assert.strictEqual(normalizeJudgeWinner(null), null);
  assert.strictEqual(normalizeJudgeWinner(undefined), null);
  assert.strictEqual(normalizeJudgeWinner(''), null);
  assert.strictEqual(normalizeJudgeWinner(null, { missingAsTie: true }), 'tie');
});

test('tallyJudgeVotes: valid ties counted; null/invalid are missing', () => {
  const tally = tallyJudgeVotes([
    { winner: 'A', valid: true },
    { winner: 'TIE', valid: true },
    { winner: 'tie', valid: true },
    { winner: null, valid: false },
  ]);
  assert.deepStrictEqual(tally, { A: 1, B: 0, tie: 2, missing: 1 });
});

test('tallyJudgeVotes: multi-judge majority produces clear winner counts', () => {
  const tally = tallyJudgeVotes([
    { winner: 'A', valid: true },
    { winner: 'A', valid: true },
    { winner: 'B', valid: true },
  ]);
  assert.strictEqual(tally.A, 2);
  assert.strictEqual(tally.B, 1);
  assert.strictEqual(tally.tie, 0);
  assert.strictEqual(tally.missing, 0);
});

test('decidePanelWinner: two matching valid A votes resolve', () => {
  const d = decidePanelWinner({ A: 2, B: 1, tie: 0, missing: 0 });
  assert.strictEqual(d.winner, 'A');
  assert.strictEqual(d.resolved, true);
  assert.strictEqual(d.unresolved, false);
});

test('decidePanelWinner: fewer than two matching valid votes is unresolved failure', () => {
  const d = decidePanelWinner({ A: 1, B: 1, tie: 1, missing: 0 });
  assert.strictEqual(d.winner, null);
  assert.strictEqual(d.unresolved, true);
  assert.ok(d.failure && d.failure.type === 'judge_unresolved');
});

test('decidePanelWinner: missing votes do not create a silent tie win', () => {
  const d = decidePanelWinner({ A: 1, B: 0, tie: 0, missing: 2 });
  assert.strictEqual(d.winner, null);
  assert.strictEqual(d.unresolved, true);
});

test('decidePanelWinner: two explicit valid tie votes resolve as tie', () => {
  const d = decidePanelWinner({ A: 0, B: 1, tie: 2, missing: 0 });
  assert.strictEqual(d.winner, 'tie');
  assert.strictEqual(d.resolved, true);
  assert.strictEqual(d.unresolved, false);
  assert.strictEqual(d.failure, null);
});

test('decidePanelWinner: three valid ties resolve as tie', () => {
  const d = decidePanelWinner({ A: 0, B: 0, tie: 3, missing: 0 });
  assert.strictEqual(d.winner, 'tie');
  assert.strictEqual(d.resolved, true);
});

test('decidePanelWinner: one valid tie plus missing votes is unresolved failure', () => {
  const d = decidePanelWinner({ A: 0, B: 0, tie: 1, missing: 2 });
  assert.strictEqual(d.winner, null);
  assert.strictEqual(d.unresolved, true);
  assert.ok(d.failure && d.failure.type === 'judge_unresolved');
});

test('tally+decide: valid ties counted; failed votes do not manufacture a tie win', () => {
  const tally = tallyJudgeVotes([
    { winner: 'tie', valid: true },
    { winner: null, valid: false },
    { winner: null, valid: false },
  ]);
  assert.deepStrictEqual(tally, { A: 0, B: 0, tie: 1, missing: 2 });
  const d = decidePanelWinner(tally);
  assert.strictEqual(d.winner, null);
  assert.strictEqual(d.unresolved, true);
});

test('tally+decide: two valid ties and one missing resolves as tie', () => {
  const tally = tallyJudgeVotes([
    { winner: 'tie', valid: true },
    { winner: 'TIE', valid: true },
    { winner: null, valid: false },
  ]);
  assert.deepStrictEqual(tally, { A: 0, B: 0, tie: 2, missing: 1 });
  const d = decidePanelWinner(tally);
  assert.strictEqual(d.winner, 'tie');
  assert.strictEqual(d.resolved, true);
});

test('modelFamily: maps known model prefixes to families', () => {
  assert.strictEqual(modelFamily('claude-sonnet-4-6'), 'claude');
  assert.strictEqual(modelFamily('claude-opus-4-8'), 'claude');
  assert.strictEqual(modelFamily('gpt-5.5-pro'), 'gpt');
  assert.strictEqual(modelFamily('gemini-3.1-pro-preview'), 'gemini');
  assert.strictEqual(modelFamily('deepseek-v4-pro'), 'deepseek');
  assert.strictEqual(modelFamily('grok-imagine'), 'grok');
  assert.strictEqual(modelFamily('glm-5.2'), 'glm');
  assert.strictEqual(modelFamily('unknown-model'), 'unknown');
});

test('judgesExcludingSolver: removes same-family judges', () => {
  const judges = ['gpt-5.5-pro', 'gemini-3.1-pro-preview', 'deepseek-v4-pro'];
  const filtered = judgesExcludingSolver('claude-sonnet-4-6', judges);
  assert.deepStrictEqual(filtered, judges);
});

test('judgesExcludingSolver: excludes solver family from panel', () => {
  const judges = ['claude-opus-4-8', 'gpt-5.5-pro', 'gemini-3.1-pro-preview'];
  const filtered = judgesExcludingSolver('claude-sonnet-4-6', judges);
  assert.deepStrictEqual(filtered, ['gpt-5.5-pro', 'gemini-3.1-pro-preview']);
});

test('judgesExcludingSolver: no same-family fallback when <2 remain', () => {
  const judges = ['claude-opus-4-8', 'claude-sonnet-4-6'];
  const filtered = judgesExcludingSolver('claude-haiku-4-5', judges);
  assert.deepStrictEqual(filtered, []);
});

test('judgesExcludingSolver: single independent judge is ineligible (empty)', () => {
  const judges = ['claude-opus-4-8', 'gpt-5.5-pro'];
  const filtered = judgesExcludingSolver('claude-sonnet-4-6', judges);
  assert.deepStrictEqual(filtered, []);
});

test('judgesExcludingSolver: two same-family judges are ineligible', () => {
  // length>=2 but only one independent family
  const judges = ['gpt-5.5-pro', 'gpt-4o'];
  const filtered = judgesExcludingSolver('claude-sonnet-4-6', judges);
  assert.deepStrictEqual(filtered, []);
});

test('judgesExcludingSolver: unknown-family judges do not count toward independence', () => {
  const judges = ['gpt-5.5-pro', 'mystery-model-x'];
  const filtered = judgesExcludingSolver('claude-sonnet-4-6', judges);
  assert.deepStrictEqual(filtered, []);
});

test('evaluateJudgeCalibration: passes approved thresholds', () => {
  const ok = evaluateJudgeCalibration({
    panel_majority_accuracy: 0.90,
    per_judge_accuracy: { gpt: 0.80, gemini: 0.78, deepseek: 0.82 },
    fleiss_kappa: 0.65,
    order_effect_delta_pp: 2,
    verbosity_effect_delta_pp: -1,
    missing_vote_rate: 0.005,
    n_pairs: 30,
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.eligible, true);
  assert.strictEqual(ok.failures.length, 0);
  assert.strictEqual(JUDGE_CALIBRATION_THRESHOLDS.panel_majority_accuracy_min, 0.85);
});

test('evaluateJudgeCalibration: fails when kappa or accuracy below gate', () => {
  const bad = evaluateJudgeCalibration({
    panel_majority_accuracy: 0.70,
    per_judge_accuracy: [0.80, 0.80, 0.80],
    fleiss_kappa: 0.40,
    order_effect_delta_pp: 1,
    verbosity_effect_delta_pp: 1,
    missing_vote_rate: 0,
    n_pairs: 30,
  });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.failures.some(f => f.gate === 'panel_majority_accuracy'));
  assert.ok(bad.failures.some(f => f.gate === 'fleiss_kappa'));
});

test('evaluateJudgeCalibration: missing n_pairs is ineligible', () => {
  const bad = evaluateJudgeCalibration({
    panel_majority_accuracy: 0.90,
    per_judge_accuracy: { gpt: 0.80, gemini: 0.78, deepseek: 0.82 },
    fleiss_kappa: 0.65,
    order_effect_delta_pp: 1,
    verbosity_effect_delta_pp: 1,
    missing_vote_rate: 0,
  });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.failures.some(f => f.gate === 'min_calibration_pairs'));
});

test('evaluateJudgeCalibration: empty per_judge_accuracy is ineligible', () => {
  const bad = evaluateJudgeCalibration({
    panel_majority_accuracy: 0.90,
    per_judge_accuracy: [],
    fleiss_kappa: 0.65,
    order_effect_delta_pp: 1,
    verbosity_effect_delta_pp: 1,
    missing_vote_rate: 0,
    n_pairs: 30,
  });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.failures.some(f => f.gate === 'per_judge_accuracy'));
});

test('evaluateJudgeCalibration: requires all three panel models', () => {
  const bad = evaluateJudgeCalibration({
    panel_majority_accuracy: 0.90,
    per_judge_accuracy: { gpt: 0.80, gemini: 0.80 },
    fleiss_kappa: 0.65,
    order_effect_delta_pp: 1,
    verbosity_effect_delta_pp: 1,
    missing_vote_rate: 0,
    n_pairs: 30,
  });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.failures.some(f => f.gate === 'per_judge_accuracy' && /deepseek/.test(String(f.judge || f.message || ''))));
});
