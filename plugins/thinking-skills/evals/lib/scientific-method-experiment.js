'use strict';

const path = require('path');
const { sha256 } = require('./result');
const { holmAdjustment, mcnemar } = require('./stats');

function eligibleLocalizationItems(items) {
  return (items || []).filter((item) => {
    if (!item || !item.id || item.mode !== 'swe-localize') return false;
    if (!Array.isArray(item.gold_files) || item.gold_files.length === 0) return false;
    const prompt = String(item.prompt || '').toLowerCase();
    return item.gold_files.every((gold) => {
      const normalized = String(gold || '').replace(/\\/g, '/').toLowerCase();
      const basename = path.posix.basename(normalized);
      return normalized && !prompt.includes(normalized) && !prompt.includes(basename);
    });
  });
}

function freezeDisjointSplits(items, options = {}) {
  const seed = options.seed == null ? 'scientific-method-vnext' : String(options.seed);
  const sizes = options.sizes || {};
  const entries = Object.entries(sizes);
  const required = entries.reduce((sum, [, size]) => sum + Number(size || 0), 0);
  const excluded = new Set((options.excludeIds || []).map(String));
  const eligible = eligibleLocalizationItems(items)
    .filter((item) => !excluded.has(String(item.id)));
  if (eligible.length < required) {
    throw new Error(`split design requires ${required} eligible items, found ${eligible.length}`);
  }

  const ordered = eligible.slice().sort((a, b) => {
    const left = sha256(`${seed}:${a.repo || ''}:${a.id}`);
    const right = sha256(`${seed}:${b.repo || ''}:${b.id}`);
    return left.localeCompare(right) || String(a.id).localeCompare(String(b.id));
  });

  const splits = {};
  let offset = 0;
  for (const [name, rawSize] of entries) {
    const size = Number(rawSize);
    if (!Number.isInteger(size) || size < 0) throw new TypeError(`invalid split size for ${name}`);
    splits[name] = ordered.slice(offset, offset + size).map((item) => String(item.id));
    offset += size;
  }
  return splits;
}

