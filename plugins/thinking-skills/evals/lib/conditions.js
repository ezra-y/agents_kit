'use strict';

/**
 * Solver conditions / arm prompt builders.
 *
 * Primary control is production no-skill (`none` / legacy `empty`).
 * Secondary equal-budget placebo uses deterministic indexed inert tokens inside
 * <context-padding>, sized by an injectable token counter to the treatment budget.
 * Legacy condition names remain callable.
 */

const DEFAULT_TAIL = '\n\nThink carefully and give your best, decision-useful answer.';

// Legacy sentence bank retained for export compatibility; neutralFiller no longer
// emits advice-bearing prose — it routes through context-padding tokens.
const FILLER_SENTENCES = [
  'When approaching a task, it helps to read the request carefully and confirm what is actually being asked.',
  'Software systems are made of many components, and work in one area often touches others.',
  'It is generally good practice to communicate clearly and to write down the reasoning behind a choice.',
  'Consider the broader context of the work, including the people and teams involved.',
  'Tools, libraries, and platforms change over time, so it is worth staying reasonably current.',
  'Testing and verification are part of delivering work that holds up in practice.',
  'Keep an eye on timelines and available resources as the work proceeds.',
  'Where possible, prefer clarity over cleverness so others can follow the work later.',
  'Document assumptions and constraints so they can be revisited if circumstances change.',
  'Small, steady progress is often easier to manage than large, infrequent changes.',
  'Be mindful of edge cases and conditions that may not appear in the most common path.',
  'It is reasonable to ask clarifying questions when a request is open to interpretation.',
];

/** Default token counter: whitespace-separated tokens (injectable override supported). */
function defaultTokenCounter(text) {
  if (text == null || text === '') return 0;
  return String(text).split(/\s+/).filter(Boolean).length;
}

function wordCount(s) {
  return defaultTokenCounter(s);
}

/**
 * Deterministic indexed inert padding tokens. No analytical advice.
 * Token shape: PAD_0001 PAD_0002 ... so counters treat each as one unit.
 */
function contextPaddingTokens(tokenCount, options = {}) {
  const n = Math.max(0, Math.floor(Number(tokenCount) || 0));
  if (n === 0) return '';
  const start = Number.isInteger(options.startIndex) && options.startIndex > 0 ? options.startIndex : 1;
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(`PAD_${String(start + i).padStart(4, '0')}`);
  }
  return parts.join(' ');
}

/**
 * Wrap padding tokens in <context-padding> for the equal-budget placebo arm.
 * Sized so total tokens of the padding body match `tokenBudget` under `tokenCounter`.
 */
function buildContextPadding(tokenBudget, options = {}) {
  const counter = typeof options.tokenCounter === 'function' ? options.tokenCounter : defaultTokenCounter;
  const budget = Math.max(0, Math.floor(Number(tokenBudget) || 0));
  if (budget === 0) return '<context-padding></context-padding>';

  // Grow token body until measured size reaches budget (handles multi-token wrappers
  // if a custom counter is used; with default whitespace counter each PAD is 1 token).
  let body = contextPaddingTokens(budget, options);
  let measured = counter(body);
  let guard = 0;
  while (measured < budget && guard < budget + 8) {
    body = contextPaddingTokens(budget + guard + 1, options);
    measured = counter(body);
    guard++;
  }
  if (measured > budget) {
    // Trim to exact budget under the counter when possible.
    const tokens = body.split(/\s+/).filter(Boolean);
    while (tokens.length > 0 && counter(tokens.join(' ')) > budget) tokens.pop();
    body = tokens.join(' ');
  }
  return `<context-padding>\n${body}\n</context-padding>`;
}

/**
 * Length-matched inert filler. Replaces advice-bearing prose with context-padding
 * tokens. `wordCount` is treated as a token budget under the optional counter.
 * Legacy name preserved.
 */
function neutralFiller(tokenBudget, options = {}) {
  const block = buildContextPadding(tokenBudget, options);
  const m = block.match(/<context-padding>\n?([\s\S]*?)\n?<\/context-padding>/);
  return (m ? m[1] : '').trim();
}

/** A 2-3 sentence trigger summary built from the skill's own frontmatter + core principle. */
function triggerSummary(content, name) {
  const desc = (content.match(/description:\s*(.+)/) || [, ''])[1].trim();
  const core = (content.match(/\*\*Core Principle:\*\*\s*(.+)/) || [, ''])[1].trim();
  let s = `Thinking skill "${name}". ${desc}`;
  if (core) s += ` Core principle: ${core}`;
  return s;
}

function normalizeCondition(condition) {
  if (condition == null) return 'none';
  const c = String(condition).toLowerCase().replace(/-/g, '_');
  if (c === 'empty' || c === 'none' || c === 'no_skill' || c === 'noskill') return 'none';
  if (c === 'placebo' || c === 'equal_budget_placebo' || c === 'equal_budget') return 'equal_budget_placebo';
  if (c === 'trigger') return 'trigger';
  if (c === 'skill' || c === 'full' || c === 'full_legacy' || c === 'lean') return 'skill';
  return c;
}

