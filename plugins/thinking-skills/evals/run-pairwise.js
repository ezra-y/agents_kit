#!/usr/bin/env node
'use strict';

/**
 * Generic blind pairwise engine CLI.
 *
 * Supports deterministic fixture mode and authenticated live studies.
 *
 * Usage:
 *   node evals/run-pairwise.js --fixture path/to/fixture.json
 *   node evals/run-pairwise.js --study path/to/study.json
 *
 * Fixture JSON shape:
 *   {
 *     "study_id", "study_version", "preregistration_sha256",
 *     "dataset": { source, version, split, sha256 },
 *     "solver": { model, effort },
 *     "judges": ["gpt-5.5-pro", "gemini-3.1-pro-preview", "deepseek-v4-pro"],
 *     "arms": [{ "id": "none", "prompt_sha256"?: "..." }, { "id": "lean", ... }],
 *     "pair": { "left": "lean", "right": "none" },
 *     "seed": 0,
 *     "trials": 1,
 *     "items": [{
 *       "id", "prompt",
 *       "fixture_responses": { "none": "text...", "lean": "text..." },
 *       "fixture_judge": { "winner": "A"|"B"|"tie", "resolved": true } // optional override
 *     }]
 *   }
 */

const fs = require('fs');
const path = require('path');
const { sha256, validateResultEnvelope } = require('./lib/result');
const { runPairwiseItems } = require('./lib/pairwise');
const { panelModels, panelJudge } = require('./lib/judge');
const { executeDroid, usageSummary } = require('./lib/droid');

