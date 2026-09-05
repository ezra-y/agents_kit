'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verdict, VERDICT, parseResultsFile, aggregateJsonlRows } = require('../run-replication.js');

// --- McNemar alias coverage (via stats.js import) ---
test('mcnemarFull: cc and midp alias values are present and consistent', () => {
  const { mcnemarFull } = require('../lib/stats.js');
  const result = mcnemarFull(8, 2);
  assert.ok('cc' in result, 'cc alias must be present');
  assert.ok('midp' in result, 'midp alias must be present');
  assert.strictEqual(result.cc, result.continuityCorrected, 'cc === continuityCorrected');
  assert.strictEqual(result.midp, result.midP, 'midp === midP');
  assert.ok(result.midp < result.cc, `midp ${result.midp} < cc ${result.cc}`);
});

// --- Replication verdict: ELEVATE only on positive replicated lift ---

test('verdict: ELEVATE when primary and replication both pass with positive delta', () => {
  const v = verdict({
    primary: { delta_pp: 9, p_value: 0.01 },
    replication: { delta_pp: 7, p_value: 0.03 },
  });
  assert.strictEqual(v, VERDICT.ELEVATE, `should be ELEVATE, got ${v}`);
});

test('verdict: ELEVATE with delta_pp exactly at threshold (5)', () => {
  const v = verdict({
    primary: { delta_pp: 5, p_value: 0.04 },
    replication: { delta_pp: 5, p_value: 0.04 },
  });
  assert.strictEqual(v, VERDICT.ELEVATE, `delta_pp=5 should be ELEVATE, got ${v}`);
});

test('verdict: NO-LIFT when primary delta_pp < 5', () => {
  const v = verdict({
    primary: { delta_pp: 4.9, p_value: 0.01 },
    replication: { delta_pp: 9, p_value: 0.01 },
  });
  assert.strictEqual(v, VERDICT.NO_LIFT, `should be NO-LIFT for delta_pp=4.9, got ${v}`);
});

test('verdict: REPLICATION-MISSING when replication is null', () => {
  const v = verdict({
    primary: { delta_pp: 9, p_value: 0.01 },
    replication: null,
  });
  assert.strictEqual(v, VERDICT.REPLICATION_MISSING, `should be REPLICATION-MISSING, got ${v}`);
});

test('verdict: REPLICATION-MISSING when replication is undefined', () => {
  const v = verdict({
    primary: { delta_pp: 9, p_value: 0.01 },
  });
  assert.strictEqual(v, VERDICT.REPLICATION_MISSING, `should be REPLICATION-MISSING for missing replication, got ${v}`);
});

// --- NEGATIVE-delta-does-NOT-ELEVATE cases ---

test('verdict: negative primary delta yields NO-LIFT, never ELEVATE', () => {
  const v = verdict({
    primary: { delta_pp: -9, p_value: 0.01 },
    replication: { delta_pp: -7, p_value: 0.03 },
  });
  assert.notStrictEqual(v, VERDICT.ELEVATE, `negative delta must NOT be ELEVATE, got ${v}`);
  assert.ok(v === VERDICT.NO_LIFT || v === VERDICT.DIRECTIONAL_NOT_REPLICATED,
    `negative delta should be NO-LIFT or DIRECTIONAL-NOT-REPLICATED, got ${v}`);
});

test('verdict: replicated negative delta yields NO-LIFT, never ELEVATE', () => {
  // Both primary and replication are negative (but meet |delta_pp|>=5)
  // Under the OLD Math.abs logic this would ELEVATE; under the fix it must NOT.
  const v = verdict({
    primary: { delta_pp: -10, p_value: 0.001 },
    replication: { delta_pp: -8, p_value: 0.02 },
  });
  assert.notStrictEqual(v, VERDICT.ELEVATE, `replicated negative delta must NOT be ELEVATE, got ${v}`);
  assert.strictEqual(v, VERDICT.NO_LIFT, `replicated negative delta should be NO-LIFT, got ${v}`);
});

test('verdict: positive primary with negative replication yields DIRECTIONAL-NOT-REPLICATED', () => {
  const v = verdict({
    primary: { delta_pp: 9, p_value: 0.01 },
    replication: { delta_pp: -7, p_value: 0.03 },
  });
  assert.notStrictEqual(v, VERDICT.ELEVATE, `opposite-direction replication must NOT be ELEVATE, got ${v}`);
  assert.strictEqual(v, VERDICT.DIRECTIONAL_NOT_REPLICATED, `should be DIRECTIONAL-NOT-REPLICATED, got ${v}`);
});

