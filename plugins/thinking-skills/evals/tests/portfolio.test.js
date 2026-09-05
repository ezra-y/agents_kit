'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const {
  PRODUCT_DISPOSITION,
  DISPOSITION_LABEL,
  PORTFOLIO_GATES,
  ELIGIBILITY_BLOCKER,
  evaluateSkillEligibility,
  evaluatePortfolioEligibility,
  evaluateAutoRetainLean,
  evaluateMinimizeFurther,
  evaluateDelete,
  evaluateDisposition,
  evaluatePortfolioDispositions,
  hasApplicabilitySourceMetricMismatch,
  evaluatePowerBudgetFeasibility,
  judgePanelDecisionEligible,
  deploymentModelsFrom,
  terminalDispositionMetadataOk,
} = require('../lib/portfolio.js');

const REGISTRY = require('../studies/registry.json');
const MODELS = deploymentModelsFrom(REGISTRY);

function completeHealth(overrides = {}) {
  return {
    attempted: 100,
    completed: 100,
    parsed: 100,
    scored: 100,
    failures: 0,
    decision_eligible: true,
    ...overrides,
  };
}

function baseStratum(overrides = {}) {
  return {
    lean_vs_none: {
      point_pp: 8,
      adjusted_lower_pp: 1.5,
      adjusted_p: 0.001,
      powered: true,
      decision_eligible: true,
      adjusted: true,
    },
    lean_vs_full: {
      adjusted_lower_pp: -1.0,
      powered: true,
      decision_eligible: true,
    },
    hard_negative: {
      adjusted_lower_pp: -0.5,
      powered: true,
      decision_eligible: true,
    },
    cost: {
      lean_input_tokens: 60,
      full_input_tokens: 100,
      lean_calls: 10,
      full_calls: 10,
      lean_output_tokens: 100,
      full_output_tokens: 100,
      lean_latency_ms: 1000,
      full_latency_ms: 1000,
      lean_cost_usd: 1.0,
      full_cost_usd: 1.0,
    },
    best_skill_vs_none: {
      adjusted_upper_pp: 1.0,
      powered: true,
      decision_eligible: true,
    },
    full_beats_lean_and_none: false,
    ...overrides,
  };
}

function terminalMeta(overrides = {}) {
  return {
    split: 'replication',
    phase: 'replication',
    untouched_replication: true,
    replication_status: 'passed',
    evidence_validity: 'confirmatory',
    decision_eligible: true,
    multiplicity_adjusted: true,
    health: completeHealth(),
    ...overrides,
  };
}

function passingAutoEvidence() {
  const models = {};
  const haiku = MODELS.find((m) => /haiku/i.test(m));
  const others = MODELS.filter((m) => m !== haiku);
  models[haiku] = baseStratum({
    lean_vs_none: {
      point_pp: 8,
      adjusted_lower_pp: 2,
      adjusted_p: 0.001,
      powered: true,
      decision_eligible: true,
      adjusted: true,
    },
  });
  for (const id of others) {
    models[id] = baseStratum({
      lean_vs_none: {
        point_pp: 2,
        adjusted_lower_pp: -1,
        adjusted_p: 0.2,
        powered: true,
        decision_eligible: true,
        adjusted: true,
      },
    });
  }
  return {
    skill_id: 'synthetic-skill',
    ...terminalMeta(),
    models,
    measured_result: { note: 'synthetic' },
    statistical_status: 'significant_utility',
  };
}

function passingDeleteEvidence() {
  const models = {};
  for (const id of MODELS) {
    models[id] = baseStratum({
      lean_vs_none: {
        point_pp: 0,
        adjusted_lower_pp: -5,
        adjusted_p: 0.9,
        powered: true,
        decision_eligible: true,
        adjusted: true,
      },
      best_skill_vs_none: {
        adjusted_upper_pp: 2.99,
        powered: true,
        decision_eligible: true,
      },
    });
  }
  return {
    skill_id: 'delete-me',
    ...terminalMeta({ replication_status: 'passed_null' }),
    models,
    caveats_cleared: true,
    no_ceiling_data_judge_caveat: true,
    hard_negative_utility_nonpositive: true,
    workflow_candidate: false,
    statistical_status: 'null_upper_below_delete_bound',
  };
}

