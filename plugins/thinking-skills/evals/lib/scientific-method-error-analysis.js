'use strict';

const path = require('path');
const { sha256 } = require('./result');

const TAXONOMY = {
  primary_cause: new Set([
    'explicit_clue_ignored',
    'instruction_overconstraint',
    'overthinking_weak_hypothesis',
    'wrong_abstraction_layer',
    'wrong_owner_module',
    'insufficient_repository_context',
    'multi_file_gold_ambiguity',
    'invalid_or_missing_answer',
    'benchmark_label_ambiguity',
  ]),
  fixability: new Set([
    'skill_instruction',
    'prompt_context',
    'task_label',
    'model_capability',
  ]),
  intervention: new Set([
    'clue_first_fast_path',
    'provide_repository_map',
    'owner_path_constraint',
    'two_contender_limit',
    'evidence_abstention',
    'answer_first_format',
    'dataset_single_owner_filter',
    'module_role_prior',
    'no_skill_change',
  ]),
  confidence: new Set(['high', 'medium', 'low']),
};

function outcomeClass(outcomes) {
  const none = outcomes.none === true;
  const lean = outcomes.lean === true;
  const candidate = outcomes['candidate-02'] === true;
  if (none && lean && candidate) return 'all_correct';
  if (!none && !lean && !candidate) return 'all_wrong';
  if (none && !lean && !candidate) return 'shared_skill_harm';
  if (!none && lean && candidate) return 'shared_skill_benefit';
  if (none && lean && !candidate) return 'candidate_specific_harm';
  if (!none && !lean && candidate) return 'candidate_specific_benefit';
  if (none && !lean && candidate) return 'lean_specific_harm';
  if (!none && lean && !candidate) return 'lean_specific_benefit';
  return 'unclassified';
}

function normalizePath(value) {
  return value == null ? null : String(value).trim().replace(/\\/g, '/');
}

function pathRelation(prediction, goldFiles) {
  const predicted = normalizePath(prediction);
  if (!predicted) return 'missing';
  const gold = (goldFiles || []).map(normalizePath).filter(Boolean);
  if (gold.includes(predicted)) return 'correct';
  const basename = path.posix.basename(predicted);
  if (gold.some((file) => path.posix.basename(file) === basename)) {
    return 'same_basename_wrong_directory';
  }
  const ownerDirectory = path.posix.dirname(predicted);
  if (gold.some((file) => path.posix.dirname(file) === ownerDirectory)) {
    return 'shared_owner_directory';
  }
  const extension = path.posix.extname(predicted);
  if (extension && gold.some((file) => path.posix.extname(file) === extension)) {
    return 'same_extension_only';
  }
  return 'unrelated_path';
}

function blindArmLabels(itemId, armIds) {
  const ordered = armIds.slice().sort((left, right) => (
    sha256(`scientific-method-error-audit-v1:${itemId}:${left}`)
      .localeCompare(sha256(`scientific-method-error-audit-v1:${itemId}:${right}`))
  ));
  return Object.fromEntries(ordered.map((armId, index) => [armId, String.fromCharCode(65 + index)]));
}

function buildBlindAuditCases(envelope, dataset, options = {}) {
  const rawLoader = options.rawLoader || (() => null);
  const byId = new Map((dataset || []).map((item) => [String(item.id), item]));
  const rowsByItem = new Map();
  for (const row of (envelope && envelope.items) || []) {
    if (!rowsByItem.has(row.item_id)) rowsByItem.set(row.item_id, {});
    rowsByItem.get(row.item_id)[row.arm_id] = row;
  }
  const cases = [];
  const blindKey = {};
  for (const [itemId, arms] of rowsByItem) {
    const item = byId.get(String(itemId));
    if (!item || !arms.none || !arms.lean || !arms['candidate-02']) continue;
    const outcomes = Object.fromEntries(
      ['none', 'lean', 'candidate-02'].map((armId) => [armId, arms[armId].correct === true]),
    );
    if (outcomes.none && outcomes.lean && outcomes['candidate-02']) continue;
    const armLabels = blindArmLabels(itemId, ['none', 'lean', 'candidate-02']);
    cases.push({
      case_id: itemId,
      prompt: item.prompt,
      gold_files: item.gold_files,
      metadata: {
        repo: item.repo,
        repo_language: item.repo_language,
        issue_categories: item.issue_categories,
        issue_specificity: item.issue_specificity,
        gold_file_count: item.gold_files.length,
      },
      responses: ['none', 'lean', 'candidate-02']
        .map((armId) => ({
          label: armLabels[armId],
          prediction: arms[armId].parsed || null,
          path_relation: pathRelation(arms[armId].parsed, item.gold_files),
          raw_response: rawLoader(arms[armId].archive_uri, arms[armId]),
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    });
    blindKey[itemId] = {
      arm_labels: armLabels,
      outcomes,
      outcome_class: outcomeClass(outcomes),
    };
  }
  cases.sort((left, right) => left.case_id.localeCompare(right.case_id));
  return { cases, blind_key: blindKey };
}

function validateCoderLabels(cases, labels) {
  const expected = new Set((cases || []).map((entry) => entry.case_id));
  const observed = new Set((labels || []).map((entry) => entry.case_id));
  if (expected.size !== observed.size || [...expected].some((id) => !observed.has(id))) {
    throw new Error(`label coverage mismatch: expected ${expected.size}, found ${observed.size}`);
  }
  for (const label of labels || []) {
    for (const field of ['primary_cause', 'fixability', 'intervention', 'confidence']) {
      if (!TAXONOMY[field].has(label[field])) {
        throw new Error(`invalid ${field} for ${label.case_id}: ${label[field]}`);
      }
    }
    if (!String(label.evidence || '').trim()) {
      throw new Error(`missing evidence for ${label.case_id}`);
    }
  }
  return true;
}

function summarizeAdjudicatedLabels(labels) {
  const fields = ['primary_cause', 'fixability', 'intervention', 'confidence'];
  return Object.fromEntries(fields.map((field) => {
    const counts = {};
    for (const label of labels || []) {
      counts[label[field]] = (counts[label[field]] || 0) + 1;
    }
    return [field, counts];
  }));
}

module.exports = {
  TAXONOMY,
  buildBlindAuditCases,
  outcomeClass,
  pathRelation,
  summarizeAdjudicatedLabels,
  validateCoderLabels,
};
