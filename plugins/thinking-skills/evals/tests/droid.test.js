'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  executeDroid,
  DroidFailure,
  droidExec,
  droidJson,
  droidExecAsync,
  droidJsonAsync,
  droidExecWithRetry,
  extractJson,
  parseDroidStdout,
  maxEffortFor,
  MAX_EFFORT,
  usageSummary,
  aggregateUsage,
  modelFamilyForCost,
  COST_PER_MTOKEN,
  COST_MODEL_VERSION,
  ISOLATION_DISABLED_TOOLS,
  ISOLATION_ENV_ALLOWLIST,
  isolationMetadata,
  _acquireSlot,
  _releaseSlot,
  _getInflight,
  MAX_DROID_INFLIGHT,
} = require('../lib/droid');
const {
  writeJson,
  writeJsonAtomic,
  readJsonIfExists,
  writeStudyCheckpoint,
  writeObservationCheckpoint,
  readStudyCheckpoint,
  readObservationCheckpoint,
  runHealthWarnings,
} = require('../lib/io');
const {
  checkpointKey,
  observationCheckpointKey,
} = require('../lib/result');

function droidStdout(result, extras = {}) {
  return JSON.stringify({
    result,
    usage: extras.usage || { input_tokens: 10, output_tokens: 5 },
    duration_ms: extras.duration_ms || 12,
    is_error: Boolean(extras.is_error),
    ...extras.extra,
  });
}

function makeRunner(handler) {
  return async (ctx) => handler(ctx);
}

test('legacy exports remain importable', () => {
  assert.equal(typeof droidExec, 'function');
  assert.equal(typeof droidJson, 'function');
  assert.equal(typeof droidExecAsync, 'function');
  assert.equal(typeof droidJsonAsync, 'function');
  assert.equal(typeof droidExecWithRetry, 'function');
  assert.equal(typeof extractJson, 'function');
  assert.equal(typeof parseDroidStdout, 'function');
  assert.equal(typeof maxEffortFor, 'function');
  assert.equal(typeof usageSummary, 'function');
  assert.equal(typeof aggregateUsage, 'function');
  assert.equal(typeof modelFamilyForCost, 'function');
  assert.ok(MAX_EFFORT);
  assert.ok(COST_PER_MTOKEN);
  assert.equal(typeof executeDroid, 'function');
  assert.equal(typeof DroidFailure, 'function');
});

test('executeDroid success path returns structured envelope', async () => {
  const r = await executeDroid({
    model: 'fixture-model',
    prompt: 'hello',
    runner: makeRunner(async () => ({
      status: 0,
      stdout: droidStdout('ANSWER: ok'),
      stderr: '',
      error: null,
      timedOut: false,
      durationMs: 42,
    })),
  });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'ANSWER: ok');
  assert.equal(r.failure, null);
  assert.equal(r.attempts, 1);
  assert.equal(r.durationMs, 42);
  assert.equal(r.usage.input_tokens, 10);
  assert.equal(r.cost_model_version, COST_MODEL_VERSION);
  assert.equal(r.isolation.enabled, true);
  assert.equal(r.isolation.effective_cwd, os.tmpdir());
  assert.deepEqual(r.isolation.disabled_tools, ISOLATION_DISABLED_TOOLS);
  assert.ok(Array.isArray(r.isolation.env_allowlist));
  assert.ok(r.isolation.env_allowlist.includes('PATH'));
});

test('transport nonzero exit becomes typed failure without throw', async () => {
  const r = await executeDroid({
    model: 'fixture-model',
    prompt: 'x',
    runner: makeRunner(async () => ({
      status: 7,
      stdout: '',
      stderr: 'boom',
      error: null,
      timedOut: false,
      durationMs: 5,
    })),
  });
  assert.equal(r.ok, false);
  assert.ok(r.failure instanceof DroidFailure);
  assert.equal(r.failure.type, 'transport');
  assert.match(r.failure.message, /exit 7/);
  assert.equal(r.error, 'exit 7');
});

test('timeout is classified separately from transport', async () => {
  const r = await executeDroid({
    model: 'fixture-model',
    prompt: 'x',
    runner: makeRunner(async () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('timeout'),
      timedOut: true,
      signal: 'SIGKILL',
      durationMs: 100,
    })),
  });
  assert.equal(r.ok, false);
  assert.equal(r.failure.type, 'timeout');
  assert.equal(r.error, 'timeout');
});