function passingMinimizeEvidence() {
  return {
    skill_id: 'min',
    split: 'heldout',
    phase: 'screening',
    screening_only: true,
    selection_split: 'heldout',
    selection_frozen: true,
    full_beats_lean_and_none: true,
    minimize_further: true,
    models: Object.fromEntries(
      MODELS.map((id) => [
        id,
        baseStratum({
          full_beats_lean_and_none: true,
          lean_vs_none: {
            point_pp: 1,
            adjusted_lower_pp: -1,
            adjusted_p: 0.4,
            powered: true,
            decision_eligible: true,
            adjusted: true,
          },
        }),
      ])
    ),
  };
}

function adequateObjectiveSkill(overrides = {}) {
  const base = {
    id: 'synthetic-objective',
    primary_metric: 'domain_classification_accuracy',
    primary_value_surface: 'routing/discoverability',
    min_sample_primary: 80,
    min_sample_replication: 80,
    data: {
      status: 'adequate',
      gaps: [],
      sources: [
        {
          path: 'evals/datasets/authored/cynefin-classify.jsonl',
          sha256: 'a'.repeat(64),
          mode: 'binary-decision',
          label_kind: 'outcome',
          applicability_labelled: false,
        },
      ],
      row_counts: {
        n: 80,
        splits: { dev: 20, heldout: 30, replication: 30, other: 0 },
      },
      hard_negative_count: 15,
      required_heldout_min: 20,
      required_hard_negatives_min: 10,
      required_replication_min: 10,
      estimated_cost_usd: 50,
      power: {
        powered: true,
        achieved_power: 0.92,
        power_target: 0.9,
        multiplicity_adjusted: true,
        final_rule: true,
        decision_eligible: true,
        feasible: true,
        estimated_cost_usd: 50,
      },
    },
  };
  if (!overrides || Object.keys(overrides).length === 0) return base;
  // Shallow merge with deep data if provided
  return {
    ...base,
    ...overrides,
    data: overrides.data ? { ...base.data, ...overrides.data } : base.data,
  };
}

// ---------------------------------------------------------------------------
// Constants / exports
// ---------------------------------------------------------------------------

test('exports named disposition and gate constants', () => {
  assert.equal(PRODUCT_DISPOSITION.AUTO_RETAIN_LEAN, 'auto_retain_lean');
  assert.equal(PRODUCT_DISPOSITION.MINIMIZE_FURTHER, 'minimize_further');
  assert.equal(PRODUCT_DISPOSITION.DELETE, 'delete');
  assert.equal(PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE, 'manual_only_quarantine');
  assert.equal(DISPOSITION_LABEL[PRODUCT_DISPOSITION.AUTO_RETAIN_LEAN], 'AUTO-RETAIN LEAN');
  assert.equal(PORTFOLIO_GATES.utility_margin_pp, 5);
  assert.equal(PORTFOLIO_GATES.noninferiority_margin_pp, 3);
  assert.equal(PORTFOLIO_GATES.harm_margin_pp, 2);
  assert.equal(PORTFOLIO_GATES.delete_upper_bound_pp, 3);
  assert.equal(PORTFOLIO_GATES.lean_input_token_ratio_max, 0.7);
  assert.equal(PORTFOLIO_GATES.lean_other_ratio_max, 1.1);
  assert.equal(PORTFOLIO_GATES.portfolio_budget_usd, 2000);
  assert.equal(PORTFOLIO_GATES.min_heldout_cases, 20);
  assert.equal(PORTFOLIO_GATES.min_hard_negative_cases, 10);
  assert.equal(PORTFOLIO_GATES.min_replication_cases, 10);
  assert.equal(PORTFOLIO_GATES.power_target, 0.9);
  assert.equal(PORTFOLIO_GATES.efficacy_hypotheses, 84);
});

// ---------------------------------------------------------------------------
// Judge panel fail-closed
// ---------------------------------------------------------------------------

