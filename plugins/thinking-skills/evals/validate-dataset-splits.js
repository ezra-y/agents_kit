#!/usr/bin/env node
'use strict';

/**
 * Global split/provenance validator for eval datasets.
 *
 * Checks IDs, recomputed prompt hashes, and semantic clusters across all
 * authored and workflow base/expanded/replication files.
 * Does not write tracked files. Optional EVAL_SPLIT_OUT must resolve outside the repo.
 *
 * Usage: node evals/validate-dataset-splits.js
 * Optional: EVAL_SPLIT_OUT=/tmp/x.json to write a non-repo report.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(path.join(__dirname, '..'));
const AUTHORED_DIR = path.join(__dirname, 'datasets', 'authored');
const WORKFLOW_DIR = path.join(__dirname, 'datasets');

const WORKFLOW_FILES = [
  'workflow-cases.jsonl',
  'workflow-cases-expanded.jsonl',
  'workflow-cases-replication.jsonl',
];

const REGISTRY_PATH = path.join(__dirname, 'studies', 'registry.json');

function legacyAuthoredBasenames(registryPath = REGISTRY_PATH) {
  if (!fs.existsSync(registryPath)) return new Set();
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const names = new Set();
  for (const skill of Object.values(registry.deleted_skills || {})) {
    for (const source of (skill.data && skill.data.sources) || []) {
      const sourcePath = String(source.path || '').replace(/\\/g, '/');
      if (sourcePath.startsWith('evals/datasets/authored/')) names.add(path.basename(sourcePath));
    }
  }
  return names;
}

const SPLITS = ['dev', 'heldout', 'replication'];

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return { __parse_error: true, __line: idx + 1, __raw: line, __error: String(e.message || e) };
      }
    });
}

function promptText(row) {
  return row.prompt || row.case_brief || row.question || row.input || '';
}

function computePromptHash(row) {
  const text = promptText(row);
  if (!text) return null;
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/**
 * Always recompute from prompt text. Declared hashes are verified, never trusted.
 */
function promptHashInfo(row) {
  const computed = computePromptHash(row);
  const declared = row.prompt_sha256 || row.prompt_hash || null;
  if (declared && computed && declared !== computed) {
    return { hash: computed, declared, mismatch: true };
  }
  if (declared && !computed) {
    return { hash: null, declared, mismatch: true };
  }
  return { hash: computed || null, declared, mismatch: false };
}

function promptHash(row) {
  return promptHashInfo(row).hash;
}

