#!/usr/bin/env node
'use strict';

/**
 * Replication Runner — enforces primary sample AND fresh replication sample.
 *
 * Guardrail: REFUSES to mark ELEVATE when replication is missing (exits non-zero
 * or emits a non-ELEVATE verdict like REPLICATION-MISSING / DIRECTIONAL-NOT-REPLICATED).
 * Yields ELEVATE only when BOTH a primary pass (>=5pp, passes paired test) AND a
 * same-direction replication pass are present; opposite-direction/failed replication
 * yields DIRECTIONAL-NOT-REPLICATED.
 *
 * Exposes a pure verdict() function so the guardrail is unit-testable offline.
 *
 * Usage:
 *   node evals/run-replication.js <primary-results.json> --replication=<replication-results.json>
 *   EVAL_RUN=smoke LIMIT=4 node evals/run-replication.js primary.jsonl --replication=replication.jsonl
 *
 * The runner accepts either:
 * - Pretty-JSON result files from objective runners (with delta_pp, mcnemar_p, significant, n)
 * - JSONL result files from paired experiments (with delta_pp, p_value, direction fields)
 * - Direct object input to verdict() for unit testing
 */

const fs = require('fs');
const path = require('path');
const { mcnemarMidp, meanPairedRiskDiff, clusterBootstrapPairedRiskDiff } = require('./lib/stats');

/** Verdict taxonomy (must match architecture.md) */
const VERDICT = {
  ELEVATE: 'ELEVATE',
  DIRECTIONAL_NOT_REPLICATED: 'DIRECTIONAL-NOT-REPLICATED',
  NO_LIFT: 'NO-LIFT',
  QUARANTINE_REDIRECT: 'QUARANTINE-REDIRECT',
  CEILING_NEEDS_HARDER_DATA: 'CEILING-NEEDS-HARDER-DATA',
  REPLICATION_MISSING: 'REPLICATION-MISSING',
};

/**
 * Pure verdict function — no side effects, no I/O, unit-testable.
 *
 * Accepts flexible input format:
 * - delta_pp: number (required) — percentage point difference
 * - p or p_value: number (required) — p-value from paired test
 * - direction: 1|-1 (optional, inferred from delta_pp sign if missing)
 * - n: number (optional) — sample size
 *
 * @param {Object} input
 * @param {Object|null} input.primary - Primary sample result (required for ELEVATE)
 * @param {Object|null} input.replication - Fresh replication sample (required for ELEVATE)
 * @returns {string} One of VERDICT values
 */
function verdict({ primary = null, replication = null }) {
  // Guardrail: NO replication sample provided → cannot ELEVATE
  if (!replication) {
    return VERDICT.REPLICATION_MISSING;
  }

  // Normalize inputs to handle both p/p_value and infer direction
  const normPrimary = normalizeSample(primary);
  const normReplication = normalizeSample(replication);

  // Primary must exist and pass (>=5pp AND passes paired test p < 0.05)
  if (!normPrimary || !passesThreshold(normPrimary)) {
    return VERDICT.NO_LIFT;
  }

  // Replication must pass
  if (!passesThreshold(normReplication)) {
    return VERDICT.DIRECTIONAL_NOT_REPLICATED;
  }

  // Check direction consistency (sign of delta_pp)
  if (Math.sign(normPrimary.delta_pp) !== Math.sign(normReplication.delta_pp)) {
    return VERDICT.DIRECTIONAL_NOT_REPLICATED;
  }

  // Both pass and same direction → ELEVATE
  return VERDICT.ELEVATE;
}

/** Normalize sample object to internal format */
function normalizeSample(s) {
  if (!s) return null;
  const pValue = s.p_value ?? s.p;
  if (typeof pValue !== 'number') return null;
  if (typeof s.delta_pp !== 'number') return null;
  return {
    delta_pp: s.delta_pp,
    p_value: pValue,
    direction: (s.direction === 1 || s.direction === -1) ? s.direction : Math.sign(s.delta_pp) || 1,
    n: s.n,
  };
}

/**
 * Check if sample meets the ELEVATE threshold:
 * - delta_pp >= 5 (at least 5 percentage points POSITIVE lift — NEVER use Math.abs;
 *   a replicated negative delta must NOT qualify for ELEVATE)
 * - p_value < 0.05 (passes paired statistical test)
 */
function passesThreshold(s) {
  return s != null &&
    typeof s.delta_pp === 'number' &&
    s.delta_pp >= 5 &&           // POSITIVE lift only — NO Math.abs
    typeof s.p_value === 'number' &&
    s.p_value < 0.05;
}

/**
 * Aggregate JSONL rows into one sample summary.
 * Supports:
 *  - pre-aggregated rows with delta_pp + p_value
 *  - paired binary rows with treatment/control or skill_correct/placebo_correct
 * Never silently drops unparseable lines — they count as failures.
 */
