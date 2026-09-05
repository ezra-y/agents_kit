'use strict';

const crypto = require('crypto');

const FAILURE_TYPES = new Set(['transport', 'timeout', 'tool_leakage', 'parse', 'scoring']);

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = normalize(value[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(normalize(value));
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === 'string' ? value : stableStringify(value));
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function itemKey({ studyId, itemId, trial, armId }) {
  requireText(studyId, 'studyId');
  requireText(itemId, 'itemId');
  requireText(armId, 'armId');
  if (!Number.isInteger(trial) || trial < 1) throw new TypeError('trial must be a positive integer');
  return `${studyId}:${itemId}:${trial}:${armId}`;
}

function checkpointKey(spec) {
  const payload = {
    study_id: requireText(spec.studyId, 'studyId'),
    study_version: requireText(spec.studyVersion, 'studyVersion'),
    dataset_sha256: requireText(spec.datasetSha256, 'datasetSha256'),
    prompt_sha256: requireText(spec.promptSha256, 'promptSha256'),
    skill_sha256: spec.skillSha256 || null,
    solver: requireText(spec.solver, 'solver'),
    judges: [...(spec.judges || [])].sort(),
  };
  return sha256(payload);
}

function observationCheckpointKey({ compatibilityKey, itemId, trial, armId }) {
  requireText(compatibilityKey, 'compatibilityKey');
  requireText(itemId, 'itemId');
  requireText(armId, 'armId');
  if (!Number.isInteger(trial) || trial < 1) throw new TypeError('trial must be a positive integer');
  return sha256({
    compatibility_key: compatibilityKey,
    item_id: itemId,
    trial,
    arm_id: armId,
  });
}

function failureRecord({ type, message, itemId = null, armId = null, trial = null, attempt = null, details = null }) {
  if (!FAILURE_TYPES.has(type)) throw new TypeError(`unsupported failure type: ${type}`);
  return {
    type,
    message: String(message || type),
    item_id: itemId,
    arm_id: armId,
    trial,
    attempt,
    details,
  };
}

function defaultUsage(usage = {}) {
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const cachedTokens = Number(usage.cached_tokens || 0);
  const cacheCreationTokens = Number(usage.cache_creation_tokens || 0);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_tokens: cachedTokens,
    cache_creation_tokens: cacheCreationTokens,
    total_tokens: usage.total_tokens != null
      ? Number(usage.total_tokens)
      : inputTokens + outputTokens + cachedTokens + cacheCreationTokens,
    calls: Number(usage.calls || 0),
    latency_ms: Number(usage.latency_ms || 0),
    estimated_cost_usd: Number(usage.estimated_cost_usd || 0),
  };
}

function deriveHealth(items, failures, supplied = {}) {
  const attempted = supplied.attempted ?? items.length;
  const completed = supplied.completed ?? items.filter(item => item && item.completed !== false).length;
  const parsed = supplied.parsed ?? items.filter(item => (
    item && (item.parsed_success === true || (item.parsed !== undefined && item.parsed !== null))
  )).length;
  const scored = supplied.scored ?? items.filter(item => item && item.scored === true).length;
  const failureCount = supplied.failures ?? failures.length;
  const decisionEligible = supplied.decision_eligible ?? (
    failureCount === 0 && attempted === completed && completed === parsed && parsed === scored
  );
  return {
    attempted,
    completed,
    parsed,
    scored,
    failures: failureCount,
    failure_rate: attempted ? failureCount / attempted : 0,
    decision_eligible: Boolean(decisionEligible),
    ...supplied,
  };
}

function createResultEnvelope(spec) {
  const items = [...(spec.items || [])];
  const failures = [...(spec.failures || [])];
  const judges = [...(spec.judges || [])];
  const arms = [...(spec.arms || [])];
  const solver = typeof spec.solver === 'string'
    ? { model: spec.solver, effort: spec.solverEffort || null }
    : { ...(spec.solver || {}) };
  const dataset = { ...(spec.dataset || {}) };
  const armPromptHash = arms.length === 1 ? arms[0].prompt_sha256 : sha256(arms.map(arm => arm.prompt_sha256 || null));
  const armSkillHash = arms.length === 1 ? arms[0].skill_sha256 : sha256(arms.map(arm => arm.skill_sha256 || null));
  const checkpoint = spec.checkpoint_key || checkpointKey({
    studyId: spec.study_id,
    studyVersion: spec.study_version,
    datasetSha256: dataset.sha256,
    promptSha256: armPromptHash,
    skillSha256: armSkillHash,
    solver: solver.model,
    judges: judges.map(j => typeof j === 'string' ? j : j.model),
  });
  return {
    schema_version: 1,
    study_id: spec.study_id,
    study_version: spec.study_version,
    preregistration_sha256: spec.preregistration_sha256,
    dataset,
    arms,
    solver,
    judges,
    items,
    failures,
    usage: defaultUsage(spec.usage),
    statistics: { ...(spec.statistics || {}) },
    health: deriveHealth(items, failures, spec.health),
    created_at: spec.created_at || new Date().toISOString(),
    checkpoint_key: checkpoint,
  };
}

function validateResultEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== 'object') return { ok: false, errors: ['envelope must be an object'] };
  if (envelope.schema_version !== 1) errors.push('schema_version must equal 1');
  for (const field of ['study_id', 'study_version', 'preregistration_sha256', 'created_at', 'checkpoint_key']) {
    if (typeof envelope[field] !== 'string' || envelope[field].length === 0) errors.push(`${field} must be a non-empty string`);
  }
  if (!envelope.dataset || typeof envelope.dataset !== 'object') errors.push('dataset must be an object');
  else for (const field of ['source', 'version', 'split', 'sha256']) {
    if (typeof envelope.dataset[field] !== 'string' || envelope.dataset[field].length === 0) errors.push(`dataset.${field} must be a non-empty string`);
  }
  if (!Array.isArray(envelope.arms) || envelope.arms.length === 0) errors.push('arms must be a non-empty array');
  if (!envelope.solver || typeof envelope.solver.model !== 'string') errors.push('solver.model must be a string');
  for (const field of ['judges', 'items', 'failures']) if (!Array.isArray(envelope[field])) errors.push(`${field} must be an array`);
  if (!envelope.usage || typeof envelope.usage !== 'object') errors.push('usage must be an object');
  if (!envelope.statistics || typeof envelope.statistics !== 'object') errors.push('statistics must be an object');
  if (!envelope.health || typeof envelope.health !== 'object') errors.push('health must be an object');
  else {
    for (const field of ['attempted', 'completed', 'parsed', 'scored', 'failures']) {
      if (!Number.isInteger(envelope.health[field]) || envelope.health[field] < 0) errors.push(`health.${field} must be a non-negative integer`);
    }
    if (envelope.health.completed > envelope.health.attempted) errors.push('health.completed cannot exceed attempted');
    if (envelope.health.parsed > envelope.health.completed) errors.push('health.parsed cannot exceed completed');
    if (envelope.health.scored > envelope.health.parsed) errors.push('health.scored cannot exceed parsed');
  }
  for (const failure of envelope.failures || []) {
    if (!FAILURE_TYPES.has(failure.type)) errors.push(`unsupported failure type: ${failure.type}`);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  FAILURE_TYPES,
  stableStringify,
  sha256,
  itemKey,
  checkpointKey,
  observationCheckpointKey,
  failureRecord,
  createResultEnvelope,
  validateResultEnvelope,
  defaultUsage,
  deriveHealth,
};