/**
 * Build a solve prompt for a named condition/arm.
 * Primary control: `none` (also accepts legacy `empty`).
 * Secondary diagnostic: `equal_budget_placebo` / `placebo`.
 * Treatment: `skill` (also accepts full/lean aliases for prompt shape).
 */
function buildConditionPrompt(condition, problemText, skillContent, skillName, options = {}) {
  const arm = normalizeCondition(condition);
  const tail = options.tail != null ? options.tail : DEFAULT_TAIL;
  const counter = typeof options.tokenCounter === 'function' ? options.tokenCounter : defaultTokenCounter;
  const budget = options.tokenBudget != null
    ? options.tokenBudget
    : (skillContent != null ? counter(skillContent) : 0);

  if (arm === 'none') {
    return `${problemText}${tail}`;
  }
  if (arm === 'equal_budget_placebo') {
    const padding = buildContextPadding(budget, { tokenCounter: counter, startIndex: options.startIndex });
    return `Some general notes before the task:\n\n${padding}\n\nNow address this problem:\n\n${problemText}${tail}`;
  }
  if (arm === 'trigger') {
    return `Consider applying the following thinking approach if relevant. Apply it substantively; do not merely name it.\n\n${triggerSummary(skillContent, skillName)}\n\nNow address this problem:\n\n${problemText}${tail}`;
  }
  // skill / full / lean share the treatment wrapper; body is caller-supplied.
  return `Use the following thinking-skill guide to structure your reasoning. Apply it substantively; do not merely name it.\n\n=== THINKING SKILL ===\n${skillContent}\n=== END SKILL ===\n\nNow address this problem:\n\n${problemText}${tail}`;
}

/**
 * Build a solve prompt for given skill CONTENT, padded with inert context-padding
 * so the total skill block reaches `targetWords` (token budget under counter).
 */
function buildBalancedSkillPrompt(content, problemText, targetWords, options = {}) {
  const counter = typeof options.tokenCounter === 'function' ? options.tokenCounter : defaultTokenCounter;
  const have = counter(content);
  const need = Math.max(0, (targetWords || 0) - have);
  const pad = need > 0
    ? `\n\nAdditional general notes:\n${buildContextPadding(need, { tokenCounter: counter, startIndex: options.startIndex })}`
    : '';
  return `Use the following thinking-skill guide to structure your reasoning. Apply it substantively; do not merely name it.\n\n=== THINKING SKILL ===\n${content}\n=== END SKILL ===${pad}\n\nNow address this problem:\n\n${problemText}\n\nThink carefully and give your best, decision-useful answer.`;
}

/** Stack N skill guides into one prompt (for the stacking experiment). */
function buildStackPrompt(contents, problemText, targetWords, options = {}) {
  const counter = typeof options.tokenCounter === 'function' ? options.tokenCounter : defaultTokenCounter;
  const joined = contents.map((c, i) => `=== THINKING SKILL ${i + 1} ===\n${c}`).join('\n\n');
  const have = counter(joined);
  const need = targetWords && targetWords > have ? targetWords - have : 0;
  const pad = need > 0
    ? `\n\nAdditional general notes:\n${buildContextPadding(need, { tokenCounter: counter, startIndex: options.startIndex })}`
    : '';
  return `Use the following thinking-skill guides TOGETHER to structure your reasoning. Apply them substantively and in combination; do not merely name them.\n\n${joined}\n=== END SKILLS ===${pad}\n\nNow address this problem:\n\n${problemText}\n\nThink carefully and give your best, decision-useful answer.`;
}

/** Convenience: production no-skill prompt. */
function buildNonePrompt(problemText, options = {}) {
  return buildConditionPrompt('none', problemText, null, null, options);
}

/** Convenience: equal-budget placebo sized to a reference text or explicit budget. */
function buildEqualBudgetPlaceboPrompt(problemText, referenceTextOrBudget, options = {}) {
  const counter = typeof options.tokenCounter === 'function' ? options.tokenCounter : defaultTokenCounter;
  const budget = typeof referenceTextOrBudget === 'number'
    ? referenceTextOrBudget
    : counter(referenceTextOrBudget || '');
  return buildConditionPrompt('equal_budget_placebo', problemText, null, null, {
    ...options,
    tokenBudget: budget,
    tokenCounter: counter,
  });
}

module.exports = {
  // Primary / new
  defaultTokenCounter,
  contextPaddingTokens,
  buildContextPadding,
  buildNonePrompt,
  buildEqualBudgetPlaceboPrompt,
  normalizeCondition,
  // Legacy + shared
  neutralFiller,
  triggerSummary,
  buildConditionPrompt,
  buildBalancedSkillPrompt,
  buildStackPrompt,
  wordCount,
  FILLER_SENTENCES,
};
