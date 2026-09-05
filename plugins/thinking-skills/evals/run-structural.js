#!/usr/bin/env node
'use strict';

/**
 * Tier 0 — Structural lint (free, deterministic, no API cost).
 *
 * Uses the same pure checks exported by scripts/validate-skills.js
 * (required sections, description length, word budgets, catalog count).
 * Also reports a legacy "loose" substance score for comparison only.
 */

const path = require('path');
const {
  validateAllSkills,
  validateSkillContent,
  DEFAULT_REQUIRED_SECTIONS,
} = require('../scripts/validate-skills');
const { loadAllSkills } = require('./lib/skills');
const { runDir, writeJson } = require('./lib/io');

function looseScore(content) {
  const checks = {
    has_frontmatter: /^---\n[\s\S]*?name:[\s\S]*?description:[\s\S]*?---/m.test(content),
    has_when_to_use: /^##\s+When to Use\s*$/mi.test(content),
    has_when_not_to_use: /^##\s+When NOT to Use\s*$/mi.test(content),
    has_procedure: /^##\s+Procedure\s*$/mi.test(content),
    has_output: /^##\s+Output\s*$/mi.test(content),
    has_verification: /^##\s+Verification\s*$/mi.test(content),
    desc_ok: (() => {
      const m = content.match(/^---\n[\s\S]*?\ndescription:\s*(.+)\n[\s\S]*?\n---/m) || content.match(/description:\s*(.+)/);
      const len = (m && m[1] ? m[1].trim().length : 0);
      return len > 0 && len <= 200;
    })(),
    word_ok: (() => {
      const w = content.trim().split(/\s+/).filter(Boolean).length;
      return w > 0 && w <= 3000;
    })(),
  };
  const vals = Object.values(checks);
  const score = vals.filter(Boolean).length;
  return { score, max: vals.length, pct: Math.round((score / vals.length) * 100), checks };
}

function main() {
  const report = validateAllSkills();
  const skills = loadAllSkills();
  const byName = new Map(report.results.map(r => [r.name, r]));

  const rows = skills.map(s => {
    const structural = byName.get(s.name) || validateSkillContent(s.content, {
      name: s.name,
      requiredSections: report.required_sections || DEFAULT_REQUIRED_SECTIONS,
    });
    const loose = looseScore(s.content);
    return {
      name: s.name,
      descLen: structural.description_length ?? s.description.length,
      words: structural.words,
      max_words: structural.max_words,
      structural_pass: structural.pass,
      structural_score: structural.score,
      structural_max: structural.maxScore,
      structural_pct: Math.round((structural.score / Math.max(1, structural.maxScore)) * 100),
      missing: (structural.failed || []).map(f => f.name),
      loose_pct: loose.pct,
      gap: loose.pct - Math.round((structural.score / Math.max(1, structural.maxScore)) * 100),
    };
  });
  rows.sort((a, b) => Number(a.structural_pass) - Number(b.structural_pass) || a.name.localeCompare(b.name));

  const overallStructural = rows.length
    ? Math.round(rows.reduce((a, r) => a + r.structural_pct, 0) / rows.length)
    : 0;
  const overallLoose = rows.length
    ? Math.round(rows.reduce((a, r) => a + r.loose_pct, 0) / rows.length)
    : 0;

  const out = {
    tier: 0,
    validator: 'scripts/validate-skills.js',
    catalog: {
      expected_count: report.expected_count,
      found_count: report.found_count,
      catalog_errors: report.catalog_errors,
      ok: report.ok,
    },
    required_sections: report.required_sections,
    overall_structural_pct: overallStructural,
    overall_loose_pct: overallLoose,
    failed_skills: rows.filter(r => !r.structural_pass).map(r => ({
      name: r.name,
      missing: r.missing,
      words: r.words,
      max_words: r.max_words,
      descLen: r.descLen,
    })),
    over_length_descriptions: rows.filter(r => r.descLen > 200).map(r => ({ name: r.name, len: r.descLen })),
    over_budget: rows.filter(r => r.max_words != null && r.words > r.max_words).map(r => ({
      name: r.name,
      words: r.words,
      max_words: r.max_words,
    })),
    rows,
  };

  // writeJson only under EVAL_RUN results dir (existing runner behavior / untracked results)
  const file = path.join(runDir(), 'tier0-structural.json');
  writeJson(file, out);
  console.log('Tier 0 — structural lint (shared validate-skills checks)');
  console.log(`  catalog: ${out.catalog.found_count} found / expected ${out.catalog.expected_count} / ok=${out.catalog.ok}`);
  console.log(`  structural overall: ${overallStructural}%`);
  console.log(`  loosened overall:   ${overallLoose}%`);
  console.log(`  failed skills: ${out.failed_skills.length}`);
  for (const r of out.failed_skills.slice(0, 12)) {
    console.log(`    ${r.name}: ${r.missing.join(', ')}`);
  }
  console.log(`  over-length descriptions (>200): ${out.over_length_descriptions.map(d => `${d.name}(${d.len})`).join(', ') || 'none'}`);
  console.log(`  over word budget: ${out.over_budget.length}`);
  console.log(`  -> ${file}`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { looseScore, main, validateAllSkills };
