'use strict';

const fs = require('fs');
const path = require('path');
const {
  analyzeObjectiveEnvelope,
} = require('./scientific-method-experiment');
const {
  buildToolLocalizationPrompt,
  parseToolLocalizationResponse,
  prepareRepository,
  TOOL_RESTRICTED_TOOLS,
  TOOL_SYSTEM_PROMPT,
} = require('./tool-localization');
const {
  executeDroid,
  usageSummary,
} = require('./droid');
const {
  mapPool,
  readJsonIfExists,
  writeJsonAtomic,
} = require('./io');
const { sha256 } = require('./result');
const { binomExactTwoSided, holmAdjustment } = require('./stats');

const EXPLORATORY_ARMS = Object.freeze([
  'none',
  'current',
  'clue-first',
  'module-role',
]);

function normalizeRepoPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function scoreToolLocalizationResponse(item, text, maxObservations = 4) {
  const parsed = parseToolLocalizationResponse(text, maxObservations);
  const gold = normalizeRepoPath(item && item.gold_files && item.gold_files[0]);
  return {
    parsed_success: Boolean(parsed),
    parsed: parsed ? parsed.answer : null,
    reported_observations: parsed ? parsed.reported_observations : null,
    budget_compliant: parsed ? parsed.budget_compliant : false,
    correct: Boolean(
      parsed
      && parsed.budget_compliant
      && normalizeRepoPath(parsed.answer) === gold,
    ),
  };
}

function analyzeToolStage(rows, candidateArms, health = {}) {
  const analysis = analyzeObjectiveEnvelope(
    { items: rows || [], health },
    {
      controlArm: 'none',
      leanArm: 'current',
      candidateArms: candidateArms || [],
    },
  );
  for (const armId of candidateArms || []) {
    const candidate = analysis.candidates[armId];
    for (const contrast of [candidate.vs_none, candidate.vs_lean]) {
      contrast.p_value = binomExactTwoSided(
        contrast.left_wins,
        contrast.left_wins + contrast.right_wins,
      );
      contrast.test = 'two-sided exact McNemar/binomial';
    }
  }
  const adjusted = holmAdjustment((candidateArms || []).map((armId) => ({
    id: armId,
    p: analysis.candidates[armId].vs_none.p_value,
  })));
  for (const result of adjusted) {
    analysis.candidates[result.id].vs_none.p_adjusted = result.p_adjusted;
    analysis.candidates[result.id].vs_none.holm_rank = result.rank;
  }
  return analysis;
}

function evaluateToolCandidateGate(analysis, candidateArm, options = {}) {
  const stage = options.stage || 'pilot';
  const candidate = analysis && analysis.candidates && analysis.candidates[candidateArm];
  const candidateUsage = analysis && analysis.usage_by_arm && analysis.usage_by_arm[candidateArm];
  const noneUsage = analysis && analysis.usage_by_arm && analysis.usage_by_arm.none;
  const reasons = [];
  if (!candidate) reasons.push('candidate contrast missing');
  if (!candidateUsage || !noneUsage) reasons.push('usage summary missing');
  if (analysis && analysis.health && analysis.health.decision_eligible === false) {
    reasons.push('run is not decision eligible');
  }
  if (!candidate || !candidateUsage || !noneUsage) {
    return { pass: false, stage, candidate_arm: candidateArm, reasons };
  }
  const tokenRatio = noneUsage.median_total_tokens
    ? candidateUsage.median_total_tokens / noneUsage.median_total_tokens
    : Infinity;
  const maxTokenRatio = stage === 'pilot' ? 1.05 : 1;
  if (candidate.vs_none.delta_pp < 5) reasons.push('lift versus no-skill is below 5pp');
  if (candidate.vs_lean.delta_pp < 0) reasons.push('accuracy is lower than current skill');
  if (tokenRatio > maxTokenRatio) {
    reasons.push(`median token ratio versus no-skill ${tokenRatio.toFixed(3)} exceeds ${maxTokenRatio}`);
  }
  if (stage !== 'pilot') {
    const minN = Number(options.minN || 100);
    if (candidate.vs_none.n < minN) reasons.push(`paired n ${candidate.vs_none.n} is below ${minN}`);
    if (!(candidate.vs_none.p_value < 0.05)) reasons.push('paired p is not below .05');
  }
  return {
    pass: reasons.length === 0,
    stage,
    candidate_arm: candidateArm,
    token_ratio_vs_none: tokenRatio,
    reasons,
  };
}