function normalizePrompt(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function validateAuthoredFile(filename, authoredDir = AUTHORED_DIR) {
  const filepath = path.join(authoredDir, filename);
  if (!fs.existsSync(filepath)) return { file: filename, status: 'missing', errors: [], rows: [] };

  const rows = loadJsonl(filepath);
  const errors = [];
  const splitClusters = { dev: new Set(), heldout: new Set(), replication: new Set() };
  const splitPromptHashes = { dev: new Set(), heldout: new Set(), replication: new Set() };
  const requiredFields = ['cluster_id', 'source_family', 'split', 'cluster_basis'];

  for (const row of rows) {
    if (row.__parse_error) {
      errors.push(`line ${row.__line}: JSON parse error: ${row.__error}`);
      continue;
    }
    for (const field of requiredFields) {
      if (!row[field]) errors.push(`${row.id || 'unknown'}: missing ${field}`);
    }
    if (row.split && !SPLITS.includes(row.split)) {
      errors.push(`${row.id || 'unknown'}: invalid split '${row.split}'`);
    }
    if (row.evidence_status === 'consumed_provisional' || row.freshness_eligible === false) {
      if (row.evidence_status !== 'consumed_provisional') {
        errors.push(`${row.id || 'unknown'}: non-fresh row must set evidence_status=consumed_provisional`);
      }
      if (row.freshness_eligible !== false) {
        errors.push(`${row.id || 'unknown'}: consumed provisional row must set freshness_eligible=false`);
      }
      if (row.split !== 'dev') {
        errors.push(`${row.id || 'unknown'}: consumed provisional row must use split=dev`);
      }
    }
    if (row.split && row.cluster_id && splitClusters[row.split]) {
      splitClusters[row.split].add(row.cluster_id);
    }
    const phi = promptHashInfo(row);
    if (phi.mismatch) {
      errors.push(`${row.id || 'unknown'}: declared prompt hash does not match recomputed prompt`);
    }
    if (row.split && phi.hash && splitPromptHashes[row.split]) {
      splitPromptHashes[row.split].add(phi.hash);
    }
  }

  const pairs = [['dev', 'heldout'], ['dev', 'replication'], ['heldout', 'replication']];
  for (const [a, b] of pairs) {
    const clusterOverlap = [...splitClusters[a]].filter(c => splitClusters[b].has(c));
    if (clusterOverlap.length > 0) {
      errors.push(`cluster overlap between ${a} and ${b}: ${clusterOverlap.join(', ')}`);
    }
    const promptOverlap = [...splitPromptHashes[a]].filter(h => splitPromptHashes[b].has(h));
    if (promptOverlap.length > 0) {
      errors.push(`prompt-hash overlap between ${a} and ${b}: ${promptOverlap.slice(0, 5).join(', ')}${promptOverlap.length > 5 ? '…' : ''}`);
    }
  }

  const allIds = rows.map(r => r.id).filter(Boolean);
  const seen = new Set();
  const dupes = [];
  for (const id of allIds) {
    if (seen.has(id)) dupes.push(id);
    else seen.add(id);
  }
  if (dupes.length > 0) errors.push(`duplicate IDs: ${[...new Set(dupes)].join(', ')}`);

  return {
    file: filename,
    status: errors.length === 0 ? 'passed' : 'failed',
    n: rows.filter(r => !r.__parse_error).length,
    splits: Object.fromEntries(Object.entries(splitClusters).map(([k, v]) => [k, v.size])),
    split_rows: {
      dev: rows.filter(r => r.split === 'dev').length,
      heldout: rows.filter(r => r.split === 'heldout').length,
      replication: rows.filter(r => r.split === 'replication').length,
    },
    errors,
    rows: rows.filter(r => !r.__parse_error),
  };
}

function validateWorkflowFile(filename, authoredIndex, workflowDir = WORKFLOW_DIR) {
  const filepath = path.join(workflowDir, filename);
  if (!fs.existsSync(filepath)) return null;

  const rows = loadJsonl(filepath);
  const errors = [];
  const caseClusters = new Set();
  const casePromptHashes = new Set();

  let role = 'base';
  if (filename.includes('expanded')) role = 'expanded';
  if (filename.includes('replication')) role = 'replication';

  for (const row of rows) {
    if (row.__parse_error) {
      errors.push(`line ${row.__line}: JSON parse error: ${row.__error}`);
      continue;
    }
    if (!row.cluster_id) errors.push(`${row.id || 'unknown'}: missing cluster_id`);
    if (row.cluster_id) caseClusters.add(row.cluster_id);

    const phi = promptHashInfo(row);
    if (phi.mismatch) {
      errors.push(`${row.id || 'unknown'}: declared prompt hash does not match recomputed prompt`);
    }
    if (phi.hash) casePromptHashes.add(phi.hash);

    const sourceIds = [];
    if (Array.isArray(row.source_ids)) {
      for (const sid of row.source_ids) sourceIds.push(sid);
    }
    for (const node of row.nodes || []) {
      if (!node.source_file) errors.push(`${row.id}: node ${node.node_id} missing source_file`);
      if (!node.source_id) errors.push(`${row.id}: node ${node.node_id} missing source_id`);
      if (node.source_id) sourceIds.push(node.source_id);
    }

    for (const sid of sourceIds) {
      if (!authoredIndex.allIds.has(sid)) {
        errors.push(`${row.id}: source_id '${sid}' not found in authored datasets`);
      }
    }
  }

  const allIds = rows.map(r => r.id).filter(Boolean);
  const seen = new Set();
  const dupes = [];
  for (const id of allIds) {
    if (seen.has(id)) dupes.push(id);
    else seen.add(id);
  }
  if (dupes.length > 0) errors.push(`duplicate IDs: ${[...new Set(dupes)].join(', ')}`);

  return {
    file: filename,
    role,
    status: errors.length === 0 ? 'passed' : 'failed',
    n: rows.filter(r => !r.__parse_error).length,
    clusters: caseClusters.size,
    prompt_hashes: casePromptHashes.size,
    errors,
    rows: rows.filter(r => !r.__parse_error),
    cluster_set: caseClusters,
    prompt_hash_set: casePromptHashes,
    id_set: new Set(allIds),
  };
}

/**
 * Map raw entry roles to effective split for leakage checks:
 * - authored:* keep declared split
 * - workflow base|expanded → heldout
 * - workflow replication → replication
 * Cluster/prompt overlap is checked only across effective dev/heldout/replication.
 * IDs remain globally unique across all files.
 */
function effectiveSplit(entry) {
  if (!entry) return null;
  if (entry.kind === 'authored') return entry.role;
  if (entry.kind === 'workflow') {
    if (entry.role === 'replication') return 'replication';
    // base and expanded are the same heldout split surface
    return 'heldout';
  }
  return entry.role || null;
}

function validateGlobal(authoredResults, workflowResults) {
  const errors = [];
  const warnings = [];
  const entries = [];

  for (const ar of authoredResults) {
    for (const row of ar.rows || []) {
      if (!row.split || !SPLITS.includes(row.split)) continue;
      const phi = promptHashInfo(row);
      if (phi.mismatch) {
        errors.push(`${ar.file}:${row.id || 'unknown'}: declared prompt hash mismatch`);
      }
      entries.push({
        kind: 'authored',
        role: row.split,
        file: ar.file,
        id: row.id || null,
        cluster_id: row.cluster_id || null,
        prompt_hash: phi.hash,
        ref: `${ar.file}:${row.id || '?'}`,
      });
    }
  }

  for (const wr of workflowResults) {
    for (const row of wr.rows || []) {
      const phi = promptHashInfo(row);
      if (phi.mismatch) {
        errors.push(`${wr.file}:${row.id || 'unknown'}: declared prompt hash mismatch`);
      }
      entries.push({
        kind: 'workflow',
        role: wr.role || 'base',
        file: wr.file,
        id: row.id || null,
        cluster_id: row.cluster_id || null,
        prompt_hash: phi.hash,
        ref: `${wr.file}:${row.id || '?'}`,
      });
    }
  }

  // Global ID uniqueness across every authored + workflow file
  const idIndex = new Map();
  for (const e of entries) {
    if (!e.id) continue;
    if (!idIndex.has(e.id)) idIndex.set(e.id, []);
    idIndex.get(e.id).push(e);
  }
  for (const [id, list] of idIndex) {
    if (list.length > 1) {
      const refs = [...new Set(list.map(x => x.ref))];
      errors.push(`global duplicate id '${id}' at ${refs.join(', ')}`);
    }
  }

  // Cluster/prompt indexes keyed by effective split only
  const bySplitCluster = { dev: new Map(), heldout: new Map(), replication: new Map() };
  const bySplitPrompt = { dev: new Map(), heldout: new Map(), replication: new Map() };
  for (const e of entries) {
    const split = effectiveSplit(e);
    if (!split || !bySplitCluster[split]) continue;
    if (e.cluster_id) {
      if (!bySplitCluster[split].has(e.cluster_id)) bySplitCluster[split].set(e.cluster_id, []);
      bySplitCluster[split].get(e.cluster_id).push(e.ref);
    }
    if (e.prompt_hash) {
      if (!bySplitPrompt[split].has(e.prompt_hash)) bySplitPrompt[split].set(e.prompt_hash, []);
      bySplitPrompt[split].get(e.prompt_hash).push(e.ref);
    }
  }

  const pairs = [['dev', 'heldout'], ['dev', 'replication'], ['heldout', 'replication']];
  for (const [a, b] of pairs) {
    for (const cluster of bySplitCluster[a].keys()) {
      if (bySplitCluster[b].has(cluster)) {
        errors.push(`global cluster '${cluster}' overlaps effective ${a} and ${b}`);
      }
    }
    for (const ph of bySplitPrompt[a].keys()) {
      if (bySplitPrompt[b].has(ph)) {
        errors.push(`global prompt-hash ${ph.slice(0, 12)}… overlaps effective ${a} and ${b}`);
      }
    }
  }

  return { errors, warnings };
}

function validateDatasetSplits(opts = {}) {
  const authoredDir = opts.authoredDir || AUTHORED_DIR;
  const workflowDir = opts.workflowDir || WORKFLOW_DIR;
  const workflowFiles = opts.workflowFiles || WORKFLOW_FILES;
  const excludedAuthored = opts.excludedAuthored || legacyAuthoredBasenames(opts.registryPath);

  const authoredFiles = fs.existsSync(authoredDir)
    ? fs.readdirSync(authoredDir)
      .filter(f => f.endsWith('.jsonl') && !excludedAuthored.has(f))
      .sort()
    : [];
  const authoredResults = authoredFiles.map(f => validateAuthoredFile(f, authoredDir));

  const authoredIndex = {
    devClusters: new Set(),
    heldoutClusters: new Set(),
    replicationClusters: new Set(),
    allClusters: new Set(),
    allIds: new Set(),
  };
  for (const ar of authoredResults) {
    for (const row of ar.rows || []) {
      if (row.cluster_id) {
        authoredIndex.allClusters.add(row.cluster_id);
        if (row.split === 'dev') authoredIndex.devClusters.add(row.cluster_id);
        if (row.split === 'heldout') authoredIndex.heldoutClusters.add(row.cluster_id);
        if (row.split === 'replication') authoredIndex.replicationClusters.add(row.cluster_id);
      }
      if (row.id) authoredIndex.allIds.add(row.id);
    }
  }

  const workflowResults = workflowFiles
    .map(f => validateWorkflowFile(f, authoredIndex, workflowDir))
    .filter(Boolean);

  const global = validateGlobal(authoredResults, workflowResults);

  const authoredOut = authoredResults.map(({ rows, ...rest }) => rest);
  const workflowOut = workflowResults.map(({ rows, cluster_set, prompt_hash_set, id_set, ...rest }) => rest);

  const fileFailed = [...authoredOut, ...workflowOut].filter(r => r.status === 'failed').length;
  const ok = fileFailed === 0 && global.errors.length === 0;

  return {
    ok,
    summary: {
      total_files: authoredOut.length + workflowOut.length,
      passed: authoredOut.length + workflowOut.length - fileFailed,
      failed: fileFailed,
      global_errors: global.errors.length,
      global_warnings: global.warnings.length,
      authored_dev_clusters: authoredOut.reduce((a, r) => a + (r.splits?.dev || 0), 0),
      authored_heldout_clusters: authoredOut.reduce((a, r) => a + (r.splits?.heldout || 0), 0),
      authored_replication_clusters: authoredOut.reduce((a, r) => a + (r.splits?.replication || 0), 0),
      workflow_clusters: workflowOut.reduce((a, r) => a + (r.clusters || 0), 0),
      excluded_authored_files: [...excludedAuthored].sort(),
      status: ok ? 'passed' : 'failed',
    },
    authored: authoredOut,
    workflow: workflowOut,
    global,
  };
}

function resolveExternalReportPath(outFile, repoRoot = REPO_ROOT) {
  if (!outFile) return { ok: false, reason: 'no output path' };
  const resolved = path.resolve(outFile);
  const root = path.resolve(repoRoot);
  const rel = path.relative(root, resolved);
  const isInsideRepo = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (isInsideRepo) {
    return {
      ok: false,
      reason: `EVAL_SPLIT_OUT must resolve outside the repository (refused: ${resolved})`,
      path: resolved,
    };
  }
  return { ok: true, path: resolved };
}

function main() {
  const out = validateDatasetSplits();

  for (const r of out.authored) {
    const icon = r.status === 'passed' ? '✓' : '✖';
    console.log(`  ${icon} ${r.file}: ${r.n} rows, dev=${r.split_rows?.dev || 0}/${r.splits?.dev || 0}c, heldout=${r.split_rows?.heldout || 0}/${r.splits?.heldout || 0}c, repl=${r.split_rows?.replication || 0}/${r.splits?.replication || 0}c`);
    if (r.errors.length > 0) for (const e of r.errors.slice(0, 5)) console.log(`      ${e}`);
  }
  for (const r of out.workflow) {
    const icon = r.status === 'passed' ? '✓' : '✖';
    console.log(`  ${icon} ${r.file}: ${r.n} rows, ${r.clusters} clusters`);
    if (r.errors.length > 0) for (const e of r.errors.slice(0, 5)) console.log(`      ${e}`);
  }
  if (out.global.errors.length) {
    console.log('\n  Global errors:');
    for (const e of out.global.errors.slice(0, 20)) console.log(`    ✖ ${e}`);
  }
  if (out.global.warnings.length) {
    console.log('\n  Global warnings:');
    for (const w of out.global.warnings.slice(0, 10)) console.log(`    ! ${w}`);
  }
  console.log(`\n  ${out.summary.passed}/${out.summary.total_files} files passed; global_errors=${out.summary.global_errors}`);

  const outFile = process.env.EVAL_SPLIT_OUT;
  if (outFile) {
    const resolved = resolveExternalReportPath(outFile, REPO_ROOT);
    if (!resolved.ok) {
      console.error(`  ${resolved.reason}`);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
    fs.writeFileSync(resolved.path, JSON.stringify(out, null, 2));
    console.log(`  -> ${resolved.path}`);
  } else {
    console.log('  (no output written; set EVAL_SPLIT_OUT to an external path to emit a report)');
  }

  if (!out.ok) process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  REPO_ROOT,
  AUTHORED_DIR,
  WORKFLOW_DIR,
  WORKFLOW_FILES,
  loadJsonl,
  promptHash,
  promptHashInfo,
  computePromptHash,
  normalizePrompt,
  validateAuthoredFile,
  validateWorkflowFile,
  validateGlobal,
  validateDatasetSplits,
  resolveExternalReportPath,
  effectiveSplit,
  main,
};
