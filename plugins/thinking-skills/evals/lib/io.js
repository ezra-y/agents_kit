'use strict';

const fs = require('fs');
const path = require('path');
const {
  checkpointKey,
  observationCheckpointKey,
} = require('./result');

const RESULTS_ROOT = path.join(__dirname, '..', 'results');

let tmpCounter = 0;

/** Shared run directory. Set EVAL_RUN to group tiers into one folder. */
function runDir() {
  const id = process.env.EVAL_RUN || 'latest';
  const dir = path.join(RESULTS_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

/**
 * Atomic JSON write: write to a same-directory temp file, then rename.
 * Survives process crash mid-write without leaving a truncated destination.
 */
function writeJsonAtomic(file, obj, opts = {}) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${tmpCounter++}.${Date.now()}.tmp`
  );
  const body = opts.pretty === false
    ? JSON.stringify(obj)
    : JSON.stringify(obj, null, 2);
  try {
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw err;
  }
  return file;
}

function readJsonIfExists(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/**
 * Persist a study-level checkpoint keyed by the common compatibility key.
 * File name is `<checkpointKey>.json` under `dir`.
 */
function writeStudyCheckpoint(dir, compatibilitySpec, payload = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const key = checkpointKey(compatibilitySpec);
  const file = path.join(dir, `${key}.json`);
  const body = {
    ...payload,
    checkpoint_key: key,
    written_at: payload.written_at || new Date().toISOString(),
  };
  writeJsonAtomic(file, body);
  return { key, file, body };
}

/**
 * Persist a per-observation checkpoint keyed by
 * observationCheckpointKey({compatibilityKey,itemId,trial,armId}).
 */
function writeObservationCheckpoint(dir, observationSpec, payload = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const key = observationCheckpointKey(observationSpec);
  const file = path.join(dir, `${key}.json`);
  const body = {
    ...payload,
    observation_checkpoint_key: key,
    compatibility_key: observationSpec.compatibilityKey,
    item_id: observationSpec.itemId,
    trial: observationSpec.trial,
    arm_id: observationSpec.armId,
    written_at: payload.written_at || new Date().toISOString(),
  };
  writeJsonAtomic(file, body);
  return { key, file, body };
}

function readStudyCheckpoint(dir, compatibilitySpec) {
  const key = checkpointKey(compatibilitySpec);
  return readJsonIfExists(path.join(dir, `${key}.json`));
}

function readObservationCheckpoint(dir, observationSpec) {
  const key = observationCheckpointKey(observationSpec);
  return readJsonIfExists(path.join(dir, `${key}.json`));
}

/** Map a thunk over items with a bounded concurrency pool. */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { results[i] = await fn(items[i], i); }
      catch (e) { results[i] = { __error: String(e && e.message || e) }; }
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/** spawnSync-based droid is blocking; wrap so the pool can interleave timers. */
function deferred(fn) {
  return () => new Promise((resolve) => { setImmediate(() => resolve(fn())); });
}

/** Build explicit warnings[] from run_health when failure noise is material. */
function runHealthWarnings(runHealth, opts = {}) {
  const warnings = [];
  const threshold = opts.failureThreshold || 0.05;
  if (!runHealth) return warnings;
  const failures = runHealth.solver_failures || 0;
  const calls = runHealth.solver_calls || 0;
  const rate = runHealth.failure_rate || (calls ? failures / calls : 0);
  if (failures > 0) {
    warnings.push({
      severity: rate >= threshold ? 'major' : 'minor',
      code: 'solver_failure_rate_high',
      message: `${failures} unresolved solver failure(s) out of ${calls} call(s); artifact is ${rate >= threshold ? 'diagnostic only' : 'usable with caveats'}`,
    });
  }
  if (runHealth.decision_eligible === false) {
    warnings.push({
      severity: 'major',
      code: 'not_decision_eligible',
      message: 'Solver failures present; artifact should not drive confirmatory claims',
    });
  }
  return warnings;
}

module.exports = {
  RESULTS_ROOT,
  runDir,
  writeJson,
  writeJsonAtomic,
  readJsonIfExists,
  writeStudyCheckpoint,
  writeObservationCheckpoint,
  readStudyCheckpoint,
  readObservationCheckpoint,
  mapPool,
  deferred,
  runHealthWarnings,
};
