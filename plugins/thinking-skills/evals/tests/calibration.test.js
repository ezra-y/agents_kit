'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  aggregatePerItem,
  classifyBands,
  buildOutput,
  serializeRate,
  loadPartialProgress,
  normalizeTrialResult,
  buildCalibrationPrompt,
  judgePrediction,
} = require('../run-calibration.js');

test('serializeRate: preserves zero instead of null', () => {
  assert.strictEqual(serializeRate(0), 0);
  assert.strictEqual(serializeRate(0.0), 0);
  assert.strictEqual(serializeRate(null), null);
  assert.strictEqual(serializeRate(undefined), null);
  assert.strictEqual(serializeRate(0.5), 0.5);
});

test('buildCalibrationPrompt supports labeled rows without decision_instruction', () => {
  const prompt = buildCalibrationPrompt('Is the observation causal?');
  assert.match(prompt, /Answer the problem/);
  assert.match(prompt, /Is the observation causal/);
  assert.match(prompt, /Return ONLY valid JSON/);
});

test('judgePrediction accepts ANSWER-prefixed JSON string values', () => {
  const parsed = { value: 'ANSWER: Yes', type: 'string', ok: true };
  assert.strictEqual(judgePrediction(parsed, { raw: true, type: 'boolean' }), true);
});

test('aggregatePerItem: failures are attempted-scored; wrong answers stay in denominator', () => {
  const trials = [
    { itemIndex: 0, id: 'i0', correct: false, scored: true, prediction: 'no', parse_failure: false, transport_failure: false },
    { itemIndex: 0, id: 'i0', correct: false, scored: true, prediction: 'no', parse_failure: false, transport_failure: false },
    { itemIndex: 0, id: 'i0', correct: null, scored: false, prediction: null, parse_failure: true, transport_failure: true },
  ];
  const per = aggregatePerItem(trials, 3);
  assert.strictEqual(per.length, 1);
  assert.strictEqual(per[0].attempted, 3);
  assert.strictEqual(per[0].scored, 2);
  assert.strictEqual(per[0].successes, 0);
  assert.strictEqual(per[0].incorrect, 2);
  // failures = attempted - scored (infra only), not attempted - successes
  assert.strictEqual(per[0].failures, 1);
  // Zero baseline must serialize as 0, not null (wrong + failed both in denom)
  assert.strictEqual(per[0].baseline, 0);
});

test('aggregatePerItem: successes / attempted (not successes / scored-only)', () => {
  const trials = [
    { itemIndex: 1, id: 'i1', correct: true, scored: true, prediction: 'yes' },
    { itemIndex: 1, id: 'i1', correct: true, scored: true, prediction: 'yes' },
    { itemIndex: 1, id: 'i1', correct: null, scored: false, prediction: null, parse_failure: true },
    { itemIndex: 1, id: 'i1', correct: false, scored: true, prediction: 'no' },
  ];
  const per = aggregatePerItem(trials, 4);
  assert.strictEqual(per[0].attempted, 4);
  assert.strictEqual(per[0].scored, 3);
  assert.strictEqual(per[0].successes, 2);
  assert.strictEqual(per[0].incorrect, 1);
  assert.strictEqual(per[0].failures, 1);
  // 2/4 = 0.5 (failure trial still in accuracy denominator)
  assert.ok(Math.abs(per[0].baseline - 0.5) < 1e-9);
});

test('classifyBands: floor includes exact zero baseline', () => {
  const { floor, inBand } = classifyBands([
    { id: 'z', baseline: 0, attempted: 5 },
    { id: 'm', baseline: 0.5, attempted: 5 },
  ]);
  assert.strictEqual(floor.length, 1);
  assert.strictEqual(floor[0].id, 'z');
  assert.strictEqual(inBand.length, 1);
});

test('buildOutput: baseline_accuracy 0 serializes as 0', () => {
  const trials = [
    { itemIndex: 0, id: 'a', correct: false, scored: true, prediction: 'x' },
  ];
  const per = aggregatePerItem(trials, 1);
  const out = buildOutput('fixture', 1, [{ id: 'a' }], trials, per);
  assert.strictEqual(out.baseline_accuracy, 0);
  assert.strictEqual(out.scored_trials, 1);
  assert.strictEqual(out.incorrect_trials, 1);
  assert.strictEqual(out.failed_trials, 0);
  assert.strictEqual(out.attempted_trials, 1);
});

test('loadPartialProgress: tracks completed trial indexes without treating partial as complete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-'));
  const partialFile = path.join(dir, 'partial.json');
  // K_TRIALS default is 5; write 5 trials for item 0 and 2 for item 1
  const raw = [];
  for (let t = 0; t < 5; t++) {
    raw.push({ itemIndex: 0, trialIndex: t, id: 'a', correct: true, scored: true, prediction: 'yes' });
  }
  raw.push({ itemIndex: 1, trialIndex: 0, id: 'b', correct: false, scored: true, prediction: 'no' });
  raw.push({ itemIndex: 1, trialIndex: 1, id: 'b', correct: false, scored: true, prediction: 'no' });
  fs.writeFileSync(partialFile, JSON.stringify({ raw_results: raw }));
  const { trialResults, completedItemIndexes, completedTrialsByItem } = loadPartialProgress(partialFile);
  assert.strictEqual(trialResults.length, 7);
  assert.ok(completedItemIndexes.has(0));
  assert.ok(!completedItemIndexes.has(1));
  assert.deepStrictEqual([...completedTrialsByItem.get(1)].sort(), [0, 1]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalizeTrialResult: converts bare mapPool __error into structured failure with identity', () => {
  const item = { id: 'x1', type: 'boolean', target: true };
  const row = normalizeTrialResult({ __error: 'boom' }, item, 3, 2);
  assert.strictEqual(row.itemIndex, 3);
  assert.strictEqual(row.trialIndex, 2);
  assert.strictEqual(row.id, 'x1');
  assert.strictEqual(row.attempted, true);
  assert.strictEqual(row.scored, false);
  assert.strictEqual(row.transport_failure, true);
  assert.strictEqual(row.correct, null);
  // lands in failure denominator, not success
  const per = aggregatePerItem([row], 1);
  assert.strictEqual(per[0].attempted, 1);
  assert.strictEqual(per[0].scored, 0);
  assert.strictEqual(per[0].failures, 1);
  assert.strictEqual(per[0].baseline, 0);
});
