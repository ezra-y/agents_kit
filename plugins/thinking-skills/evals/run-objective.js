#!/usr/bin/env node
'use strict';

/**
 * Generic paired objective engine.
 *
 * Supports deterministic fixture mode, authenticated live study files, and
 * dataset/scorer registry-style inputs.
 *
 * Usage:
 *   node evals/run-objective.js --fixture path/to/fixture.json
 *   node evals/run-objective.js --study path/to/study.json
 *   FIXTURE=1 node evals/run-objective.js --dataset path.jsonl --scorer boolean --arms none
 *
 * Fixture JSON shape:
 *   {
 *     "study_id", "study_version", "preregistration_sha256",
 *     "dataset": { source, version, split, sha256 },
 *     "solver": { model, effort },
 *     "scorer": "boolean",
 *     "arms": [{ "id": "none" }, { "id": "skill", "skillContent": "..." }],
 *     "items": [{ "id", "prompt", "label"|..., "fixture_responses": { "none": "ANSWER: Yes", ... } }],
 *     "trials": 1
 *   }
 */

const fs = require('fs');
const path = require('path');
const { sha256 } = require('./lib/result');
const { runObjectiveItems, SCORERS } = require('./lib/objective');
const { executeDroid, usageSummary } = require('./lib/droid');
const { normalizeCondition } = require('./lib/conditions');

function usage(code = 0) {
  const msg = `Usage:
  node evals/run-objective.js --fixture <file.json>
  node evals/run-objective.js --study <file.json>
  node evals/run-objective.js --dataset <file.jsonl> --scorer <name> [--arms none] [--out file]

Environment:
  FIXTURE=1          require fixture_responses; never call a model
  SOLVER_MODEL       solver model id
  SOLVER_EFFORT      solver effort
  LIMIT              max dataset items
  OUTFILE / --out    write envelope JSON
`;
  if (code) console.error(msg);
  else console.log(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { arms: null, dataset: null, fixture: null, study: null, scorer: null, out: null, trials: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') usage(0);
    else if (a === '--fixture') out.fixture = argv[++i];
    else if (a === '--study') out.study = argv[++i];
    else if (a === '--dataset') out.dataset = argv[++i];
    else if (a === '--scorer') out.scorer = argv[++i];
    else if (a === '--arms') out.arms = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--trials') out.trials = parseInt(argv[++i], 10);
    else if (a.startsWith('-')) {
      console.error(`unknown flag: ${a}`);
      usage(1);
    }
  }
  return out;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function datasetShaFromItems(items, sourcePath) {
  return sha256({ source: sourcePath, items: items.map((it) => it.id || it.item_id) });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtureMode = process.env.FIXTURE === '1' || Boolean(args.fixture);

  let study;
  if (args.fixture) {
    study = loadJson(path.resolve(args.fixture));
  } else if (args.study) {
    study = loadJson(path.resolve(args.study));
  } else if (args.dataset) {
    const datasetPath = path.resolve(args.dataset);
    let items = loadJsonl(datasetPath);
    if (process.env.LIMIT) items = items.slice(0, parseInt(process.env.LIMIT, 10));
    const scorer = args.scorer || process.env.SCORER;
    if (!scorer || !SCORERS[String(scorer).toLowerCase().replace(/-/g, '_')]) {
      console.error(`scorer required and must be one of: ${Object.keys(SCORERS).join(', ')}`);
      process.exit(1);
    }
    const armIds = (args.arms || process.env.ARMS || 'none').split(',').map((s) => s.trim()).filter(Boolean);
    study = {
      study_id: process.env.STUDY_ID || 'objective-adhoc',
      study_version: process.env.STUDY_VERSION || '0',
      preregistration_sha256: process.env.PREREG_SHA256 || sha256('adhoc'),
      dataset: {
        source: datasetPath,
        version: process.env.DATASET_VERSION || '0',
        split: process.env.DATASET_SPLIT || 'adhoc',
        sha256: datasetShaFromItems(items, datasetPath),
      },
      solver: {
        model: process.env.SOLVER_MODEL || 'fixture-model',
        effort: process.env.SOLVER_EFFORT || null,
      },
      scorer,
      arms: armIds.map((id) => ({ id: normalizeCondition(id) === 'none' ? 'none' : id })),
      items,
      trials: args.trials || 1,
    };
  } else {
    usage(1);
  }

  const liveSolve = fixtureMode
    ? null
    : async ({ prompt }) => {
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

  const envelope = await runObjectiveItems({
    studyId: study.study_id || study.studyId,
    studyVersion: study.study_version || study.studyVersion || '1',
    preregistrationSha256: study.preregistration_sha256 || study.preregistrationSha256,
    dataset: study.dataset,
    arms: study.arms,
    solver: study.solver || { model: 'fixture-model' },
    items: study.items,
    trials: study.trials || 1,
    scorer: study.scorer,
    scorerOptions: study.scorerOptions || {},
    judges: study.judges || [],
    fixtureMode,
    solve: liveSolve,
    createdAt: study.created_at,
    statistics: study.statistics,
  });

  const outPath = args.out || process.env.OUTFILE;
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    console.log(`wrote ${outPath}`);
  } else {
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  }

  const h = envelope.health;
  console.error(`objective: attempted=${h.attempted} completed=${h.completed} scored=${h.scored} failures=${h.failures} eligible=${h.decision_eligible}`);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
