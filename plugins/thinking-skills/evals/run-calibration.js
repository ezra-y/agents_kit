#!/usr/bin/env node
'use strict';

/**
 * Calibration Runner — placebo/baseline-only difficulty profiler.
 *
 * Runs candidate items through the model WITHOUT any skill guide (empty/baseline
 * condition) to measure per-item difficulty. Keeps only items whose baseline
 * accuracy falls in the 40–70% band; flags ceiling (1.0) and floor (0.0) items
 * as out-of-band. No paired skill arm — this is a pure difficulty profiler.
 *
 * Usage:
 *   EVAL_RUN=smoke LIMIT=4 node evals/run-calibration.js <dataset.jsonl> [--solver-model=claude-sonnet-4-6] [--solver-effort=high] [--batch] [--batch-size=5] [--label-field=answer]
 *
 * Env:
 *   LIMIT                — slice first N items for smoke tests (deterministic order)
 *   K_TRIALS             — baseline solver runs per item for fractional difficulty (default: 5)
 *   EVAL_RUN             — run id for output directory (default: 'calibration')
 *   SOLVER_MODEL         — model for solving (default: claude-sonnet-4-6)
 *   SOLVER_EFFORT        — reasoning effort (default: model max)
 *   CONC                 — concurrency (default: 4)
 *
 * Batch mode (--batch):
 *   Processes items in small batches with incremental progress-saving to a
 *   partial-results file. If API timeouts interrupt the run, completed batches
 *   are preserved and can be resumed.
 */

const fs = require('fs');
const path = require('path');
const { droidJsonAsync, maxEffortFor } = require('./lib/droid');
const { runDir, writeJson, mapPool, readJsonIfExists } = require('./lib/io');

// ---- CLI ----
const args = process.argv.slice(2);
const datasetPath = args.find(a => !a.startsWith('--'));
const solverModelArg = args.find(a => a.startsWith('--solver-model='));
const solverEffortArg = args.find(a => a.startsWith('--solver-effort='));
const labelFieldArg = args.find(a => a.startsWith('--label-field='));
const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
const BATCH_MODE = args.includes('--batch');

// When required as a module (tests), skip CLI hard-exit
const IS_CLI = require.main === module;

if (IS_CLI && !datasetPath) {
  console.error('Usage: node evals/run-calibration.js <dataset.jsonl> [--solver-model=MODEL] [--solver-effort=EFFORT] [--batch] [--batch-size=N] [--label-field=FIELD]');
  process.exit(1);
}

const DATASET = datasetPath ? path.resolve(datasetPath) : null;
const SOLVER_MODEL = solverModelArg ? solverModelArg.split('=')[1] : 'claude-sonnet-4-6';
const SOLVER_EFFORT = solverEffortArg ? solverEffortArg.split('=')[1] : maxEffortFor(SOLVER_MODEL);
const LABEL_FIELD = labelFieldArg ? labelFieldArg.split('=')[1] : null;
const K_TRIALS = parseInt(process.env.K_TRIALS || '5', 10);
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : null;
const CONC = parseInt(process.env.CONC || '4', 10);
const EVAL_RUN = process.env.EVAL_RUN || 'calibration';
const BATCH_SIZE = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 5;

function loadDataset(file) {
  const text = fs.readFileSync(file, 'utf8');
  return text.trim().split('\n').map((line, i) => {
    try { return JSON.parse(line); } catch (e) {
      throw new Error(`Invalid JSONL at line ${i + 1}: ${e.message}`);
    }
  });
}

