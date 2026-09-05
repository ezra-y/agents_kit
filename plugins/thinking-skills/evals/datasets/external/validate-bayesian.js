#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'bayesian-authored.jsonl');
const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);

let errors = 0;
const seen = new Set();

// Independent re-derivation of the (base, tpr, fpr) per item id, mirroring the spec table,
// so validation does not trust the generator's own arithmetic path.
const truth = {
  'bayes-1': [0.01, 0.90, 0.09], 'bayes-2': [0.001, 0.99, 0.01], 'bayes-3': [0.30, 0.85, 0.20],
  'bayes-4': [0.002, 0.95, 0.03], 'bayes-5': [0.40, 0.98, 0.05], 'bayes-6': [0.0005, 0.99, 0.02],
  'bayes-7': [0.05, 0.92, 0.04], 'bayes-8': [0.10, 0.80, 0.05], 'bayes-9': [0.04, 0.97, 0.05],
  'bayes-10': [0.08, 0.88, 0.10], 'bayes-11': [0.02, 0.93, 0.07], 'bayes-12': [0.15, 0.96, 0.08],
  'bayes-13': [0.005, 0.98, 0.03], 'bayes-14': [0.01, 0.99, 0.02], 'bayes-15': [0.20, 0.90, 0.10],
  'bayes-16': [0.0001, 0.99, 0.01], 'bayes-17': [0.03, 0.85, 0.06], 'bayes-18': [0.06, 0.94, 0.02],
  'bayes-19': [0.005, 0.92, 0.01], 'bayes-20': [0.35, 0.90, 0.15], 'bayes-21': [0.002, 0.80, 0.05],
  'bayes-22': [0.01, 0.85, 0.04], 'bayes-23': [0.10, 0.95, 0.07], 'bayes-24': [0.02, 0.97, 0.10],
  'bayes-25': [0.001, 0.90, 0.005], 'bayes-26': [0.05, 0.88, 0.03], 'bayes-27': [0.25, 0.99, 0.02],
  'bayes-28': [0.008, 0.96, 0.05], 'bayes-29': [0.003, 0.90, 0.02], 'bayes-30': [0.015, 0.92, 0.06],
  'bayes-31': [0.30, 0.78, 0.18], 'bayes-32': [0.12, 0.85, 0.10], 'bayes-33': [0.004, 0.93, 0.03],
  'bayes-34': [0.007, 0.88, 0.015], 'bayes-35': [0.45, 0.92, 0.12], 'bayes-36': [0.01, 0.95, 0.10],
  'bayes-37': [0.025, 0.90, 0.05], 'bayes-38': [0.02, 0.80, 0.03], 'bayes-39': [0.001, 0.95, 0.001],
  'bayes-40': [0.10, 0.70, 0.10],
};

function bayes(base, tpr, fpr) {
  const num = tpr * base;
  return num / (num + fpr * (1 - base));
}

// Parse the numeric value(s) out of an option label so we can confirm bracketing.
function rangeFromOption(label) {
  // "between X and Y" -> [X, Y] in fraction
  const m = label.match(/between\s+([\d.]+)%\s+and\s+([\d.]+)%/i);
  if (m) return [parseFloat(m[1]) / 100, parseFloat(m[2]) / 100];
  // "about N% (...)" -> single value with tolerance derived below
  const a = label.match(/about\s+([\d.]+)%/i);
  if (a) return ['point', parseFloat(a[1]) / 100];
  return null;
}

const letters = ['A', 'B', 'C', 'D', 'E'];