function selectPilotCandidate(analysis, candidateArms = ['clue-first', 'module-role']) {
  const passing = candidateArms
    .map((armId) => ({
      armId,
      gate: evaluateToolCandidateGate(analysis, armId, { stage: 'pilot' }),
      candidate: analysis && analysis.candidates && analysis.candidates[armId],
      usage: analysis && analysis.usage_by_arm && analysis.usage_by_arm[armId],
    }))
    .filter((entry) => entry.gate.pass);
  passing.sort((left, right) => (
    right.candidate.vs_none.delta_pp - left.candidate.vs_none.delta_pp
    || left.usage.median_total_tokens - right.usage.median_total_tokens
    || (left.armId === 'clue-first' ? -1 : 1)
  ));
  return passing.length ? passing[0].armId : null;
}

function stageArmIds(stage, selectedCandidate) {
  if (stage === 'calibration' || stage === 'pilot') return EXPLORATORY_ARMS.slice();
  if (stage === 'confirmation' || stage === 'replication') {
    if (!selectedCandidate || !EXPLORATORY_ARMS.includes(selectedCandidate)
      || selectedCandidate === 'none' || selectedCandidate === 'current') {
      throw new Error(`${stage} requires a selected candidate`);
    }
    return ['none', 'current', selectedCandidate];
  }
  throw new Error(`unknown tool-localization stage: ${stage}`);
}

function checkpointFile(checkpointDir, studyId, manifestHash, stage, itemId, armId) {
  return path.join(
    checkpointDir,
    `${sha256(`${studyId}:${manifestHash}:${stage}:${itemId}:${armId}`)}.json`,
  );
}

function verifyPinnedFiles(manifest, rootDir) {
  for (const [relativePath, expectedHash] of Object.entries(
    manifest && manifest.file_pins || {},
  )) {
    const file = path.resolve(rootDir, relativePath);
    const root = path.resolve(rootDir);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      throw new Error(`pinned file escapes root: ${relativePath}`);
    }
    if (!fs.existsSync(file)) throw new Error(`pinned file missing: ${relativePath}`);
    const actualHash = sha256(fs.readFileSync(file));
    if (actualHash !== expectedHash) {
      throw new Error(`pinned file hash mismatch: ${relativePath}`);
    }
  }
  return true;
}

function normalizedUsage(result, model) {
  const summary = usageSummary(result && result.usage, model);
  return {
    input_tokens: summary.input_tokens,
    output_tokens: summary.output_tokens,
    cache_read_tokens: summary.cache_read_tokens,
    cache_creation_tokens: summary.cache_creation_tokens,
    total_tokens: summary.total_tokens,
    estimated_cost_usd: summary.est_cost_usd,
    latency_ms: Number(result && result.durationMs || 0),
    cost_model_version: summary.cost_model_version,
  };
}

function serializeFailure(failure) {
  if (!failure) return null;
  return typeof failure.toJSON === 'function' ? failure.toJSON() : failure;
}