function aggregateJsonlRows(results) {
  if (!results || results.length === 0) {
    return { delta_pp: 0, p_value: 1, n: 0, failures: 0, rows: 0 };
  }

  // Path A: rows already carry delta_pp (and optionally p)
  const withDelta = results.filter(r => r && typeof r.delta_pp === 'number');
  if (withDelta.length === results.length) {
    const n = withDelta.length;
    const meanDelta = withDelta.reduce((s, r) => s + r.delta_pp, 0) / n;
    // Prefer min p (most conservative) when multiple p-values present; else 1
    const ps = withDelta.map(r => r.p_value ?? r.p ?? r.mcnemar_p).filter(p => typeof p === 'number');
    const p_value = ps.length ? Math.max(...ps) : 1;
    const nField = withDelta.reduce((s, r) => s + (typeof r.n === 'number' ? r.n : 1), 0);
    return {
      delta_pp: +meanDelta.toFixed(6),
      p_value,
      n: nField,
      rows: n,
      failures: 0,
      aggregation: 'mean_delta_pp',
    };
  }

  // Path B: paired binary observations
  const obs = [];
  let failures = 0;
  for (const r of results) {
    if (!r || typeof r !== 'object') { failures++; continue; }
    let t = r.treatment ?? r.skill_correct ?? r.skill ?? r.lean;
    let c = r.control ?? r.placebo_correct ?? r.placebo ?? r.none;
    if (typeof t === 'boolean') t = t ? 1 : 0;
    if (typeof c === 'boolean') c = c ? 1 : 0;
    if (typeof t !== 'number' || typeof c !== 'number' || !Number.isFinite(t) || !Number.isFinite(c)) {
      failures++;
      continue;
    }
    obs.push({
      treatment: t,
      control: c,
      item_id: r.item_id || r.id,
      leakage_family: r.leakage_family || r.cluster_id,
    });
  }

  if (obs.length === 0) {
    return { delta_pp: 0, p_value: 1, n: 0, failures, rows: results.length, aggregation: 'empty' };
  }

  const rd = meanPairedRiskDiff(obs);
  let b = 0, cCount = 0;
  for (const o of obs) {
    const t = Number(o.treatment) ? 1 : 0;
    const ctrl = Number(o.control) ? 1 : 0;
    if (t === 1 && ctrl === 0) b++;
    else if (t === 0 && ctrl === 1) cCount++;
  }
  const p_value = mcnemarMidp(b, cCount);
  // Optional bootstrap CI kept for diagnostics (deterministic seed)
  const boot = clusterBootstrapPairedRiskDiff(obs, { seed: 1, resamples: 200 });

  return {
    delta_pp: +(rd * 100).toFixed(6),
    p_value,
    n: obs.length,
    rows: results.length,
    failures,
    discordant: { b, c: cCount },
    bootstrap_ci: boot.ci,
    aggregation: 'paired_binary',
  };
}

/**
 * Parse a result file, accepting both pretty-JSON (objective-runner schema
 * with delta_pp / mcnemar_p / significant) and JSONL (one object per line).
 *
 * Pretty-JSON schema (legacy objective runners / generic envelope aggregates):
 *   { delta_pp, mcnemar_p, significant, n, ... }
 *
 * JSONL schema (paired experiment runners):
 *   { delta_pp, p_value, direction, n, ... } per line
 *   OR { treatment, control } / { skill_correct, placebo_correct } per line
 *
 * Returns normalized { delta_pp, p_value, n } or null if unparseable/empty.
 */
function parseResultsFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) return null;

  // Try pretty-JSON first (single object with delta_pp / mcnemar_p / significant)
  try {
    const obj = JSON.parse(text);
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj) && typeof obj.delta_pp === 'number') {
      const p_value = obj.mcnemar_p ?? obj.p_value ?? null;
      if (p_value !== null) {
        return {
          delta_pp: obj.delta_pp,
          p_value,
          n: obj.n ?? null,
          aggregation: 'pretty_json',
        };
      }
    }
    // Array of objects
    if (Array.isArray(obj)) {
      return aggregateJsonlRows(obj);
    }
  } catch (e) {
    // Not valid JSON — fall through to JSONL
  }

  // Try JSONL (one JSON object per line)
  const lines = text.split('\n').filter(l => l.trim());
  const results = [];
  const parseFailures = [];
  lines.forEach((line, i) => {
    try {
      results.push(JSON.parse(line));
    } catch (e) {
      parseFailures.push({ line: i + 1, message: e.message });
    }
  });

  if (results.length === 0 && parseFailures.length > 0) {
    throw new Error(`Invalid JSONL: ${parseFailures.length} unparseable line(s); first: line ${parseFailures[0].line}: ${parseFailures[0].message}`);
  }

  if (results.length === 0) return null;

  const agg = aggregateJsonlRows(results);
  if (parseFailures.length) {
    agg.failures = (agg.failures || 0) + parseFailures.length;
    agg.parse_failures = parseFailures.length;
  }
  return agg;
}

/** CLI entry point */
async function main() {
  const args = process.argv.slice(2);
  const primaryPath = args.find(a => !a.startsWith('--'));
  const replicationPath = args.find(a => a.startsWith('--replication='))?.split('=')[1];

  if (!primaryPath) {
    console.error('Usage: node evals/run-replication.js <primary-results.json> [--replication=<replication-results.json>]');
    console.error('  Accepts pretty-JSON (delta_pp/mcnemar_p/significant) or JSONL');
    process.exit(1);
  }

  const primary = parseResultsFile(path.resolve(primaryPath));
  const replication = replicationPath ? parseResultsFile(path.resolve(replicationPath)) : null;

  const v = verdict({ primary, replication });
  console.log(`VERDICT: ${v}`);
  if (primary) console.log(`primary: delta_pp=${primary.delta_pp} p=${primary.p_value} n=${primary.n}`);
  if (replication) console.log(`replication: delta_pp=${replication.delta_pp} p=${replication.p_value} n=${replication.n}`);

  // Exit non-zero for non-ELEVATE verdicts (guardrail enforcement)
  if (v !== VERDICT.ELEVATE) {
    process.exit(1);
  }
}

module.exports = {
  verdict,
  VERDICT,
  parseResultsFile,
  passesThreshold,
  normalizeSample,
  aggregateJsonlRows,
};

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