function median(values) {
  const sorted = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rowTotalTokens(row) {
  const usage = (row && row.usage) || {};
  if (Number.isFinite(usage.total_tokens)) return usage.total_tokens;
  return Number(usage.input_tokens || 0)
    + Number(usage.output_tokens || 0)
    + Number(usage.cached_tokens || usage.cache_read_tokens || 0)
    + Number(usage.cache_creation_tokens || 0);
}

function usageSummary(rows) {
  const usageRows = rows || [];
  return {
    n: usageRows.length,
    median_input_tokens: median(usageRows.map((row) => Number(row.usage && row.usage.input_tokens || 0))),
    median_output_tokens: median(usageRows.map((row) => Number(row.usage && row.usage.output_tokens || 0))),
    median_total_tokens: median(usageRows.map(rowTotalTokens)),
    median_latency_ms: median(usageRows.map((row) => Number(row.usage && row.usage.latency_ms || row.duration_ms || 0))),
    median_estimated_cost_usd: median(usageRows.map((row) => Number(row.usage && row.usage.estimated_cost_usd || 0))),
    total_estimated_cost_usd: usageRows.reduce(
      (sum, row) => sum + Number(row.usage && row.usage.estimated_cost_usd || 0),
      0,
    ),
  };
}

function pairedContrast(envelope, leftArm, rightArm) {
  const units = new Map();
  for (const row of (envelope && envelope.items) || []) {
    const key = `${row.item_id}::${row.trial || 1}`;
    if (!units.has(key)) units.set(key, {});
    if (row.arm_id === leftArm) units.get(key).left = row;
    if (row.arm_id === rightArm) units.get(key).right = row;
  }
  const pairs = [...units.values()].filter((unit) => unit.left && unit.right);
  const n = pairs.length;
  const leftCorrect = pairs.filter((unit) => unit.left.correct === true).length;
  const rightCorrect = pairs.filter((unit) => unit.right.correct === true).length;
  const leftWins = pairs.filter(
    (unit) => unit.left.correct === true && unit.right.correct !== true,
  ).length;
  const rightWins = pairs.filter(
    (unit) => unit.left.correct !== true && unit.right.correct === true,
  ).length;
  const p = mcnemar(leftWins, rightWins);
  return {
    n,
    left_arm: leftArm,
    right_arm: rightArm,
    left_accuracy: n ? leftCorrect / n : null,
    right_accuracy: n ? rightCorrect / n : null,
    delta_pp: n ? ((leftCorrect - rightCorrect) / n) * 100 : 0,
    p_value: p,
    discordant: leftWins + rightWins,
    left_wins: leftWins,
    right_wins: rightWins,
  };
}

function analyzeObjectiveEnvelope(envelope, options = {}) {
  const controlArm = options.controlArm || 'none';
  const leanArm = options.leanArm || 'lean';
  const candidateArms = options.candidateArms || [];
  const rows = (envelope && envelope.items) || [];
  const armIds = [...new Set(rows.map((row) => row.arm_id))];
  const usageByArm = Object.fromEntries(
    armIds.map((armId) => [armId, usageSummary(rows.filter((row) => row.arm_id === armId))]),
  );
  const candidates = {};
  for (const armId of candidateArms) {
    candidates[armId] = {
      vs_none: pairedContrast(envelope, armId, controlArm),
      vs_lean: pairedContrast(envelope, armId, leanArm),
    };
  }
  const adjusted = holmAdjustment(candidateArms.map((armId) => ({
    id: armId,
    p: candidates[armId].vs_none.p_value,
  })));
  for (const result of adjusted) {
    candidates[result.id].vs_none.p_adjusted = result.p_adjusted;
    candidates[result.id].vs_none.holm_rank = result.rank;
  }
  return {
    control_arm: controlArm,
    lean_arm: leanArm,
    health: { ...((envelope && envelope.health) || {}) },
    usage_by_arm: usageByArm,
    candidates,
  };
}

function evaluateCandidateGate(analysis, candidateArm, options = {}) {
  const stage = options.stage || 'pilot';
  const candidate = analysis && analysis.candidates && analysis.candidates[candidateArm];
  const leanArm = (analysis && analysis.lean_arm) || options.leanArm || 'lean';
  const candidateUsage = analysis && analysis.usage_by_arm && analysis.usage_by_arm[candidateArm];
  const leanUsage = analysis && analysis.usage_by_arm && analysis.usage_by_arm[leanArm];
  const reasons = [];
  if (!candidate) reasons.push('candidate contrast missing');
  if (!candidateUsage || !leanUsage) reasons.push('usage summary missing');
  if (analysis && analysis.health && analysis.health.decision_eligible === false) {
    reasons.push('run is not decision eligible');
  }
  if (!candidate || !candidateUsage || !leanUsage) return { pass: false, stage, reasons };

  const maxTokenRatio = stage === 'pilot' ? 1.05 : 1;
  const tokenRatio = leanUsage.median_total_tokens
    ? candidateUsage.median_total_tokens / leanUsage.median_total_tokens
    : Infinity;
  if (tokenRatio > maxTokenRatio) reasons.push(`median token ratio ${tokenRatio.toFixed(3)} exceeds ${maxTokenRatio}`);

  if (stage === 'pilot') {
    if (candidate.vs_lean.delta_pp < 0) reasons.push('accuracy is lower than current lean');
  } else {
    const minN = Number(options.minN || 100);
    if (candidate.vs_none.n < minN) reasons.push(`paired n ${candidate.vs_none.n} is below ${minN}`);
    if (candidate.vs_none.delta_pp < 5) reasons.push('lift versus no-skill is below 5pp');
    if (!(candidate.vs_none.p_adjusted < 0.05)) reasons.push('Holm-adjusted p is not below .05');
  }

  return {
    pass: reasons.length === 0,
    stage,
    candidate_arm: candidateArm,
    token_ratio_vs_lean: tokenRatio,
    reasons,
  };
}

module.exports = {
  eligibleLocalizationItems,
  freezeDisjointSplits,
  analyzeObjectiveEnvelope,
  evaluateCandidateGate,
  median,
  rowTotalTokens,
};