// ---- Label normalization ----
function normalizeLabel(item) {
  if (LABEL_FIELD) {
    const raw = item[LABEL_FIELD];
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'boolean') return { raw, type: 'boolean', field: LABEL_FIELD };
    if (Array.isArray(raw)) return { raw, type: 'filepath', field: LABEL_FIELD };
    const s = String(raw);
    if (/^[A-Ea-e]$/.test(s.trim())) return { raw: s.trim(), type: 'choice', field: LABEL_FIELD };
    if (/^(yes|no)$/i.test(s.trim())) return { raw: s.trim(), type: 'yesno', field: LABEL_FIELD };
    return { raw: s.trim(), type: 'string', field: LABEL_FIELD };
  }
  if (item.label !== undefined && item.label !== null) return { raw: item.label, type: typeof item.label === 'boolean' ? 'boolean' : 'string', field: 'label' };
  if (item.answer !== undefined && item.answer !== null) return { raw: item.answer, type: 'yesno', field: 'answer' };
  if (item.answer_idx !== undefined && item.answer_idx !== null) return { raw: item.answer_idx, type: 'choice', field: 'answer_idx' };
  if (item.gold_files !== undefined && item.gold_files !== null) return { raw: item.gold_files, type: 'filepath', field: 'gold_files' };
  return null;
}

const ANSWER_LINE_RE = /\bANSWER\s*:\s*(.+)$/im;

function parsePrediction(json, rawText) {
  if (!json) {
    if (rawText) {
      const m = rawText.match(ANSWER_LINE_RE);
      if (m) return { value: m[1].trim(), type: 'string', ok: true };
    }
    return { value: null, ok: false };
  }

  for (const key of ['answer', 'decision', 'label', 'result', 'yes', 'classification', 'answerable']) {
    if (typeof json[key] === 'boolean') return { value: json[key], type: 'boolean', ok: true };
  }

  for (const key of ['answer', 'answer_idx', 'result', 'file', 'files', 'path']) {
    if (typeof json[key] === 'string' && json[key].trim().length > 0) {
      return { value: json[key].trim(), type: 'string', ok: true };
    }
  }

  for (const key of ['gold_files', 'files', 'answer']) {
    if (Array.isArray(json[key]) && json[key].length > 0) {
      return { value: json[key], type: 'array', ok: true };
    }
  }

  const str = JSON.stringify(json);
  const m = str.match(ANSWER_LINE_RE);
  if (m) return { value: m[1].trim(), type: 'string', ok: true };

  if (rawText) {
    const rm = rawText.match(ANSWER_LINE_RE);
    if (rm) return { value: rm[1].trim(), type: 'string', ok: true };
  }

  return { value: null, ok: false };
}

function judgePrediction(predParsed, normLabel) {
  if (!predParsed.ok || !normLabel) return null;

  const normalizedString = predParsed.type === 'string'
    ? predParsed.value.replace(/^ANSWER\s*:\s*/i, '').trim()
    : null;

  if (normLabel.type === 'boolean') {
    if (predParsed.type === 'boolean') return predParsed.value === normLabel.raw;
    if (normalizedString !== null) {
      const s = normalizedString.toLowerCase();
      if (s === 'yes' || s === 'true') return normLabel.raw === true;
      if (s === 'no' || s === 'false') return normLabel.raw === false;
      return null;
    }
    return null;
  }

  if (normLabel.type === 'yesno') {
    const predBool = predParsed.type === 'boolean' ? predParsed.value :
      (normalizedString && normalizedString.toLowerCase() === 'yes' ? true :
       normalizedString && normalizedString.toLowerCase() === 'no' ? false : null);
    if (predBool === null) return null;
    const labelBool = normLabel.raw.toLowerCase() === 'yes';
    return predBool === labelBool;
  }

  if (normLabel.type === 'choice') {
    if (normalizedString !== null) {
      return normalizedString.toUpperCase() === normLabel.raw.toUpperCase();
    }
    if (predParsed.type === 'boolean' && normLabel.raw.toUpperCase() === 'A') {
      return null;
    }
    return null;
  }

  if (normLabel.type === 'filepath') {
    const goldFiles = Array.isArray(normLabel.raw) ? normLabel.raw : [normLabel.raw];
    if (predParsed.type === 'string') {
      return goldFiles.some(gf => {
        const normPred = normalizedString.replace(/^\/+/, '').replace(/\\/g, '/');
        const normGold = String(gf).replace(/^\/+/, '').replace(/\\/g, '/');
        return normPred === normGold || normPred.endsWith(normGold) || normGold.endsWith(normPred);
      });
    }
    if (predParsed.type === 'array') {
      const predFiles = predParsed.value.map(f => String(f).replace(/^\/+/, '').replace(/\\/g, '/'));
      return goldFiles.some(gf => {
        const normGold = String(gf).replace(/^\/+/, '').replace(/\\/g, '/');
        return predFiles.some(pf => pf === normGold || pf.endsWith(normGold) || normGold.endsWith(pf));
      });
    }
    return null;
  }

  return null;
}