test('malformed stdout yields parse failure', async () => {
  const r = await executeDroid({
    model: 'fixture-model',
    prompt: 'x',
    runner: makeRunner(async () => ({
      status: 0,
      stdout: 'not-json-at-all',
      stderr: '',
      error: null,
      timedOut: false,
      durationMs: 3,
    })),
  });
  assert.equal(r.ok, false);
  assert.equal(r.failure.type, 'parse');
  assert.match(r.failure.message, /parse/i);
});

test('tool leakage under isolation is typed tool_leakage', async () => {
  const r = await executeDroid({
    model: 'fixture-model',
    prompt: 'x',
    isolate: true,
    runner: makeRunner(async () => ({
      status: 0,
      stdout: droidStdout('invoked a tool', {
        extra: { tool_use: { name: 'Read', input: { path: 'secret' } } },
      }),
      stderr: '',
      error: null,
      timedOut: false,
      durationMs: 8,
    })),
  });
  assert.equal(r.ok, false);
  assert.equal(r.failure.type, 'tool_leakage');
});

test('tool-enabled isolation permits read tools with custom restrictions', async () => {
  let captured = null;
  const r = await executeDroid({
    model: 'fixture-model',
    prompt: 'inspect the checkout',
    isolate: true,
    allowToolUse: true,
    cwd: '/tmp/checkout',
    restrictTools: ['Read', 'LS', 'Grep', 'Glob'],
    appendSystemPrompt: 'Use only read-only repository tools.',
    runner: makeRunner(async (ctx) => {
      captured = ctx;
      return {
        status: 0,
        stdout: droidStdout('ANSWER: src/owner.js', {
          extra: { tool_use: { name: 'Grep', input: { pattern: 'owner' } } },
        }),
        stderr: '',
        error: null,
        timedOut: false,
        durationMs: 8,
      };
    }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.failure, null);
  assert.equal(r.isolation.allow_tool_use, true);
  assert.equal(r.isolation.effective_cwd, '/tmp/checkout');
  const restrictedAt = captured.args.indexOf('--restrict-tools');
  assert.equal(captured.args[restrictedAt + 1], 'Read LS Grep Glob');
  assert.equal(captured.args.includes('--disabled-tools'), false);
  const promptAt = captured.args.indexOf('--append-system-prompt');
  assert.equal(captured.args[promptAt + 1], 'Use only read-only repository tools.');
});

test('tool-enabled isolation rejects tool events outside explicit restrictions', async () => {
  const r = await executeDroid({
    model: 'fixture-model',
    prompt: 'inspect',
    isolate: true,
    allowToolUse: true,
    restrictTools: ['Read', 'LS', 'Grep', 'Glob'],
    runner: makeRunner(async () => ({
      status: 0,
      stdout: droidStdout('unexpected execution', {
        extra: { tool_use: { name: 'Execute', input: { command: 'pwd' } } },
      }),
      stderr: '',
      error: null,
      timedOut: false,
      durationMs: 2,
    })),
  });
  assert.equal(r.ok, false);
  assert.equal(r.failure.type, 'tool_leakage');
});

test('answer text mentioning tools is not tool_leakage', async () => {
  const r = await executeDroid({
    model: 'fixture-model',
    prompt: 'x',
    isolate: true,
    runner: makeRunner(async () => ({
      status: 0,
      stdout: droidStdout('Do not use tool_use or functions.Read; answer without tools.'),
      stderr: '',
      error: null,
      timedOut: false,
      durationMs: 4,
    })),
  });
  assert.equal(r.ok, true);
  assert.equal(r.failure, null);
  assert.match(r.text, /tool_use/);
});

test('temp prompt file is cleaned up on success and failure', async () => {
  const seen = [];
  for (const mode of ['ok', 'fail']) {
    await executeDroid({
      model: 'fixture-model',
      prompt: `cleanup-${mode}`,
      runner: makeRunner(async (ctx) => {
        seen.push(ctx.promptFile);
        assert.equal(fs.existsSync(ctx.promptFile), true);
        assert.equal(fs.readFileSync(ctx.promptFile, 'utf8'), `cleanup-${mode}`);
        if (mode === 'ok') {
          return {
            status: 0,
            stdout: droidStdout('done'),
            stderr: '',
            error: null,
            timedOut: false,
            durationMs: 1,
          };
        }
        return {
          status: 1,
          stdout: '',
          stderr: 'fail',
          error: null,
          timedOut: false,
          durationMs: 1,
        };
      }),
    });
  }
  assert.equal(seen.length, 2);
  for (const file of seen) {
    assert.equal(fs.existsSync(file), false, `temp prompt should be removed: ${file}`);
  }
});

test('retries only on transport/timeout and report attempt count', async () => {
  let calls = 0;
  const r = await executeDroid({
    model: 'fixture-model',
    prompt: 'retry-me',
    attempts: 3,
    runner: makeRunner(async () => {
      calls += 1;
      if (calls < 3) {
        return {
          status: 1,
          stdout: '',
          stderr: 'transient',
          error: null,
          timedOut: false,
          durationMs: 1,
        };
      }
      return {
        status: 0,
        stdout: droidStdout('recovered'),
        stderr: '',
        error: null,
        timedOut: false,
        durationMs: 2,
      };
    }),
  });
  assert.equal(calls, 3);
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
  assert.equal(r.text, 'recovered');
});

test('retries accumulate usage and duration across attempts', async () => {
  let calls = 0;
  const r = await executeDroid({
    model: 'fixture-model',
    prompt: 'retry-cost',
    attempts: 2,
    runner: makeRunner(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 1,
          stdout: droidStdout('partial', {
            usage: { input_tokens: 100, output_tokens: 20 },
            duration_ms: 11,
          }),
          stderr: 'transient',
          error: null,
          timedOut: false,
          durationMs: 11,
        };
      }
      return {
        status: 0,
        stdout: droidStdout('final', {
          usage: { input_tokens: 40, output_tokens: 10 },
          duration_ms: 7,
        }),
        stderr: '',
        error: null,
        timedOut: false,
        durationMs: 7,
      };
    }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.usage.input_tokens, 140);
  assert.equal(r.usage.output_tokens, 30);
  assert.equal(r.durationMs, 18);
  assert.equal(r.attempt_records.length, 2);
  assert.equal(r.attempt_records[0].ok, false);
  assert.equal(r.attempt_records[1].ok, true);
});

test('parse failures do not burn remaining retries', async () => {
  let calls = 0;
  const r = await executeDroid({
    model: 'fixture-model',
    prompt: 'no-retry-parse',
    attempts: 4,
    runner: makeRunner(async () => {
      calls += 1;
      return {
        status: 0,
        stdout: '<<<not json>>>',
        stderr: '',
        error: null,
        timedOut: false,
        durationMs: 1,
      };
    }),
  });
  assert.equal(calls, 1);
  assert.equal(r.ok, false);
  assert.equal(r.failure.type, 'parse');
  assert.equal(r.attempts, 1);
});

test('droidExecWithRetry preserves attempts on final failure', async () => {
  let calls = 0;
  const r = await droidExecWithRetry({
    model: 'fixture-model',
    prompt: 'always-fail',
    runner: makeRunner(async () => {
      calls += 1;
      return {
        status: 2,
        stdout: '',
        stderr: 'nope',
        error: null,
        timedOut: false,
        durationMs: 1,
      };
    }),
  }, 3);
  assert.equal(calls, 3);
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 3);
  assert.equal(r.failure.type, 'transport');
});