test('judgePanelDecisionEligible requires decision_eligible===true AND calibration_status===calibrated', () => {
  assert.equal(judgePanelDecisionEligible(REGISTRY), false);
  assert.equal(
    judgePanelDecisionEligible({
      judge_panel: { decision_eligible: true, calibration_status: 'calibrated' },
    }),
    true
  );
  assert.equal(
    judgePanelDecisionEligible({
      judge_panel: { decision_eligible: true, calibration_status: 'unknown' },
    }),
    false
  );
  assert.equal(
    judgePanelDecisionEligible({
      judge_panel: { decision_eligible: true, calibration_status: 'blocked_missing_human_labels' },
    }),
    false
  );
  assert.equal(
    judgePanelDecisionEligible({
      judge_panel: { decision_eligible: false, calibration_status: 'calibrated' },
    }),
    false
  );
  assert.equal(
    judgePanelDecisionEligible({
      judge_panel: { decision_eligible: true },
    }),
    false
  );
});

// ---------------------------------------------------------------------------
// Current registry: zero runnable / zero auto-retain
// ---------------------------------------------------------------------------

test('current registry yields zero runnable and zero auto-retain skills', () => {
  const summary = evaluatePortfolioEligibility(REGISTRY);
  assert.equal(summary.skill_count, 28);
  assert.equal(summary.runnable_count, 0, `runnable should be 0, got ${summary.runnable_skill_ids}`);
  assert.equal(summary.auto_retain_count, 0);
  assert.equal(summary.judge_panel_decision_eligible, false);
  assert.equal(summary.portfolio_budget_usd, 2000);
  for (const row of summary.results) {
    assert.equal(row.runnable, false);
    assert.equal(row.product_disposition, PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE);
    assert.ok(row.blockers.length > 0, `${row.skill_id} should have blockers`);
  }
});

test('adequate registry skills still blocked by applicability binary-decision mismatch or missing hard_neg', () => {
  for (const [id, skill] of Object.entries(REGISTRY.skills)) {
    if (skill.data?.status !== 'adequate') continue;
    const row = evaluateSkillEligibility(skill, REGISTRY);
    assert.equal(row.runnable, false, id);
    assert.ok(
      row.blockers.includes(ELIGIBILITY_BLOCKER.MISSING_FIELD) ||
        row.blockers.includes(ELIGIBILITY_BLOCKER.SOURCE_METRIC_MISMATCH) ||
        row.blockers.includes(ELIGIBILITY_BLOCKER.JUDGE_BLOCKED) ||
        row.blockers.includes(ELIGIBILITY_BLOCKER.HARD_NEG) ||
        row.blockers.includes(ELIGIBILITY_BLOCKER.POWER_BUDGET),
      `${id} blockers=${row.blockers.join(',')}`
    );
  }
});

// ---------------------------------------------------------------------------
// Eligibility blockers
// ---------------------------------------------------------------------------

test('eligibility: missing sources block', () => {
  const skill = adequateObjectiveSkill({
    data: { ...adequateObjectiveSkill().data, sources: [] },
  });
  const row = evaluateSkillEligibility(skill, REGISTRY);
  assert.equal(row.runnable, false);
  assert.ok(row.blockers.includes(ELIGIBILITY_BLOCKER.MISSING_SOURCES));
});

test('eligibility: unknown/inadequate status blocks', () => {
  for (const status of ['unknown', 'inadequate']) {
    const skill = adequateObjectiveSkill({
      data: { ...adequateObjectiveSkill().data, status, gaps: ['x'] },
    });
    const row = evaluateSkillEligibility(skill, REGISTRY);
    assert.equal(row.runnable, false);
    assert.ok(
      row.blockers.includes(ELIGIBILITY_BLOCKER.UNKNOWN_STATUS) ||
        row.blockers.includes(ELIGIBILITY_BLOCKER.INADEQUATE_STATUS)
    );
  }
});

test('eligibility: blocked judge panel blocks judged metrics', () => {
  const skill = adequateObjectiveSkill({
    primary_metric: 'pairwise_win_rate_vs_placebo',
    primary_value_surface: 'paired reasoning quality',
  });
  const row = evaluateSkillEligibility(skill, REGISTRY);
  assert.equal(row.runnable, false);
  assert.ok(row.blockers.includes(ELIGIBILITY_BLOCKER.JUDGE_BLOCKED));
  assert.equal(row.judge_required, true);
});