const MAX_PROMPT_LEN = 1600;

function truncatePrompt(prompt, maxLen = MAX_PROMPT_LEN) {
  if (!prompt || prompt.length <= maxLen) return prompt;
  const keepStart = Math.floor(maxLen * 0.45);
  const keepEnd = Math.floor(maxLen * 0.45);
  const start = prompt.slice(0, keepStart);
  const end = prompt.slice(prompt.length - keepEnd);
  const omitted = prompt.length - keepStart - keepEnd;
  const lastNewline = start.lastIndexOf('\n');
  const cleanStart = lastNewline > keepStart * 0.7 ? start.slice(0, lastNewline) : start;
  const firstNewline = end.indexOf('\n');
  const cleanEnd = firstNewline > 0 && firstNewline < keepEnd * 0.3 ? end.slice(firstNewline + 1) : end;
  return `${cleanStart}\n\n[...truncated ${omitted} chars...]\n\n${cleanEnd}`;
}

function buildCalibrationPrompt(problemText, decisionInstruction) {
  let cleanProblem = String(problemText || '');
  cleanProblem = cleanProblem.replace(/\n*\s*End\s+with\s+exactly\s*:\s*ANSWER\s*:.+\s*$/im, '');

  let instruction = String(decisionInstruction || 'Answer the problem.');
  const answerMatch = instruction.match(/End\s+with\s+exactly\s*:\s*ANSWER\s*:\s*(.+)/i);
  if (answerMatch) {
    instruction = instruction.replace(/\s*End\s+with\s+exactly\s*:\s*ANSWER\s*:.+\s*$/i, '');
    instruction += '\n\nReturn ONLY valid JSON. Use the key "answer" for your file path. Example: {"answer": "path/to/file.ext"}';
  }

  const hasJsonInstruction = /return\s+only\s+valid\s+json/i.test(instruction) ||
    /\{"\w+":/i.test(instruction);

  if (hasJsonInstruction) {
    return `${instruction}\n\nProblem:\n${cleanProblem}`;
  }
  return `${instruction}\n\nProblem:\n${cleanProblem}\n\nReturn ONLY valid JSON with your answer.`;
}

async function processItemTrial(item, itemIndex, trialIndex = null) {
  try {
    const normLabel = normalizeLabel(item);
    const rawPrompt = buildCalibrationPrompt(item.prompt, item.decision_instruction);

    const isFilepathItem = normLabel && normLabel.type === 'filepath';
    const prompt = isFilepathItem ? rawPrompt : truncatePrompt(rawPrompt);

    const r = await droidJsonAsync({ model: SOLVER_MODEL, prompt, effort: SOLVER_EFFORT });

    let correct = null;
    let prediction = null;
    let predType = null;
    let scored = false;
    let parse_failure = false;
    let transport_failure = false;
    const rawText = r.raw || '';

    if (r.ok) {
      const parsed = parsePrediction(r.json, rawText);
      predType = parsed.type;
      prediction = parsed.value;

      if (parsed.ok && normLabel) {
        const result = judgePrediction(parsed, normLabel);
        correct = result;
        // scored only when judgment is true/false (not null/unjudgeable)
        scored = result === true || result === false;
      } else if (!parsed.ok) {
        parse_failure = true;
      }
    } else {
      if (rawText) {
        const parsed = parsePrediction(null, rawText);
        predType = parsed.type;
        prediction = parsed.value;

        if (parsed.ok && normLabel) {
          const result = judgePrediction(parsed, normLabel);
          correct = result;
          scored = result === true || result === false;
        } else if (!parsed.ok) {
          parse_failure = true;
          transport_failure = true;
        }
      } else {
        transport_failure = true;
        parse_failure = true;
      }
    }

    return {
      id: item && item.id,
      itemIndex,
      trialIndex,
      itemType: item && item.type || null,
      target: item && item.target,
      labelRaw: normLabel ? normLabel.raw : null,
      labelField: normLabel ? normLabel.field : null,
      labelType: normLabel ? normLabel.type : null,
      prediction,
      predType,
      correct,
      scored,
      parse_failure,
      transport_failure,
      raw: rawText,
      // Attempt always true once the trial was issued
      attempted: true,
      ok: r.ok || (prediction !== null),
      error: r.error,
      usage: r.usage,
      durationMs: r.durationMs,
    };
  } catch (err) {
    // Never let mapPool collapse identity into bare {__error}
    return {
      id: item && item.id,
      itemIndex,
      trialIndex,
      itemType: item && item.type || null,
      target: item && item.target,
      labelRaw: null,
      labelField: null,
      labelType: null,
      prediction: null,
      predType: null,
      correct: null,
      scored: false,
      parse_failure: false,
      transport_failure: true,
      raw: '',
      attempted: true,
      ok: false,
      error: String(err && err.message || err),
      usage: null,
      durationMs: null,
    };
  }
}

/** Normalize mapPool results that may be bare {__error} into structured failures. */
function normalizeTrialResult(row, item, itemIndex, trialIndex) {
  if (row && row.__error) {
    return {
      id: item && item.id,
      itemIndex,
      trialIndex,
      itemType: item && item.type || null,
      target: item && item.target,
      labelRaw: null,
      labelField: null,
      labelType: null,
      prediction: null,
      predType: null,
      correct: null,
      scored: false,
      parse_failure: false,
      transport_failure: true,
      raw: '',
      attempted: true,
      ok: false,
      error: String(row.__error),
      usage: null,
      durationMs: null,
    };
  }
  if (row && row.itemIndex == null) row.itemIndex = itemIndex;
  if (row && row.trialIndex == null && trialIndex != null) row.trialIndex = trialIndex;
  return row;
}

/**
 * Aggregate trial results into per-item stats.
 * Denominators:
 *   trials_planned = kTrials
 *   attempted = number of trial rows present
 *   scored = trials with true/false judgment
 *   failures = attempted - scored (parse/transport/unjudgeable)
 *   baseline = successes / attempted  (failures count against accuracy)
 * Zero baselines serialize as 0, never null.
 */
function aggregatePerItem(trialResults, kTrials) {
  const perItemMap = new Map();
  for (const t of trialResults) {
    if (!perItemMap.has(t.itemIndex)) {
      perItemMap.set(t.itemIndex, {
        id: t.id,
        itemType: t.itemType,
        target: t.target,
        labelRaw: t.labelRaw,
        labelField: t.labelField,
        labelType: t.labelType,
        predictions: [],
        corrects: [],
        trials: [],
      });
    }
    const entry = perItemMap.get(t.itemIndex);
    entry.trials.push(t);
    if (t.prediction !== null && t.prediction !== undefined) {
      entry.predictions.push(t.prediction);
    }
    entry.corrects.push(t.correct);
  }

  const perItem = [];
  for (const [itemIndex, entry] of perItemMap) {
    const attempted = entry.trials.length;
    // Prefer explicit scored flag; fall back to boolean correct
    const scoredCount = entry.trials.reduce((n, t) => {
      if (t.scored === true) return n + 1;
      if (t.scored === false) return n;
      if (t.correct === true || t.correct === false) return n + 1;
      return n;
    }, 0);
    const successes = entry.trials.filter(t => t.correct === true).length;
    const incorrect = entry.trials.filter(t => t.correct === false).length;
    const parseFailures = entry.trials.filter(t => t.parse_failure).length;
    const transportFailures = entry.trials.filter(t => t.transport_failure).length;
    // Infrastructure/parse/unjudgeable failures only — not ordinary wrong answers.
    // Wrong answers remain in the accuracy denominator via successes/attempted.
    const failures = attempted - scoredCount;
    const baseline = attempted > 0 ? successes / attempted : null;
    perItem.push({
      id: entry.id,
      itemIndex,
      itemType: entry.itemType,
      target: entry.target,
      labelField: entry.labelField,
      labelType: entry.labelType,
      labelRaw: entry.labelRaw,
      trials: kTrials,
      attempted,
      scored: scoredCount,
      successes,
      incorrect,
      failures,
      parse_failures: parseFailures,
      transport_failures: transportFailures,
      // Serialize 0 as 0 (not null). Only null when nothing attempted.
      baseline: attempted > 0 ? +baseline.toFixed(4) : null,
      predictions: entry.predictions,
    });
  }
  perItem.sort((a, b) => a.itemIndex - b.itemIndex);
  return perItem;
}

function classifyBands(perItem) {
  const inBand = [];
  const ceiling = [];
  const floor = [];
  const otherOutOfBand = [];

  for (const item of perItem) {
    if (item.baseline === null || item.baseline === undefined) {
      otherOutOfBand.push({ ...item, band: 'unattempted' });
    } else if (item.baseline >= 0.40 && item.baseline <= 0.70) {
      inBand.push({ ...item, band: 'in-band', kept: true });
    } else if (item.baseline >= 0.999) {
      ceiling.push({ ...item, band: 'ceiling', kept: false });
    } else if (item.baseline <= 0.001) {
      // Explicit floor including exact 0
      floor.push({ ...item, band: 'floor', kept: false });
    } else {
      otherOutOfBand.push({ ...item, band: 'out-of-band', kept: false });
    }
  }
  return { inBand, ceiling, floor, otherOutOfBand };
}

/** Serialize a number that may be 0 without collapsing to null. */
function serializeRate(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return +Number(value).toFixed(3);
}

function buildOutput(datasetName, totalItems, limitedItems, trialResults, perItem) {
  const totalAttempted = perItem.reduce((s, i) => s + i.attempted, 0);
  const totalCorrect = perItem.reduce((s, i) => s + i.successes, 0);
  // failed_trials = infra/parse/unjudgeable only (attempted - scored)
  const totalFailures = perItem.reduce((s, i) => s + i.failures, 0);
  const totalScored = perItem.reduce((s, i) => s + (i.scored || 0), 0);
  const totalIncorrect = perItem.reduce((s, i) => s + (i.incorrect || 0), 0);
  const baselineAccuracy = totalAttempted > 0 ? totalCorrect / totalAttempted : null;
  const { inBand, ceiling, floor, otherOutOfBand } = classifyBands(perItem);
  const kept = inBand.map(i => i.id);
  const outOfBand = [...ceiling, ...floor, ...otherOutOfBand].map(i => ({
    id: i.id,
    band: i.band,
    // Preserve 0 baselines
    baseline: i.baseline,
  }));

  return {
    tier: 'calibration',
    dataset: datasetName,
    run_id: EVAL_RUN,
    solver_model: SOLVER_MODEL,
    solver_effort: SOLVER_EFFORT,
    k_trials: K_TRIALS,
    limit: LIMIT || limitedItems.length,
    total_items: totalItems,
    total_trials: trialResults.length,
    attempted_trials: totalAttempted,
    scored_trials: totalScored,
    incorrect_trials: totalIncorrect,
    failed_trials: totalFailures,
    // 0 serializes as 0.000 not null
    baseline_accuracy: serializeRate(baselineAccuracy),
    calibration_band: [0.40, 0.70],
    summary: {
      in_band: inBand.length,
      ceiling: ceiling.length,
      floor: floor.length,
      other_out_of_band: otherOutOfBand.length,
      unattempted: perItem.filter(i => i.attempted === 0).length,
    },
    kept_item_ids: kept,
    out_of_band: outOfBand,
    items: perItem,
    raw_results: trialResults,
  };
}

function logSummary(out, outputFile) {
  console.log(`\n  k trials/item: ${K_TRIALS}`);
  const accStr = out.baseline_accuracy === null || out.baseline_accuracy === undefined
    ? 'N/A'
    : (out.baseline_accuracy * 100).toFixed(1) + '%';
  console.log(`  baseline accuracy: ${accStr} (${out.summary.in_band + out.summary.ceiling + out.summary.floor + out.summary.other_out_of_band} items)`);
  console.log(`  calibration band: [0.40, 0.70]`);
  console.log(`  kept (in-band): ${out.summary.in_band}`);
  console.log(`  ceiling (≈1.0): ${out.summary.ceiling}`);
  console.log(`  floor (≈0.0): ${out.summary.floor}`);
  console.log(`  other out-of-band: ${out.summary.other_out_of_band}`);
  console.log(`  attempted/scored/failed trials: ${out.attempted_trials}/${out.scored_trials}/${out.failed_trials}`);
  console.log(`  -> ${outputFile}`);
}

/**
 * Resume support: load partial results and return per-item completed trial indexes.
 * Partial items keep existing trials; only missing trialIndexes are re-scheduled.
 */
function loadPartialProgress(partialFile) {
  const partial = readJsonIfExists(partialFile);
  if (!partial || !Array.isArray(partial.raw_results)) {
    return {
      trialResults: [],
      completedItemIndexes: new Set(),
      completedTrialsByItem: new Map(),
    };
  }
  const trialResults = partial.raw_results.slice();
  const completedTrialsByItem = new Map(); // itemIndex -> Set(trialIndex)
  for (const t of trialResults) {
    if (t == null || t.itemIndex == null) continue;
    if (!completedTrialsByItem.has(t.itemIndex)) completedTrialsByItem.set(t.itemIndex, new Set());
    // Prefer explicit trialIndex; else assign next free slot 0..K_TRIALS-1
    let trialIndex = t.trialIndex;
    if (trialIndex == null || trialIndex === undefined) {
      const used = completedTrialsByItem.get(t.itemIndex);
      trialIndex = 0;
      while (used.has(trialIndex) && trialIndex < K_TRIALS) trialIndex++;
    }
    completedTrialsByItem.get(t.itemIndex).add(trialIndex);
  }
  const completedItemIndexes = new Set();
  for (const [idx, trials] of completedTrialsByItem) {
    if (trials.size >= K_TRIALS) completedItemIndexes.add(idx);
  }
  return { trialResults, completedItemIndexes, completedTrialsByItem, partial };
}

async function runCalibration() {
  if (!DATASET) throw new Error('dataset path required');
  const items = loadDataset(DATASET);
  const limitedItems = LIMIT ? items.slice(0, LIMIT) : items;
  const datasetName = path.basename(DATASET, path.extname(DATASET));
  const outputDir = runDir();

  console.log(`╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║  CALIBRATION RUN — placebo/baseline only (no skill arm)        ║`);
  console.log(`║  dataset: ${datasetName.padEnd(55)} ║`);
  console.log(`║  items: ${String(limitedItems.length).padStart(3)} / ${String(items.length).padEnd(3)} (LIMIT=${LIMIT || 'all'})`.padEnd(61) + '║');
  console.log(`║  trials/item: ${String(K_TRIALS).padEnd(50)}║`);
  console.log(`║  solver: ${SOLVER_MODEL} (${SOLVER_EFFORT})`.padEnd(61) + '║');
  console.log(`║  concurrency: ${String(CONC).padEnd(50)}║`);
  console.log(`║  run id: ${EVAL_RUN.padEnd(54)}║`);
  if (BATCH_MODE) {
    console.log(`║  batch mode: ${`YES (size=${BATCH_SIZE})`.padEnd(50)}║`);
  }
  if (LABEL_FIELD) {
    console.log(`║  label field: ${LABEL_FIELD.padEnd(50)}║`);
  }
  console.log(`╚══════════════════════════════════════════════════════════════════╝`);

  const allTrialResults = [];

  if (BATCH_MODE) {
    const partialFile = path.join(outputDir, `calibration-${datasetName}-${EVAL_RUN}-partial.json`);
    const {
      trialResults: resumed,
      completedItemIndexes,
      completedTrialsByItem,
    } = loadPartialProgress(partialFile);
    if (resumed.length > 0) {
      allTrialResults.push(...resumed);
      console.log(`  Resuming from partial: ${resumed.length} trials, ${completedItemIndexes.size} complete items`);
    }

    const numBatches = Math.ceil(limitedItems.length / BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
      const start = batchIdx * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, limitedItems.length);
      const batchItems = limitedItems.slice(start, end);

      // Schedule only missing trialIndexes per item (no duplicate partial trials)
      const pending = [];
      for (let i = 0; i < batchItems.length; i++) {
        const itemIndex = start + i;
        const done = completedTrialsByItem.get(itemIndex) || new Set();
        for (let t = 0; t < K_TRIALS; t++) {
          if (done.has(t)) continue;
          pending.push({ itemIndex, trialIndex: t, item: batchItems[i] });
        }
      }

      if (pending.length === 0) {
        console.log(`\n  [batch ${batchIdx + 1}/${numBatches}] items ${start}–${end - 1} already complete — skip`);
        continue;
      }

      console.log(`\n  [batch ${batchIdx + 1}/${numBatches}] items ${start}–${end - 1} (${pending.length} pending trials)`);

      const batchResults = await mapPool(pending, CONC, async ({ itemIndex, trialIndex, item }) => {
        const result = await processItemTrial(item, itemIndex, trialIndex);
        return normalizeTrialResult(result, item, itemIndex, trialIndex);
      });

      allTrialResults.push(...batchResults);
      for (const r of batchResults) {
        if (r == null || r.itemIndex == null) continue;
        if (!completedTrialsByItem.has(r.itemIndex)) completedTrialsByItem.set(r.itemIndex, new Set());
        if (r.trialIndex != null) completedTrialsByItem.get(r.itemIndex).add(r.trialIndex);
        if (completedTrialsByItem.get(r.itemIndex).size >= K_TRIALS) {
          completedItemIndexes.add(r.itemIndex);
        }
      }

      const partialPerItem = aggregatePerItem(allTrialResults, K_TRIALS);
      const partialOut = buildOutput(datasetName, items.length, limitedItems, allTrialResults, partialPerItem);
      writeJson(partialFile, partialOut);

      const batchSuccesses = batchResults.filter(r => r.correct === true).length;
      const batchAttempted = batchResults.length;
      console.log(`  [batch ${batchIdx + 1}/${numBatches}] complete — ${batchSuccesses}/${batchAttempted} correct. Partial saved to ${partialFile}`);
    }
  } else {
    const trials = [];
    for (let i = 0; i < limitedItems.length; i++) {
      for (let t = 0; t < K_TRIALS; t++) {
        trials.push({ itemIndex: i, trialIndex: t, item: limitedItems[i] });
      }
    }

    allTrialResults.push(...await mapPool(trials, CONC, async ({ itemIndex, trialIndex, item }) => {
      const result = await processItemTrial(item, itemIndex, trialIndex);
      return normalizeTrialResult(result, item, itemIndex, trialIndex);
    }));
  }

  const perItem = aggregatePerItem(allTrialResults, K_TRIALS);
  const out = buildOutput(datasetName, items.length, limitedItems, allTrialResults, perItem);

  const outputFile = path.join(outputDir, `calibration-${datasetName}-${EVAL_RUN}.json`);
  writeJson(outputFile, out);

  logSummary(out, outputFile);
  return out;
}

module.exports = {
  normalizeLabel,
  parsePrediction,
  judgePrediction,
  aggregatePerItem,
  classifyBands,
  buildOutput,
  serializeRate,
  loadPartialProgress,
  truncatePrompt,
  buildCalibrationPrompt,
  processItemTrial,
  normalizeTrialResult,
  runCalibration,
};

if (IS_CLI) {
  runCalibration().catch(err => {
    console.error('Calibration run failed:', err);
    process.exit(1);
  });
}
