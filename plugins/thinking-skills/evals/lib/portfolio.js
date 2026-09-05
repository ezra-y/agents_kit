'use strict';

/**
 * Pure portfolio eligibility + Phase-4 disposition gates.
 *
 * No model calls. Missing fields always quarantine. Denominators are never
 * silently shrunk: incomplete strata block terminal positive/delete verdicts.
 */

/** Product disposition codes (machine-readable). */
const PRODUCT_DISPOSITION = Object.freeze({
  AUTO_RETAIN_LEAN: 'auto_retain_lean',
  MINIMIZE_FURTHER: 'minimize_further',
  DELETE: 'delete',
  MANUAL_ONLY_QUARANTINE: 'manual_only_quarantine',
});

/** Human-facing disposition labels from the preregistered algorithm. */
const DISPOSITION_LABEL = Object.freeze({
  [PRODUCT_DISPOSITION.AUTO_RETAIN_LEAN]: 'AUTO-RETAIN LEAN',
  [PRODUCT_DISPOSITION.MINIMIZE_FURTHER]: 'MINIMIZE FURTHER',
  [PRODUCT_DISPOSITION.DELETE]: 'DELETE',
  [PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE]: 'MANUAL-ONLY QUARANTINE',
});

/**
 * Frozen Phase-4 / registry gates. Tests mutation-protect these thresholds.
 * Budget ceiling is the staged portfolio total (USD), not per skill.
 */
const PORTFOLIO_GATES = Object.freeze({
  utility_margin_pp: 5,
  noninferiority_margin_pp: 3,
  harm_margin_pp: 2,
  delete_upper_bound_pp: 3,
  directional_zone_low_pp: 3,
  directional_zone_high_pp: 5,
  lean_input_token_ratio_max: 0.7,
  lean_other_ratio_max: 1.1, // calls, output tokens, latency, cost ≤ full * 1.10
  power_target: 0.9,
  alpha_one_sided: 0.05,
  efficacy_hypotheses: 84,
  portfolio_budget_usd: 2000,
  min_heldout_cases: 20,
  min_hard_negative_cases: 10,
  min_replication_cases: 10,
  nested_trials_screening: 3,
  nested_trials_replication: 5,
  confirmatory_completeness: 1,
  deployment_model_count: 3,
});

/** Metrics that require a calibrated cross-family judge panel. */
const JUDGED_PRIMARY_METRICS = Object.freeze(new Set([
  'pairwise_win_rate_vs_placebo',
  'pairwise_win_rate',
  'judge_preference',
  'open_ended_quality',
  'synthesis_quality',
  'decision_analysis_quality',
]));

/**
 * Primary metrics for which binary-decision applicability labels can be native
 * outcome evidence. Everything else with applicability binary-decision sources
 * is a source/metric mismatch (not reasoning-outcome evidence).
 */
const APPLICABILITY_COMPATIBLE_METRICS = Object.freeze(new Set([
  'skill_applicability_accuracy',
  'applicability_accuracy',
  'binary_applicability_accuracy',
]));

/**
 * Binary-decision labels that are the task outcome itself (not "is skill warranted").
 */
const BINARY_OUTCOME_METRICS = Object.freeze(new Set([
  'domain_classification_accuracy',
  'abstention_accuracy',
  'routing_accuracy',
  'divergence_detection_accuracy',
  'bottleneck_identification_accuracy',
  'consequence_prediction_accuracy',
]));

const DEFAULT_DEPLOYMENT_MODELS = Object.freeze([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
]);

const ELIGIBILITY_BLOCKER = Object.freeze({
  MISSING_SOURCES: 'missing_or_empty_sources',
  DATA_STATUS: 'data_status_not_adequate',
  DATA_GAPS: 'data_gaps_present',
  JUDGE_BLOCKED: 'judge_panel_blocked_for_metric',
  SOURCE_METRIC_MISMATCH: 'applicability_binary_decision_not_native_for_primary_metric',
  HELD_OUT: 'insufficient_heldout_cases',
  HARD_NEG: 'insufficient_hard_negative_cases',
  REPLICATION: 'insufficient_replication_cases',
  POWER_BUDGET: 'power_or_budget_infeasible',
  MISSING_FIELD: 'missing_required_field',
  UNKNOWN_STATUS: 'data_status_unknown',
  INADEQUATE_STATUS: 'data_status_inadequate',
});

const TERMINAL_REPLICATION_OK = Object.freeze(new Set([
  'passed',
  'passed_null',
  'complete',
  'success',
  'successful',
]));

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(list) {
  return [...new Set(list.filter(Boolean))];
}

function deploymentModelsFrom(registry) {
  const models = registry?.models?.deployment;
  if (Array.isArray(models) && models.length > 0) return models.slice();
  return DEFAULT_DEPLOYMENT_MODELS.slice();
}

function gatesFrom(registry) {
  const g = registry?.gates || {};
  return {
    utility_margin_pp: g.utility_margin_pp ?? PORTFOLIO_GATES.utility_margin_pp,
    noninferiority_margin_pp: g.noninferiority_margin_pp ?? PORTFOLIO_GATES.noninferiority_margin_pp,
    harm_margin_pp: g.harm_margin_pp ?? PORTFOLIO_GATES.harm_margin_pp,
    lean_input_token_ratio_max: g.lean_input_token_ratio_max ?? PORTFOLIO_GATES.lean_input_token_ratio_max,
    lean_other_ratio_max:
      g.lean_calls_output_latency_cost_margin != null
        ? 1 + Number(g.lean_calls_output_latency_cost_margin)
        : PORTFOLIO_GATES.lean_other_ratio_max,
    power_target: g.power_target ?? PORTFOLIO_GATES.power_target,
    alpha_one_sided: g.alpha_one_sided ?? PORTFOLIO_GATES.alpha_one_sided,
    efficacy_hypotheses: g.efficacy_hypotheses ?? PORTFOLIO_GATES.efficacy_hypotheses,
    portfolio_budget_usd: g.portfolio_budget_usd ?? PORTFOLIO_GATES.portfolio_budget_usd,
    delete_upper_bound_pp: g.delete_upper_bound_pp ?? PORTFOLIO_GATES.delete_upper_bound_pp,
    directional_zone_low_pp:
      Array.isArray(g.directional_zone_pp) ? g.directional_zone_pp[0] : PORTFOLIO_GATES.directional_zone_low_pp,
    directional_zone_high_pp:
      Array.isArray(g.directional_zone_pp) ? g.directional_zone_pp[1] : PORTFOLIO_GATES.directional_zone_high_pp,
  };
}

