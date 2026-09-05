'use strict';

/**
 * Pairwise judging across a fixed three-family panel.
 * Failed votes are missing (never silent ties). Two matching valid A/B/tie votes
 * decide; otherwise the panel is unresolved failure.
 *
 * Production panel is frozen. Fixture injection uses the explicit `judges`
 * argument to panelJudge / judgesExcludingSolver — env vars do not override.
 */

const { droidJsonAsync, usageSummary } = require('./droid');

/** Frozen cross-family panel — one vote each. */
const DEFAULT_PANEL_MODELS = Object.freeze([
  'gpt-5.5-pro',
  'gemini-3.1-pro-preview',
  'deepseek-v4-pro',
]);
const FROZEN_PANEL = DEFAULT_PANEL_MODELS;

/**
 * Approved judge-calibration gates (Phase 1D).
 * Unmet gate → judged studies ineligible / skills manual-only.
 */
const JUDGE_CALIBRATION_THRESHOLDS = Object.freeze({
  panel_majority_accuracy_min: 0.85,
  per_judge_accuracy_min: 0.75,
  fleiss_kappa_min: 0.60,
  order_effect_delta_max_pp: 5,
  verbosity_effect_delta_max_pp: 5,
  missing_vote_rate_max: 0.01,
  min_calibration_pairs: 30,
});

/** Always the frozen three-family panel. Override only via explicit judges args. */
function panelModels() {
  return [...DEFAULT_PANEL_MODELS];
}

/**
 * Normalize a parsed judge winner. Only A/B/tie are valid labels.
 * Null/undefined/empty → null (missing), not 'tie'.
 * Pass { missingAsTie: true } only for legacy adapters that need the old behavior.
 */
function normalizeJudgeWinner(winner, { missingAsTie = false } = {}) {
  if (winner == null || winner === '') {
    return missingAsTie ? 'tie' : null;
  }
  const value = String(winner).trim().toUpperCase();
  if (value === 'A' || value === 'B') return value;
  if (value === 'TIE' || value === 'DRAW') return 'tie';
  return missingAsTie ? 'tie' : null;
}

/**
 * Tally votes. Failed/missing winners stay in `missing` — never counted as ties.
 * Valid explicit `tie` votes still count under `tie`.
 * @returns {{A:number,B:number,tie:number,missing:number}}
 */
function tallyJudgeVotes(votes) {
  const tally = { A: 0, B: 0, tie: 0, missing: 0 };
  for (const v of votes) {
    if (!v || v.valid === false) {
      tally.missing++;
      continue;
    }
    if (v.winner == null || v.winner === '') {
      tally.missing++;
      continue;
    }
    const w = normalizeJudgeWinner(v.winner);
    if (w == null) tally.missing++;
    else tally[w]++;
  }
  return tally;
}

/**
 * Panel decision from tallied valid votes.
 * Two matching valid A, B, or explicit tie votes decide.
 * Missing votes never create a silent tie; <2 matching valid votes → unresolved.
 */
function decidePanelWinner(tally) {
  if (tally.A >= 2 && tally.A > tally.B && tally.A > tally.tie) {
    return { winner: 'A', resolved: true, unresolved: false, failure: null };
  }
  if (tally.B >= 2 && tally.B > tally.A && tally.B > tally.tie) {
    return { winner: 'B', resolved: true, unresolved: false, failure: null };
  }
  if (tally.tie >= 2 && tally.tie > tally.A && tally.tie > tally.B) {
    return { winner: 'tie', resolved: true, unresolved: false, failure: null };
  }
  return {
    winner: null,
    resolved: false,
    unresolved: true,
    failure: {
      type: 'judge_unresolved',
      message: 'Fewer than two matching valid votes (failed votes are missing, not ties)',
    },
  };
}

/**
 * Run the panel. Vote transport/parse failures are recorded as missing votes.
 * @param {string} judgePromptFor
 * @param {string[]} [judges] explicit panel (fixtures); defaults to frozen panel
 * @returns {Promise<{winner:'A'|'B'|'tie'|null, resolved:boolean, unresolved:boolean, failure:object|null, tally:object, votes:Array, failures:Array}>}
 */
