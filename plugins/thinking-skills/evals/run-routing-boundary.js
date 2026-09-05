#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadAllSkills } = require('./lib/skills');
const {
  droidJsonAsync,
  maxEffortFor,
  usageSummary,
  aggregateUsage,
} = require('./lib/droid');
const { mapPool, writeJsonAtomic } = require('./lib/io');
const { deterministicArmOrder } = require('./lib/objective');
const { sha256 } = require('./lib/result');
const {
  applyDescriptionOverride,
  scoreRoutingBoundary,
} = require('./lib/routing-boundary');

const MODEL = process.env.ROUTER_MODEL || 'claude-sonnet-4-6';
const CONCURRENCY = Math.max(1, Number(process.env.CONC || 4));
const DATASET = path.join(__dirname, 'datasets', 'scientific-method-routing-boundary.json');
const OUT = process.env.OUT
  ? path.resolve(process.env.OUT)
  : path.join(__dirname, 'results', 'local', 'scientific-method-routing-boundary.json');
const BOUNDARY_DESCRIPTION = 'When several observable causes could explain a live symptom, localize the faulty file/function/config now with falsifying checks; after localization, use five-whys-plus for systemic prevention.';

function catalogText(skills) {
  return skills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n');
}

function routingPrompt(catalog, userPrompt) {
  return `You are the skill-router inside an AI coding agent. Pick the SINGLE optional thinking skill whose description best matches the user's actual need, or "none" when no skill strongly fits.\n\n=== SKILL CATALOG ===\n${catalog}\n\n=== USER MESSAGE ===\n${userPrompt}\n\nReturn ONLY JSON: {"skill":"thinking-... or none","confidence":0.0,"rationale":"one sentence"}`;
}

async function main() {
  if (BOUNDARY_DESCRIPTION.length > 200) throw new Error('boundary description exceeds 200 characters');
  const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  const currentCatalog = loadAllSkills();
  const boundaryCatalog = applyDescriptionOverride(
    currentCatalog,
    'thinking-scientific-method',
    BOUNDARY_DESCRIPTION,
  );
  const catalogs = {
    current: catalogText(currentCatalog),
    boundary: catalogText(boundaryCatalog),
  };
  const rows = await mapPool(dataset.cases, CONCURRENCY, async (testCase) => {
    const armIds = deterministicArmOrder(['current', 'boundary'], {
      seed: 'scientific-method-routing-boundary-v1',
      itemId: testCase.id,
      trial: 1,
    });
    const caseRows = [];
    for (const armId of armIds) {
      const result = await droidJsonAsync({
        model: MODEL,
        effort: maxEffortFor(MODEL),
        prompt: routingPrompt(catalogs[armId], testCase.prompt),
        timeoutMs: Number(process.env.DROID_TIMEOUT_MS || 180000),
      });
      const chosen = result.ok && result.json && result.json.skill
        ? String(result.json.skill).trim()
        : null;
      caseRows.push({
        case_id: testCase.id,
        arm_id: armId,
        expected: testCase.expected,
        chosen,
        correct: chosen === testCase.expected,
        confidence: result.ok && result.json ? result.json.confidence : null,
        rationale: result.ok && result.json ? result.json.rationale : null,
        response_sha256: result.raw ? sha256(result.raw) : null,
        usage: usageSummary(result.usage, MODEL),
        attempts: result.attempts,
        failure: result.failure && typeof result.failure.toJSON === 'function'
          ? result.failure.toJSON()
          : result.failure || null,
      });
    }
    return caseRows;
  });
  const results = rows.flat();
  const score = scoreRoutingBoundary(results);
  const health = {
    attempted: results.length,
    completed: results.filter((row) => !row.failure).length,
    failures: results.filter((row) => row.failure).length,
  };
  health.decision_eligible = health.completed === health.attempted;
  if (!health.decision_eligible) score.boundary_pass = false;
  const artifact = {
    schema_version: 1,
    study_id: 'scientific-method-routing-boundary-v1',
    created_at: new Date().toISOString(),
    model: MODEL,
    effort: maxEffortFor(MODEL),
    dataset: {
      path: path.relative(path.join(__dirname, '..'), DATASET),
      sha256: sha256(fs.readFileSync(DATASET)),
      n: dataset.cases.length,
    },
    descriptions: {
      current: currentCatalog.find((skill) => skill.name === 'thinking-scientific-method').description,
      boundary: BOUNDARY_DESCRIPTION,
    },
    health,
    usage: aggregateUsage(results.map((row) => row.usage)),
    score,
    results,
  };
  writeJsonAtomic(OUT, artifact);
  process.stdout.write(`${JSON.stringify({ out: OUT, health, usage: artifact.usage, score }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