function isJudgeDependentMetric(primaryMetric, skill = null) {
  if (!isNonEmptyString(primaryMetric)) return false;
  if (JUDGED_PRIMARY_METRICS.has(primaryMetric)) return true;
  const surface = skill?.primary_value_surface || '';
  if (/paired|pairwise|open.?ended|judge/i.test(surface) && /pairwise|win_rate|quality/i.test(primaryMetric)) {
    return true;
  }
  if (skill?.scoring?.requires_judge === true || skill?.requires_judge === true) return true;
  return false;
}

/**
 * Fail-closed: panel is decision-eligible only when both flags are exact.
 * decision_eligible true with unknown/non-calibrated status → false.
 */
function judgePanelDecisionEligible(registry) {
  const panel = registry?.judge_panel || {};
  return panel.decision_eligible === true && panel.calibration_status === 'calibrated';
}

function sourceIsApplicabilityBinary(source) {
  if (!source || typeof source !== 'object') return false;
  const mode = String(source.mode || source.dataset_mode || '').toLowerCase().replace(/_/g, '-');
  const kind = String(
    source.label_kind || source.evidence_kind || source.label_type || source.outcome_kind || ''
  ).toLowerCase();
  if (kind === 'applicability' || kind === 'skill_applicability' || kind === 'warrant') return true;
  if (source.applicability_labelled === true) return true;
  if (mode === 'binary-decision' || mode === 'binary_decision') {
    if (kind === 'outcome' || kind === 'native_outcome' || kind === 'task_outcome') return false;
    if (source.applicability_labelled === false) return false;
    return kind === '' || kind === 'applicability' || kind === 'binary-decision';
  }
  return false;
}

function sourceIsBinaryDecision(source) {
  if (!source || typeof source !== 'object') return false;
  const mode = String(source.mode || source.dataset_mode || '').toLowerCase().replace(/_/g, '-');
  return mode === 'binary-decision' || mode === 'binary_decision' || source.binary_decision === true;
}

function hasApplicabilitySourceMetricMismatch(skill) {
  const metric = skill?.primary_metric;
  if (!isNonEmptyString(metric)) return { mismatch: true, reason: ELIGIBILITY_BLOCKER.MISSING_FIELD };
  if (APPLICABILITY_COMPATIBLE_METRICS.has(metric)) {
    return { mismatch: false, reason: null };
  }
  const sources = asArray(skill?.data?.sources);
  const applicabilitySources = sources.filter(sourceIsApplicabilityBinary);
  if (applicabilitySources.length === 0) {
    const binaryOnly = sources.length > 0 && sources.every(sourceIsBinaryDecision);
    if (binaryOnly && !BINARY_OUTCOME_METRICS.has(metric) && !APPLICABILITY_COMPATIBLE_METRICS.has(metric)) {
      return { mismatch: true, reason: ELIGIBILITY_BLOCKER.SOURCE_METRIC_MISMATCH };
    }
    return { mismatch: false, reason: null };
  }
  if (!BINARY_OUTCOME_METRICS.has(metric)) {
    return { mismatch: true, reason: ELIGIBILITY_BLOCKER.SOURCE_METRIC_MISMATCH };
  }
  const explicitApplicability = applicabilitySources.some(
    (s) => s.applicability_labelled === true ||
      ['applicability', 'skill_applicability', 'warrant'].includes(
        String(s.label_kind || s.evidence_kind || s.label_type || '').toLowerCase()
      )
  );
  if (explicitApplicability) {
    return { mismatch: true, reason: ELIGIBILITY_BLOCKER.SOURCE_METRIC_MISMATCH };
  }
  return { mismatch: false, reason: null };
}

function readSplitCounts(skill) {
  const data = skill?.data || {};
  const splits = data.row_counts?.splits || data.splits || {};
  const heldout = splits.heldout;
  const replication = splits.replication;
  const hardNeg =
    data.hard_negative_count ??
    data.hard_negatives ??
    splits.hard_negative ??
    splits.hard_negatives ??
    data.row_counts?.hard_negatives ??
    null;
  return { heldout, replication, hardNeg, splits };
}

function requiredMins(skill) {
  const data = skill?.data || {};
  return {
    heldout: data.required_heldout_min ?? PORTFOLIO_GATES.min_heldout_cases,
    hardNeg: data.required_hard_negatives_min ?? PORTFOLIO_GATES.min_hard_negative_cases,
    replication: data.required_replication_min ?? PORTFOLIO_GATES.min_replication_cases,
  };
}

/**
 * Power/budget feasibility — fail-closed when declarations are missing.
 * Requires explicit design, powered=true, achieved_power ≥ target, multiplicity
 * adjustment, finite estimated cost ≤ portfolio ceiling.
 */
