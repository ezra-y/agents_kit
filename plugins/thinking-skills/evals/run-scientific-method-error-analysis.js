#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { writeJsonAtomic } = require('./lib/io');
const {
  TAXONOMY,
  buildBlindAuditCases,
  summarizeAdjudicatedLabels,
  validateCoderLabels,
} = require('./lib/scientific-method-error-analysis');

const DEFAULT_ENVELOPE = path.join(
  __dirname,
  'results',
  'local',
  'scientific-method-candidate-02-v6',
  'confirmation',
  'envelope.json',
);
const DEFAULT_DATASET = path.join(__dirname, 'datasets', 'external', 'swebench-pro.jsonl');
const AUDIT_DIR = process.env.SCI_AUDIT_DIR
  ? path.resolve(process.env.SCI_AUDIT_DIR)
  : path.join(__dirname, 'results', 'local', 'scientific-method-candidate-02-root-cause');

function usage() {
  process.stdout.write(`Usage:
  node evals/run-scientific-method-error-analysis.js generate
  node evals/run-scientific-method-error-analysis.js summarize <adjudicated-labels.json>

Environment:
  SCI_CONFIRMATION_ENVELOPE  Override confirmation envelope
  SCI_DATASET_PATH           Override local dataset
  SCI_AUDIT_DIR              Override ignored local audit directory
`);
}

function loadJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function rawLoader(uri) {
  if (!uri || !String(uri).startsWith('file://')) return null;
  const file = fileURLToPath(uri);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function generate() {
  const envelopePath = process.env.SCI_CONFIRMATION_ENVELOPE
    ? path.resolve(process.env.SCI_CONFIRMATION_ENVELOPE)
    : DEFAULT_ENVELOPE;
  const datasetPath = process.env.SCI_DATASET_PATH
    ? path.resolve(process.env.SCI_DATASET_PATH)
    : DEFAULT_DATASET;
  const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
  const dataset = loadJsonl(datasetPath);
  const audit = buildBlindAuditCases(envelope, dataset, { rawLoader });
  const template = audit.cases.map((entry) => ({
    case_id: entry.case_id,
    primary_cause: null,
    fixability: null,
    intervention: null,
    confidence: null,
    evidence: null,
  }));
  writeJsonAtomic(path.join(AUDIT_DIR, 'blind-cases.json'), audit.cases);
  writeJsonAtomic(path.join(AUDIT_DIR, 'blind-key.json'), audit.blind_key);
  writeJsonAtomic(path.join(AUDIT_DIR, 'coder-template.json'), template);
  writeJsonAtomic(
    path.join(AUDIT_DIR, 'taxonomy.json'),
    Object.fromEntries(Object.entries(TAXONOMY).map(([key, values]) => [key, [...values]])),
  );
  process.stdout.write(`${JSON.stringify({
    audit_dir: AUDIT_DIR,
    cases: audit.cases.length,
    disagreements: Object.values(audit.blind_key)
      .filter((entry) => entry.outcomes.none !== entry.outcomes['candidate-02']).length,
    both_wrong: Object.values(audit.blind_key)
      .filter((entry) => !entry.outcomes.none && !entry.outcomes['candidate-02']).length,
  }, null, 2)}\n`);
}

function summarize(labelsFile) {
  if (!labelsFile) throw new Error('summarize requires an adjudicated labels file');
  const cases = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'blind-cases.json'), 'utf8'));
  const blindKey = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'blind-key.json'), 'utf8'));
  const labels = JSON.parse(fs.readFileSync(path.resolve(labelsFile), 'utf8'));
  validateCoderLabels(cases, labels);
  const byOutcomeClass = {};
  for (const label of labels) {
    const outcomeClass = blindKey[label.case_id].outcome_class;
    if (!byOutcomeClass[outcomeClass]) byOutcomeClass[outcomeClass] = [];
    byOutcomeClass[outcomeClass].push(label);
  }
  const result = {
    n: labels.length,
    overall: summarizeAdjudicatedLabels(labels),
    by_outcome_class: Object.fromEntries(
      Object.entries(byOutcomeClass)
        .map(([key, rows]) => [key, { n: rows.length, ...summarizeAdjudicatedLabels(rows) }]),
    ),
  };
  writeJsonAtomic(path.join(AUDIT_DIR, 'summary.json'), result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function main() {
  const command = process.argv[2];
  if (!command || command === '--help' || command === '-h') {
    usage();
    process.exitCode = command ? 0 : 1;
    return;
  }
  if (command === 'generate') return generate();
  if (command === 'summarize') return summarize(process.argv[3]);
  throw new Error(`unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
}
