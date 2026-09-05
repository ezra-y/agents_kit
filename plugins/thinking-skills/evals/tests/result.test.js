'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stableStringify,
  sha256,
  itemKey,
  checkpointKey,
  observationCheckpointKey,
  failureRecord,
  createResultEnvelope,
  validateResultEnvelope,
} = require('../lib/result');

function baseSpec() {
  return {
    study_id: 'study-1',
    study_version: '1',
    preregistration_sha256: 'a'.repeat(64),
    dataset: { source: 'fixture', version: '1', split: 'heldout', sha256: 'b'.repeat(64) },
    arms: [{ id: 'none', prompt_sha256: 'c'.repeat(64), skill_sha256: null }],
    solver: { model: 'fixture-model', effort: 'low' },
    judges: [],
    items: [{ item_id: 'one', parsed_success: true, scored: true }],
    failures: [],
    created_at: '2026-07-17T00:00:00.000Z',
  };
}

test('stable serialization and hashing ignore object key order', () => {
  assert.equal(stableStringify({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));
});

test('item identity includes study item trial and arm', () => {
  assert.equal(itemKey({ studyId: 's', itemId: 'i', trial: 2, armId: 'lean' }), 's:i:2:lean');
  assert.throws(() => itemKey({ studyId: 's', itemId: 'i', trial: 0, armId: 'lean' }), /positive integer/);
});

test('checkpoint changes for every compatibility input', () => {
  const spec = { studyId: 's', studyVersion: '1', datasetSha256: 'd', promptSha256: 'p', skillSha256: 'k', solver: 'm', judges: ['j2', 'j1'] };
  const key = checkpointKey(spec);
  assert.equal(key, checkpointKey({ ...spec, judges: ['j1', 'j2'] }));
  for (const [field, value] of [['studyVersion', '2'], ['datasetSha256', 'x'], ['promptSha256', 'x'], ['skillSha256', 'x'], ['solver', 'x']]) {
    assert.notEqual(key, checkpointKey({ ...spec, [field]: value }));
  }
});

test('observation checkpoint binds item trial and arm to compatibility', () => {
  const compatibilityKey = checkpointKey({
    studyId: 's',
    studyVersion: '1',
    datasetSha256: 'd',
    promptSha256: 'p',
    skillSha256: 'k',
    solver: 'm',
    judges: [],
  });
  const spec = { compatibilityKey, itemId: 'i', trial: 1, armId: 'lean' };
  const key = observationCheckpointKey(spec);
  assert.notEqual(key, observationCheckpointKey({ ...spec, itemId: 'j' }));
  assert.notEqual(key, observationCheckpointKey({ ...spec, trial: 2 }));
  assert.notEqual(key, observationCheckpointKey({ ...spec, armId: 'none' }));
  assert.notEqual(key, observationCheckpointKey({ ...spec, compatibilityKey: 'x' }));
});

test('failure records reject unknown classes', () => {
  assert.equal(failureRecord({ type: 'parse', message: 'bad json', itemId: 'i' }).type, 'parse');
  assert.throws(() => failureRecord({ type: 'mystery' }), /unsupported/);
});

test('result envelope derives complete health and validates', () => {
  const envelope = createResultEnvelope(baseSpec());
  assert.equal(envelope.health.attempted, 1);
  assert.equal(envelope.health.scored, 1);
  assert.equal(envelope.health.parsed, 1);
  assert.equal(envelope.health.decision_eligible, true);
  assert.equal(validateResultEnvelope(envelope).ok, true);
});

test('unscored or failed attempts remain ineligible', () => {
  const spec = baseSpec();
  spec.items = [{ item_id: 'one', parsed_success: false, scored: false }];
  spec.failures = [failureRecord({ type: 'scoring', message: 'no label', itemId: 'one' })];
  const envelope = createResultEnvelope(spec);
  assert.equal(envelope.health.attempted, 1);
  assert.equal(envelope.health.scored, 0);
  assert.equal(envelope.health.failures, 1);
  assert.equal(envelope.health.decision_eligible, false);
});

test('validator rejects internally impossible health', () => {
  const envelope = createResultEnvelope(baseSpec());
  envelope.health.scored = 2;
  const result = validateResultEnvelope(envelope);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /scored cannot exceed parsed/);
});