test('eligibility: applicability binary-decision mismatches non-native primary metric', () => {
  const skill = adequateObjectiveSkill({
    primary_metric: 'fault_localization_accuracy',
    data: {
      ...adequateObjectiveSkill().data,
      sources: [
        {
          path: 'x.jsonl',
          sha256: 'b'.repeat(64),
          mode: 'binary-decision',
          applicability_labelled: true,
          label_kind: 'applicability',
        },
      ],
    },
  });
  const mismatch = hasApplicabilitySourceMetricMismatch(skill);
  assert.equal(mismatch.mismatch, true);
  const row = evaluateSkillEligibility(skill, REGISTRY);
  assert.equal(row.runnable, false);
  assert.ok(row.blockers.includes(ELIGIBILITY_BLOCKER.SOURCE_METRIC_MISMATCH));
});

test('eligibility: insufficient heldout/replication/hard-neg cases', () => {
  const skill = adequateObjectiveSkill({
    data: {
      ...adequateObjectiveSkill().data,
      row_counts: { n: 20, splits: { heldout: 5, replication: 5, dev: 10, other: 0 } },
      hard_negative_count: 2,
    },
  });
  const row = evaluateSkillEligibility(skill, REGISTRY);
  assert.equal(row.runnable, false);
  assert.ok(row.blockers.includes(ELIGIBILITY_BLOCKER.HELD_OUT));
  assert.ok(row.blockers.includes(ELIGIBILITY_BLOCKER.REPLICATION));
  assert.ok(row.blockers.includes(ELIGIBILITY_BLOCKER.HARD_NEG));
});

test('eligibility: missing hard_negative_count never silently passes', () => {
  const base = adequateObjectiveSkill();
  delete base.data.hard_negative_count;
  const row = evaluateSkillEligibility(base, REGISTRY);
  assert.equal(row.runnable, false);
  assert.ok(row.blockers.includes(ELIGIBILITY_BLOCKER.MISSING_FIELD));
  assert.ok(row.reasons.some((r) => /hard_negative/.test(r)));
});

test('eligibility: power/budget infeasibility blocks and rejects false 90% power', () => {
  const skill = adequateObjectiveSkill({
    data: {
      ...adequateObjectiveSkill().data,
      estimated_cost_usd: 5000,
      power: {
        powered: true,
        achieved_power: 0.5,
        power_target: 0.9,
        multiplicity_adjusted: true,
        final_rule: true,
        decision_eligible: true,
        estimated_cost_usd: 5000,
      },
    },
  });
  const pb = evaluatePowerBudgetFeasibility(skill, REGISTRY);
  assert.equal(pb.ok, false);
  assert.ok(pb.reasons.some((r) => /budget|power/i.test(r)));
  const row = evaluateSkillEligibility(skill, REGISTRY);
  assert.equal(row.runnable, false);
  assert.ok(row.blockers.includes(ELIGIBILITY_BLOCKER.POWER_BUDGET));
});

test('eligibility: missing power/design and estimated_cost_usd fail closed', () => {
  const skill = adequateObjectiveSkill();
  delete skill.data.power;
  delete skill.data.estimated_cost_usd;
  const pb = evaluatePowerBudgetFeasibility(skill, REGISTRY);
  assert.equal(pb.ok, false);
  assert.ok(pb.reasons.some((r) => /power|design missing/i.test(r)));
  assert.ok(pb.reasons.some((r) => /estimated_cost_usd missing/.test(r)));
  const row = evaluateSkillEligibility(skill, REGISTRY);
  assert.equal(row.runnable, false);
  assert.ok(row.blockers.includes(ELIGIBILITY_BLOCKER.POWER_BUDGET));
});

test('eligibility: missing achieved_power fails even when powered claimed', () => {
  const skill = adequateObjectiveSkill();
  delete skill.data.power.achieved_power;
  const pb = evaluatePowerBudgetFeasibility(skill, REGISTRY);
  assert.equal(pb.ok, false);
  assert.ok(pb.reasons.some((r) => /achieved_power missing/.test(r)));
});

test('eligibility: positive synthetic adequate objective skill is runnable', () => {
  const skill = adequateObjectiveSkill();
  const row = evaluateSkillEligibility(skill, REGISTRY);
  assert.equal(row.runnable, true, row.blockers.join('; '));
  assert.equal(row.eligible, true);
  assert.equal(row.source_metric_mismatch, false);
});