for (const line of lines) {
  let o;
  try { o = JSON.parse(line); } catch (e) { console.error(`PARSE FAIL: ${e.message}\n  ${line.slice(0, 80)}`); errors++; continue; }

  // strict shape
  if (!o.id || seen.has(o.id)) { console.error(`BAD/DUP id: ${o.id}`); errors++; }
  seen.add(o.id);
  if (o.mode !== 'correctness') { console.error(`${o.id}: mode != correctness`); errors++; }
  if (!/^[A-E]$/.test(o.answer_idx)) { console.error(`${o.id}: answer_idx '${o.answer_idx}' fails /^[A-E]$/`); errors++; continue; }
  if (!Array.isArray(o.skill_fit) || o.skill_fit[0] !== 'probabilistic') { console.error(`${o.id}: skill_fit wrong`); errors++; }
  if (typeof o.posterior !== 'number') { console.error(`${o.id}: posterior not a number`); errors++; continue; }
  if (typeof o.prompt !== 'string' || !o.prompt.includes('A)') || !o.prompt.includes('E)')) { console.error(`${o.id}: prompt missing A-E lettered options`); errors++; }

  // Bayes recompute vs stored posterior
  const t = truth[o.id];
  if (!t) { console.error(`${o.id}: no truth entry`); errors++; continue; }
  const expected = bayes(t[0], t[1], t[2]);
  if (Math.abs(expected - o.posterior) > 0.0006) {
    console.error(`${o.id}: posterior mismatch. stored=${o.posterior} bayes=${expected.toFixed(4)}`);
    errors++;
  }

  // Extract the chosen-letter option text from the prompt
  const optLines = o.prompt.split('\n').filter(l => /^[A-E]\)/.test(l.trim()));
  if (optLines.length !== 5) { console.error(`${o.id}: found ${optLines.length} option lines, expected 5`); errors++; continue; }

  // No two options should carry the same numeric value (would create a second correct answer)
  const nums = optLines.map(l => {
    const r = l.match(/([\d.]+)%/g) || [];
    return r.map(x => parseFloat(x)).sort((a, b) => a - b).join(',');
  });
  const dupSet = new Set();
  for (const n of nums) { if (dupSet.has(n)) { console.error(`${o.id}: duplicate option numeric value '${n}'`); errors++; } dupSet.add(n); }
  const idxOfLetter = letters.indexOf(o.answer_idx);
  const correctLine = optLines.find(l => l.trim().startsWith(o.answer_idx + ')'));
  if (!correctLine) { console.error(`${o.id}: no option line for ${o.answer_idx}`); errors++; continue; }

  // Confirm the correct option brackets the posterior
  const r = rangeFromOption(correctLine);
  if (!r) { console.error(`${o.id}: cannot parse correct option '${correctLine.trim()}'`); errors++; }
  else if (r[0] === 'point') {
    // "about N%" should round to the posterior; allow 0.6pp tolerance
    if (Math.abs(r[1] - o.posterior) > 0.006) { console.error(`${o.id}: correct 'about ${(r[1]*100).toFixed(1)}%' != posterior ${(o.posterior*100).toFixed(2)}%`); errors++; }
  } else {
    if (o.posterior < r[0] - 1e-9 || o.posterior > r[1] + 1e-9) { console.error(`${o.id}: posterior ${(o.posterior*100).toFixed(2)}% not in range [${(r[0]*100)}, ${(r[1]*100)}]`); errors++; }
  }

  // Base-rate-neglect distractor: TPR must appear as a WRONG option (not the correct one)
  const tprPct = `${Math.round(t[1] * 100)}%`;
  const wrongLines = optLines.filter(l => !l.trim().startsWith(o.answer_idx + ')'));
  const hasTprDistractor = wrongLines.some(l => l.includes(tprPct));
  if (!hasTprDistractor) { console.error(`${o.id}: base-rate-neglect distractor (TPR ${tprPct}) not present among wrong options`); errors++; }
  // and TPR must NOT be inside the correct option
  if (correctLine.includes(tprPct) && Math.abs(t[1] - o.posterior) > 0.02) { console.error(`${o.id}: TPR ${tprPct} appears in correct option`); errors++; }
}

console.log(`\nChecked ${lines.length} items, unique ids: ${seen.size}, errors: ${errors}`);
if (errors) process.exit(1);
console.log('ALL CHECKS PASSED');