async function panelJudge(judgePromptFor, judges = panelModels()) {
  const panel = judges || [];
  const votes = await Promise.all(panel.map(async model => {
    try {
      const r = await droidJsonAsync({ model, prompt: judgePromptFor });
      if (!r.ok || !r.json) {
        return {
          model,
          winner: null,
          valid: false,
          failure: {
            type: r && r.error && /timeout/i.test(String(r.error)) ? 'timeout' : 'parse',
            message: (r && r.error) || 'judge response missing or unparseable',
          },
          usage: r && r.usage || null,
          durationMs: r && r.durationMs || null,
        };
      }
      const winner = normalizeJudgeWinner(r.json.winner);
      if (winner == null) {
        return {
          model,
          winner: null,
          valid: false,
          failure: { type: 'parse', message: `invalid winner label: ${r.json.winner}` },
          margin: r.json.margin,
          why: r.json.why,
          vocab_only: !!r.json.skill_vocab_without_substance,
          usage: r.usage || null,
          durationMs: r.durationMs || null,
        };
      }
      return {
        model,
        winner,
        valid: true,
        failure: null,
        margin: r.json.margin,
        why: r.json.why,
        vocab_only: !!r.json.skill_vocab_without_substance,
        usage: r.usage || null,
        durationMs: r.durationMs || null,
      };
    } catch (err) {
      return {
        model,
        winner: null,
        valid: false,
        failure: { type: 'transport', message: String(err && err.message || err) },
        usage: null,
        durationMs: null,
      };
    }
  }));

  const tally = tallyJudgeVotes(votes);
  const decision = decidePanelWinner(tally);
  const failures = votes
    .filter(v => v.failure)
    .map(v => ({ model: v.model, ...v.failure }));
  const vocabVotes = votes.filter(v => v.valid && v.vocab_only).length;
  const validCount = votes.filter(v => v.valid).length;
  const judge_usage = votes.map(v => (v.usage ? usageSummary(v.usage, v.model) : null)).filter(Boolean);
  const judge_durationMs = votes.reduce((a, v) => a + (v.durationMs || 0), 0);

  let failure = decision.failure;
  if (!failure && panel.length < 2) {
    failure = { type: 'judge_unresolved', message: 'panel has fewer than 2 judges' };
  }

  return {
    winner: decision.winner,
    resolved: decision.resolved && !failure,
    unresolved: !!(decision.unresolved || failure),
    failure,
    tally,
    votes,
    failures,
    valid_votes: validCount,
    vocab_only: validCount > 0 && vocabVotes > validCount / 2,
    whys: votes.map(v => v.why).filter(Boolean),
    judge_usage,
    judge_durationMs,
  };
}

/**
 * Families: claude, gpt, gemini, deepseek, grok, glm
 */
function modelFamily(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('claude') || m.includes('sonnet') || m.includes('opus') || m.includes('haiku')) return 'claude';
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'gpt';
  if (m.includes('gemini') || m.includes('google')) return 'gemini';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('grok')) return 'grok';
  if (m.includes('glm')) return 'glm';
  return 'unknown';
}

/**
 * Judges excluding the solver's model family.
 * Strict: never falls back to same-family judges.
 * Returns [] unless ≥2 distinct non-unknown independent families remain.
 */
function judgesExcludingSolver(solverModel, allJudges = panelModels()) {
  const solverFamily = modelFamily(solverModel);
  const filtered = (allJudges || []).filter(j => modelFamily(j) !== solverFamily);
  const families = new Set(
    filtered
      .map(j => modelFamily(j))
      .filter(f => f && f !== 'unknown')
  );
  if (families.size < 2) return [];
  return filtered;
}

/**
 * Evaluate calibration metrics against frozen thresholds.
 * Requires n_pairs >= min and one valid accuracy per frozen panel model.
 */
