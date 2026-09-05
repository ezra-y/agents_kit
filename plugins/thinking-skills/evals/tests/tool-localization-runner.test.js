'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  analyzeToolStage,
  evaluateToolCandidateGate,
  runToolStage,
  scoreToolLocalizationResponse,
  selectPilotCandidate,
  stageArmIds,
  verifyPinnedFiles,
} = require('../lib/tool-localization-runner');

function syntheticRows(n = 100) {
  const rows = [];
  for (let index = 0; index < n; index++) {
    const outcomes = {
      none: index < Math.floor(n * 0.50),
      current: index < Math.floor(n * 0.54),
      'clue-first': index < Math.floor(n * 0.60),
      'module-role': index < Math.floor(n * 0.48),
    };
    for (const [arm_id, correct] of Object.entries(outcomes)) {
      rows.push({
        item_id: `i${index}`,
        trial: 1,
        arm_id,
        correct,
        usage: { total_tokens: arm_id === 'module-role' ? 110 : 100 },
      });
    }
  }
  return rows;
}

test('scoreToolLocalizationResponse applies exact path and ITT budget scoring', () => {
  const item = { gold_files: ['pkg/core/owner.py'] };
  assert.equal(
    scoreToolLocalizationResponse(item, 'OBSERVATIONS_USED: 2\nANSWER: pkg/core/owner.py', 4).correct,
    true,
  );
  assert.equal(
    scoreToolLocalizationResponse(item, 'OBSERVATIONS_USED: 5\nANSWER: pkg/core/owner.py', 4).correct,
    false,
  );
  assert.equal(scoreToolLocalizationResponse(item, 'owner.py', 4).correct, false);
});

test('confirmation gate requires lift, paired significance, current parity, and no token increase', () => {
  const analysis = analyzeToolStage(syntheticRows(), ['clue-first', 'module-role']);
  const clue = evaluateToolCandidateGate(analysis, 'clue-first', {
    stage: 'confirmation',
    minN: 100,
  });
  assert.equal(clue.pass, true);
  assert.ok(Math.abs(
    analysis.candidates['clue-first'].vs_none.p_value - 0.001953125,
  ) < 1e-12);
  const moduleRole = evaluateToolCandidateGate(analysis, 'module-role', {
    stage: 'confirmation',
    minN: 100,
  });
  assert.equal(moduleRole.pass, false);
  assert.ok(moduleRole.reasons.length > 0);
});

test('selectPilotCandidate advances only passing candidates with deterministic ordering', () => {
  const analysis = analyzeToolStage(syntheticRows(30), ['clue-first', 'module-role']);
  assert.equal(selectPilotCandidate(analysis, ['clue-first', 'module-role']), 'clue-first');
  const none = analyzeToolStage(syntheticRows(30).map((row) => (
    row.arm_id === 'clue-first' ? { ...row, correct: false } : row
  )), ['clue-first', 'module-role']);
  assert.equal(selectPilotCandidate(none, ['clue-first', 'module-role']), null);
});

test('stageArmIds uses four exploratory arms and only the selected confirmatory candidate', () => {
  assert.deepEqual(stageArmIds('pilot'), ['none', 'current', 'clue-first', 'module-role']);
  assert.deepEqual(
    stageArmIds('confirmation', 'module-role'),
    ['none', 'current', 'module-role'],
  );
  assert.throws(() => stageArmIds('confirmation'), /selected candidate/);
});

test('runToolStage serializes repository checkouts, restricts tools, and resumes checkpoints', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-stage-'));
  const events = [];
  let executions = 0;
  const items = [0, 1].map((index) => ({
    id: `i${index}`,
    repo: 'org/repo',
    base_commit: `commit-${index}`,
    problem_statement: `Issue ${index}`,
    gold_files: ['pkg/core/owner.py'],
  }));
  const options = {
    studyId: 'fixture-study',
    manifestHash: 'fixture-manifest',
    stage: 'pilot',
    items,
    armDefinitions: [
      { id: 'none', skillContent: '' },
      { id: 'current', skillContent: 'CURRENT SKILL' },
    ],
    model: 'fixture-model',
    effort: 'high',
    outputDir,
    cacheRoot: '/tmp/checkouts',
    callCap: 10,
    costCapUsd: 10,
    prepare: async (item) => {
      events.push(`prepare:${item.id}`);
      return `/tmp/checkouts/${item.repo.replace('/', '__')}`;
    },
    execute: async (opts) => {
      executions++;
      events.push(`execute:${opts.prompt.includes('CURRENT SKILL') ? 'current' : 'none'}`);
      assert.deepEqual(opts.restrictTools, ['Read', 'LS', 'Grep', 'Glob']);
      assert.equal(opts.allowToolUse, true);
      return {
        ok: true,
        text: 'OBSERVATIONS_USED: 2\nANSWER: pkg/core/owner.py',
        usage: { input_tokens: 10, output_tokens: 5 },
        durationMs: 1,
        attempts: 1,
        failure: null,
        raw: '{}',
      };
    },
  };
  try {
    const first = await runToolStage(options);
    assert.equal(first.health.decision_eligible, true);
    assert.equal(first.items.length, 4);
    assert.deepEqual(events, [
      'prepare:i0', 'execute:none', 'execute:current',
      'prepare:i1', 'execute:none', 'execute:current',
    ]);
    const resumed = await runToolStage(options);
    assert.equal(resumed.items.length, 4);
    assert.equal(executions, 4);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('runToolStage keeps parse failures ITT-eligible but stops on exhausted transport failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-health-'));
  const item = {
    id: 'i0',
    repo: 'org/repo',
    base_commit: 'commit-0',
    problem_statement: 'Issue',
    gold_files: ['pkg/core/owner.py'],
  };
  const base = {
    studyId: 'fixture-health',
    manifestHash: 'manifest',
    stage: 'pilot',
    items: [item],
    armDefinitions: [{ id: 'none' }, { id: 'current', skillContent: 'skill' }],
    model: 'fixture-model',
    cacheRoot: '/tmp/checkouts',
    callCap: 10,
    costCapUsd: 10,
    prepare: async () => '/tmp/checkouts/org__repo',
  };
  try {
    const parse = await runToolStage({
      ...base,
      outputDir: path.join(root, 'parse'),
      execute: async () => ({
        ok: true,
        text: 'malformed',
        usage: {},
        durationMs: 1,
        attempts: 1,
        failure: null,
      }),
    });
    assert.equal(parse.health.decision_eligible, true);
    assert.equal(parse.health.parse_or_protocol_failures, 2);
    let calls = 0;
    const transport = await runToolStage({
      ...base,
      outputDir: path.join(root, 'transport'),
      execute: async () => {
        calls++;
        return {
          ok: false,
          text: '',
          usage: {},
          durationMs: 1,
          attempts: 2,
          failure: { type: 'transport', message: 'offline' },
        };
      },
    });
    assert.equal(transport.health.decision_eligible, false);
    assert.equal(transport.items.length, 1);
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyPinnedFiles rejects runtime drift before paid calls', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-pins-'));
  try {
    fs.writeFileSync(path.join(root, 'pinned.txt'), 'frozen');
    const hash = require('../lib/result').sha256('frozen');
    assert.doesNotThrow(() => verifyPinnedFiles({
      file_pins: { 'pinned.txt': hash },
    }, root));
    fs.writeFileSync(path.join(root, 'pinned.txt'), 'drifted');
    assert.throws(
      () => verifyPinnedFiles({ file_pins: { 'pinned.txt': hash } }, root),
      /hash mismatch/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
