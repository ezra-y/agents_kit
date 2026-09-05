'use strict';

const path = require('path');
const { createResultEnvelope, defaultUsage, sha256 } = require('./result');

function resolveFocusedCandidate(env = process.env) {
  const value = String(env.SCI_FOCUSED_CANDIDATE || '').trim();
  if (!value) return null;
  if (!/^candidate-\d{2}$/.test(value)) {
    throw new Error(`invalid focused candidate: ${value}`);
  }
  return value;
}

function assertStudyRuntime(manifest, runtime = {}) {
  if (runtime.studyVersion != null
    && String(manifest.study_version) !== String(runtime.studyVersion)) {
    throw new Error(`study version mismatch: manifest=${manifest.study_version} runtime=${runtime.studyVersion}`);
  }
  if (runtime.focusedCandidate != null
    && manifest.focused_candidate !== runtime.focusedCandidate) {
    throw new Error('focused candidate mismatch');
  }
  if (runtime.allowParseFailures != null) {
    const pinned = Boolean(
      manifest.health_policy
      && manifest.health_policy.parse_failures_are_itt_incorrect,
    );
    if (pinned !== Boolean(runtime.allowParseFailures)) {
      throw new Error('parse health policy mismatch');
    }
  }
  if (runtime.leanSha256 != null
    && (!manifest.current_lean || manifest.current_lean.sha256 !== runtime.leanSha256)) {
    throw new Error('lean skill hash mismatch');
  }
  if (runtime.candidateSha256 != null) {
    const pinnedCandidate = (manifest.variants || [])
      .find((entry) => entry.id === runtime.focusedCandidate);
    if (!pinnedCandidate || pinnedCandidate.sha256 !== runtime.candidateSha256) {
      throw new Error('focused candidate hash mismatch');
    }
  }
}

function extractFocusedSplits(sourceArtifact, expectedCounts = {}) {
  const sourceSplits = (sourceArtifact && sourceArtifact.splits) || {};
  const focused = {};
  for (const stage of ['confirmation', 'replication']) {
    const split = sourceSplits[stage];
    if (!split || !Array.isArray(split.ids)) {
      throw new Error(`${stage} split is missing`);
    }
    const expected = Number(expectedCounts[stage]);
    if (Number.isFinite(expected) && split.ids.length !== expected) {
      throw new Error(`${stage} split requires ${expected} items, found ${split.ids.length}`);
    }
    focused[stage] = split;
  }
  return focused;
}

function resolveStudyVersion(env = process.env) {
  const value = String(env.SCI_STUDY_VERSION || '1');
  if (!/^[1-9]\d*$/.test(value)) throw new Error('SCI_STUDY_VERSION must be a positive integer');
  return value;
}

function resolveDatasetPath(env, defaultPath, cwd = process.cwd()) {
  return env && env.SCI_DATASET_PATH
    ? path.resolve(cwd, env.SCI_DATASET_PATH)
    : defaultPath;
}

function createCallBudget(options = {}) {
  const maxCalls = Number.isFinite(options.maxCalls) ? options.maxCalls : Infinity;
  const maxEstimatedCostUsd = Number.isFinite(options.maxEstimatedCostUsd)
    ? options.maxEstimatedCostUsd
    : Infinity;
  let calls = Number(options.initialCalls || 0);
  let estimatedCostUsd = Number(options.initialEstimatedCostUsd || 0);
  let reservedCalls = 0;

  return {
    reserve(count = 1) {
      const requested = Number(count);
      if (!Number.isInteger(requested) || requested < 1) {
        throw new TypeError('reserved call count must be a positive integer');
      }
      if (calls + reservedCalls + requested > maxCalls) {
        throw new Error(`call cap ${maxCalls} reached`);
      }
      if (estimatedCostUsd >= maxEstimatedCostUsd) {
        throw new Error(`estimated cost cap ${maxEstimatedCostUsd} reached`);
      }
      reservedCalls += requested;
    },
    release(count = 1) {
      reservedCalls = Math.max(0, reservedCalls - Number(count || 0));
    },
    record(usage = {}, reservedCount = 1) {
      reservedCalls = Math.max(0, reservedCalls - Number(reservedCount || 0));
      calls += Number(usage.calls == null ? 1 : usage.calls);
      estimatedCostUsd += Number(
        usage.estimated_cost_usd == null ? usage.est_cost_usd || 0 : usage.estimated_cost_usd,
      );
    },
    snapshot() {
      return {
        calls,
        reserved_calls: reservedCalls,
        estimated_cost_usd: estimatedCostUsd,
        max_calls: maxCalls,
        max_estimated_cost_usd: maxEstimatedCostUsd,
      };
    },
  };
}