test('throwing syncRunner becomes transport failure without escaping', () => {
  let promptFile = null;
  const r = droidExec({
    model: 'fixture-model',
    prompt: 'throwing-runner',
    syncRunner: (ctx) => {
      promptFile = ctx.promptFile;
      throw new Error('sync boom');
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.failure.type, 'transport');
  assert.match(r.failure.message, /sync boom/);
  assert.equal(fs.existsSync(promptFile), false);
});

test('sync droidExec uses injected syncRunner and cleans temp prompt', () => {
  let promptFile = null;
  const r = droidExec({
    model: 'fixture-model',
    prompt: 'sync-path',
    syncRunner: (ctx) => {
      promptFile = ctx.promptFile;
      assert.equal(fs.existsSync(promptFile), true);
      return {
        status: 0,
        stdout: droidStdout('sync-ok'),
        stderr: '',
        error: null,
        timedOut: false,
        durationMs: 9,
      };
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'sync-ok');
  assert.equal(fs.existsSync(promptFile), false);
});

test('missing model/prompt returns structured transport failure in async path', async () => {
  const r = await executeDroid({
    model: '',
    prompt: 'x',
    runner: makeRunner(async () => {
      throw new Error('runner should not run');
    }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.failure.type, 'transport');
  assert.match(r.failure.message, /model and prompt/);
});

test('isolation metadata and args respect call-time isolate override', async () => {
  let captured = null;
  await executeDroid({
    model: 'fixture-model',
    prompt: 'iso',
    isolate: false,
    runner: makeRunner(async (ctx) => {
      captured = ctx;
      return {
        status: 0,
        stdout: droidStdout('ok'),
        stderr: '',
        error: null,
        timedOut: false,
        durationMs: 1,
      };
    }),
  });
  assert.ok(captured);
  assert.equal(captured.isolation.enabled, false);
  assert.deepEqual(captured.isolation.disabled_tools, []);
  assert.equal(captured.args.includes('--disabled-tools'), false);
  assert.equal(captured.env.EVAL_SECRET_SHOULD_PASS, undefined);
});

test('isolated env is allowlisted and cwd is neutral', async () => {
  const prev = process.env.EVAL_SECRET_SHOULD_NOT_LEAK;
  process.env.EVAL_SECRET_SHOULD_NOT_LEAK = 'sentinel-secret';
  try {
    let captured = null;
    const r = await executeDroid({
      model: 'fixture-model',
      prompt: 'env-check',
      isolate: true,
      runner: makeRunner(async (ctx) => {
        captured = ctx;
        return {
          status: 0,
          stdout: droidStdout('ok'),
          stderr: '',
          error: null,
          timedOut: false,
          durationMs: 1,
        };
      }),
    });
    assert.equal(r.isolation.enabled, true);
    assert.equal(captured.cwd, os.tmpdir());
    assert.equal(captured.env.EVAL_SECRET_SHOULD_NOT_LEAK, undefined);
    assert.ok(captured.env.PATH);
    assert.ok(r.isolation.env_allowlist.includes('PATH'));
    assert.ok(ISOLATION_ENV_ALLOWLIST.includes('HOME'));
  } finally {
    if (prev === undefined) delete process.env.EVAL_SECRET_SHOULD_NOT_LEAK;
    else process.env.EVAL_SECRET_SHOULD_NOT_LEAK = prev;
  }
});

test('isolation canary: repository sentinel is unavailable from neutral cwd/tools', async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const sentinelName = `ISOLATION_CANARY_SENTINEL_${process.pid}.txt`;
  const sentinelPath = path.join(repoRoot, sentinelName);
  const marker = `canary-secret-${process.pid}`;
  fs.writeFileSync(sentinelPath, marker, 'utf8');
  try {
    let captured = null;
    const r = await executeDroid({
      model: 'fixture-model',
      prompt: 'canary',
      isolate: true,
      runner: makeRunner(async (ctx) => {
        captured = ctx;
        // Simulate what an isolated solver could observe with only the
        // allowlisted env + neutral cwd + disabled tools.
        const cwdListing = fs.readdirSync(ctx.cwd);
        const canSeeSentinelInCwd = cwdListing.includes(sentinelName);
        let canReadByRelative = false;
        try {
          fs.readFileSync(path.join(ctx.cwd, sentinelName), 'utf8');
          canReadByRelative = true;
        } catch (_) { /* expected */ }
        const toolsDisabled = ctx.args.includes('--disabled-tools')
          && String(ctx.args[ctx.args.indexOf('--disabled-tools') + 1] || '').includes('Read')
          && String(ctx.args[ctx.args.indexOf('--disabled-tools') + 1] || '').includes('Execute');
        return {
          status: 0,
          stdout: droidStdout(JSON.stringify({
            cwd: ctx.cwd,
            canSeeSentinelInCwd,
            canReadByRelative,
            toolsDisabled,
            repoRootInEnv: Object.values(ctx.env || {}).some(v => String(v).includes(repoRoot)),
          })),
          stderr: '',
          error: null,
          timedOut: false,
          durationMs: 1,
        };
      }),
    });
    assert.equal(r.ok, true);
    assert.equal(captured.cwd, os.tmpdir());
    assert.notEqual(path.resolve(captured.cwd), path.resolve(repoRoot));
    const payload = JSON.parse(r.text);
    assert.equal(payload.canSeeSentinelInCwd, false);
    assert.equal(payload.canReadByRelative, false);
    assert.equal(payload.toolsDisabled, true);
    assert.equal(fs.existsSync(sentinelPath), true, 'sentinel remains in repo for the test harness only');
    // Solver process env must not carry an easy pointer to the repo root.
    assert.equal(payload.repoRootInEnv, false);
  } finally {
    try { fs.unlinkSync(sentinelPath); } catch (_) { /* ignore */ }
  }
});

test('concurrency gate limits inflight executions', async () => {
  const prev = _getInflight();
  assert.equal(prev, 0);
  let concurrent = 0;
  let peak = 0;
  const n = Math.min(6, MAX_DROID_INFLIGHT + 2);
  const tasks = [];
  for (let i = 0; i < n; i++) {
    tasks.push(droidExecAsync({
      model: 'fixture-model',
      prompt: `c-${i}`,
      runner: makeRunner(async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await new Promise(resolve => setTimeout(resolve, 20));
        concurrent -= 1;
        return {
          status: 0,
          stdout: droidStdout('ok'),
          stderr: '',
          error: null,
          timedOut: false,
          durationMs: 20,
        };
      }),
    }));
  }
  const results = await Promise.all(tasks);
  assert.equal(results.every(r => r.ok), true);
  assert.ok(peak <= MAX_DROID_INFLIGHT);
  assert.equal(_getInflight(), 0);
});

test('usageSummary and aggregateUsage expose cost model version', () => {
  const one = usageSummary({
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }, 'claude-sonnet-4-6');
  assert.equal(one.cost_model_version, COST_MODEL_VERSION);
  assert.ok(one.est_cost_usd > 0);
  const agg = aggregateUsage([one, one]);
  assert.equal(agg.input_tokens, 2000);
  assert.equal(agg.cost_model_version, COST_MODEL_VERSION);
});

test('extractJson handles fences and prose', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('answer is {"b":2} trailing'), { b: 2 });
  assert.equal(extractJson('no json here'), null);
});

test('writeJsonAtomic is crash-safe rename and checkpoint keys bind identity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-io-'));
  try {
    const file = path.join(dir, 'out.json');
    writeJsonAtomic(file, { hello: 'world' });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { hello: 'world' });

    const compatibilitySpec = {
      studyId: 'study-a',
      studyVersion: '1',
      datasetSha256: 'd'.repeat(64),
      promptSha256: 'p'.repeat(64),
      skillSha256: 'k'.repeat(64),
      solver: 'fixture-model',
      judges: ['j2', 'j1'],
    };
    const compatibilityKey = checkpointKey(compatibilitySpec);
    const study = writeStudyCheckpoint(dir, compatibilitySpec, { status: 'partial', n: 2 });
    assert.equal(study.key, compatibilityKey);
    assert.equal(readStudyCheckpoint(dir, compatibilitySpec).status, 'partial');

    const observationSpec = {
      compatibilityKey,
      itemId: 'item-1',
      trial: 1,
      armId: 'lean',
    };
    const obsKey = observationCheckpointKey(observationSpec);
    const obs = writeObservationCheckpoint(dir, observationSpec, { scored: true, value: 1 });
    assert.equal(obs.key, obsKey);
    const loaded = readObservationCheckpoint(dir, observationSpec);
    assert.equal(loaded.scored, true);
    assert.equal(loaded.item_id, 'item-1');
    assert.equal(loaded.arm_id, 'lean');
    assert.equal(loaded.trial, 1);

    // Different arm => different observation checkpoint path.
    assert.equal(
      readObservationCheckpoint(dir, { ...observationSpec, armId: 'none' }),
      null
    );

    // Legacy writeJson still works.
    const legacy = path.join(dir, 'legacy.json');
    writeJson(legacy, { ok: 1 });
    assert.deepEqual(readJsonIfExists(legacy), { ok: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runHealthWarnings remains available', () => {
  const warnings = runHealthWarnings({
    solver_failures: 2,
    solver_calls: 10,
    failure_rate: 0.2,
    decision_eligible: false,
  });
  assert.ok(warnings.some(w => w.code === 'solver_failure_rate_high'));
  assert.ok(warnings.some(w => w.code === 'not_decision_eligible'));
});

test('isolationMetadata defaults to tmpdir and disabled tools', () => {
  const meta = isolationMetadata({ isolate: true });
  assert.equal(meta.enabled, true);
  assert.equal(meta.effective_cwd, os.tmpdir());
  assert.ok(meta.disabled_tools.includes('Read'));
  assert.ok(meta.disabled_tools.includes('Skill'));
});