// ---------------------------------------------------------------------------
// AUTO-RETAIN positive + mutations
// ---------------------------------------------------------------------------

test('AUTO-RETAIN: positive synthetic passes all strata gates', () => {
  const evidence = passingAutoEvidence();
  const auto = evaluateAutoRetainLean(evidence, REGISTRY);
  assert.equal(auto.pass, true, auto.reasons.join('; '));
  const disp = evaluateDisposition(evidence, REGISTRY);
  assert.equal(disp.product_disposition, PRODUCT_DISPOSITION.AUTO_RETAIN_LEAN);
  assert.equal(disp.disable_model_invocation, false);
  assert.equal(disp.disposition_label, 'AUTO-RETAIN LEAN');
  assert.equal(disp.evidence_validity, 'confirmatory');
  assert.equal(disp.replication_status, 'passed');
});

test('AUTO-RETAIN mutation: utility point just below +5pp fails', () => {
  const evidence = passingAutoEvidence();
  const haiku = MODELS.find((m) => /haiku/i.test(m));
  evidence.models[haiku].lean_vs_none.point_pp = 4.99;
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
});

test('AUTO-RETAIN mutation: adjusted lower bound == 0 fails', () => {
  const evidence = passingAutoEvidence();
  const haiku = MODELS.find((m) => /haiku/i.test(m));
  evidence.models[haiku].lean_vs_none.adjusted_lower_pp = 0;
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
});

test('AUTO-RETAIN mutation: adjusted p == 0.05 fails', () => {
  const evidence = passingAutoEvidence();
  const haiku = MODELS.find((m) => /haiku/i.test(m));
  evidence.models[haiku].lean_vs_none.adjusted_p = 0.05;
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
});

test('AUTO-RETAIN mutation: unadjusted lower_95_pp / p_value fallback rejected', () => {
  const evidence = passingAutoEvidence();
  const haiku = MODELS.find((m) => /haiku/i.test(m));
  delete evidence.models[haiku].lean_vs_none.adjusted_lower_pp;
  delete evidence.models[haiku].lean_vs_none.adjusted_p;
  delete evidence.models[haiku].lean_vs_none.adjusted;
  evidence.models[haiku].lean_vs_none.lower_95_pp = 2;
  evidence.models[haiku].lean_vs_none.p_value = 0.001;
  const auto = evaluateAutoRetainLean(evidence, REGISTRY);
  assert.equal(auto.pass, false);
  assert.ok(auto.reasons.some((r) => /adjusted/i.test(r)));
});

test('AUTO-RETAIN mutation: adjusted:true missing fails', () => {
  const evidence = passingAutoEvidence();
  const haiku = MODELS.find((m) => /haiku/i.test(m));
  delete evidence.models[haiku].lean_vs_none.adjusted;
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
});

test('AUTO-RETAIN mutation: directional 3–5pp zone never auto-retains', () => {
  const evidence = passingAutoEvidence();
  const haiku = MODELS.find((m) => /haiku/i.test(m));
  evidence.models[haiku].lean_vs_none.point_pp = 4.0;
  evidence.models[haiku].lean_vs_none.adjusted_lower_pp = 1.0;
  evidence.models[haiku].lean_vs_none.adjusted_p = 0.001;
  const auto = evaluateAutoRetainLean(evidence, REGISTRY);
  assert.equal(auto.pass, false);
  const disp = evaluateDisposition(evidence, REGISTRY);
  assert.equal(disp.product_disposition, PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE);
});

test('AUTO-RETAIN mutation: other model lower bound ≤ -3pp fails', () => {
  const evidence = passingAutoEvidence();
  const sonnet = MODELS.find((m) => /sonnet/i.test(m));
  evidence.models[sonnet].lean_vs_none.adjusted_lower_pp = -3;
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
});

test('AUTO-RETAIN mutation: missing model stratum fails (no silent shrink)', () => {
  const evidence = passingAutoEvidence();
  const opus = MODELS.find((m) => /opus/i.test(m));
  delete evidence.models[opus];
  const auto = evaluateAutoRetainLean(evidence, REGISTRY);
  assert.equal(auto.pass, false);
  assert.ok(auto.reasons.some((r) => /missing model/i.test(r)));
});

