'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  eligibleLocalizationItems,
  freezeDisjointSplits,
  analyzeObjectiveEnvelope,
  evaluateCandidateGate,
} = require('../lib/scientific-method-experiment');
const {
  applyIttParseHealthPolicy,
  assertStudyRuntime,
  createCallBudget,
  extractFocusedSplits,
  resolveFocusedCandidate,
  mergeObjectiveEnvelopes,
  ineligibleHealthReason,
  resolveDatasetPath,
  resolveStudyVersion,
} = require('../lib/scientific-method-runner');

function item(id, repo, prompt, gold = [`src/${id}.js`]) {
  return { id, repo, prompt, gold_files: gold, mode: 'swe-localize' };
}

test('eligibleLocalizationItems removes leaked and invalid localization items', () => {
  const rows = [
    item('hard', 'org/a', 'A subtle behavior changed after an upgrade.'),
    item('leaked', 'org/a', 'The trace points to src/leaked.js.'),
    item('missing', 'org/a', 'No gold file.', []),
    { id: 'binary', prompt: 'Yes or no?', label: true, mode: 'boolean' },
  ];

  assert.deepEqual(
    eligibleLocalizationItems(rows).map((row) => row.id),
    ['hard'],
  );
});

test('freezeDisjointSplits is deterministic, exact, and non-overlapping', () => {
  const rows = Array.from({ length: 240 }, (_, i) => (
    item(`i${i}`, `org/repo-${i % 12}`, `Ambiguous defect report number ${i}.`)
  ));

  const first = freezeDisjointSplits(rows, {
    seed: 'scientific-method-vnext',
    sizes: { calibration: 10, pilot: 30, confirmation: 100, replication: 100 },
  });
  const second = freezeDisjointSplits(rows, {
    seed: 'scientific-method-vnext',
    sizes: { calibration: 10, pilot: 30, confirmation: 100, replication: 100 },
  });

  assert.deepEqual(first, second);
  assert.equal(first.calibration.length, 10);
  assert.equal(first.pilot.length, 30);
  assert.equal(first.confirmation.length, 100);
  assert.equal(first.replication.length, 100);
  assert.equal(new Set(Object.values(first).flat()).size, 240);
});

test('freezeDisjointSplits fails when eligible data cannot satisfy the design', () => {
  const rows = Array.from({ length: 20 }, (_, i) => (
    item(`i${i}`, 'org/repo', `Ambiguous defect report number ${i}.`)
  ));
  assert.throws(
    () => freezeDisjointSplits(rows, {
      seed: 'x',
      sizes: { pilot: 30, confirmation: 100, replication: 100 },
    }),
    /requires 230 eligible items, found 20/,
  );
});

test('freezeDisjointSplits excludes previously observed item IDs', () => {
  const rows = Array.from({ length: 30 }, (_, i) => (
    item(`i${i}`, 'org/repo', `Ambiguous defect report number ${i}.`)
  ));
  const splits = freezeDisjointSplits(rows, {
    seed: 'fresh',
    sizes: { calibration: 5, pilot: 5 },
    excludeIds: Array.from({ length: 20 }, (_, i) => `i${i}`),
  });
  assert.equal(splits.calibration.length, 5);
  assert.equal(splits.pilot.length, 5);
  assert.equal(
    Object.values(splits).flat().some((id) => Number(id.slice(1)) < 20),
    false,
  );
});

test('analysis reports paired contrasts, Holm p-values, and median usage', () => {
  const items = [];
  const outcomes = [
    { none: false, lean: true, candidate: true },
    { none: false, lean: false, candidate: true },
    { none: true, lean: true, candidate: true },
    { none: true, lean: false, candidate: false },
  ];
  for (let i = 0; i < outcomes.length; i++) {
    for (const arm of ['none', 'lean', 'candidate']) {
      items.push({
        item_id: `i${i}`,
        trial: 1,
        arm_id: arm,
        correct: outcomes[i][arm],
        scored: true,
        usage: {
          input_tokens: arm === 'candidate' ? 12 : 10,
          output_tokens: arm === 'candidate' ? 3 : 4,
          cached_tokens: 0,
          cache_creation_tokens: 0,
          total_tokens: arm === 'candidate' ? 15 : 14,
          estimated_cost_usd: 0.001,
        },
      });
    }
  }

  const analysis = analyzeObjectiveEnvelope(
    { items, health: { decision_eligible: true } },
    { controlArm: 'none', leanArm: 'lean', candidateArms: ['candidate'] },
  );

  assert.equal(analysis.usage_by_arm.candidate.median_total_tokens, 15);
  assert.equal(analysis.candidates.candidate.vs_none.delta_pp, 25);
  assert.equal(typeof analysis.candidates.candidate.vs_none.p_adjusted, 'number');
});

