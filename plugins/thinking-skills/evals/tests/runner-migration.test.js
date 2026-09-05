'use strict';

/**
 * Contract tests for Phase 6 runner migration.
 * Exercise the canonical objective/pairwise engines (not temporary wrappers).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runObjectiveItems,
  summarizePairedArms,
  scoreBoolean,
  scoreMultipleChoice,
  scoreAbstention,
  scoreNumericOrderOfMagnitude,
  scoreProbabilityBrier,
  scoreFileLocalization,
  extractYesNo,
  pairedContrast,
} = require('../lib/objective');
const { runPairwiseItems, summarizePairwise } = require('../lib/pairwise');
const { balancedAcc } = require('../lib/stats');
const { validateResultEnvelope } = require('../lib/result');

function baseDataset(ids) {
  return {
    source: 'fixture',
    version: '0',
    split: 'fixture',
    sha256: 'a'.repeat(64),
    item_ids: ids,
  };
}

test('objective boolean fixture yields valid envelope and paired summary', async () => {
  const items = [
    {
      id: 'b1',
      prompt: 'Is 2 even?',
      gold: true,
      answer_instruction: 'End your response with exactly: ANSWER: <Yes or No>',
      fixture_responses: {
        skill: 'ANSWER: Yes',
        placebo: 'ANSWER: No',
      },
    },
    {
      id: 'b2',
      prompt: 'Is 3 even?',
      gold: false,
      answer_instruction: 'End your response with exactly: ANSWER: <Yes or No>',
      fixture_responses: {
        skill: 'ANSWER: No',
        placebo: 'ANSWER: No',
      },
    },
  ];
  const envelope = await runObjectiveItems({
    studyId: 'mig-boolean',
    studyVersion: '1',
    preregistrationSha256: 'b'.repeat(64),
    dataset: baseDataset(['b1', 'b2']),
    arms: [
      { id: 'skill', condition: 'skill', skillContent: 'Be careful.' },
      { id: 'placebo', condition: 'equal_budget_placebo', skillContent: 'Be careful.' },
    ],
    solver: { model: 'fixture-model' },
    items,
    trials: 1,
    scorer: 'boolean',
    fixtureMode: true,
  });
  const v = validateResultEnvelope(envelope);
  assert.equal(v.ok, true, v.errors && v.errors.join('; '));
  assert.equal(envelope.health.attempted, 4);
  assert.equal(envelope.health.scored, 4);
  const summary = summarizePairedArms(envelope, 'skill', 'placebo');
  assert.equal(summary.n, 2);
  assert.equal(summary.acc_with_skill, 1);
  assert.equal(summary.acc_placebo, 0.5);
  assert.equal(summary.left_wins, 1);
  assert.equal(summary.right_wins, 0);
  assert.equal(summary.discordant, 1);
});

test('objective multiple-choice and abstention scorers match former specialized modes', () => {
  assert.equal(scoreMultipleChoice('ANSWER: C', 'C').correct, true);
  assert.equal(scoreMultipleChoice('ANSWER: A', 'C').correct, false);
  assert.equal(scoreAbstention('ANSWER: UNANSWERABLE', { answerable: false }).correct, true);
  assert.equal(scoreAbstention('ANSWER: 42', { answerable: true }).correct, true);
  assert.equal(scoreAbstention('ANSWER: UNANSWERABLE', { answerable: true }).correct, false);
});

test('objective numeric and probability scorers match former run-numeric modes', () => {
  assert.equal(scoreNumericOrderOfMagnitude('ANSWER: 1e3', 1000).correct, true);
  assert.equal(scoreNumericOrderOfMagnitude('ANSWER: 1e6', 1000, { tolerance: 1 }).correct, false);
  const brier = scoreProbabilityBrier('ANSWER: 0.8', 1);
  assert.equal(brier.correct, true);
  assert.ok(typeof brier.value.brier === 'number');
});

test('file localization scorer requires strict terminal ANSWER path', () => {
  const inv = ['src/foo.py', 'src/bar.py'];
  assert.equal(
    scoreFileLocalization('Reasoning.\nANSWER: src/foo.py', ['src/foo.py'], { inventory: inv }).correct,
    true
  );
  // basename-only mention is rejected under the strict generic scorer
  assert.equal(
    scoreFileLocalization('I think foo.py is broken.', ['src/foo.py'], { inventory: inv }).scored,
    false
  );
});

test('balanced accuracy nulls are never true negatives (routing-data contract)', () => {
  const rows = [
    { label: true, skill_yes: true },
    { label: true, skill_yes: null },
    { label: false, skill_yes: false },
    { label: false, skill_yes: null },
  ];
  assert.equal(balancedAcc(rows, 'skill_yes'), 0.5);
});

test('pairwise fixture engine produces typed envelope for former behavioral surface', async () => {
  const envelope = await runPairwiseItems({
    studyId: 'mig-pairwise',
    studyVersion: '1',
    preregistrationSha256: 'c'.repeat(64),
    dataset: baseDataset(['p1']),
    arms: [
      { id: 'skill', prompt_sha256: 'd'.repeat(64), skill_sha256: 'e'.repeat(64) },
      { id: 'placebo', prompt_sha256: 'f'.repeat(64), skill_sha256: null },
    ],
    pair: { left: 'skill', right: 'placebo' },
    solver: { model: 'fixture-model' },
    judges: ['gpt-5.5-pro', 'gemini-3.1-pro-preview', 'deepseek-v4-pro'],
    items: [{
      id: 'p1',
      prompt: 'Should we pause the rollout?',
      fixture_responses: {
        skill: 'Long careful analysis with tradeoffs.',
        placebo: 'Ship it.',
      },
    }],
    trials: 1,
    seed: 7,
    solve: async ({ item, armId }) => ({
      ok: true,
      text: item.fixture_responses[armId],
      usage: { calls: 0 },
    }),
    judge: async () => ({
      winner: 'A',
      resolved: true,
      unresolved: false,
      failure: null,
      tally: { A: 3, B: 0, tie: 0, missing: 0 },
      votes: [
        { model: 'gpt-5.5-pro', winner: 'A', valid: true },
        { model: 'gemini-3.1-pro-preview', winner: 'A', valid: true },
        { model: 'deepseek-v4-pro', winner: 'A', valid: true },
      ],
      failures: [],
      vocab_only: false,
      whys: ['fixture'],
      judge_usage: [],
      judge_durationMs: 0,
    }),
  });
  const v = validateResultEnvelope(envelope);
  assert.equal(v.ok, true, v.errors && v.errors.join('; '));
  const stats = summarizePairwise(envelope.items, { left: 'skill', right: 'placebo' });
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 0);
});

test('extractYesNo and pairedContrast remain shared pure helpers', () => {
  assert.equal(extractYesNo('{ "answer": true }'), true);
  assert.equal(extractYesNo('Return { "answer": true | false }'), null);
  const contrast = pairedContrast(
    [
      { by_arm: { a: { case_success: true }, b: { case_success: false } } },
      { by_arm: { a: { case_success: false }, b: { case_success: false } } },
    ],
    'a',
    'b'
  );
  assert.equal(contrast.left_wins, 1);
  assert.equal(contrast.right_wins, 0);
});

test('mixed-skill objective groups remain independent via separate engine runs', async () => {
  // Former run-correctness mixed skill_fit behavior: run each skill group separately.
  async function runGroup(skill, items) {
    return runObjectiveItems({
      studyId: `mig-mixed:${skill}`,
      studyVersion: '1',
      preregistrationSha256: 'g'.repeat(64),
      dataset: baseDataset(items.map((i) => i.id)),
      arms: [
        { id: 'skill', condition: 'skill', skillContent: `BODY ${skill}`, skillName: skill },
        { id: 'placebo', condition: 'equal_budget_placebo', skillContent: `BODY ${skill}`, skillName: skill },
      ],
      solver: { model: 'fixture-model' },
      items,
      trials: 1,
      scorer: 'boolean',
      fixtureMode: true,
    });
  }
  const envA = await runGroup('red-team', [{
    id: 'a1',
    prompt: 'vuln?',
    gold: true,
    answer_instruction: 'End your response with exactly: ANSWER: <Yes or No>',
    fixture_responses: { skill: 'ANSWER: Yes', placebo: 'ANSWER: No' },
  }]);
  const envB = await runGroup('socratic', [{
    id: 'b1',
    prompt: 'clarify?',
    gold: true,
    answer_instruction: 'End your response with exactly: ANSWER: <Yes or No>',
    fixture_responses: { skill: 'ANSWER: Yes', placebo: 'ANSWER: Yes' },
  }]);
  assert.equal(envA.arms[0].skill_sha256 !== envB.arms[0].skill_sha256, true);
  const merged = { items: [...envA.items, ...envB.items] };
  const summary = summarizePairedArms(merged, 'skill', 'placebo');
  assert.equal(summary.n, 2);
  assert.equal(summary.acc_with_skill, 1);
  assert.equal(summary.acc_placebo, 0.5);
});