function evaluatePowerBudgetFeasibility(skill, registry, options = {}) {
  const reasons = [];
  const gates = gatesFrom(registry);
  const design = options.design || skill?.study_design || skill?.power || skill?.data?.power || null;
  const portfolioBudget = options.portfolio_budget_usd ?? gates.portfolio_budget_usd;

  if (!design || typeof design !== 'object') {
    reasons.push('power/study design missing');
  }

  const estimatedCost =
    options.estimated_cost_usd ??
    design?.estimated_cost_usd ??
    skill?.data?.estimated_cost_usd ??
    null;
  const achievedPower =
    options.achieved_power ??
    design?.achieved_power ??
    null;
  const powerTarget = design?.power_target ?? gates.power_target;

  if (estimatedCost == null) {
    reasons.push('estimated_cost_usd missing');
  } else if (!isFiniteNumber(estimatedCost) || estimatedCost < 0) {
    reasons.push('estimated_cost_usd invalid');
  } else if (estimatedCost > portfolioBudget) {
    reasons.push(
      `estimated_cost_usd ${estimatedCost} exceeds portfolio budget ceiling ${portfolioBudget}`
    );
  }

  if (design && design.powered !== true && options.claim_powered !== true) {
    reasons.push('design.powered must be explicitly true');
  }

  if (!isFiniteNumber(achievedPower)) {
    reasons.push('achieved_power missing');
  } else if (achievedPower < powerTarget) {
    reasons.push(
      `achieved_power ${achievedPower} < power_target ${powerTarget}; cannot claim 90% power`
    );
  }

  if (design) {
    if (design.decision_eligible !== true) {
      reasons.push('power design decision_eligible must be true');
    }
    if (
      design.multiplicity_adjusted !== true &&
      design.final_rule !== true &&
      design.familywise !== true
    ) {
      reasons.push('power design lacks final-rule multiplicity adjustment');
    }
    if (design.feasible === false || design.power_feasible === false || design.budget_feasible === false) {
      reasons.push('study design marked power/budget infeasible');
    }
  }

  const maxN = design?.max_n ?? skill?.data?.max_n ?? null;
  const minPrimary = skill?.min_sample_primary ?? skill?.min_sample_replication ?? null;
  if (isFiniteNumber(maxN) && isFiniteNumber(minPrimary) && maxN < minPrimary) {
    reasons.push(`max_n ${maxN} < min_sample ${minPrimary}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    portfolio_budget_usd: portfolioBudget,
    estimated_cost_usd: estimatedCost,
    achieved_power: achievedPower,
    power_target: powerTarget,
  };
}

function evaluateSkillEligibility(skill, registry, options = {}) {
  const skillId = skill?.id || skill?.skill_id || 'unknown';
  const blockers = [];
  const reasons = [];
  const data = skill?.data;

  if (!skill || typeof skill !== 'object') {
    return {
      skill_id: skillId,
      eligible: false,
      runnable: false,
      blockers: [ELIGIBILITY_BLOCKER.MISSING_FIELD],
      reasons: ['skill object missing'],
      evidence_validity: 'ineligible',
      product_disposition: PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE,
      counts: {},
      judge_required: false,
      source_metric_mismatch: false,
      power_budget: { ok: false, reasons: ['skill missing'] },
    };
  }

  if (!data || typeof data !== 'object') {
    blockers.push(ELIGIBILITY_BLOCKER.MISSING_FIELD);
    reasons.push('skill.data missing');
  }

  const status = data?.status;
  if (status == null) {
    blockers.push(ELIGIBILITY_BLOCKER.MISSING_FIELD);
    reasons.push('data.status missing');
  } else if (status === 'unknown') {
    blockers.push(ELIGIBILITY_BLOCKER.UNKNOWN_STATUS);
    reasons.push('data.status=unknown');
  } else if (status === 'inadequate') {
    blockers.push(ELIGIBILITY_BLOCKER.INADEQUATE_STATUS);
    reasons.push('data.status=inadequate');
  } else if (status !== 'adequate') {
    blockers.push(ELIGIBILITY_BLOCKER.DATA_STATUS);
    reasons.push(`data.status=${status} not adequate`);
  }

  if (Array.isArray(data?.gaps) && data.gaps.length > 0) {
    blockers.push(ELIGIBILITY_BLOCKER.DATA_GAPS);
    reasons.push(`data.gaps=${data.gaps.join(',')}`);
  }

  const sources = asArray(data?.sources);
  if (sources.length === 0) {
    blockers.push(ELIGIBILITY_BLOCKER.MISSING_SOURCES);
    reasons.push('no declared sources');
  }

  if (!isNonEmptyString(skill.primary_metric)) {
    blockers.push(ELIGIBILITY_BLOCKER.MISSING_FIELD);
    reasons.push('primary_metric missing');
  }

  const judgeRequired = isJudgeDependentMetric(skill.primary_metric, skill);
  if (judgeRequired && !judgePanelDecisionEligible(registry)) {
    blockers.push(ELIGIBILITY_BLOCKER.JUDGE_BLOCKED);
    reasons.push(
      `judge panel blocked (${registry?.judge_panel?.calibration_status || 'unknown'}) for metric ${skill.primary_metric}`
    );
  }

  const mismatch = hasApplicabilitySourceMetricMismatch(skill);
  if (mismatch.mismatch) {
    blockers.push(ELIGIBILITY_BLOCKER.SOURCE_METRIC_MISMATCH);
    reasons.push(
      `applicability-labelled binary-decision sources are not native evidence for primary_metric=${skill.primary_metric}`
    );
  }

  const mins = requiredMins(skill);
  const counts = readSplitCounts(skill);

  if (counts.heldout == null || !Number.isFinite(Number(counts.heldout))) {
    blockers.push(ELIGIBILITY_BLOCKER.MISSING_FIELD);
    reasons.push('heldout count missing');
  } else if (Number(counts.heldout) < mins.heldout) {
    blockers.push(ELIGIBILITY_BLOCKER.HELD_OUT);
    reasons.push(`heldout=${counts.heldout} < required ${mins.heldout}`);
  }

  if (counts.replication == null || !Number.isFinite(Number(counts.replication))) {
    blockers.push(ELIGIBILITY_BLOCKER.MISSING_FIELD);
    reasons.push('replication count missing');
  } else if (Number(counts.replication) < mins.replication) {
    blockers.push(ELIGIBILITY_BLOCKER.REPLICATION);
    reasons.push(`replication=${counts.replication} < required ${mins.replication}`);
  }

  if (counts.hardNeg == null || !Number.isFinite(Number(counts.hardNeg))) {
    blockers.push(ELIGIBILITY_BLOCKER.MISSING_FIELD);
    reasons.push('hard_negative_count missing (denominator not inventable)');
  } else if (Number(counts.hardNeg) < mins.hardNeg) {
    blockers.push(ELIGIBILITY_BLOCKER.HARD_NEG);
    reasons.push(`hard_negatives=${counts.hardNeg} < required ${mins.hardNeg}`);
  }

  const powerBudget = evaluatePowerBudgetFeasibility(skill, registry, options);
  if (!powerBudget.ok) {
    blockers.push(ELIGIBILITY_BLOCKER.POWER_BUDGET);
    reasons.push(...powerBudget.reasons);
  }

  if (data?.migration_coverage?.excluded_from_confirmatory_counts === true && sources.length === 0) {
    blockers.push(ELIGIBILITY_BLOCKER.MISSING_SOURCES);
    reasons.push('only migration_coverage sources; excluded from confirmatory counts');
  }

  const eligible = blockers.length === 0;
  return {
    skill_id: skillId,
    eligible,
    runnable: eligible,
    blockers: uniqueStrings(blockers),
    reasons,
    evidence_validity: eligible ? 'eligible_for_study' : 'ineligible',
    product_disposition: PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE,
    counts: {
      heldout: counts.heldout,
      replication: counts.replication,
      hard_negatives: counts.hardNeg,
      required_heldout_min: mins.heldout,
      required_hard_negatives_min: mins.hardNeg,
      required_replication_min: mins.replication,
      sources: sources.length,
    },
    judge_required: judgeRequired,
    source_metric_mismatch: Boolean(mismatch.mismatch),
    power_budget: powerBudget,
    measured_result: null,
    statistical_status: 'not_run',
    replication_status: 'not_run',
  };
}

function evaluatePortfolioEligibility(registry, options = {}) {
  const skills = registry?.skills || {};
  const rows = Object.keys(skills)
    .sort()
    .map((id) => evaluateSkillEligibility(skills[id], registry, options));
  const runnable = rows.filter((r) => r.runnable);
  const autoRetain = rows.filter(
    (r) => r.product_disposition === PRODUCT_DISPOSITION.AUTO_RETAIN_LEAN
  );
  return {
    skill_count: rows.length,
    runnable_count: runnable.length,
    auto_retain_count: autoRetain.length,
    runnable_skill_ids: runnable.map((r) => r.skill_id),
    auto_retain_skill_ids: autoRetain.map((r) => r.skill_id),
    results: rows,
    portfolio_budget_usd: gatesFrom(registry).portfolio_budget_usd,
    judge_panel_decision_eligible: judgePanelDecisionEligible(registry),
  };
}

// --- Disposition helpers ----------------------------------------------------

function modelStratum(models, modelId) {
  if (!models || typeof models !== 'object') return null;
  return models[modelId] || models[shortModelKey(modelId)] || null;
}

function shortModelKey(modelId) {
  const s = String(modelId || '');
  if (/haiku/i.test(s)) return 'haiku';
  if (/sonnet/i.test(s)) return 'sonnet';
  if (/opus/i.test(s)) return 'opus';
  return s;
}

function readEfficacy(stratum) {
  if (!stratum || typeof stratum !== 'object') return null;
  return (
    stratum.lean_vs_none ||
    stratum.efficacy ||
    stratum.lean_vs_none_replication ||
    null
  );
}

function readNoninfFull(stratum) {
  if (!stratum || typeof stratum !== 'object') return null;
  return stratum.lean_vs_full || stratum.noninferiority_vs_full || null;
}

function readHarm(stratum) {
  if (!stratum || typeof stratum !== 'object') return null;
  return (
    stratum.hard_negative ||
    stratum.wrong_neighbor ||
    stratum.hard_negative_or_wrong_neighbor ||
    stratum.harm ||
    null
  );
}

function readCost(stratum) {
  if (!stratum || typeof stratum !== 'object') return null;
  return stratum.cost || stratum.usage || stratum.token_cost || null;
}

function readBestBlock(stratum) {
  if (!stratum || typeof stratum !== 'object') return null;
  return stratum.best_skill_vs_none || stratum.best_arm_vs_none || stratum.delete_probe || null;
}

/** Multiplicity-adjusted lower only — never unadjusted CI fallbacks. */
function readAdjustedLowerPp(block) {
  if (!block || typeof block !== 'object') return null;
  return isFiniteNumber(block.adjusted_lower_pp) ? block.adjusted_lower_pp : null;
}

/** Multiplicity-adjusted p only — never unadjusted p_value fallback. */
function readAdjustedP(block) {
  if (!block || typeof block !== 'object') return null;
  if (isFiniteNumber(block.adjusted_p)) return block.adjusted_p;
  if (isFiniteNumber(block.p_adjusted)) return block.p_adjusted;
  return null;
}

/** Multiplicity-adjusted upper only. */
function readAdjustedUpperPp(block) {
  if (!block || typeof block !== 'object') return null;
  return isFiniteNumber(block.adjusted_upper_pp) ? block.adjusted_upper_pp : null;
}

/**
 * Explicit powered + decision_eligible required.
 * `adjusted: true` alone is insufficient.
 */
function stratumPowered(block) {
  if (!block || typeof block !== 'object') return false;
  if (block.powered === false || block.underpowered === true) return false;
  if (block.missing === true) return false;
  if (block.decision_eligible === false) return false;
  return block.powered === true && block.decision_eligible === true;
}

/**
 * Efficacy terminal block must declare multiplicity adjustment explicitly.
 */
function efficacyMultiplicityOk(block) {
  if (!block || typeof block !== 'object') return false;
  if (block.adjusted !== true) return false;
  if (readAdjustedLowerPp(block) == null) return false;
  if (readAdjustedP(block) == null) return false;
  return true;
}

function isUntouchedReplicationSplit(evidence) {
  if (!evidence || typeof evidence !== 'object') return false;
  if (evidence.untouched_replication === true || evidence.untouched === true) return true;
  const split = evidence.split ?? evidence.eligible_split ?? evidence.disposition_split;
  const phase = evidence.phase;
  if (split === 'replication' || split === 'untouched_replication') return true;
  if (phase === 'replication' || phase === 'untouched_replication') return true;
  return false;
}

function isScreeningOrHeldout(evidence) {
  if (!evidence || typeof evidence !== 'object') return false;
  if (evidence.screening_only === true) return true;
  if (evidence.phase === 'screening') return true;
  const split = evidence.split ?? evidence.selection_split;
  return split === 'heldout' || split === 'screening';
}

function healthDecisionEligibleComplete(health) {
  if (!health || typeof health !== 'object') {
    return { ok: false, reasons: ['health missing'] };
  }
  const reasons = [];
  if (health.decision_eligible !== true) {
    reasons.push('health.decision_eligible must be true');
  }
  // Match evidence.js health contract: attempted/completed/parsed/scored/failures.
  const fields = ['attempted', 'completed', 'parsed', 'scored', 'failures'];
  for (const f of fields) {
    if (!Number.isInteger(health[f]) || health[f] < 0) {
      reasons.push(`health.${f} missing or invalid`);
    }
  }
  if (
    Number.isInteger(health.attempted) &&
    Number.isInteger(health.completed) &&
    Number.isInteger(health.parsed) &&
    Number.isInteger(health.scored)
  ) {
    if (!(health.attempted === health.completed &&
          health.completed === health.parsed &&
          health.parsed === health.scored)) {
      reasons.push('health denominators not equal (never silently shrink)');
    }
    if (health.attempted === 0) {
      reasons.push('health.attempted is 0');
    }
  }
  if (Number.isInteger(health.failures) && health.failures > 0) {
    reasons.push(`health.failures=${health.failures}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Terminal AUTO/DELETE require explicit untouched-replication metadata,
 * confirmatory validity, successful replication status, and complete
 * decision-eligible health. Missing fields quarantine.
 */
function terminalDispositionMetadataOk(evidence) {
  const reasons = [];
  if (!evidence || typeof evidence !== 'object') {
    return { ok: false, reasons: ['evidence missing'] };
  }

  if (!isUntouchedReplicationSplit(evidence)) {
    reasons.push('untouched replication split/phase/flag required');
  }
  if (evidence.phase === 'screening' || evidence.screening_only === true) {
    reasons.push('screening_only cannot be terminal disposition');
  }
  if (evidence.split === 'heldout') {
    reasons.push('heldout split cannot AUTO/DELETE');
  }

  const repl = evidence.replication_status;
  if (!isNonEmptyString(repl)) {
    reasons.push('replication_status missing');
  } else if (!TERMINAL_REPLICATION_OK.has(String(repl).toLowerCase())) {
    reasons.push(`replication_status='${repl}' not terminal-eligible`);
  }

  const validity = evidence.evidence_validity;
  if (!isNonEmptyString(validity)) {
    reasons.push('evidence_validity missing');
  } else {
    const v = String(validity).toLowerCase();
    if (v !== 'confirmatory' && v !== 'confirmed') {
      reasons.push(`evidence_validity='${validity}' not confirmatory`);
    }
  }

  if (evidence.decision_eligible !== true) {
    reasons.push('decision_eligible must be explicitly true');
  }
  if (evidence.multiplicity_adjusted !== true && evidence.final_rule_adjusted !== true) {
    reasons.push('multiplicity_adjusted/final_rule_adjusted must be explicitly true');
  }

  const healthCheck = healthDecisionEligibleComplete(evidence.health);
  if (!healthCheck.ok) {
    reasons.push(...healthCheck.reasons);
  }

  return { ok: reasons.length === 0, reasons };
}

function costGatesPass(cost, gates, reasons) {
  if (!cost || typeof cost !== 'object') {
    reasons.push('cost metrics missing');
    return false;
  }
  const leanIn = cost.lean_input_tokens ?? cost.lean?.input_tokens;
  const fullIn = cost.full_input_tokens ?? cost.full_legacy?.input_tokens ?? cost.full?.input_tokens;
  if (!isFiniteNumber(leanIn) || !isFiniteNumber(fullIn) || fullIn <= 0) {
    reasons.push('input token costs missing or invalid');
    return false;
  }
  const inputRatio = leanIn / fullIn;
  if (inputRatio > gates.lean_input_token_ratio_max) {
    reasons.push(
      `lean input token ratio ${inputRatio} > max ${gates.lean_input_token_ratio_max}`
    );
    return false;
  }

  const pairs = [
    ['calls', cost.lean_calls ?? cost.lean?.calls, cost.full_calls ?? cost.full_legacy?.calls ?? cost.full?.calls],
    [
      'output_tokens',
      cost.lean_output_tokens ?? cost.lean?.output_tokens,
      cost.full_output_tokens ?? cost.full_legacy?.output_tokens ?? cost.full?.output_tokens,
    ],
    [
      'latency_ms',
      cost.lean_latency_ms ?? cost.lean?.latency_ms,
      cost.full_latency_ms ?? cost.full_legacy?.latency_ms ?? cost.full?.latency_ms,
    ],
    [
      'cost_usd',
      cost.lean_cost_usd ?? cost.lean?.estimated_cost_usd ?? cost.lean?.cost_usd,
      cost.full_cost_usd ??
        cost.full_legacy?.estimated_cost_usd ??
        cost.full?.estimated_cost_usd ??
        cost.full_legacy?.cost_usd ??
        cost.full?.cost_usd,
    ],
  ];

  for (const [name, lean, full] of pairs) {
    if (!isFiniteNumber(lean) || !isFiniteNumber(full) || full < 0) {
      reasons.push(`cost.${name} missing`);
      return false;
    }
    if (full === 0) {
      if (lean > 0) {
        reasons.push(`cost.${name} lean>0 while full=0`);
        return false;
      }
      continue;
    }
    const ratio = lean / full;
    if (ratio > gates.lean_other_ratio_max) {
      reasons.push(`cost.${name} ratio ${ratio} > max ${gates.lean_other_ratio_max}`);
      return false;
    }
  }
  return true;
}

/**
 * AUTO-RETAIN LEAN: multiplicity-adjusted efficacy fields only.
 */
function evaluateAutoRetainLean(evidence, registry, options = {}) {
  const reasons = [];
  const gates = { ...gatesFrom(registry), ...options.gates };
  const models = deploymentModelsFrom(registry);
  if (!evidence || typeof evidence !== 'object') {
    return { pass: false, reasons: ['evidence missing'], winning_model: null };
  }

  const meta = terminalDispositionMetadataOk(evidence);
  if (!meta.ok) {
    return { pass: false, reasons: meta.reasons, winning_model: null };
  }

  const byModel = evidence.models || evidence.by_model || null;
  if (!byModel || typeof byModel !== 'object') {
    return { pass: false, reasons: ['models strata missing'], winning_model: null };
  }

  let winning = null;

  for (const modelId of models) {
    const stratum = modelStratum(byModel, modelId);
    if (!stratum) {
      reasons.push(`missing model stratum: ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }
    const eff = readEfficacy(stratum);
    if (!eff) {
      reasons.push(`missing lean_vs_none for ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }
    if (!efficacyMultiplicityOk(eff)) {
      reasons.push(
        `lean_vs_none requires adjusted:true + adjusted_lower_pp + adjusted_p on ${modelId}`
      );
      return { pass: false, reasons, winning_model: null };
    }
    const point = eff.point_pp ?? eff.delta_pp ?? eff.estimate_pp;
    const lower = readAdjustedLowerPp(eff);
    const p = readAdjustedP(eff);
    if (!isFiniteNumber(point)) {
      reasons.push(`point_pp missing for ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }
    if (!stratumPowered(eff)) {
      reasons.push(`lean_vs_none not powered+decision_eligible for ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }

    const isWinner =
      point >= gates.utility_margin_pp &&
      lower > 0 &&
      p < gates.alpha_one_sided;

    if (
      point >= gates.directional_zone_low_pp &&
      point < gates.directional_zone_high_pp &&
      isWinner
    ) {
      reasons.push(
        `point_pp ${point} in directional zone [${gates.directional_zone_low_pp},${gates.directional_zone_high_pp}) on ${modelId}`
      );
    }

    if (
      isWinner &&
      !(point >= gates.directional_zone_low_pp && point < gates.directional_zone_high_pp)
    ) {
      if (!winning) winning = { modelId, point, lower, p };
    }

    const vsFull = readNoninfFull(stratum);
    if (!vsFull) {
      reasons.push(`missing lean_vs_full for ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }
    const fullLower = readAdjustedLowerPp(vsFull);
    if (fullLower == null) {
      reasons.push(`lean_vs_full adjusted_lower_pp missing for ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }
    if (!stratumPowered(vsFull)) {
      reasons.push(`lean_vs_full not powered+decision_eligible for ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }
    if (fullLower <= -gates.noninferiority_margin_pp) {
      reasons.push(
        `lean_vs_full adjusted lower ${fullLower} not > -${gates.noninferiority_margin_pp} on ${modelId}`
      );
      return { pass: false, reasons, winning_model: null };
    }

    const harm = readHarm(stratum);
    if (!harm) {
      reasons.push(`missing hard_negative/wrong_neighbor for ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }
    const harmLower = readAdjustedLowerPp(harm);
    if (harmLower == null) {
      reasons.push(`harm adjusted_lower_pp missing for ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }
    if (!stratumPowered(harm)) {
      reasons.push(`harm not powered+decision_eligible for ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }
    if (harmLower <= -gates.harm_margin_pp) {
      reasons.push(
        `harm adjusted lower ${harmLower} not > -${gates.harm_margin_pp} on ${modelId}`
      );
      return { pass: false, reasons, winning_model: null };
    }

    if (!costGatesPass(readCost(stratum), gates, reasons)) {
      reasons.push(`cost gate failed on ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }
  }

  if (!winning) {
    reasons.push('no deployment model meets utility point≥+5pp, adjusted lower>0, adjusted p<.05');
    return { pass: false, reasons, winning_model: null };
  }

  for (const modelId of models) {
    if (modelId === winning.modelId || shortModelKey(modelId) === shortModelKey(winning.modelId)) {
      continue;
    }
    const stratum = modelStratum(byModel, modelId);
    const eff = readEfficacy(stratum);
    if (!efficacyMultiplicityOk(eff)) {
      reasons.push(`other-stratum adjusted efficacy incomplete for ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }
    const lower = readAdjustedLowerPp(eff);
    if (!stratumPowered(eff)) {
      reasons.push(`other stratum underpowered/missing power: ${modelId}`);
      return { pass: false, reasons, winning_model: null };
    }
    if (lower <= -gates.noninferiority_margin_pp) {
      reasons.push(
        `other model ${modelId} adjusted lower ${lower} not > -${gates.noninferiority_margin_pp}`
      );
      return { pass: false, reasons, winning_model: null };
    }
  }

  return { pass: true, reasons: [], winning_model: winning.modelId };
}

/**
 * MINIMIZE FURTHER: heldout/screening selection only.
 * Replication evidence must not trigger minimize.
 */
function evaluateMinimizeFurther(evidence, registry) {
  const reasons = [];
  if (!evidence || typeof evidence !== 'object') {
    return { pass: false, reasons: ['evidence missing'] };
  }

  // Replication / untouched replication never selects minimize.
  if (isUntouchedReplicationSplit(evidence) && !isScreeningOrHeldout(evidence)) {
    return { pass: false, reasons: ['minimize is heldout/screening selection only; replication cannot minimize'] };
  }
  if (evidence.split === 'replication' || evidence.phase === 'replication') {
    return { pass: false, reasons: ['replication must not trigger minimize'] };
  }

  const selection = evidence.minimize_selection || evidence.selection || null;
  const hasSelectionObject = selection && typeof selection === 'object';
  const selectionSplit = hasSelectionObject
    ? (selection.split || selection.selection_split)
    : (evidence.selection_split ?? evidence.split);
  const selectionPhase = hasSelectionObject
    ? selection.phase
    : evidence.phase;

  const onHeldoutOrScreening =
    selectionSplit === 'heldout' ||
    selectionSplit === 'screening' ||
    selectionPhase === 'screening' ||
    evidence.screening_only === true ||
    evidence.phase === 'screening' ||
    evidence.split === 'heldout';

  if (!onHeldoutOrScreening) {
    reasons.push(
      `minimize requires heldout/screening evidence (got split=${selectionSplit == null ? 'missing' : selectionSplit})`
    );
  }

  const selectionFrozen =
    hasSelectionObject
      ? selection.frozen === true || selection.comparator_frozen === true
      : evidence.selection_frozen === true;
  if (!selectionFrozen) {
    reasons.push('selection_frozen/comparator_frozen must be explicitly true');
  }

  const fullBeats =
    evidence.full_beats_lean_and_none === true ||
    evidence.minimize_further === true ||
    (hasSelectionObject && selection.full_beats_lean_and_none === true);
  if (!fullBeats) {
    reasons.push('full_beats_lean_and_none / minimize_further not affirmed');
  }

  if (evidence.auto_retain_eligible === true) {
    reasons.push('auto-retain already eligible; minimize is nonterminal only when auto fails');
  }

  const byModel = evidence.models || evidence.by_model;
  if (!byModel || typeof byModel !== 'object') {
    reasons.push('models strata missing for minimize selection');
  } else {
    for (const modelId of deploymentModelsFrom(registry)) {
      const stratum = modelStratum(byModel, modelId);
      if (!stratum) {
        reasons.push(`missing model stratum for minimize: ${modelId}`);
        continue;
      }
      if (stratum.full_beats_lean_and_none !== true) {
        reasons.push(`full_beats_lean_and_none not true on ${modelId}`);
      }
    }
  }

  if (reasons.length > 0) return { pass: false, reasons };
  return { pass: true, reasons: [] };
}

/**
 * DELETE: powered/decision-eligible best-arm adjusted upper < +3pp every stratum.
 */
function evaluateDelete(evidence, registry, options = {}) {
  const reasons = [];
  const gates = { ...gatesFrom(registry), ...options.gates };
  if (!evidence || typeof evidence !== 'object') {
    return { pass: false, reasons: ['evidence missing'] };
  }

  const meta = terminalDispositionMetadataOk(evidence);
  if (!meta.ok) {
    return { pass: false, reasons: meta.reasons };
  }

  if (evidence.ceiling_limited === true || evidence.data_caveat === true || evidence.judge_caveat === true) {
    return { pass: false, reasons: ['ceiling/data/judge caveat remains'] };
  }
  if (evidence.no_ceiling_data_judge_caveat !== true && evidence.caveats_cleared !== true) {
    return { pass: false, reasons: ['caveat clearance not affirmed'] };
  }
  if (evidence.hard_negative_utility_nonpositive !== true) {
    return { pass: false, reasons: ['hard-negative utility nonpositive not affirmed'] };
  }

  if (evidence.workflow_candidate === true) {
    if (evidence.workflow_gate_failed !== true && evidence.workflow_gate_pass !== false) {
      return { pass: false, reasons: ['workflow candidate without failed workflow gate'] };
    }
  } else if (evidence.workflow_candidate == null && evidence.workflow_gate_na !== true) {
    return { pass: false, reasons: ['workflow_candidate/workflow_gate_na must be explicit'] };
  }

  const byModel = evidence.models || evidence.by_model;
  if (!byModel) return { pass: false, reasons: ['models missing'] };

  for (const modelId of deploymentModelsFrom(registry)) {
    const stratum = modelStratum(byModel, modelId);
    if (!stratum) {
      return { pass: false, reasons: [`missing model stratum: ${modelId}`] };
    }
    const best = readBestBlock(stratum);
    if (!best) {
      return { pass: false, reasons: [`best-arm block missing for ${modelId}`] };
    }
    // Best-arm bounds themselves must be powered + decision-eligible.
    if (!stratumPowered(best)) {
      return {
        pass: false,
        reasons: [`best-arm not powered+decision_eligible for ${modelId}`],
      };
    }
    const upper = readAdjustedUpperPp(best);
    if (!isFiniteNumber(upper)) {
      return { pass: false, reasons: [`best-arm adjusted_upper_pp missing for ${modelId}`] };
    }
    if (upper >= gates.delete_upper_bound_pp) {
      return {
        pass: false,
        reasons: [
          `best-arm adjusted upper ${upper} not < +${gates.delete_upper_bound_pp} on ${modelId}`,
        ],
      };
    }
  }

  return { pass: true, reasons: [] };
}

/**
 * Disposition order:
 * 1) missing → MANUAL
 * 2) MINIMIZE (heldout/screening only) — before screening quarantine
 * 3) screening/heldout without minimize → MANUAL
 * 4) AUTO
 * 5) DELETE
 * 6) MANUAL
 */
function evaluateDisposition(evidence, registry = {}, options = {}) {
  const base = {
    measured_result: evidence?.measured_result ?? null,
    statistical_status: evidence?.statistical_status ?? 'unknown',
    replication_status: evidence?.replication_status ?? 'unknown',
    evidence_validity: evidence?.evidence_validity ?? 'provisional',
  };

  if (!evidence || typeof evidence !== 'object') {
    return {
      product_disposition: PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE,
      disposition_label: DISPOSITION_LABEL[PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE],
      ...base,
      statistical_status: 'missing_evidence',
      replication_status: 'missing',
      evidence_validity: 'ineligible',
      auto_retain: { pass: false, reasons: ['evidence missing'] },
      minimize_further: { pass: false, reasons: ['evidence missing'] },
      delete: { pass: false, reasons: ['evidence missing'] },
      reasons: ['evidence missing'],
      disable_model_invocation: true,
    };
  }

  // MINIMIZE first so heldout/screening selection can return before quarantine.
  const minimize = evaluateMinimizeFurther(evidence, registry);
  if (minimize.pass) {
    return {
      product_disposition: PRODUCT_DISPOSITION.MINIMIZE_FURTHER,
      disposition_label: DISPOSITION_LABEL[PRODUCT_DISPOSITION.MINIMIZE_FURTHER],
      measured_result: evidence.measured_result ?? { gate: 'minimize_further' },
      statistical_status: evidence.statistical_status ?? 'full_beats_lean',
      replication_status: evidence.replication_status ?? 'nonterminal_selection',
      evidence_validity: evidence.evidence_validity ?? 'provisional',
      auto_retain: { pass: false, reasons: ['minimize path'] },
      minimize_further: minimize,
      delete: { pass: false, reasons: ['minimize path'] },
      reasons: minimize.reasons,
      disable_model_invocation: true,
    };
  }

  // Screening/heldout cannot AUTO or DELETE.
  if (isScreeningOrHeldout(evidence)) {
    return {
      product_disposition: PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE,
      disposition_label: DISPOSITION_LABEL[PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE],
      ...base,
      statistical_status: base.statistical_status === 'unknown' ? 'screening_only' : base.statistical_status,
      replication_status: 'not_disposition_split',
      evidence_validity: 'provisional',
      auto_retain: { pass: false, reasons: ['screening/heldout cannot elevate or delete'] },
      minimize_further: minimize,
      delete: { pass: false, reasons: ['screening/heldout cannot delete'] },
      reasons: uniqueStrings([
        ...minimize.reasons,
        'disposition AUTO/DELETE requires untouched replication',
      ]),
      disable_model_invocation: true,
    };
  }

  const auto = evaluateAutoRetainLean(evidence, registry, options);
  if (auto.pass) {
    return {
      product_disposition: PRODUCT_DISPOSITION.AUTO_RETAIN_LEAN,
      disposition_label: DISPOSITION_LABEL[PRODUCT_DISPOSITION.AUTO_RETAIN_LEAN],
      measured_result: evidence.measured_result ?? {
        winning_model: auto.winning_model,
        gate: 'auto_retain_lean',
      },
      statistical_status: evidence.statistical_status,
      replication_status: evidence.replication_status,
      evidence_validity: evidence.evidence_validity,
      auto_retain: auto,
      minimize_further: minimize,
      delete: { pass: false, reasons: ['auto-retain passed'] },
      reasons: [],
      disable_model_invocation: false,
      winning_model: auto.winning_model,
    };
  }

  const del = evaluateDelete(evidence, registry, options);
  if (del.pass) {
    return {
      product_disposition: PRODUCT_DISPOSITION.DELETE,
      disposition_label: DISPOSITION_LABEL[PRODUCT_DISPOSITION.DELETE],
      measured_result: evidence.measured_result ?? { gate: 'delete' },
      statistical_status: evidence.statistical_status,
      replication_status: evidence.replication_status,
      evidence_validity: evidence.evidence_validity,
      auto_retain: auto,
      minimize_further: minimize,
      delete: del,
      reasons: [],
      disable_model_invocation: true,
    };
  }

  return {
    product_disposition: PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE,
    disposition_label: DISPOSITION_LABEL[PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE],
    measured_result: evidence.measured_result ?? null,
    statistical_status: evidence.statistical_status ?? 'quarantine',
    replication_status: evidence.replication_status ?? 'incomplete_or_null',
    evidence_validity: evidence.evidence_validity ?? 'provisional',
    auto_retain: auto,
    minimize_further: minimize,
    delete: del,
    reasons: uniqueStrings([
      ...auto.reasons,
      ...minimize.reasons,
      ...del.reasons,
      'default MANUAL-ONLY QUARANTINE',
    ]),
    disable_model_invocation: true,
  };
}

function evaluatePortfolioDispositions(evidenceRows, registry = {}, options = {}) {
  const results = asArray(evidenceRows).map((row) => ({
    skill_id: row?.skill_id || row?.id || null,
    ...evaluateDisposition(row, registry, options),
  }));
  const counts = {
    auto_retain_lean: 0,
    minimize_further: 0,
    delete: 0,
    manual_only_quarantine: 0,
  };
  for (const r of results) {
    if (r.product_disposition === PRODUCT_DISPOSITION.AUTO_RETAIN_LEAN) counts.auto_retain_lean++;
    else if (r.product_disposition === PRODUCT_DISPOSITION.MINIMIZE_FURTHER) counts.minimize_further++;
    else if (r.product_disposition === PRODUCT_DISPOSITION.DELETE) counts.delete++;
    else counts.manual_only_quarantine++;
  }
  return { results, counts };
}

module.exports = {
  PRODUCT_DISPOSITION,
  DISPOSITION_LABEL,
  PORTFOLIO_GATES,
  JUDGED_PRIMARY_METRICS,
  APPLICABILITY_COMPATIBLE_METRICS,
  BINARY_OUTCOME_METRICS,
  DEFAULT_DEPLOYMENT_MODELS,
  ELIGIBILITY_BLOCKER,
  isJudgeDependentMetric,
  judgePanelDecisionEligible,
  sourceIsApplicabilityBinary,
  hasApplicabilitySourceMetricMismatch,
  evaluatePowerBudgetFeasibility,
  evaluateSkillEligibility,
  evaluatePortfolioEligibility,
  evaluateAutoRetainLean,
  evaluateMinimizeFurther,
  evaluateDelete,
  evaluateDisposition,
  evaluatePortfolioDispositions,
  deploymentModelsFrom,
  gatesFrom,
  terminalDispositionMetadataOk,
  healthDecisionEligibleComplete,
  readAdjustedLowerPp,
  readAdjustedP,
  readAdjustedUpperPp,
  efficacyMultiplicityOk,
};