test('AUTO-RETAIN mutation: underpowered stratum fails', () => {
  const evidence = passingAutoEvidence();
  const sonnet = MODELS.find((m) => /sonnet/i.test(m));
  evidence.models[sonnet].lean_vs_none.powered = false;
  evidence.models[sonnet].lean_vs_none.decision_eligible = false;
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
});

test('AUTO-RETAIN mutation: lean_vs_full lower ≤ -3pp fails', () => {
  const evidence = passingAutoEvidence();
  const haiku = MODELS.find((m) => /haiku/i.test(m));
  evidence.models[haiku].lean_vs_full.adjusted_lower_pp = -3;
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
});

test('AUTO-RETAIN mutation: harm lower ≤ -2pp fails', () => {
  const evidence = passingAutoEvidence();
  const haiku = MODELS.find((m) => /haiku/i.test(m));
  evidence.models[haiku].hard_negative.adjusted_lower_pp = -2;
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
});

test('AUTO-RETAIN mutation: input token ratio > 0.7 fails', () => {
  const evidence = passingAutoEvidence();
  const haiku = MODELS.find((m) => /haiku/i.test(m));
  evidence.models[haiku].cost.lean_input_tokens = 71;
  evidence.models[haiku].cost.full_input_tokens = 100;
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
});

test('AUTO-RETAIN mutation: calls/output/latency/cost ratio > 1.10 fails', () => {
  const fields = [
    ['lean_calls', 'full_calls', 12, 10],
    ['lean_output_tokens', 'full_output_tokens', 120, 100],
    ['lean_latency_ms', 'full_latency_ms', 1200, 1000],
    ['lean_cost_usd', 'full_cost_usd', 1.2, 1.0],
  ];
  for (const [leanKey, fullKey, lean, full] of fields) {
    const evidence = passingAutoEvidence();
    const haiku = MODELS.find((m) => /haiku/i.test(m));
    evidence.models[haiku].cost[leanKey] = lean;
    evidence.models[haiku].cost[fullKey] = full;
    assert.equal(
      evaluateAutoRetainLean(evidence, REGISTRY).pass,
      false,
      `${leanKey}/${fullKey} should fail`
    );
  }
});

test('AUTO-RETAIN mutation: missing cost fields fail', () => {
  const evidence = passingAutoEvidence();
  const haiku = MODELS.find((m) => /haiku/i.test(m));
  delete evidence.models[haiku].cost;
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
});

test('AUTO-RETAIN mutation: missing terminal metadata fields quarantine', () => {
  const fields = [
    'split',
    'replication_status',
    'evidence_validity',
    'decision_eligible',
    'multiplicity_adjusted',
    'health',
  ];
  for (const field of fields) {
    const evidence = passingAutoEvidence();
    delete evidence[field];
    if (field === 'split') delete evidence.phase;
    if (field === 'split') delete evidence.untouched_replication;
    if (field === 'multiplicity_adjusted') delete evidence.final_rule_adjusted;
    const auto = evaluateAutoRetainLean(evidence, REGISTRY);
    assert.equal(auto.pass, false, `missing ${field} should fail`);
    const disp = evaluateDisposition(evidence, REGISTRY);
    assert.equal(disp.product_disposition, PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE);
  }
});

test('AUTO-RETAIN mutation: evidence_validity provisional fails', () => {
  const evidence = passingAutoEvidence();
  evidence.evidence_validity = 'provisional';
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
});

test('AUTO-RETAIN mutation: incomplete health denominators fail', () => {
  const evidence = passingAutoEvidence();
  evidence.health = completeHealth({ completed: 90, scored: 90 });
  const meta = terminalDispositionMetadataOk(evidence);
  assert.equal(meta.ok, false);
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
});

test('AUTO-RETAIN mutation: missing health.failures fails closed', () => {
  const evidence = passingAutoEvidence();
  delete evidence.health.failures;
  const meta = terminalDispositionMetadataOk(evidence);
  assert.equal(meta.ok, false);
  assert.ok(meta.reasons.some((r) => /health\.failures missing/.test(r)));
  assert.equal(evaluateAutoRetainLean(evidence, REGISTRY).pass, false);
  assert.equal(evaluateDelete({ ...passingDeleteEvidence(), health: { ...completeHealth() } }, REGISTRY).pass, true);
  const delEvidence = passingDeleteEvidence();
  delete delEvidence.health.failures;
  assert.equal(evaluateDelete(delEvidence, REGISTRY).pass, false);
});