function sumUsage(summaries) {
  const out = defaultUsage();
  for (const summary of summaries || []) {
    const usage = defaultUsage(summary);
    out.input_tokens += usage.input_tokens;
    out.output_tokens += usage.output_tokens;
    out.cached_tokens += usage.cached_tokens;
    out.cache_creation_tokens += usage.cache_creation_tokens;
    out.total_tokens += usage.total_tokens;
    out.calls += usage.calls;
    out.latency_ms += usage.latency_ms;
    out.estimated_cost_usd += usage.estimated_cost_usd;
  }
  return out;
}

function mergeObjectiveEnvelopes(envelopes) {
  const parts = (envelopes || []).filter(Boolean);
  if (!parts.length) throw new TypeError('mergeObjectiveEnvelopes: at least one envelope required');
  const first = parts[0];
  for (const part of parts.slice(1)) {
    if (part.study_id !== first.study_id || part.study_version !== first.study_version) {
      throw new Error('cannot merge envelopes from different studies');
    }
    if (!part.dataset || part.dataset.sha256 !== first.dataset.sha256) {
      throw new Error('cannot merge envelopes from different datasets');
    }
  }

  const rows = parts.flatMap((part) => part.items || []);
  const failures = parts.flatMap((part) => part.failures || []);
  const armIds = [...new Set(parts.flatMap((part) => (part.arms || []).map((arm) => arm.id)))];
  const arms = armIds.map((id) => {
    const matching = parts.flatMap((part) => (part.arms || []).filter((arm) => arm.id === id));
    return {
      id,
      prompt_sha256: sha256(matching.map((arm) => arm.prompt_sha256 || null)),
      skill_sha256: matching.find((arm) => arm.skill_sha256)?.skill_sha256 || null,
    };
  });
  const usage = sumUsage(parts.map((part) => part.usage));
  const perArm = {};
  for (const armId of armIds) {
    const armRows = rows.filter((row) => row.arm_id === armId);
    const scored = armRows.filter((row) => row.scored === true);
    const correct = armRows.filter((row) => row.correct === true).length;
    perArm[armId] = {
      attempted: armRows.length,
      completed: armRows.filter((row) => row.completed !== false).length,
      parsed: armRows.filter((row) => row.parsed_success === true || row.parsed != null).length,
      scored: scored.length,
      correct,
      accuracy: armRows.length ? correct / armRows.length : null,
      conditional_accuracy: scored.length
        ? scored.filter((row) => row.correct === true).length / scored.length
        : null,
    };
  }
  const attempted = rows.length;
  const completed = rows.filter((row) => row.completed !== false).length;
  const parsed = rows.filter((row) => row.parsed_success === true || row.parsed != null).length;
  const scored = rows.filter((row) => row.scored === true).length;

  return createResultEnvelope({
    study_id: first.study_id,
    study_version: first.study_version,
    preregistration_sha256: first.preregistration_sha256,
    dataset: first.dataset,
    arms,
    solver: first.solver,
    judges: first.judges || [],
    items: rows,
    failures,
    usage,
    statistics: {
      arm_order_policy: first.statistics && first.statistics.arm_order_policy,
      arm_order_seed: first.statistics && first.statistics.arm_order_seed,
      per_arm: perArm,
    },
    health: {
      attempted,
      completed,
      parsed,
      scored,
      failures: failures.length,
    },
    created_at: first.created_at,
  });
}

function ineligibleHealthReason(stage, envelope) {
  const health = envelope && envelope.health;
  if (!health || health.decision_eligible !== false) return null;
  const failures = Number(health.failures || 0);
  return `${stage} stopped after an item envelope became decision-ineligible (${failures} ${failures === 1 ? 'failure' : 'failures'})`;
}

function applyIttParseHealthPolicy(envelope) {
  const health = { ...((envelope && envelope.health) || {}) };
  const failures = (envelope && envelope.failures) || [];
  const failureCount = Number(health.failures || 0);
  const allRowsCompleted = Number(health.completed || 0) === Number(health.attempted || 0);
  const onlyStrictParseFailures = failures.length === failureCount
    && failures.every((failure) => failure && failure.type === 'parse');
  return {
    ...envelope,
    health: {
      ...health,
      decision_eligible: allRowsCompleted && onlyStrictParseFailures,
    },
  };
}

module.exports = {
  applyIttParseHealthPolicy,
  assertStudyRuntime,
  extractFocusedSplits,
  resolveDatasetPath,
  resolveFocusedCandidate,
  resolveStudyVersion,
  createCallBudget,
  ineligibleHealthReason,
  mergeObjectiveEnvelopes,
  sumUsage,
};