test('candidate gate enforces stage sample, lift, significance, and token limits', () => {
  const passing = {
    health: { decision_eligible: true },
    usage_by_arm: {
      lean: { median_total_tokens: 100 },
      candidate: { median_total_tokens: 95 },
    },
    candidates: {
      candidate: {
        vs_none: { n: 100, delta_pp: 6, p_adjusted: 0.04 },
        vs_lean: { delta_pp: 1 },
      },
    },
  };

  assert.equal(
    evaluateCandidateGate(passing, 'candidate', { stage: 'confirmation' }).pass,
    true,
  );
  assert.equal(
    evaluateCandidateGate({
      ...passing,
      usage_by_arm: {
        lean: { median_total_tokens: 100 },
        candidate: { median_total_tokens: 101 },
      },
    }, 'candidate', { stage: 'confirmation' }).pass,
    false,
  );
});

test('call budget reserves calls and stops before exceeding hard caps', () => {
  const budget = createCallBudget({ maxCalls: 2, maxEstimatedCostUsd: 0.05 });
  budget.reserve();
  budget.record({ calls: 1, estimated_cost_usd: 0.01 });
  budget.reserve();
  budget.record({ calls: 1, estimated_cost_usd: 0.04 });
  assert.throws(() => budget.reserve(), /call cap/);
  assert.equal(budget.snapshot().calls, 2);
  assert.equal(budget.snapshot().estimated_cost_usd, 0.05);

  const retryBudget = createCallBudget({ maxCalls: 3, maxEstimatedCostUsd: 1 });
  retryBudget.reserve(2);
  assert.throws(() => retryBudget.reserve(2), /call cap/);
  retryBudget.record({ calls: 1, estimated_cost_usd: 0.01 }, 2);
  retryBudget.reserve(2);
  assert.equal(retryBudget.snapshot().reserved_calls, 2);
  retryBudget.release(2);
  retryBudget.reserve(2);
  retryBudget.record({ calls: 2, estimated_cost_usd: 0.01 }, 2);
  assert.throws(() => retryBudget.reserve(2), /call cap/);
});

test('resolveStudyVersion requires an explicit positive version string', () => {
  assert.equal(resolveStudyVersion({ SCI_STUDY_VERSION: '2' }), '2');
  assert.equal(resolveStudyVersion({}), '1');
  assert.throws(() => resolveStudyVersion({ SCI_STUDY_VERSION: '0' }), /positive integer/);
});

test('resolveDatasetPath accepts an explicit isolated dataset path', () => {
  assert.equal(
    resolveDatasetPath({ SCI_DATASET_PATH: './harder.jsonl' }, '/tmp/default.jsonl', '/tmp/repo'),
    path.join('/tmp/repo', 'harder.jsonl'),
  );
  assert.equal(resolveDatasetPath({}, '/tmp/default.jsonl', '/tmp/repo'), '/tmp/default.jsonl');
});

test('mergeObjectiveEnvelopes preserves every attempted row and aggregates usage', () => {
  const base = {
    schema_version: 1,
    study_id: 'study',
    study_version: '1',
    preregistration_sha256: 'p'.repeat(64),
    dataset: { source: 'fixture', version: '1', split: 'pilot', sha256: 'd'.repeat(64) },
    arms: [{ id: 'none', prompt_sha256: 'a'.repeat(64), skill_sha256: null }],
    solver: { model: 'fixture' },
    judges: [],
    failures: [],
    statistics: {},
    health: { attempted: 1, completed: 1, parsed: 1, scored: 1, failures: 0, decision_eligible: true },
    created_at: '2026-07-17T00:00:00.000Z',
    checkpoint_key: 'c'.repeat(64),
  };
  const merged = mergeObjectiveEnvelopes([
    {
      ...base,
      items: [{ item_id: 'i1', arm_id: 'none', scored: true, correct: true }],
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cached_tokens: 0,
        cache_creation_tokens: 0,
        total_tokens: 12,
        calls: 1,
        latency_ms: 5,
        estimated_cost_usd: 0.01,
      },
    },
    {
      ...base,
      items: [{ item_id: 'i2', arm_id: 'none', scored: true, correct: false }],
      usage: {
        input_tokens: 11,
        output_tokens: 3,
        cached_tokens: 0,
        cache_creation_tokens: 0,
        total_tokens: 14,
        calls: 1,
        latency_ms: 6,
        estimated_cost_usd: 0.02,
      },
    },
  ]);
  assert.equal(merged.items.length, 2);
  assert.equal(merged.health.attempted, 2);
  assert.equal(merged.statistics.per_arm.none.accuracy, 0.5);
  assert.equal(merged.usage.total_tokens, 26);
  assert.equal(merged.usage.estimated_cost_usd, 0.03);
});

