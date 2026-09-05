#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  evaluateConfirmationEligibility,
  listConfirmatoryCandidates,
} = require('./lib/evidence');

const REPO_ROOT = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(__dirname, 'studies', 'registry.json');
const EVIDENCE_PATH = path.join(REPO_ROOT, 'analysis', 'evidence.json');
const PORTFOLIO_DIR = path.join(__dirname, 'studies', 'portfolio-v1');
const WORKFLOW_DIR = path.join(__dirname, 'studies', 'workflow-v1');
const RECOVERY_LEDGER_PATH = path.join(__dirname, 'studies', 'catalog-cutover', 'recovery-ledger.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function stableUnique(values) {
  return [...new Set(values)].sort();
}

function countBy(values) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      counts.set(value, (counts.get(value) || 0) + 1);
      return counts;
    }, new Map()).entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))
  );
}

function generateEvidenceRegistry() {
  const registry = readJson(REGISTRY_PATH);
  const previous = readJson(EVIDENCE_PATH);
  const manifest = readJson(path.join(PORTFOLIO_DIR, 'manifest.json'));
  const aggregate = readJson(path.join(PORTFOLIO_DIR, 'aggregate.json'));
  const cases = readJson(path.join(PORTFOLIO_DIR, 'cases.json'));
  const workflowManifest = readJson(path.join(WORKFLOW_DIR, 'manifest.json'));
  const workflowAggregate = readJson(path.join(WORKFLOW_DIR, 'aggregate.json'));
  const workflowCases = readJson(path.join(WORKFLOW_DIR, 'cases.json'));
  const recoveryLedger = readJson(RECOVERY_LEDGER_PATH);

  const previousRows = {
    ...(previous.deleted_skills || {}),
    ...(previous.skills || {}),
  };
  const portfolioById = new Map(aggregate.skills.map(row => [row.skill_id, row]));

  const skills = {};
  for (const bareId of Object.keys(registry.skills).sort()) {
    const skillId = `thinking-${bareId}`;
    const prior = previousRows[skillId];
    const gate = portfolioById.get(bareId);
    if (!prior) throw new Error(`missing historical evidence row for ${skillId}`);
    if (!gate) throw new Error(`missing portfolio gate row for ${bareId}`);

    skills[skillId] = {
      ...prior,
      catalog_status: 'active_manual_only',
      prior_product_disposition: prior.prior_product_disposition || prior.product_disposition,
      product_disposition: gate.product_disposition,
      elevate: false,
      auto_retain: false,
      portfolio_gate: {
        study_id: aggregate.study_id,
        run_status: aggregate.run_status,
        decision_eligible: aggregate.health.decision_eligible,
        measured_result: gate.measured_result,
        statistical_status: gate.statistical_status,
        replication_status: gate.replication_status,
        evidence_validity: gate.evidence_validity,
        product_disposition: gate.product_disposition,
        blockers: gate.blockers,
      },
      notes: stableUnique([
        ...(prior.notes || []),
        'portfolio-v1 made zero solver calls because the frozen design was not feasible under the declared power and budget gates.',
        'Manual-only quarantine remains in force; no automatic invocation claim.',
      ]),
      study_ids: stableUnique([...(prior.study_ids || []), aggregate.study_id]),
    };
  }

  const deletedSkills = {};
  for (const bareId of Object.keys(registry.deleted_skills).sort()) {
    const skillId = `thinking-${bareId}`;
    const prior = previousRows[skillId];
    const deletion = registry.deleted_skills[bareId];
    if (!prior) throw new Error(`missing historical evidence row for deleted skill ${skillId}`);

    deletedSkills[skillId] = {
      ...prior,
      catalog_status: 'deleted_after_mechanism_absorption',
      prior_product_disposition: prior.prior_product_disposition || prior.product_disposition,
      product_disposition: 'deleted_after_mechanism_absorption',
      elevate: false,
      auto_retain: false,
      absorbed_into: deletion.disposition?.absorb_into || [],
      absorbed_mechanisms: deletion.disposition?.absorbed_mechanisms || [],
      deletion_reason: deletion.reason || null,
      notes: stableUnique([
        ...(prior.notes || []),
        'Removed from the shipped catalog only after its retained mechanism was migrated to the named survivor contracts.',
      ]),
    };
  }

  const caseRows = Object.values(cases.skills);

  const portfolioStudy = {
    study_id: aggregate.study_id,
    bundle_dir: 'evals/studies/portfolio-v1',
    prereg_path: 'evals/studies/portfolio-v1/prereg.md',
    manifest_path: 'evals/studies/portfolio-v1/manifest.json',
    cases_path: 'evals/studies/portfolio-v1/cases.json',
    aggregate_path: 'evals/studies/portfolio-v1/aggregate.json',
    items_path: 'evals/studies/portfolio-v1/items.jsonl',
    prereg_sha256: manifest.preregistration.sha256,
    manifest_sha256: sha256File(path.join(PORTFOLIO_DIR, 'manifest.json')),
    input_registry_ref: manifest.input_registry_ref,
    current_registry_ref: manifest.current_registry_ref,
    run_status: aggregate.run_status,
    measured_result: aggregate.measured_result,
    statistical_status: aggregate.statistical_status,
    replication_status: aggregate.replication_status,
    evidence_validity: aggregate.evidence_validity,
    product_disposition: aggregate.product_disposition,
    decision_eligible: aggregate.health.decision_eligible,
    model_calls: aggregate.usage.calls,
    skill_count: aggregate.summary.skill_count,
    blockers: stableUnique(aggregate.skills.flatMap(row => row.blockers || [])),
    disposition_counts: countBy(aggregate.skills.map(row => row.product_disposition)),
    frozen_case_counts: {
      heldout: caseRows.reduce((n, row) => n + row.heldout_ids.length, 0),
      replication: caseRows.reduce((n, row) => n + row.replication_ids.length, 0),
      hard_negatives: caseRows.reduce((n, row) => n + row.hard_negative_ids.length, 0),
    },
  };

  const workflowStudy = {
    study_id: workflowAggregate.study_id,
    bundle_dir: 'evals/studies/workflow-v1',
    prereg_path: 'evals/studies/workflow-v1/prereg.md',
    manifest_path: 'evals/studies/workflow-v1/manifest.json',
    cases_path: 'evals/studies/workflow-v1/cases.json',
    aggregate_path: 'evals/studies/workflow-v1/aggregate.json',
    items_path: 'evals/studies/workflow-v1/items.jsonl',
    prereg_sha256: workflowManifest.preregistration.sha256,
    manifest_sha256: sha256File(path.join(WORKFLOW_DIR, 'manifest.json')),
    input_registry_ref: workflowManifest.input_registry_ref,
    current_registry_ref: workflowManifest.current_registry_ref,
    frozen_artifacts: workflowManifest.frozen_artifacts,
    candidate: workflowManifest.primary_arm,
    comparators: workflowManifest.comparators,
    models: workflowManifest.models,
    run_status: workflowAggregate.run_status,
    measured_result: workflowAggregate.measured_result,
    statistical_status: workflowAggregate.statistical_status,
    replication_status: workflowAggregate.replication_status,
    evidence_validity: workflowAggregate.evidence_validity,
    product_disposition: workflowAggregate.product_disposition,
    decision_eligible: workflowAggregate.health.decision_eligible,
    model_calls: workflowAggregate.usage.calls,
    retention_gates: workflowAggregate.retention_gates,
    blockers: workflowAggregate.reasons,
    frozen_case_count: workflowCases.cases.length,
  };

  const studies = (previous.studies || [])
    .filter(study => study.study_id !== aggregate.study_id && study.study_id !== workflowAggregate.study_id)
    .concat(portfolioStudy, workflowStudy)
    .sort((a, b) => a.study_id.localeCompare(b.study_id));

  const historicalStatuses = Object.values(skills).map(row => row.statistical_status || 'unknown');
  const evidence = {
    schema_version: 2,
    created_at: previous.created_at,
    updated_at: aggregate.created_at,
    phase: 5,
    title: 'Canonical evidence registry — 28 manual-only skills; workflow machinery rejected',
    authority: 'analysis/evidence.json',
    generated_by: 'node evals/evidence.js generate',
    registry_ref: {
      path: 'evals/studies/registry.json',
      registry_version: registry.registry_version,
      sha256: sha256File(REGISTRY_PATH),
    },
    policy: {
      ...(previous.policy || {}),
      elevate_count: 0,
      auto_retain_count: 0,
      notes: [
        'Historical estimates remain provisional unless their declared study bundle independently passes every confirmation gate.',
        'A statistically significant row cannot silently become an ELEVATE product verdict.',
        'portfolio-v1 was preregistered, but zero solver calls were eligible under its frozen power and budget constraints.',
        'All 28 active skills remain manual-only; 11 removed skills are preserved separately with absorption provenance.',
        'workflow-v1 made zero solver calls after its frozen 24-case design failed the pre-run power gate; workflow-only machinery is marked for deletion.',
        'Fourteen frozen historical result artifacts were accidentally deleted during cleanup; their hashes and recovery attempts are pinned in the catalog-cutover recovery ledger and they cannot support confirmatory claims.',
      ],
    },
    summary: {
      active_skill_count: Object.keys(skills).length,
      deleted_skill_count: Object.keys(deletedSkills).length,
      study_count: studies.length,
      elevate_count: 0,
      robust_elevate_count: 0,
      auto_retain_count: 0,
      manual_only_count: Object.keys(skills).length,
      portfolio_run_status: aggregate.run_status,
      portfolio_model_calls: aggregate.usage.calls,
      portfolio_decision_eligible_count: aggregate.health.decision_eligible ? aggregate.summary.skill_count : 0,
      workflow_run_status: workflowAggregate.run_status,
      workflow_model_calls: workflowAggregate.usage.calls,
      workflow_decision_eligible: workflowAggregate.health.decision_eligible,
      workflow_product_disposition: workflowAggregate.product_disposition,
      historical_statistical_status_counts_active: countBy(historicalStatuses),
      product_disposition_counts_active: countBy(Object.values(skills).map(row => row.product_disposition)),
      evidence_validity: 'provisional',
      product_disposition_global: 'no_automatic_elevation',
    },
    historical_artifact_loss: {
      status: recoveryLedger.incident.status,
      lost_artifact_count: recoveryLedger.lost_artifacts.length,
      current_claim_registry_directly_references_lost_paths:
        recoveryLedger.incident.current_claim_registry_directly_references_lost_paths,
      evidence_effect: recoveryLedger.incident.evidence_effect,
      ledger_ref: {
        path: path.relative(REPO_ROOT, RECOVERY_LEDGER_PATH),
        sha256: sha256File(RECOVERY_LEDGER_PATH),
      },
    },
    studies,
    skills,
    deleted_skills: deletedSkills,
    workflow_form: {
      study_id: workflowAggregate.study_id,
      measured_result: workflowAggregate.measured_result,
      statistical_status: workflowAggregate.statistical_status,
      replication_status: workflowAggregate.replication_status,
      evidence_validity: workflowAggregate.evidence_validity,
      product_disposition: workflowAggregate.product_disposition,
      decision_eligible: workflowAggregate.health.decision_eligible,
      model_calls: workflowAggregate.usage.calls,
      candidate: workflowManifest.primary_arm,
      comparators: workflowManifest.comparators,
      retention_gates: workflowAggregate.retention_gates,
      blockers: workflowAggregate.reasons,
    },
  };

  if (Object.keys(skills).length !== 28) throw new Error('expected exactly 28 active skill rows');
  if (Object.keys(deletedSkills).length !== 11) throw new Error('expected exactly 11 deleted skill rows');
  if (Object.values(skills).some(row => row.elevate || row.auto_retain)) {
    throw new Error('automatic elevation found in canonical evidence');
  }
  if (aggregate.usage.calls !== 0 || aggregate.health.decision_eligible !== false) {
    throw new Error('portfolio aggregate no longer records the zero-call blocked outcome');
  }
  if (workflowAggregate.usage.calls !== 0 || workflowAggregate.health.decision_eligible !== false) {
    throw new Error('workflow aggregate no longer records the zero-call blocked outcome');
  }
  if (workflowAggregate.product_disposition !== 'delete_workflow_machinery') {
    throw new Error('workflow disposition no longer requires failed-gate cleanup');
  }

  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function listEvidence() {
  const evidence = readJson(EVIDENCE_PATH);
  const declared = new Set(listConfirmatoryCandidates().map(row => row.study_id));
  const rows = evidence.studies.map(study => ({
    study_id: study.study_id,
    declared: declared.has(study.study_id),
    run_status: study.run_status,
    statistical_status: study.statistical_status,
    evidence_validity: study.evidence_validity,
    product_disposition: study.product_disposition,
    decision_eligible: study.decision_eligible,
    model_calls: study.model_calls,
  }));
  console.log(JSON.stringify(rows, null, 2));
  return rows;
}

function checkEvidence(studyId) {
  if (!studyId) throw new Error('check requires a declared study id');
  const result = evaluateConfirmationEligibility({ studyId });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function printUsage() {
  console.log([
    'Usage: node evals/evidence.js <command>',
    '',
    'Commands:',
    '  generate       regenerate analysis/evidence.json (default)',
    '  list           list canonical study dispositions',
    '  check <id>     evaluate one declared study against confirmation gates',
  ].join('\n'));
}

function main(args = process.argv.slice(2)) {
  const [command = 'generate', studyId] = args;
  if (command === 'generate') return generateEvidenceRegistry();
  if (command === 'list') return listEvidence();
  if (command === 'check') return checkEvidence(studyId);
  if (command === 'help' || command === '--help' || command === '-h') return printUsage();
  throw new Error(`unknown evidence command: ${command}`);
}

if (require.main === module) main();

module.exports = {
  generateEvidenceRegistry,
  listEvidence,
  checkEvidence,
  main,
};