test('verdict: positive primary with below-threshold replication yields DIRECTIONAL-NOT-REPLICATED', () => {
  const v = verdict({
    primary: { delta_pp: 9, p_value: 0.01 },
    replication: { delta_pp: 3, p_value: 0.01 },
  });
  assert.notStrictEqual(v, VERDICT.ELEVATE, `below-threshold replication must NOT be ELEVATE, got ${v}`);
  assert.strictEqual(v, VERDICT.DIRECTIONAL_NOT_REPLICATED, `should be DIRECTIONAL-NOT-REPLICATED, got ${v}`);
});

test('verdict: replication p-value >= 0.05 yields DIRECTIONAL-NOT-REPLICATED', () => {
  const v = verdict({
    primary: { delta_pp: 9, p_value: 0.01 },
    replication: { delta_pp: 9, p_value: 0.06 },
  });
  assert.notStrictEqual(v, VERDICT.ELEVATE, `non-significant replication must NOT be ELEVATE, got ${v}`);
  assert.strictEqual(v, VERDICT.DIRECTIONAL_NOT_REPLICATED, `should be DIRECTIONAL-NOT-REPLICATED, got ${v}`);
});

test('verdict: accepts p field as alias for p_value', () => {
  const v = verdict({
    primary: { delta_pp: 9, p: 0.01 },
    replication: { delta_pp: 7, p: 0.03 },
  });
  assert.strictEqual(v, VERDICT.ELEVATE, `p alias should work, got ${v}`);
});

// --- parseResultsFile: pretty-JSON support ---

test('parseResultsFile: handles pretty-printed JSON with delta_pp/mcnemar_p/significant', () => {
  // Use a real objective-runner result file to test pretty-JSON parsing
  const realFile = path.join(__dirname, '..', 'results', 'run1', 'swe-five-whys-plus-improved.json');
  assert.ok(fs.existsSync(realFile), 'test fixture file must exist');
  const result = parseResultsFile(realFile);
  assert.ok(result !== null, 'should parse pretty-JSON');
  assert.strictEqual(result.delta_pp, 3.3, 'delta_pp should be 3.3');
  assert.strictEqual(result.p_value, 0.131, 'p_value should be 0.131 (from mcnemar_p)');
  assert.strictEqual(result.n, 150, 'n should be 150');
});

test('aggregateJsonlRows: averages pre-aggregated delta_pp rows', () => {
  const agg = aggregateJsonlRows([
    { delta_pp: 10, p_value: 0.01, n: 20 },
    { delta_pp: 6, p_value: 0.02, n: 20 },
  ]);
  assert.ok(Math.abs(agg.delta_pp - 8) < 1e-9);
  assert.strictEqual(agg.p_value, 0.02); // max p (conservative)
  assert.strictEqual(agg.n, 40);
  assert.strictEqual(agg.failures, 0);
});

test('aggregateJsonlRows: paired binary observations produce risk-diff pp', () => {
  const rows = [
    { skill_correct: true, placebo_correct: false, item_id: '1' },
    { skill_correct: true, placebo_correct: false, item_id: '2' },
    { skill_correct: true, placebo_correct: true, item_id: '3' },
    { skill_correct: false, placebo_correct: false, item_id: '4' },
  ];
  const agg = aggregateJsonlRows(rows);
  // mean RD = (1+1+0+0)/4 = 0.5 → 50pp
  assert.ok(Math.abs(agg.delta_pp - 50) < 1e-6, `expected 50pp, got ${agg.delta_pp}`);
  assert.strictEqual(agg.n, 4);
  assert.strictEqual(agg.aggregation, 'paired_binary');
  assert.ok(typeof agg.p_value === 'number');
});

test('parseResultsFile: JSONL paired binary aggregation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repl-'));
  const file = path.join(dir, 'rows.jsonl');
  const lines = [
    JSON.stringify({ treatment: 1, control: 0, item_id: 'a' }),
    JSON.stringify({ treatment: 1, control: 0, item_id: 'b' }),
    JSON.stringify({ treatment: 1, control: 0, item_id: 'c' }),
    JSON.stringify({ treatment: 0, control: 0, item_id: 'd' }),
  ];
  fs.writeFileSync(file, lines.join('\n'));
  const result = parseResultsFile(file);
  assert.ok(result);
  assert.ok(result.delta_pp > 0);
  assert.strictEqual(result.n, 4);
  assert.strictEqual(result.failures, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseResultsFile: counts unparseable paired fields as failures without dropping attempted rows from report', () => {
  const agg = aggregateJsonlRows([
    { treatment: 1, control: 0 },
    { treatment: 'x', control: 0 }, // failure
    { skill_correct: true, placebo_correct: false },
  ]);
  assert.strictEqual(agg.failures, 1);
  assert.strictEqual(agg.n, 2);
});
