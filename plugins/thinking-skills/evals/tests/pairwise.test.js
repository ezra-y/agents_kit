'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deterministicArmOrder,
  runPairwiseItems,
  summarizePairwise,
  normalizePanelResult,
} = require('../lib/pairwise');
const {
  validateResultEnvelope,
  observationCheckpointKey,
  checkpointKey,
  sha256,
} = require('../lib/result');

const JUDGES = ['gpt-5.5-pro', 'gemini-3.1-pro-preview', 'deepseek-v4-pro'];

function baseSpec(overrides = {}) {
  return {
    studyId: 'pairwise-study',
    studyVersion: '1',
    preregistrationSha256: 'p'.repeat(64),
    dataset: {
      source: 'fixture',
      version: '1',
      split: 'heldout',
      sha256: 'd'.repeat(64),
    },
    arms: [
      { id: 'lean', prompt_sha256: 'a'.repeat(64), skill_sha256: 'b'.repeat(64) },
      { id: 'none', prompt_sha256: 'c'.repeat(64), skill_sha256: null },
    ],
    pair: { left: 'lean', right: 'none' },
    solver: { model: 'claude-sonnet-4-6', effort: 'low' },
    judges: JUDGES,
    items: [
      { id: 'i1', prompt: 'Problem one' },
      { id: 'i2', prompt: 'Problem two' },
    ],
    trials: 1,
    seed: 42,
    createdAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

function solveAllOk() {
  return async ({ armId, item }) => ({
    ok: true,
    text: `answer for ${item.id} under ${armId}`,
    usage: { input_tokens: 10, output_tokens: 5, calls: 1, latency_ms: 3 },
    attempts: 1,
  });
}

function judgeWinner(winner, opts = {}) {
  return async (_prompt, judges = JUDGES) => {
    if (opts.unresolved) {
      return {
        winner: null,
        resolved: false,
        unresolved: true,
        failure: { type: 'judge_unresolved', message: 'no majority' },
        tally: { A: 1, B: 1, tie: 0, missing: 1 },
        votes: (judges || JUDGES).map((model, i) => ({
          model,
          winner: i === 0 ? 'A' : i === 1 ? 'B' : null,
          valid: i < 2,
        })),
        failures: [],
        vocab_only: false,
        whys: [],
        judge_usage: [],
        judge_durationMs: 1,
      };
    }
    const w = winner;
    return {
      winner: w,
      resolved: true,
      unresolved: false,
      failure: null,
      tally: {
        A: w === 'A' ? 2 : 0,
        B: w === 'B' ? 2 : 0,
        tie: w === 'tie' ? 2 : 0,
        missing: 0,
      },
      votes: (judges || JUDGES).map(model => ({ model, winner: w, valid: true })),
      failures: [],
      vocab_only: false,
      whys: [`fixture ${w}`],
      judge_usage: [{ input_tokens: 1, output_tokens: 1, est_cost_usd: 0 }],
      judge_durationMs: 2,
    };
  };
}

test('deterministicArmOrder is stable for the same seed/item/trial', () => {
  const a = deterministicArmOrder(['lean', 'none'], { seed: 7, itemId: 'x', trial: 1 });
  const b = deterministicArmOrder(['lean', 'none'], { seed: 7, itemId: 'x', trial: 1 });
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  assert.ok(a.includes('lean') && a.includes('none'));
});

test('deterministicArmOrder changes with seed, item, or trial', () => {
  const base = deterministicArmOrder(['lean', 'none', 'full'], { seed: 1, itemId: 'i', trial: 1 });
  const bySeed = deterministicArmOrder(['lean', 'none', 'full'], { seed: 2, itemId: 'i', trial: 1 });
  const byItem = deterministicArmOrder(['lean', 'none', 'full'], { seed: 1, itemId: 'j', trial: 1 });
  const byTrial = deterministicArmOrder(['lean', 'none', 'full'], { seed: 1, itemId: 'i', trial: 2 });
  // At least one of the knobs must flip order for this 3-arm set (very high probability; assert not all equal).
  const same = (x, y) => x.join('|') === y.join('|');
  assert.equal(same(base, bySeed) && same(base, byItem) && same(base, byTrial), false);
});

test('deterministicArmOrder is independent of input arm array order', () => {
  const a = deterministicArmOrder(['lean', 'none'], { seed: 99, itemId: 'p', trial: 3 });
  const b = deterministicArmOrder(['none', 'lean'], { seed: 99, itemId: 'p', trial: 3 });
  assert.deepEqual(a, b);
});

test('runPairwiseItems produces valid envelope with complete denominators', async () => {
  const envelope = await runPairwiseItems({
    ...baseSpec(),
    solve: solveAllOk(),
    judge: judgeWinner('A'),
  });

  const v = validateResultEnvelope(envelope);
  assert.equal(v.ok, true, v.errors && v.errors.join('; '));
  assert.equal(envelope.schema_version, 1);
  assert.equal(envelope.health.attempted, 2);
  assert.equal(envelope.health.completed, 2);
  assert.equal(envelope.health.parsed, 2);
  assert.equal(envelope.health.scored, 2);
  assert.equal(envelope.health.failures, 0);
  assert.equal(envelope.health.decision_eligible, true);
  assert.equal(envelope.items.length, 2);
  for (const row of envelope.items) {
    assert.equal(row.completed, true);
    assert.equal(row.parsed_success, true);
    assert.equal(row.scored, true);
    assert.ok(row.parsed && row.parsed.winner_arm);
    assert.ok(row.observation_checkpoint_keys.lean);
    assert.ok(row.observation_checkpoint_keys.none);
    assert.ok(row.item_keys.lean.includes('pairwise-study:i'));
  }
  assert.ok(envelope.usage.calls >= 2);
  assert.equal(envelope.statistics.attempted, 2);
  assert.equal(envelope.statistics.wins + envelope.statistics.losses + envelope.statistics.ties, 2);
});

test('fresh independent solve calls per arm and trial', async () => {
  const calls = [];
  const envelope = await runPairwiseItems({
    ...baseSpec({ trials: 2, items: [{ id: 'only', prompt: 'p' }] }),
    solve: async ({ armId, trial, item }) => {
      calls.push(`${item.id}:${trial}:${armId}`);
      return { ok: true, text: `${armId}-${trial}`, usage: { calls: 1 } };
    },
    judge: judgeWinner('B'),
  });
  assert.equal(envelope.health.attempted, 2);
  assert.deepEqual(calls.sort(), [
    'only:1:lean',
    'only:1:none',
    'only:2:lean',
    'only:2:none',
  ].sort());
});

test('solver failures remain in denominators and block scoring', async () => {
  const envelope = await runPairwiseItems({
    ...baseSpec({ items: [{ id: 'i1', prompt: 'p' }] }),
    solve: async ({ armId }) => {
      if (armId === 'none') {
        return {
          ok: false,
          text: null,
          failure: { type: 'timeout', message: 'solver timed out' },
          usage: { calls: 1 },
        };
      }
      return { ok: true, text: 'ok', usage: { calls: 1 } };
    },
    judge: judgeWinner('A'),
  });

  assert.equal(envelope.health.attempted, 1);
  assert.equal(envelope.health.completed, 0);
  assert.equal(envelope.health.parsed, 0);
  assert.equal(envelope.health.scored, 0);
  assert.ok(envelope.health.failures >= 1);
  assert.equal(envelope.health.decision_eligible, false);
  assert.equal(envelope.items[0].scored, false);
  assert.equal(envelope.items[0].parsed_success, false);
  assert.equal(envelope.items[0].completed, false);
  assert.ok(envelope.failures.some(f => f.type === 'timeout'));
  assert.equal(envelope.statistics.unresolved, 1);
});

test('unresolved disagreement keeps parsed_success true and scored false', async () => {
  const envelope = await runPairwiseItems({
    ...baseSpec({ items: [{ id: 'i1', prompt: 'p' }] }),
    solve: solveAllOk(),
    // Two valid A/B votes that disagree → unresolved scoring failure, not parse failure.
    judge: judgeWinner('A', { unresolved: true }),
  });

  assert.equal(envelope.health.attempted, 1);
  assert.equal(envelope.health.completed, 1);
  assert.equal(envelope.health.parsed, 1);
  assert.equal(envelope.health.scored, 0);
  assert.equal(envelope.health.decision_eligible, false);
  assert.equal(envelope.items[0].winner_arm, null);
  assert.equal(envelope.items[0].scored, false);
  assert.equal(envelope.items[0].parsed_success, true);
  assert.ok(envelope.items[0].parsed && envelope.items[0].parsed.unresolved === true);
  assert.ok(envelope.failures.some(f => f.type === 'scoring'));
  assert.equal(envelope.statistics.ties, 0);
  assert.equal(envelope.statistics.unresolved, 1);
});

test('unresolved with no valid votes leaves parsed_success false', async () => {
  const envelope = await runPairwiseItems({
    ...baseSpec({ items: [{ id: 'i1', prompt: 'p' }] }),
    solve: solveAllOk(),
    judge: async (_prompt, judges = JUDGES) => ({
      winner: null,
      resolved: false,
      unresolved: true,
      failure: { type: 'parse', message: 'all judges unparseable' },
      tally: { A: 0, B: 0, tie: 0, missing: (judges || JUDGES).length },
      votes: (judges || JUDGES).map(model => ({
        model,
        winner: null,
        valid: false,
        failure: { type: 'parse', message: 'bad json' },
      })),
      failures: [],
      vocab_only: false,
      whys: [],
      judge_usage: [],
      judge_durationMs: 0,
    }),
  });
  assert.equal(envelope.health.completed, 1);
  assert.equal(envelope.health.parsed, 0);
  assert.equal(envelope.health.scored, 0);
  assert.equal(envelope.items[0].parsed_success, false);
  assert.ok(envelope.failures.some(f => f.type === 'parse'));
});

test('maps panel A/B through presentation order onto left/right arms', async () => {
  const seed = 0;
  const order = deterministicArmOrder(['lean', 'none'], { seed, itemId: 'i1', trial: 1 });
  const leftIsA = order[0] === 'lean';

  const envelope = await runPairwiseItems({
    ...baseSpec({ seed, items: [{ id: 'i1', prompt: 'p' }] }),
    solve: solveAllOk(),
    judge: judgeWinner('A'),
  });

  const row = envelope.items[0];
  assert.deepEqual(row.arm_order, order);
  assert.equal(row.left_is_a, leftIsA);
  // Winner label A means presentation arm A.
  assert.equal(row.winner_label, 'A');
  assert.equal(row.winner_arm, order[0]);
  if (leftIsA) {
    assert.equal(envelope.statistics.wins, 1);
  } else {
    assert.equal(envelope.statistics.losses, 1);
  }
});

test('observation checkpoint keys bind item trial arm to compatibility', async () => {
  const envelope = await runPairwiseItems({
    ...baseSpec({ items: [{ id: 'i1', prompt: 'p' }] }),
    solve: solveAllOk(),
    judge: judgeWinner('B'),
  });
  const row = envelope.items[0];
  const expectedLean = observationCheckpointKey({
    compatibilityKey: row.compatibility_key,
    itemId: 'i1',
    trial: 1,
    armId: 'lean',
  });
  assert.equal(row.observation_checkpoint_keys.lean, expectedLean);
  assert.notEqual(row.observation_checkpoint_keys.lean, row.observation_checkpoint_keys.none);
});

test('ineligible same-family judge panel records failure and never silent-fallback', async () => {
  const envelope = await runPairwiseItems({
    ...baseSpec({
      solver: { model: 'gpt-4o', effort: 'low' },
      judges: ['gpt-5.5-pro', 'gpt-4.1'], // all gpt → judgesExcludingSolver returns []
      items: [{ id: 'i1', prompt: 'p' }],
    }),
    solve: solveAllOk(),
    judge: judgeWinner('A'),
  });
  assert.equal(envelope.judges.length, 0);
  assert.equal(envelope.health.panel_eligible, false);
  assert.equal(envelope.health.decision_eligible, false);
  assert.ok(envelope.failures.some(f => /ineligible judge panel/i.test(f.message)));
  assert.equal(envelope.items[0].scored, false);
});

test('buildJudgePrompt rejection becomes explicit parse failure row', async () => {
  const envelope = await runPairwiseItems({
    ...baseSpec({ items: [{ id: 'i1', prompt: 'p' }] }),
    solve: solveAllOk(),
    judge: judgeWinner('A'),
    buildJudgePrompt: async () => {
      throw new Error('prompt builder boom');
    },
  });
  assert.equal(envelope.health.attempted, 1);
  assert.equal(envelope.health.completed, 1);
  assert.equal(envelope.health.parsed, 0);
  assert.equal(envelope.health.scored, 0);
  assert.equal(envelope.health.decision_eligible, false);
  assert.equal(envelope.items[0].scored, false);
  assert.equal(envelope.items[0].parsed_success, false);
  assert.ok(envelope.failures.some(f => f.type === 'parse' && /prompt builder boom/.test(f.message)));
});

test('judgeFn throw remains transport failure not parse', async () => {
  const envelope = await runPairwiseItems({
    ...baseSpec({ items: [{ id: 'i1', prompt: 'p' }] }),
    solve: solveAllOk(),
    judge: async () => {
      throw new Error('judge transport down');
    },
  });
  assert.equal(envelope.health.attempted, 1);
  assert.equal(envelope.health.completed, 1);
  assert.equal(envelope.health.parsed, 0);
  assert.equal(envelope.health.scored, 0);
  assert.ok(envelope.failures.some(f => f.type === 'transport' && /judge transport down/.test(f.message)));
  assert.equal(envelope.failures.some(f => f.type === 'parse'), false);
});

test('summarizePairwise ITT win_rate uses attempted denominator', () => {
  const summary = summarizePairwise([
    { scored: true, winner_arm: 'lean', left_is_a: true, pair: 'lean:none' },
    { scored: true, winner_arm: 'none', left_is_a: true, pair: 'lean:none' },
    { scored: true, winner_arm: 'tie', left_is_a: false, pair: 'lean:none' },
    { scored: false, failure: { type: 'transport' }, left_is_a: true, pair: 'lean:none' },
  ], { left: 'lean', right: 'none' });
  assert.equal(summary.attempted, 4);
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 1);
  assert.equal(summary.ties, 1);
  assert.equal(summary.unresolved, 1);
  assert.equal(summary.solver_failures, 1);
  // ITT: (1 + 0.5*1) / 4 = 0.375 — unresolved stays in denominator
  assert.equal(summary.win_rate, 0.375);
  // Conditional (judged-only): (1 + 0.5) / 3 = 0.5
  assert.equal(summary.conditional_win_rate, 0.5);
  assert.equal(summary.order_balance.left_is_a, 3);
  assert.equal(summary.order_balance.left_is_b, 1);
});

test('fixture unresolved row keeps primary win_rate ITT denominator', async () => {
  const items = [
    { id: 'ok', prompt: 'resolved case' },
    { id: 'bad', prompt: 'unresolved case' },
  ];
  const envelope = await runPairwiseItems({
    ...baseSpec({ items, seed: 7 }),
    solve: solveAllOk(),
    // Resolved item: always award left arm (lean). Unresolved item: panel failure.
    judge: async (prompt, judges) => {
      if (String(prompt).includes('unresolved case')) {
        return judgeWinner('A', { unresolved: true })(prompt, judges);
      }
      // Infer presentation from responses tags embedded by default solve text.
      // Default solve text is `answer for ${id} under ${armId}` — A block has first arm.
      const aMatch = String(prompt).match(/=== RESPONSE A ===\nanswer for ok under (\w+)/);
      const armA = aMatch ? aMatch[1] : 'lean';
      const label = armA === 'lean' ? 'A' : 'B';
      return judgeWinner(label)(prompt, judges);
    },
  });
  assert.equal(envelope.health.attempted, 2);
  assert.equal(envelope.health.scored, 1);
  assert.equal(envelope.statistics.attempted, 2);
  assert.equal(envelope.statistics.unresolved, 1);
  assert.equal(envelope.statistics.judged, 1);
  assert.equal(envelope.statistics.wins, 1);
  assert.equal(envelope.statistics.losses, 0);
  // ITT: 1/2; conditional: 1/1 — unresolved stays in primary denominator.
  assert.equal(envelope.statistics.win_rate, 0.5);
  assert.equal(envelope.statistics.conditional_win_rate, 1);
});

test('normalizePanelResult never promotes unresolved to tie', () => {
  const n = normalizePanelResult({
    winner: 'tie',
    unresolved: true,
    failure: { type: 'judge_unresolved', message: 'bad' },
    votes: [],
    tally: { A: 0, B: 0, tie: 0, missing: 3 },
  });
  assert.equal(n.winner, null);
  assert.equal(n.unresolved, true);
  assert.equal(n.failure.type, 'scoring');
});

test('usage aggregates solver and judge calls', async () => {
  const envelope = await runPairwiseItems({
    ...baseSpec({ items: [{ id: 'i1', prompt: 'p' }] }),
    solve: async () => ({
      ok: true,
      text: 'x',
      usage: { input_tokens: 4, output_tokens: 2, calls: 1, latency_ms: 5, estimated_cost_usd: 0.01 },
    }),
    judge: judgeWinner('A'),
  });
  // 2 solves + judge usage calls
  assert.ok(envelope.usage.calls >= 2);
  assert.ok(envelope.usage.input_tokens >= 8);
  assert.ok(envelope.usage.latency_ms >= 10);
  assert.ok(envelope.usage.estimated_cost_usd >= 0.02);
});

test('checkpoint_key matches shared compatibility hash', async () => {
  const spec = baseSpec({ items: [{ id: 'i1', prompt: 'p' }] });
  const envelope = await runPairwiseItems({
    ...spec,
    solve: solveAllOk(),
    judge: judgeWinner('A'),
  });
  const expected = checkpointKey({
    studyId: spec.studyId,
    studyVersion: spec.studyVersion,
    datasetSha256: spec.dataset.sha256,
    promptSha256: sha256(spec.arms.map(a => a.prompt_sha256 || null)),
    skillSha256: sha256(spec.arms.map(a => a.skill_sha256 || null)),
    solver: spec.solver.model,
    judges: JUDGES,
  });
  assert.equal(envelope.checkpoint_key, expected);
});
