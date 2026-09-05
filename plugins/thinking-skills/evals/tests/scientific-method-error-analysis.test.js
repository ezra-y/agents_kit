'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  buildBlindAuditCases,
  outcomeClass,
  pathRelation,
  summarizeAdjudicatedLabels,
  validateCoderLabels,
} = require('../lib/scientific-method-error-analysis');

test('outcomeClass names all three-arm correctness signatures', () => {
  assert.equal(outcomeClass({ none: true, lean: false, 'candidate-02': false }), 'shared_skill_harm');
  assert.equal(outcomeClass({ none: false, lean: true, 'candidate-02': true }), 'shared_skill_benefit');
  assert.equal(outcomeClass({ none: true, lean: true, 'candidate-02': false }), 'candidate_specific_harm');
  assert.equal(outcomeClass({ none: false, lean: false, 'candidate-02': true }), 'candidate_specific_benefit');
  assert.equal(outcomeClass({ none: false, lean: false, 'candidate-02': false }), 'all_wrong');
});

test('pathRelation distinguishes adjacent paths from unrelated guesses', () => {
  const gold = ['src/auth/session.js', 'src/auth/token.js'];
  assert.equal(pathRelation('src/auth/session.js', gold), 'correct');
  assert.equal(pathRelation('lib/auth/session.js', gold), 'same_basename_wrong_directory');
  assert.equal(pathRelation('src/auth/cookies.js', gold), 'shared_owner_directory');
  assert.equal(pathRelation('src/payments/card.js', gold), 'same_extension_only');
  assert.equal(pathRelation(null, gold), 'missing');
});

test('buildBlindAuditCases excludes all-correct cases and masks arm identity', () => {
  const envelope = {
    items: [
      { item_id: 'i1', arm_id: 'none', correct: true, parsed: 'a.js', archive_uri: 'none' },
      { item_id: 'i1', arm_id: 'lean', correct: false, parsed: 'b.js', archive_uri: 'lean' },
      { item_id: 'i1', arm_id: 'candidate-02', correct: false, parsed: 'c.js', archive_uri: 'candidate' },
      { item_id: 'i2', arm_id: 'none', correct: true, parsed: 'a.js', archive_uri: 'none2' },
      { item_id: 'i2', arm_id: 'lean', correct: true, parsed: 'a.js', archive_uri: 'lean2' },
      { item_id: 'i2', arm_id: 'candidate-02', correct: true, parsed: 'a.js', archive_uri: 'candidate2' },
      { item_id: 'i3', arm_id: 'none', correct: true, parsed: 'a.js', archive_uri: 'none3' },
      { item_id: 'i3', arm_id: 'lean', correct: false, parsed: 'b.js', archive_uri: 'lean3' },
      { item_id: 'i3', arm_id: 'candidate-02', correct: true, parsed: 'a.js', archive_uri: 'candidate3' },
    ],
  };
  const dataset = [
    { id: 'i1', prompt: 'Issue one', gold_files: ['a.js'], repo_language: 'js' },
    { id: 'i2', prompt: 'Issue two', gold_files: ['a.js'], repo_language: 'js' },
    { id: 'i3', prompt: 'Issue three', gold_files: ['a.js'], repo_language: 'js' },
  ];
  const result = buildBlindAuditCases(envelope, dataset, {
    rawLoader: (uri) => `reasoning:${uri}`,
  });
  assert.equal(result.cases.length, 2);
  assert.deepEqual(result.cases[0].responses.map((row) => row.label).sort(), ['A', 'B', 'C']);
  assert.equal(result.cases[0].responses.some((row) => row.arm_id), false);
  assert.equal(result.blind_key.i1.outcome_class, 'shared_skill_harm');
  assert.equal(result.blind_key.i3.outcome_class, 'lean_specific_harm');
  assert.equal(new Set(Object.values(result.blind_key.i1.arm_labels)).size, 3);
});

test('coder labels require complete fixed-taxonomy coverage and summarize mechanisms', () => {
  const cases = [{ case_id: 'i1' }, { case_id: 'i2' }];
  const labels = [
    {
      case_id: 'i1',
      primary_cause: 'instruction_overconstraint',
      fixability: 'skill_instruction',
      intervention: 'clue_first_fast_path',
      confidence: 'high',
      evidence: 'The structured response discarded the explicit owner clue.',
    },
    {
      case_id: 'i2',
      primary_cause: 'insufficient_repository_context',
      fixability: 'prompt_context',
      intervention: 'provide_repository_map',
      confidence: 'medium',
      evidence: 'The issue does not distinguish several plausible owners.',
    },
  ];
  assert.doesNotThrow(() => validateCoderLabels(cases, labels));
  assert.throws(
    () => validateCoderLabels(cases, labels.slice(0, 1)),
    /label coverage mismatch/,
  );
  const summary = summarizeAdjudicatedLabels(labels);
  assert.deepEqual(summary.primary_cause, {
    instruction_overconstraint: 1,
    insufficient_repository_context: 1,
  });
  assert.equal(summary.fixability.skill_instruction, 1);
  assert.equal(summary.intervention.provide_repository_map, 1);
});

test('scientific-method error analysis CLI exposes generate and summarize commands', () => {
  const cli = path.join(__dirname, '..', 'run-scientific-method-error-analysis.js');
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /generate/);
  assert.match(result.stdout, /summarize/);
});
