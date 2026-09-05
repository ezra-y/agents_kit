#!/usr/bin/env node
'use strict';

/**
 * In-domain capability-substitution test (removes the medical out-of-domain
 * confound). Same-family ladder haiku→sonnet→opus, each skill paired with ITS OWN
 * in-domain behavioral problems (software/product/decision), skill vs length-
 * matched placebo, a FIXED single judge across all tiers (so judge bias is
 * constant → clean slope). Pairwise (these problems have no ground truth).
 *
 * Reports win-rate + CI per tier and the lift-vs-capability slope. Tracked in the
 * ledger. Usage: node experiments/run-capability-indomain.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('./lib');

const ROOT = lib.REPO_ROOT;
const LADDER = (process.env.LADDER || 'claude-haiku-4-5-20251001,claude-sonnet-4-6,claude-opus-4-8').split(',');
const tag = m => m.replace('claude-', '').replace('-4-8', '').replace('-4-5-20251001', '').replace('-4-6', '');
const JUDGE = process.env.JUDGES || 'gemini-3.1-pro-preview'; // fixed across tiers
const SKILLS = (process.env.SKILLS || 'thinking-second-order,thinking-opportunity-cost,thinking-theory-of-constraints,thinking-systems,thinking-pre-mortem,thinking-via-negativa,thinking-scientific-method,thinking-first-principles,thinking-probabilistic').split(',');

function runTier(model, idx) {
  const run = `indomain-${tag(model)}`;
  const env = { ...process.env, EVAL_RUN: run, SOLVER_MODEL: model, SOLVER_EFFORT: 'medium', JUDGES: JUDGE, PAIRS: 'skill:placebo', CONC: '4' };
  const r = spawnSync('node', ['evals/run-behavioral.js', ...SKILLS], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.log(`  ${tag(model)} FAILED: ${(r.stderr || '').slice(-200)}`); return null; }
  const res = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', 'results', run, 'tier3-behavioral.json'), 'utf8'));
  const a = res.aggregate_significance;
  console.log(`  ${tag(model).padEnd(8)} skill beats placebo ${(a.win_rate * 100).toFixed(0)}%  95% CI [${(a.ci95[0] * 100).toFixed(0)},${(a.ci95[1] * 100).toFixed(0)}]  p=${a.p_value}${a.significant ? ' SIG' : ''}  (n=${a.n})`);
  return { tier: tag(model), rank: idx, win_rate: a.win_rate, ci: a.ci95, p: a.p_value, n: a.n };
}
function slope(pts) {
  const n = pts.length, sx = pts.reduce((a, p) => a + p.rank, 0), sy = pts.reduce((a, p) => a + p.win_rate, 0);
  const sxy = pts.reduce((a, p) => a + p.rank * p.win_rate, 0), sxx = pts.reduce((a, p) => a + p.rank * p.rank, 0);
  return (n * sxy - sx * sy) / (n * sxx - sx * sx) * 100; // pp per step
}

async function main() {
  lib.init();
  const id = lib.genId('CAP-MODEL-INDOMAIN');
  console.log(`▶ ${id} — in-domain capability ladder (${SKILLS.length} skills × 3 problems, judge=${JUDGE} fixed), isolation ${process.env.EVAL_NO_ISOLATE === '1' ? 'OFF' : 'ON'}`);
  lib.register({ id, hypothesis: 'CAP-MODEL-INDOMAIN', title: `In-domain capability ladder (skill vs placebo, ${SKILLS.length} software/decision skills)`, intervention: 'capability-ladder-indomain', skills: SKILLS, status: 'running', dataset: 'behavioral' });
  const pts = [];
  for (let i = 0; i < LADDER.length; i++) { const p = runTier(LADDER[i], i); if (p) { pts.push(p); lib.recordSkill(id, p.tier, 0.5, p.win_rate, p.n); } }
  const m = pts.length >= 2 ? slope(pts) : 0;
  const dir = m < -1 ? 'SUBSTITUTES (helps weak models more)' : m > 1 ? 'COMPLEMENTS (helps strong models more)' : 'flat/no interaction';
  lib.update(id, { status: 'evaluated', lift_pp: +m.toFixed(2), n_problems: pts.reduce((a, p) => a + p.n, 0),
    notes: `IN-DOMAIN (software/decision), pairwise, fixed judge ${JUDGE}, isolation ON. slope=${m.toFixed(1)}pp/step → ${dir}. tiers: ${pts.map(p => p.tier + ':' + (p.win_rate * 100).toFixed(0) + '%(p=' + p.p + ')').join(', ')}.` });
  console.log(`\n  slope = ${m.toFixed(1)} pp per capability step → ${dir}`);
  console.log(`  ledger id: ${id}`);
}
main();
