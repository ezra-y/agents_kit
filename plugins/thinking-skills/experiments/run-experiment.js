#!/usr/bin/env node
'use strict';

/**
 * Run lift experiments, each in its own git worktree, and track EVERY one in the
 * central experiments ledger with a unique id — whether merged or not.
 *
 * Flow per executed experiment:
 *   register(unique id) → git worktree add (branch exp/<id>) → apply intervention
 *   → commit → run behavioral eval in the worktree → record lift vs main baseline
 *   → status: merged | evaluated(merge-pending) | discarded  → remove worktree.
 *
 * Usage:
 *   node experiments/run-experiment.js --register-all          # register every spec
 *   node experiments/run-experiment.js L1 L2                    # register all + run L1,L2
 *   MERGE=1 node experiments/run-experiment.js L1 L2            # also merge positive-lift branches to main
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('./lib');
const { SPECS, INTERVENTIONS } = require('./specs');

const REPO = lib.REPO_ROOT;
const WT_PARENT = path.join(REPO, '..', 'cc-tsk-wt');
const SOLVER = process.env.SOLVER_MODEL || 'claude-sonnet-4-6';
const JUDGE = process.env.JUDGE_MODEL || 'gemini-3.1-pro-preview';
const DO_MERGE = process.env.MERGE === '1';

function git(args, cwd = REPO) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

// The eval harness is uncommitted on main (untracked), so a fresh worktree at
// HEAD lacks it. Copy the needed harness pieces in (they stay untracked in the
// worktree and vanish when it's removed). The committed 39 skills are already
// present from HEAD; the intervention has already modified them + committed.
function copyHarness(worktree) {
  fs.mkdirSync(path.join(worktree, 'evals'), { recursive: true });
  for (const p of ['lib', 'rubrics', 'datasets']) {
    spawnSync('cp', ['-R', path.join(REPO, 'evals', p), path.join(worktree, 'evals', p)]);
  }
  spawnSync('cp', [path.join(REPO, 'evals', 'run-behavioral.js'), path.join(worktree, 'evals', 'run-behavioral.js')]);
}

async function execute(spec) {
  const id = lib.genId(spec.hypothesis);
  const branch = `exp/${id}`;
  const worktree = path.join(WT_PARENT, id);
  console.log(`\n▶ ${id} — ${spec.title}`);
  lib.register({ ...spec, id, branch, worktree, status: 'running' });

  try {
    fs.mkdirSync(WT_PARENT, { recursive: true });
    git(['worktree', 'add', '-b', branch, worktree, 'HEAD']);
    console.log(`  worktree: ${worktree} (branch ${branch})`);

    console.log(`  applying intervention: ${spec.intervention} on ${spec.skills.join(', ')}`);
    await INTERVENTIONS[spec.intervention](worktree, spec.skills);
    git(['add', '-A'], worktree);
    git(['commit', '-m', `exp ${id}: ${spec.intervention} on ${spec.skills.join(',')}`], worktree);
    const commit = git(['rev-parse', 'HEAD'], worktree);

    // Paired, length-balanced, SAME-RUN head-to-head: modified skill vs original
    // skill on the same problems. Removes the run-variance + length confounds of
    // the first pass; run-paired.js executes from main (reads both skill dirs).
    console.log(`  running paired head-to-head (modified vs original, length-balanced)…`);
    const outPath = path.join(REPO, 'evals', 'results', id, 'paired.json');
    const args = ['experiments/run-paired.js', ...spec.skills.map(s => 'thinking-' + s.replace(/^thinking-/, ''))];
    const env = { ...process.env, ORIG_DIR: REPO, MOD_DIR: worktree, SOLVER_MODEL: SOLVER, JUDGES: process.env.JUDGES || JUDGE, CONC: '3', SOLVER_EFFORT: 'medium', OUT: outPath };
    const r = spawnSync('node', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (r.status !== 0) throw new Error('paired eval failed: ' + (r.stderr || '').slice(-400));
    const res = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    const agg = res.aggregate;

    for (const s of res.skills) {
      lib.recordSkill(id, s.skill, 0.5, s.win_rate, s.n);
      console.log(`    ${s.skill}: modified beats original ${(s.win_rate * 100).toFixed(0)}%  (n=${s.n}, CI [${(s.ci95[0] * 100).toFixed(0)},${(s.ci95[1] * 100).toFixed(0)}])`);
    }
    const winRate = agg.win_rate, liftPp = (winRate - 0.5) * 100, positive = winRate > 0.5, sig = agg.significant;

    let status = positive ? 'evaluated' : 'discarded';
    let mergedNote = '';
    if (positive && sig && DO_MERGE) {
      try { git(['merge', '--no-ff', '-m', `Merge ${id} (paired ${(winRate * 100).toFixed(0)}% vs original, p=${agg.p_value})`, branch]); status = 'merged'; mergedNote = ' [merged to main]'; }
      catch (e) { mergedNote = ' [merge failed: ' + e.message.slice(0, 80) + ']'; }
    }

    lib.update(id, {
      status, commit_hash: commit, baseline_win_rate: 0.5, result_win_rate: winRate,
      lift_pp: +liftPp.toFixed(1), n_problems: agg.n, merge_recommended: (positive && sig) ? 1 : 0,
      notes: `paired head-to-head, length-balanced, same-run. modified beats original ${(winRate * 100).toFixed(0)}% (n=${agg.n}, 95% CI [${(agg.ci95[0] * 100).toFixed(0)},${(agg.ci95[1] * 100).toFixed(0)}], p=${agg.p_value}, ${sig ? 'SIGNIFICANT' : 'directional'}). commit ${commit.slice(0, 9)}.`,
    });
    console.log(`  aggregate: modified beats original ${(winRate * 100).toFixed(0)}%  95% CI [${(agg.ci95[0] * 100).toFixed(0)},${(agg.ci95[1] * 100).toFixed(0)}]  p=${agg.p_value}  → status=${status}${mergedNote}`);

    try { git(['worktree', 'remove', '--force', worktree]); } catch (_) {}
    return { id, status, liftPp, sig };
  } catch (e) {
    lib.update(id, { status: 'failed', notes: String(e.message).slice(0, 300) });
    console.log(`  FAILED: ${e.message.slice(0, 200)}`);
    try { git(['worktree', 'remove', '--force', worktree]); } catch (_) {}
    return { id, status: 'failed' };
  }
}

async function main() {
  lib.init();
  const argv = process.argv.slice(2);
  const registerAll = argv.includes('--register-all');
  const toRun = argv.filter(a => !a.startsWith('--'));

  // 1) register EVERY spec (planned ones tracked too)
  for (const spec of SPECS) {
    if (toRun.includes(spec.hypothesis)) continue; // executed ones get registered inside execute()
    const id = `exp-${spec.hypothesis.toLowerCase()}-planned`; // stable id → idempotent across re-runs
    lib.register({ ...spec, id, status: spec.run ? 'registered' : 'planned',
      notes: spec.run ? 'runnable; not selected this invocation' : 'planned — intervention not yet implemented / needs Class-B (distractor) eval' });
    console.log(`registered ${id} [${spec.run ? 'registered' : 'planned'}] — ${spec.hypothesis}: ${spec.title}`);
  }

  // 2) execute the requested ones
  const results = [];
  for (const hyp of toRun) {
    const spec = SPECS.find(s => s.hypothesis === hyp);
    if (!spec) { console.log(`no spec for ${hyp}`); continue; }
    if (!spec.run) { console.log(`${hyp} is not runnable (planned)`); continue; }
    results.push(await execute(spec));
  }
  console.log('\n=== summary ===');
  for (const r of results) console.log(`  ${r.id}: ${r.status}${r.liftPp != null ? ' (' + (r.liftPp >= 0 ? '+' : '') + r.liftPp.toFixed(1) + 'pp)' : ''}`);
  console.log(`\nLedger: ${lib.DB}`);
}

main();