async function runToolStage(options = {}) {
  const {
    studyId,
    manifestHash,
    stage,
    items = [],
    armDefinitions = [],
    model,
    effort = 'high',
    outputDir,
    cacheRoot,
    callCap,
    costCapUsd,
    maxObservations = 4,
    concurrency = 4,
  } = options;
  if (!studyId || !manifestHash || !stage || !model || !outputDir || !cacheRoot) {
    throw new Error('studyId, manifestHash, stage, model, outputDir, and cacheRoot are required');
  }
  if (!armDefinitions.length) throw new Error('armDefinitions are required');
  const prepare = options.prepare || ((item) => prepareRepository(item, { cacheRoot }));
  const execute = options.execute || executeDroid;
  const stageDir = path.join(outputDir, stage);
  const checkpointDir = path.join(stageDir, 'checkpoints');
  const rawDir = path.join(stageDir, 'raw');
  fs.mkdirSync(checkpointDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const rows = [];
  const loadedKeys = new Set();
  let solverCalls = 0;
  let reservedCalls = 0;
  let estimatedCostUsd = 0;
  let invalidReason = null;
  const errors = [];
  for (const item of items) {
    for (const arm of armDefinitions) {
      const file = checkpointFile(
        checkpointDir,
        studyId,
        manifestHash,
        stage,
        item.id,
        arm.id,
      );
      const saved = readJsonIfExists(file);
      if (!saved) continue;
      if (saved.manifest_hash !== manifestHash || saved.study_id !== studyId
        || saved.stage !== stage || saved.item_id !== item.id || saved.arm_id !== arm.id) {
        throw new Error(`incompatible checkpoint: ${file}`);
      }
      rows.push(saved);
      loadedKeys.add(`${item.id}:${arm.id}`);
      solverCalls += Number(saved.solver_calls || 0);
      estimatedCostUsd += Number(saved.usage && saved.usage.estimated_cost_usd || 0);
    }
  }

  const groupsByRepo = new Map();
  for (const item of items) {
    if (!groupsByRepo.has(item.repo)) groupsByRepo.set(item.repo, []);
    groupsByRepo.get(item.repo).push(item);
  }
  const groups = [...groupsByRepo.values()];

  await mapPool(groups, Math.max(1, Number(concurrency || 1)), async (group) => {
    for (const item of group) {
      if (invalidReason) break;
      const missingArms = armDefinitions.filter(
        (arm) => !loadedKeys.has(`${item.id}:${arm.id}`),
      );
      if (!missingArms.length) continue;
      let checkout;
      try {
        checkout = await prepare(item);
      } catch (error) {
        invalidReason = `repository preparation failed for ${item.id}`;
        errors.push({ item_id: item.id, type: 'repository', message: String(error.message || error) });
        break;
      }
      for (const arm of missingArms) {
        if (invalidReason) break;
        if (estimatedCostUsd >= Number(costCapUsd)) {
          invalidReason = `estimated cost cap reached before ${item.id}:${arm.id}`;
          break;
        }
        const availableAttempts = Number(callCap) - solverCalls - reservedCalls;
        const attempts = Math.min(2, availableAttempts);
        if (attempts < 1) {
          invalidReason = `solver call cap reached before ${item.id}:${arm.id}`;
          break;
        }
        reservedCalls += attempts;
        const prompt = buildToolLocalizationPrompt(item, {
          skillContent: arm.skillContent || '',
          maxObservations,
        });
        let result;
        try {
          result = await execute({
            model,
            effort,
            prompt,
            cwd: checkout,
            isolate: true,
            allowToolUse: true,
            restrictTools: TOOL_RESTRICTED_TOOLS,
            appendSystemPrompt: TOOL_SYSTEM_PROMPT,
            attempts,
            timeoutMs: Number(options.timeoutMs || 300000),
          });
        } catch (error) {
          result = {
            ok: false,
            text: '',
            usage: null,
            durationMs: 0,
            attempts: 1,
            failure: { type: 'transport', message: String(error.message || error) },
            raw: '',
          };
        } finally {
          reservedCalls -= attempts;
        }
        const actualCalls = Math.max(1, Number(result.attempts || 1));
        solverCalls += actualCalls;
        const usage = normalizedUsage(result, model);
        estimatedCostUsd += usage.estimated_cost_usd;
        const score = result.ok
          ? scoreToolLocalizationResponse(item, result.text, maxObservations)
          : {
              parsed_success: false,
              parsed: null,
              reported_observations: null,
              budget_compliant: false,
              correct: false,
            };
        const key = sha256(`${studyId}:${manifestHash}:${stage}:${item.id}:${arm.id}`);
        const rawFile = path.join(rawDir, `${key}.txt`);
        fs.writeFileSync(rawFile, String(result.raw || result.text || ''), 'utf8');
        const row = {
          schema_version: 1,
          study_id: studyId,
          manifest_hash: manifestHash,
          stage,
          item_id: item.id,
          repo: item.repo,
          base_commit: item.base_commit,
          trial: 1,
          arm_id: arm.id,
          completed: true,
          solver_ok: Boolean(result.ok),
          solver_calls: actualCalls,
          ...score,
          failure: serializeFailure(result.failure),
          usage,
          prompt_sha256: sha256(prompt),
          response_sha256: sha256(result.text || ''),
          archive_path: rawFile,
        };
        const file = checkpointFile(
          checkpointDir,
          studyId,
          manifestHash,
          stage,
          item.id,
          arm.id,
        );
        writeJsonAtomic(file, row);
        rows.push(row);
        loadedKeys.add(`${item.id}:${arm.id}`);
        if (!result.ok && (!result.failure || result.failure.type !== 'parse')) {
          invalidReason = `exhausted solver failure at ${item.id}:${arm.id}`;
          errors.push({
            item_id: item.id,
            arm_id: arm.id,
            type: result.failure && result.failure.type || 'transport',
            message: result.failure && result.failure.message || result.error || 'solver failure',
          });
        }
        if (estimatedCostUsd > Number(costCapUsd)) {
          invalidReason = `estimated cost cap exceeded at ${item.id}:${arm.id}`;
        }
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            stage,
            completed: rows.length,
            assigned: items.length * armDefinitions.length,
            solver_calls: solverCalls,
            estimated_cost_usd: estimatedCostUsd,
            invalid_reason: invalidReason,
          });
        }
      }
    }
  });

  const itemOrder = new Map(items.map((item, index) => [item.id, index]));
  const armOrder = new Map(armDefinitions.map((arm, index) => [arm.id, index]));
  rows.sort((left, right) => (
    itemOrder.get(left.item_id) - itemOrder.get(right.item_id)
    || armOrder.get(left.arm_id) - armOrder.get(right.arm_id)
  ));
  const assigned = items.length * armDefinitions.length;
  const nonParseFailures = rows.filter(
    (row) => !row.solver_ok && (!row.failure || row.failure.type !== 'parse'),
  ).length;
  const health = {
    assigned_observations: assigned,
    completed_observations: rows.length,
    solver_calls: solverCalls,
    non_parse_solver_failures: nonParseFailures,
    parse_or_protocol_failures: rows.filter(
      (row) => !row.parsed_success || !row.budget_compliant,
    ).length,
    estimated_cost_usd: Number(estimatedCostUsd.toFixed(6)),
    call_cap: Number(callCap),
    cost_cap_usd: Number(costCapUsd),
    decision_eligible: !invalidReason && rows.length === assigned && nonParseFailures === 0,
    invalid_reason: invalidReason,
    errors,
  };
  const envelope = {
    schema_version: 1,
    study_id: studyId,
    manifest_hash: manifestHash,
    stage,
    model,
    effort,
    arm_ids: armDefinitions.map((arm) => arm.id),
    item_ids: items.map((item) => item.id),
    health,
    items: rows,
  };
  writeJsonAtomic(path.join(stageDir, 'envelope.json'), envelope);
  return envelope;
}

module.exports = {
  EXPLORATORY_ARMS,
  analyzeToolStage,
  evaluateToolCandidateGate,
  runToolStage,
  scoreToolLocalizationResponse,
  selectPilotCandidate,
  stageArmIds,
  verifyPinnedFiles,
};