// ---------------------------------------------------------------------------
// MINIMIZE FURTHER — heldout/screening only
// ---------------------------------------------------------------------------

test('MINIMIZE FURTHER: positive on heldout/screening selection', () => {
  const evidence = passingMinimizeEvidence();
  const m = evaluateMinimizeFurther(evidence, REGISTRY);
  assert.equal(m.pass, true, m.reasons.join('; '));
  const disp = evaluateDisposition(evidence, REGISTRY);
  assert.equal(disp.product_disposition, PRODUCT_DISPOSITION.MINIMIZE_FURTHER);
  assert.equal(disp.disable_model_invocation, true);
});

test('MINIMIZE FURTHER: evaluateDisposition returns minimize before screening quarantine', () => {
  const evidence = passingMinimizeEvidence();
  // Explicitly heldout/screening
  assert.equal(evidence.split, 'heldout');
  const disp = evaluateDisposition(evidence, REGISTRY);
  assert.equal(disp.product_disposition, PRODUCT_DISPOSITION.MINIMIZE_FURTHER);
});

test('MINIMIZE FURTHER mutation: replication must not trigger minimize', () => {
  const evidence = passingMinimizeEvidence();
  evidence.split = 'replication';
  evidence.phase = 'replication';
  evidence.untouched_replication = true;
  delete evidence.screening_only;
  delete evidence.selection_split;
  const m = evaluateMinimizeFurther(evidence, REGISTRY);
  assert.equal(m.pass, false);
  assert.ok(m.reasons.some((r) => /replication/i.test(r)));
  const disp = evaluateDisposition(evidence, REGISTRY);
  assert.notEqual(disp.product_disposition, PRODUCT_DISPOSITION.MINIMIZE_FURTHER);
});

test('MINIMIZE FURTHER mutation: missing selection_frozen fails', () => {
  const evidence = passingMinimizeEvidence();
  delete evidence.selection_frozen;
  assert.equal(evaluateMinimizeFurther(evidence, REGISTRY).pass, false);
});

test('MINIMIZE FURTHER mutation: missing full_beats flag fails', () => {
  const evidence = passingMinimizeEvidence();
  delete evidence.full_beats_lean_and_none;
  delete evidence.minimize_further;
  for (const id of MODELS) {
    evidence.models[id].full_beats_lean_and_none = false;
  }
  assert.equal(evaluateMinimizeFurther(evidence, REGISTRY).pass, false);
});