function usage(code = 0) {
  const msg = `Usage:
  node evals/run-pairwise.js --fixture <fixture.json> [--out file.json]
  node evals/run-pairwise.js --study <study.json> [--out file.json]

Fixture mode requires fixture_responses per arm. Live mode uses the authenticated droid transport.
`;
  if (code) console.error(msg);
  else console.log(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { fixture: null, study: null, out: null, trials: null, seed: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') usage(0);
    else if (a === '--fixture' && argv[i + 1]) out.fixture = argv[++i];
    else if (a === '--study' && argv[i + 1]) out.study = argv[++i];
    else if (a === '--out' && argv[i + 1]) out.out = argv[++i];
    else if (a === '--trials' && argv[i + 1]) out.trials = parseInt(argv[++i], 10);
    else if (a === '--seed' && argv[i + 1]) out.seed = argv[++i];
    else if (a.startsWith('--')) {
      console.error(`unknown flag: ${a}`);
      usage(1);
    }
  }
  return out;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fixtureSolve(study) {
  return async function solve({ item, armId }) {
    const table = item.fixture_responses || item.responses || {};
    const entry = table[armId];
    if (entry == null) {
      return {
        ok: false,
        text: null,
        failure: {
          type: 'transport',
          message: `fixture mode: missing fixture_responses for arm ${armId}`,
        },
        usage: { calls: 0 },
      };
    }
    if (typeof entry === 'string') {
      return { ok: true, text: entry, usage: { calls: 0, input_tokens: 0, output_tokens: 0 } };
    }
    return {
      ok: entry.ok !== false,
      text: entry.text != null ? entry.text : null,
      usage: entry.usage || { calls: 0 },
      failure: entry.failure || null,
      durationMs: entry.durationMs || 0,
      attempts: entry.attempts != null ? entry.attempts : 1,
    };
  };
}

function liveSolve(study) {
  return async function solve({ prompt }) {
    const model = (study.solver && study.solver.model) || process.env.SOLVER_MODEL;
    const result = await executeDroid({
      model,
      effort: (study.solver && study.solver.effort) || process.env.SOLVER_EFFORT,
      prompt,
      timeoutMs: parseInt(process.env.DROID_TIMEOUT_MS || '180000', 10),
      attempts: parseInt(process.env.DROID_ATTEMPTS || '3', 10),
    });
    const normalized = usageSummary(result.usage, model);
    return {
      ...result,
      usage: {
        ...normalized,
        calls: result.attempts,
        latency_ms: result.durationMs || 0,
        estimated_cost_usd: normalized.est_cost_usd,
      },
    };
  };
}

/**
 * Fixture judge: uses item.fixture_judge, study.fixture_judge, or a deterministic
 * default that prefers arm A when responses differ in length (stable, no models).
 */
function fixtureJudge(study) {
  return async function judge(prompt, judges) {
    // Allow per-call override via a marker embedded only in tests; primary path is study items.
    // The runner rebinds per item via closure below when items carry fixture_judge.
    void prompt;
    const models = Array.isArray(judges) && judges.length ? judges : panelModels();
    const defaultWinner = study.fixture_judge && study.fixture_judge.winner
      ? study.fixture_judge.winner
      : 'A';
    const resolved = study.fixture_judge && study.fixture_judge.resolved === false
      ? false
      : true;
    if (!resolved) {
      return {
        winner: null,
        resolved: false,
        unresolved: true,
        failure: { type: 'judge_unresolved', message: 'fixture unresolved panel' },
        tally: { A: 0, B: 0, tie: 0, missing: models.length },
        votes: models.map(model => ({ model, winner: null, valid: false, failure: { type: 'parse', message: 'fixture missing' } })),
        failures: [],
        vocab_only: false,
        whys: [],
        judge_usage: [],
        judge_durationMs: 0,
      };
    }
    const winner = String(defaultWinner).toUpperCase() === 'B' ? 'B'
      : String(defaultWinner).toUpperCase() === 'TIE' ? 'tie'
        : 'A';
    // Two matching valid votes for A/B; for tie inject resolved=true path used by pairwise normalize.
    if (winner === 'tie') {
      return {
        winner: 'tie',
        resolved: true,
        unresolved: false,
        failure: null,
        tally: { A: 0, B: 0, tie: models.length, missing: 0 },
        votes: models.map(model => ({ model, winner: 'tie', valid: true, failure: null })),
        failures: [],
        vocab_only: false,
        whys: ['fixture tie'],
        judge_usage: [],
        judge_durationMs: 0,
      };
    }
    return {
      winner,
      resolved: true,
      unresolved: false,
      failure: null,
      tally: {
        A: winner === 'A' ? Math.max(2, models.length) : 0,
        B: winner === 'B' ? Math.max(2, models.length) : 0,
        tie: 0,
        missing: 0,
      },
      votes: models.map(model => ({ model, winner, valid: true, failure: null })),
      failures: [],
      vocab_only: false,
      whys: [`fixture winner ${winner}`],
      judge_usage: [],
      judge_durationMs: 0,
    };
  };
}

/**
 * Wrap fixture judge so per-item fixture_judge overrides study default.
 * We recover the item id from the judge prompt PROBLEM section when present,
 * else fall back to sequential consumption of items list.
 */
function makeItemAwareJudge(study, baseJudge) {
  const byId = new Map();
  for (const item of study.items || []) {
    const id = item.id || item.item_id;
    if (id != null && item.fixture_judge) byId.set(String(id), item.fixture_judge);
  }
  if (byId.size === 0) return baseJudge;

  return async function judge(prompt, judges) {
    // Prefer explicit id tag if buildJudgePrompt embeds it; else scan prompt for item prompts.
    let override = null;
    const idMatch = String(prompt).match(/\[item_id=([^\]]+)\]/);
    if (idMatch && byId.has(idMatch[1])) override = byId.get(idMatch[1]);
    if (!override) {
      for (const item of study.items || []) {
        const id = String(item.id || item.item_id || '');
        const text = item.prompt || item.problem || item.text || '';
        if (text && String(prompt).includes(text) && byId.has(id)) {
          override = byId.get(id);
          break;
        }
      }
    }
    if (!override) return baseJudge(prompt, judges);

    const models = Array.isArray(judges) && judges.length ? judges : panelModels();
    if (override.resolved === false || override.unresolved === true) {
      return {
        winner: null,
        resolved: false,
        unresolved: true,
        failure: override.failure || { type: 'judge_unresolved', message: 'fixture unresolved panel' },
        tally: override.tally || { A: 0, B: 0, tie: 0, missing: models.length },
        votes: override.votes || models.map(model => ({ model, winner: null, valid: false })),
        failures: override.failures || [],
        vocab_only: !!override.vocab_only,
        whys: override.whys || [],
        judge_usage: override.judge_usage || [],
        judge_durationMs: override.judge_durationMs || 0,
      };
    }
    const winnerRaw = override.winner == null ? 'A' : String(override.winner);
    const upper = winnerRaw.toUpperCase();
    const winner = upper === 'B' ? 'B' : upper === 'TIE' ? 'tie' : 'A';
    return {
      winner,
      resolved: true,
      unresolved: false,
      failure: null,
      tally: override.tally || {
        A: winner === 'A' ? 2 : 0,
        B: winner === 'B' ? 2 : 0,
        tie: winner === 'tie' ? 2 : 0,
        missing: 0,
      },
      votes: override.votes || models.map(model => ({ model, winner, valid: true, failure: null })),
      failures: [],
      vocab_only: !!override.vocab_only,
      whys: override.whys || [`fixture winner ${winner}`],
      judge_usage: override.judge_usage || [],
      judge_durationMs: override.judge_durationMs || 0,
    };
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (Boolean(args.fixture) === Boolean(args.study)) usage(1);

  const fixtureMode = Boolean(args.fixture);
  const studyPath = args.fixture || args.study;
  const study = loadJson(path.resolve(studyPath));
  const items = study.items || [];

  if (fixtureMode && items.some(it => !it.fixture_responses && !it.responses)) {
    console.error('run-pairwise: each fixture item needs fixture_responses for both arms');
    process.exit(1);
  }

  const arms = (study.arms || []).map(a => ({
    ...a,
    id: a.id,
    prompt_sha256: a.prompt_sha256 || sha256(a.id),
    skill_sha256: a.skill_sha256 != null ? a.skill_sha256 : null,
  }));
  if (arms.length < 2) {
    console.error('run-pairwise: study needs at least two arms');
    process.exit(1);
  }

  const pair = study.pair || { left: arms[0].id, right: arms[1].id };
  const judges = study.judges || panelModels();
  const armById = new Map(arms.map(arm => [arm.id, arm]));
  const runOptions = {
    studyId: study.study_id || study.studyId,
    studyVersion: study.study_version || study.studyVersion || '1',
    preregistrationSha256: study.preregistration_sha256 || study.preregistrationSha256 || sha256('adhoc'),
    dataset: study.dataset || {
      source: fixtureMode ? 'fixture' : studyPath,
      version: '0',
      split: fixtureMode ? 'fixture' : 'adhoc',
      sha256: sha256(items.map(it => it.id || it.item_id)),
    },
    arms,
    pair,
    solver: study.solver || { model: fixtureMode ? 'fixture-model' : process.env.SOLVER_MODEL, effort: null },
    judges,
    items,
    trials: args.trials || study.trials || 1,
    seed: args.seed != null ? args.seed : (study.seed != null ? study.seed : 0),
    solve: fixtureMode ? fixtureSolve(study) : liveSolve(study),
    judge: fixtureMode
      ? makeItemAwareJudge(study, fixtureJudge(study))
      : panelJudge,
    createdAt: study.created_at,
    retainResponseText: study.retain_response_text === true,
  };

  if (fixtureMode) {
    runOptions.buildJudgePrompt = ({ item, responseA, responseB }) => {
      const problem = item.prompt || item.problem || item.text || '';
      const id = item.id || item.item_id || '';
      return [
        `Pairwise fixture judge [item_id=${id}]`,
        '',
        '=== PROBLEM ===',
        problem,
        '',
        '=== RESPONSE A ===',
        responseA,
        '',
        '=== RESPONSE B ===',
        responseB,
        '',
        '=== END ===',
      ].join('\n');
    };
  } else {
    runOptions.buildPrompt = ({ item, armId }) => {
      const problem = item.prompt || item.problem || item.text || '';
      const arm = armById.get(armId);
      const guide = arm && (arm.skillContent || arm.skill_content || arm.instruction || arm.prompt);
      if (armId === 'none') {
        return `Answer the problem directly without using a named thinking-skill guide.\n\n${problem}`;
      }
      if (!guide) throw new Error(`live arm ${armId} is missing skillContent/instruction`);
      return `Use the following reasoning guide to answer the problem. Apply it substantively without naming the guide.\n\n=== GUIDE ===\n${guide}\n=== END GUIDE ===\n\n${problem}`;
    };
  }

  const envelope = await runPairwiseItems(runOptions);
  const validation = validateResultEnvelope(envelope);
  if (!validation.ok) {
    console.error('run-pairwise: envelope validation failed:\n' + validation.errors.join('\n'));
    process.exit(2);
  }

  const outPath = args.out || process.env.OUTFILE;
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    console.log(`wrote ${outPath}`);
  } else {
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  }

  const h = envelope.health;
  const s = envelope.statistics || {};
  console.error(
    `pairwise: attempted=${h.attempted} completed=${h.completed} parsed=${h.parsed} scored=${h.scored} ` +
    `failures=${h.failures} eligible=${h.decision_eligible} ` +
    `W/L/T=${s.wins || 0}/${s.losses || 0}/${s.ties || 0}`
  );
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