test('ineligibleHealthReason stops a stage after an incomplete item envelope', () => {
  assert.equal(
    ineligibleHealthReason('pilot', { health: { decision_eligible: false, failures: 1 } }),
    'pilot stopped after an item envelope became decision-ineligible (1 failure)',
  );
  assert.equal(
    ineligibleHealthReason('pilot', { health: { decision_eligible: true, failures: 0 } }),
    null,
  );
});

test('ITT parse health keeps strict parse failures incorrect but decision-eligible', () => {
  const envelope = {
    health: {
      attempted: 3,
      completed: 3,
      parsed: 2,
      scored: 2,
      failures: 1,
      decision_eligible: false,
    },
    failures: [{ type: 'parse' }],
  };
  const updated = applyIttParseHealthPolicy(envelope);
  assert.equal(updated.health.decision_eligible, true);
  assert.equal(updated.health.failures, 1);
  assert.equal(envelope.health.decision_eligible, false);
  assert.equal(
    applyIttParseHealthPolicy({
      ...envelope,
      failures: [{ type: 'transport' }],
    }).health.decision_eligible,
    false,
  );
});

test('focused confirmation runtime is pinned to the manifest', () => {
  assert.equal(
    resolveFocusedCandidate({ SCI_FOCUSED_CANDIDATE: 'candidate-02' }),
    'candidate-02',
  );
  assert.equal(resolveFocusedCandidate({}), null);
  assert.throws(
    () => resolveFocusedCandidate({ SCI_FOCUSED_CANDIDATE: '../candidate-02' }),
    /invalid focused candidate/,
  );
  assert.doesNotThrow(() => assertStudyRuntime(
    {
      study_version: '6',
      focused_candidate: 'candidate-02',
      health_policy: { parse_failures_are_itt_incorrect: true },
      current_lean: { sha256: 'lean-sha' },
      variants: [{ id: 'candidate-02', sha256: 'candidate-sha' }],
    },
    {
      studyVersion: '6',
      focusedCandidate: 'candidate-02',
      allowParseFailures: true,
      leanSha256: 'lean-sha',
      candidateSha256: 'candidate-sha',
    },
  ));
  assert.throws(
    () => assertStudyRuntime(
      { study_version: '5' },
      { studyVersion: '6' },
    ),
    /study version mismatch/,
  );
  assert.throws(
    () => assertStudyRuntime(
      {
        study_version: '6',
        focused_candidate: 'candidate-02',
        health_policy: { parse_failures_are_itt_incorrect: true },
        current_lean: { sha256: 'lean-sha' },
        variants: [{ id: 'candidate-02', sha256: 'candidate-sha' }],
      },
      {
        studyVersion: '6',
        focusedCandidate: 'candidate-02',
        allowParseFailures: true,
        leanSha256: 'changed',
        candidateSha256: 'candidate-sha',
      },
    ),
    /lean skill hash mismatch/,
  );
});

test('focused confirmation inherits untouched confirmation and replication splits', () => {
  const source = {
    splits: {
      pilot: { count: 1, ids: ['seen'] },
      confirmation: { count: 2, ids: ['c1', 'c2'], ids_sha256: 'c' },
      replication: { count: 2, ids: ['r1', 'r2'], ids_sha256: 'r' },
    },
  };
  assert.deepEqual(
    extractFocusedSplits(source, { confirmation: 2, replication: 2 }),
    {
      confirmation: source.splits.confirmation,
      replication: source.splits.replication,
    },
  );
  assert.throws(
    () => extractFocusedSplits(source, { confirmation: 3, replication: 2 }),
    /confirmation split requires 3 items, found 2/,
  );
});

test('scientific-method experiment CLI exposes staged commands', () => {
  const script = path.join(__dirname, '..', 'run-scientific-method-experiment.js');
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /prepare/);
  assert.match(result.stdout, /calibration/);
  assert.match(result.stdout, /pilot/);
  assert.match(result.stdout, /confirmation/);
  assert.match(result.stdout, /replication/);
});
