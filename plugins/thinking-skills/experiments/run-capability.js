#!/usr/bin/env node
'use strict';

/**
 * Capability-substitution experiments. Tests whether a skill helps MORE at lower
 * capability (the core hypothesis). Two axes, correctness-mode (judge-free):
 *   effort: one model, sweep reasoning effort (low→xhigh)
 *   model : fixed effort, sweep a capability ladder (haiku→sonnet→opus)
 * Fits the lift-vs-capability slope; a NEGATIVE slope = skills substitute for
 * capability. Each sweep is registered in the experiments ledger with a unique id.
 *
 * Usage: node experiments/run-capability.js effort
 *        node experiments/run-capability.js model
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('./lib');

const ROOT = lib.REPO_ROOT;
const LIMIT = process.env.LIMIT || '24';
const FORCE_SKILL = process.env.FORCE_SKILL || 'probabilistic';
const TAGS = process.env.TAGS || 'medical';

const SWEEPS = {
  effort: { hyp: 'CAP-EFFORT', model: process.env.SWEEP_MODEL || 'claude-opus-4-8', cells: (process.env.EFFORTS || 'low,medium,high,max').split(','), label: e => e, vary: 'effort' },
  model: { hyp: 'CAP-MODEL', effort: 'medium', cells: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'], label: m => m.replace('claude-', '').replace('-4-8', '').replace('-4-5-20251001', '').replace('-4-6', ''), vary: 'model' },
};

function runCell(sweep, cell, idx) {
  const id = lib.genId(sweep.hyp + '-' + sweep.label(cell));
  const out = path.join(ROOT, 'evals', 'results', 'capability', `${sweep.hyp}-${idx}.json`);
  const env = { ...process.env, LIMIT, FORCE_SKILL, TAGS,
    SOLVER_MODEL: sweep.vary === 'model' ? cell : sweep.model,
    SOLVER_EFFORT: sweep.vary === 'effort' ? cell : sweep.effort,
    OUTFILE: out };
  const r = spawnSync('node', ['evals/run-correctness.js', ...TAGS.split(' ')], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) { console.log(`  cell ${sweep.label(cell)} FAILED: ${(r.stderr || '').slice(-200)}`); return null; }
  const res = JSON.parse(fs.readFileSync(out, 'utf8'));
  console.log(`  ${sweep.label(cell).padEnd(10)} acc_skill ${(res.acc_with_skill * 100).toFixed(0)}%  acc_placebo ${(res.acc_placebo * 100).toFixed(0)}%  Δ ${res.delta_pp >= 0 ? '+' : ''}${res.delta_pp}pp  (McNemar p=${res.mcnemar_p}, n=${res.n})`);
  return { cell: sweep.label(cell), rank: idx, delta: res.delta_pp, acc_with: res.acc_with_skill, acc_placebo: res.acc_placebo, n: res.n, mcnemar_p: res.mcnemar_p };
}

// least-squares slope of delta vs capability rank
function slope(points) {
  const n = points.length, sx = points.reduce((a, p) => a + p.rank, 0), sy = points.reduce((a, p) => a + p.delta, 0);
  const sxy = points.reduce((a, p) => a + p.rank * p.delta, 0), sxx = points.reduce((a, p) => a + p.rank * p.rank, 0);
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}

async function main() {
  const which = process.argv[2];
  const sweep = SWEEPS[which];
  if (!sweep) { console.error('usage: run-capability.js effort|model'); process.exit(1); }
  lib.init();
  const id = lib.genId(sweep.hyp);
  console.log(`▶ ${id} — ${sweep.hyp} sweep (skill=${FORCE_SKILL}, ${TAGS}, n≤${LIMIT}/cell), isolation ${process.env.EVAL_NO_ISOLATE === '1' ? 'OFF' : 'ON'}`);
  lib.register({ id, hypothesis: sweep.hyp, title: `Capability-substitution: ${sweep.vary} sweep (${FORCE_SKILL} on ${TAGS})`,
    intervention: 'capability-sweep', skills: [FORCE_SKILL], status: 'running', dataset: TAGS });

  const pts = [];
  for (let i = 0; i < sweep.cells.length; i++) { const p = runCell(sweep, sweep.cells[i], i); if (p) { pts.push(p); lib.recordSkill(id, p.cell, p.acc_placebo, p.acc_with, p.n); } }
  const m = pts.length >= 2 ? slope(pts) : 0;
  const direction = m < -0.5 ? 'SUBSTITUTES (helps more at low capability)' : m > 0.5 ? 'COMPLEMENTS (helps more at high capability)' : 'flat/no interaction';
  lib.update(id, { status: 'evaluated', result_win_rate: pts.length ? pts[0].acc_with : null, lift_pp: +m.toFixed(2),
    n_problems: pts.reduce((a, p) => a + p.n, 0),
    notes: `slope of lift vs ${sweep.vary}-rank = ${m.toFixed(2)} pp/step → ${direction}. cells: ${pts.map(p => p.cell + ':' + (p.delta >= 0 ? '+' : '') + p.delta + 'pp').join(', ')}. ISOLATION ${process.env.EVAL_NO_ISOLATE === '1' ? 'OFF' : 'ON'}.` });
  console.log(`\n  slope = ${m.toFixed(2)} pp per capability step → ${direction}`);
  console.log(`  ledger id: ${id}`);
}
main();