function evaluateJudgeCalibration(metrics = {}) {
  const t = JUDGE_CALIBRATION_THRESHOLDS;
  const failures = [];
  const requiredPanel = [...DEFAULT_PANEL_MODELS];

  const nPairs = metrics.n_pairs;
  if (!(nPairs >= t.min_calibration_pairs)) {
    failures.push({
      gate: 'min_calibration_pairs',
      required: t.min_calibration_pairs,
      observed: nPairs == null ? null : nPairs,
      message: nPairs == null ? 'n_pairs missing' : 'n_pairs below minimum',
    });
  }

  const panelAcc = metrics.panel_majority_accuracy;
  if (!(panelAcc >= t.panel_majority_accuracy_min)) {
    failures.push({
      gate: 'panel_majority_accuracy',
      required: t.panel_majority_accuracy_min,
      observed: panelAcc,
    });
  }

  let perJudgeMap = null;
  const rawPer = metrics.per_judge_accuracy;
  if (rawPer && !Array.isArray(rawPer) && typeof rawPer === 'object') {
    perJudgeMap = rawPer;
  } else if (Array.isArray(rawPer)) {
    perJudgeMap = {};
    requiredPanel.forEach((model, i) => {
      if (i < rawPer.length) perJudgeMap[model] = rawPer[i];
    });
  }

  if (!perJudgeMap) {
    failures.push({
      gate: 'per_judge_accuracy',
      required: t.per_judge_accuracy_min,
      observed: null,
      message: 'per_judge_accuracy missing; need one score per frozen panel model',
    });
  } else {
    for (const model of requiredPanel) {
      const fam = modelFamily(model);
      const acc = perJudgeMap[model] != null ? perJudgeMap[model]
        : (perJudgeMap[fam] != null ? perJudgeMap[fam] : undefined);
      if (!(acc >= t.per_judge_accuracy_min)) {
        failures.push({
          gate: 'per_judge_accuracy',
          judge: model,
          required: t.per_judge_accuracy_min,
          observed: acc == null ? null : acc,
          message: acc == null ? `missing accuracy for ${model}` : `accuracy below threshold for ${model}`,
        });
      }
    }
  }

  if (!(metrics.fleiss_kappa >= t.fleiss_kappa_min)) {
    failures.push({
      gate: 'fleiss_kappa',
      required: t.fleiss_kappa_min,
      observed: metrics.fleiss_kappa,
    });
  }

  const orderAbs = Math.abs(metrics.order_effect_delta_pp == null ? Infinity : metrics.order_effect_delta_pp);
  if (!(orderAbs <= t.order_effect_delta_max_pp)) {
    failures.push({
      gate: 'order_effect_delta_pp',
      required_abs_max: t.order_effect_delta_max_pp,
      observed: metrics.order_effect_delta_pp,
    });
  }

  const verbAbs = Math.abs(metrics.verbosity_effect_delta_pp == null ? Infinity : metrics.verbosity_effect_delta_pp);
  if (!(verbAbs <= t.verbosity_effect_delta_max_pp)) {
    failures.push({
      gate: 'verbosity_effect_delta_pp',
      required_abs_max: t.verbosity_effect_delta_max_pp,
      observed: metrics.verbosity_effect_delta_pp,
    });
  }

  if (!(metrics.missing_vote_rate <= t.missing_vote_rate_max)) {
    failures.push({
      gate: 'missing_vote_rate',
      required_max: t.missing_vote_rate_max,
      observed: metrics.missing_vote_rate,
    });
  }

  return {
    ok: failures.length === 0,
    eligible: failures.length === 0,
    thresholds: { ...t },
    required_panel: requiredPanel,
    failures,
    metrics,
  };
}

module.exports = {
  DEFAULT_PANEL_MODELS,
  FROZEN_PANEL,
  JUDGE_CALIBRATION_THRESHOLDS,
  panelModels,
  panelJudge,
  normalizeJudgeWinner,
  tallyJudgeVotes,
  decidePanelWinner,
  modelFamily,
  judgesExcludingSolver,
  evaluateJudgeCalibration,
};