test('MINIMIZE FURTHER mutation: missing heldout/screening split fails', () => {
  const evidence = passingMinimizeEvidence();
  delete evidence.split;
  delete evidence.phase;
  delete evidence.screening_only;
  delete evidence.selection_split;
  assert.equal(evaluateMinimizeFurther(evidence, REGISTRY).pass, false);
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

test('DELETE: positive when adjusted upper < +3pp on all models with caveats cleared', () => {
  const evidence = passingDeleteEvidence();
  const del = evaluateDelete(evidence, REGISTRY);
  assert.equal(del.pass, true, del.reasons.join('; '));
  const disp = evaluateDisposition(evidence, REGISTRY);
  assert.equal(disp.product_disposition, PRODUCT_DISPOSITION.DELETE);
  assert.equal(disp.evidence_validity, 'confirmatory');
});

test('DELETE mutation: adjusted upper == +3pp fails', () => {
  const evidence = passingDeleteEvidence();
  for (const id of MODELS) {
    evidence.models[id].best_skill_vs_none.adjusted_upper_pp = 3;
  }
  assert.equal(evaluateDelete(evidence, REGISTRY).pass, false);
});

test('DELETE mutation: unadjusted upper_95_pp fallback rejected', () => {
  const evidence = passingDeleteEvidence();
  for (const id of MODELS) {
    delete evidence.models[id].best_skill_vs_none.adjusted_upper_pp;
    evidence.models[id].best_skill_vs_none.upper_95_pp = 1;
  }
  assert.equal(evaluateDelete(evidence, REGISTRY).pass, false);
});

test('DELETE mutation: best-arm not powered/decision_eligible fails', () => {
  const evidence = passingDeleteEvidence();
  const id = MODELS[0];
  evidence.models[id].best_skill_vs_none.powered = false;
  evidence.models[id].best_skill_vs_none.decision_eligible = false;
  assert.equal(evaluateDelete(evidence, REGISTRY).pass, false);
});

test('DELETE mutation: missing best-arm powered flag fails', () => {
  const evidence = passingDeleteEvidence();
  const id = MODELS[0];
  delete evidence.models[id].best_skill_vs_none.powered;
  delete evidence.models[id].best_skill_vs_none.decision_eligible;
  assert.equal(evaluateDelete(evidence, REGISTRY).pass, false);
});

test('DELETE mutation: missing caveat clearance fails', () => {
  const evidence = passingDeleteEvidence();
  delete evidence.caveats_cleared;
  delete evidence.no_ceiling_data_judge_caveat;
  assert.equal(evaluateDelete(evidence, REGISTRY).pass, false);
});

test('DELETE mutation: missing model upper fails (no silent shrink)', () => {
  const evidence = passingDeleteEvidence();
  delete evidence.models[MODELS[0]].best_skill_vs_none;
  assert.equal(evaluateDelete(evidence, REGISTRY).pass, false);
});

test('DELETE mutation: remaining judge/ceiling caveat fails', () => {
  const evidence = passingDeleteEvidence();
  evidence.ceiling_limited = true;
  assert.equal(evaluateDelete(evidence, REGISTRY).pass, false);
});

test('DELETE mutation: missing terminal metadata fields quarantine', () => {
  for (const field of [
    'replication_status',
    'evidence_validity',
    'decision_eligible',
    'health',
    'multiplicity_adjusted',
  ]) {
    const evidence = passingDeleteEvidence();
    delete evidence[field];
    if (field === 'multiplicity_adjusted') delete evidence.final_rule_adjusted;
    assert.equal(evaluateDelete(evidence, REGISTRY).pass, false, `missing ${field}`);
  }
});

// ---------------------------------------------------------------------------
// MANUAL-ONLY default
// ---------------------------------------------------------------------------

test('MANUAL-ONLY: missing evidence quarantines', () => {
  const disp = evaluateDisposition(null, REGISTRY);
  assert.equal(disp.product_disposition, PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE);
  assert.equal(disp.disable_model_invocation, true);
});

test('MANUAL-ONLY: screening split without minimize cannot elevate or delete', () => {
  const evidence = passingAutoEvidence();
  evidence.split = 'heldout';
  evidence.phase = 'screening';
  evidence.screening_only = true;
  // strip minimize flags
  delete evidence.full_beats_lean_and_none;
  delete evidence.selection_frozen;
  const disp = evaluateDisposition(evidence, REGISTRY);
  assert.equal(disp.product_disposition, PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE);
});

test('MANUAL-ONLY: adverse/missing fields quarantine', () => {
  const evidence = {
    skill_id: 'partial',
    split: 'replication',
    models: {
      [MODELS[0]]: baseStratum(),
    },
  };
  const disp = evaluateDisposition(evidence, REGISTRY);
  assert.equal(disp.product_disposition, PRODUCT_DISPOSITION.MANUAL_ONLY_QUARANTINE);
});

test('evaluatePortfolioDispositions counts terminal gates', () => {
  const autoEv = passingAutoEvidence();
  const deleteEv = passingDeleteEvidence();
  const minEv = passingMinimizeEvidence();
  const summary = evaluatePortfolioDispositions([autoEv, deleteEv, minEv, null], REGISTRY);
  assert.equal(summary.counts.auto_retain_lean, 1);
  assert.equal(summary.counts.delete, 1);
  assert.equal(summary.counts.minimize_further, 1);
  assert.equal(summary.counts.manual_only_quarantine, 1);
});

test('registry path resolves and portfolio module is pure (no droid import)', () => {
  const modPath = path.join(__dirname, '..', 'lib', 'portfolio.js');
  const src = fs.readFileSync(modPath, 'utf8');
  assert.ok(!/require\(['"]\.\/droid/.test(src));
  assert.ok(!/require\(['"]\.\/judge/.test(src));
  assert.ok(!/child_process|spawn|fetch\(/.test(src));
});
