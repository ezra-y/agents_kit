'use strict';

/**
 * Generic blind pairwise engine.
 *
 * - Deterministic A/B arm order from a frozen seed (per item × trial).
 * - Fresh independent solve calls per arm (no conversation reuse).
 * - Panel judging via judge.js (injectable for fixtures/tests).
 * - Every attempted item/trial remains in denominators; failures are explicit.
 * - Item rows set completed / parsed_success / scored explicitly.
 */

const {
  sha256,
  itemKey,
  checkpointKey,
  observationCheckpointKey,
  failureRecord,
  createResultEnvelope,
  defaultUsage,
} = require('./result');

let _judgeModule;
function loadJudge() {
  if (!_judgeModule) _judgeModule = require('./judge');
  return _judgeModule;
}

/** Mulberry32 PRNG — deterministic, no deps. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedToUint32(seed) {
  if (Number.isInteger(seed) && seed >= 0) return seed >>> 0;
  const hex = sha256(String(seed)).slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

function unitSeed(parts) {
  return seedToUint32(sha256(parts.map(p => String(p)).join(':')));
}

/**
 * Deterministic presentation order for arms from a frozen seed.
 * Stable across processes; depends only on seed + itemId + trial + arm set.
 *
 * @param {string[]} armIds
 * @param {{seed:string|number, itemId:string, trial:number}} ctx
 * @returns {string[]} arm ids in A.. presentation order
 */
function deterministicArmOrder(armIds, ctx = {}) {
  if (!Array.isArray(armIds) || armIds.length === 0) {
    throw new TypeError('armIds must be a non-empty array');
  }
  const ids = armIds.map(String);
  const seed = ctx.seed == null ? 0 : ctx.seed;
  const itemId = ctx.itemId == null ? '' : String(ctx.itemId);
  const trial = Number.isInteger(ctx.trial) ? ctx.trial : 1;
  const rng = mulberry32(unitSeed([seed, itemId, trial, ids.slice().sort().join(',')]));
  // Canonicalize input order so callers' arm array order cannot change presentation.
  const out = ids.slice().sort();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
function emptyUsage() {
  return defaultUsage();
}

function mergeUsage(a, b) {
  const left = defaultUsage(a);
  const right = defaultUsage(b);
  return defaultUsage({
    input_tokens: left.input_tokens + right.input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    cached_tokens: left.cached_tokens + right.cached_tokens,
    calls: left.calls + right.calls,
    latency_ms: left.latency_ms + right.latency_ms,
    estimated_cost_usd: left.estimated_cost_usd + right.estimated_cost_usd,
  });
}

function normalizeSolveUsage(usage, durationMs) {
  if (!usage && durationMs == null) return emptyUsage();
  const u = usage || {};
  return defaultUsage({
    input_tokens: u.input_tokens || 0,
    output_tokens: u.output_tokens || 0,
    cached_tokens: u.cached_tokens || u.cache_read_tokens || 0,
    calls: u.calls != null ? u.calls : 1,
    latency_ms: u.latency_ms != null ? u.latency_ms : (durationMs || 0),
    estimated_cost_usd: u.estimated_cost_usd != null ? u.estimated_cost_usd : (u.est_cost_usd || 0),
  });
}

function normalizeJudgeUsage(panel) {
  let usage = emptyUsage();
  const voteUsages = panel && Array.isArray(panel.judge_usage) ? panel.judge_usage : [];
  if (voteUsages.length) {
    for (const u of voteUsages) {
      usage = mergeUsage(usage, {
        input_tokens: u.input_tokens || 0,
        output_tokens: u.output_tokens || 0,
        cached_tokens: u.cache_read_tokens || u.cached_tokens || 0,
        calls: 1,
        latency_ms: 0,
        estimated_cost_usd: u.est_cost_usd || u.estimated_cost_usd || 0,
      });
    }
  } else if (panel && Array.isArray(panel.votes)) {
    for (const v of panel.votes) {
      if (!v) continue;
      usage = mergeUsage(usage, normalizeSolveUsage(v.usage, v.durationMs));
    }
  }
  if (panel && panel.judge_durationMs) {
    usage = defaultUsage({ ...usage, latency_ms: usage.latency_ms + Number(panel.judge_durationMs || 0) });
  }
  if (usage.calls === 0 && panel && Array.isArray(panel.votes) && panel.votes.length) {
    usage = defaultUsage({ ...usage, calls: panel.votes.length });
  }
  return usage;
}

/** Map judge-layer failure labels onto result.FAILURE_TYPES. */
function coerceFailureType(type, fallback = 'scoring') {
  if (type === 'transport' || type === 'timeout' || type === 'tool_leakage' || type === 'parse' || type === 'scoring') {
    return type;
  }
  if (type === 'judge_unresolved' || type === 'unresolved') return 'scoring';
  return fallback;
}

/**
 * Normalize both legacy and contract-era panelJudge payloads.
 * Contract: unresolved never becomes a scored tie.
 */
function normalizePanelResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      winner: null,
      resolved: false,
      unresolved: true,
      tally: { A: 0, B: 0, tie: 0, missing: 0 },
      votes: [],
      failures: [],
      failure: failureRecord({ type: 'scoring', message: 'panelJudge returned no result' }),
      vocab_only: false,
      whys: [],
      judge_usage: [],
      judge_durationMs: 0,
    };
  }

  const votes = Array.isArray(raw.votes) ? raw.votes : [];
  const explicitUnresolved = raw.unresolved === true || raw.resolved === false;
  let winner = raw.winner == null ? null : String(raw.winner).trim();
  if (winner) {
    const upper = winner.toUpperCase();
    if (upper === 'A' || upper === 'B') winner = upper;
    else if (upper === 'TIE') winner = 'tie';
    else winner = null;
  }

  let unresolved = explicitUnresolved;
  if (raw.failure) unresolved = true;
  if (winner == null && !explicitUnresolved && raw.resolved !== true) unresolved = true;
  // Resolved substantive ties are allowed only when caller marks resolved=true.
  if (unresolved) winner = null;

  const tally = raw.tally && typeof raw.tally === 'object'
    ? {
        A: Number(raw.tally.A || 0),
        B: Number(raw.tally.B || 0),
        tie: Number(raw.tally.tie || 0),
        missing: Number(raw.tally.missing != null ? raw.tally.missing : 0),
      }
    : { A: 0, B: 0, tie: 0, missing: 0 };

  let failure = null;
  if (unresolved) {
    const src = raw.failure || {};
    failure = failureRecord({
      type: coerceFailureType(src.type, 'scoring'),
      message: src.message || 'unresolved panel judgment',
      details: src.details || { winner: raw.winner, tally, vote_count: votes.length },
    });
  }

  return {
    winner,
    resolved: !unresolved,
    unresolved,
    tally,
    votes,
    failures: Array.isArray(raw.failures) ? raw.failures : (failure ? [failure] : []),
    failure,
    vocab_only: !!raw.vocab_only,
    whys: Array.isArray(raw.whys) ? raw.whys : [],
    judge_usage: Array.isArray(raw.judge_usage) ? raw.judge_usage : [],
    judge_durationMs: Number(raw.judge_durationMs || 0),
  };
}

function requireFn(fn, name) {
  if (typeof fn !== 'function') throw new TypeError(`${name} must be a function`);
  return fn;
}

function armById(arms, id) {
  return arms.find(a => a && a.id === id) || null;
}

function defaultBuildJudgePrompt({ item, responseA, responseB }) {
  const problem = item.prompt || item.problem || item.text || '';
  return [
    'Two assistants answered the same problem. Judge which response reasons better.',
    'Return ONLY JSON: {"winner":"A"|"B"|"tie","margin":"slight","why":"...","skill_vocab_without_substance":false}',
    '',
    '=== PROBLEM ===',
    problem,
    '',
    '=== RESPONSE A ===',
    responseA,
    '',
    '=== RESPONSE B ===',
    responseB,
    '',
    '=== END ===',
  ].join('\n');
}

/**
 * Run pairwise comparisons over items × trials for a fixed arm pair.
 *
 * @param {object} opts
 * @returns {Promise<object>} result envelope
 */
async function runPairwiseItems(opts = {}) {
  const studyId = opts.studyId || opts.study_id;
  const studyVersion = opts.studyVersion || opts.study_version;
  const preregistrationSha256 = opts.preregistrationSha256 || opts.preregistration_sha256;
  if (!studyId || !studyVersion || !preregistrationSha256) {
    throw new TypeError('studyId, studyVersion, and preregistrationSha256 are required');
  }
  if (!opts.dataset || typeof opts.dataset !== 'object') throw new TypeError('dataset is required');
  if (!Array.isArray(opts.arms) || opts.arms.length < 2) throw new TypeError('arms must include at least two entries');
  if (!Array.isArray(opts.items)) throw new TypeError('items must be an array');
  if (!opts.solver || typeof (opts.solver.model || opts.solver) !== 'string') {
    throw new TypeError('solver.model is required');
  }

  const arms = opts.arms.map(a => ({
    id: a.id,
    prompt_sha256: a.prompt_sha256 || a.promptSha256 || null,
    skill_sha256: a.skill_sha256 != null ? a.skill_sha256 : (a.skillSha256 != null ? a.skillSha256 : null),
  }));
  const armIds = arms.map(a => a.id);
  const pair = opts.pair || { left: armIds[0], right: armIds[1] };
  if (!armById(arms, pair.left) || !armById(arms, pair.right)) {
    throw new TypeError(`pair arms must exist in arms: ${pair.left} vs ${pair.right}`);
  }
  if (pair.left === pair.right) throw new TypeError('pair.left and pair.right must differ');

  const solver = typeof opts.solver === 'string'
    ? { model: opts.solver, effort: opts.solverEffort || null }
    : { model: opts.solver.model, effort: opts.solver.effort != null ? opts.solver.effort : null };

  const judgeMod = loadJudge();
  const judgesInput = opts.judges != null
    ? opts.judges.map(j => (typeof j === 'string' ? j : j.model)).filter(Boolean)
    : (typeof judgeMod.panelModels === 'function' ? judgeMod.panelModels() : []);

  let judges = judgesInput;
  if (typeof judgeMod.judgesExcludingSolver === 'function') {
    const filtered = judgeMod.judgesExcludingSolver(solver.model, judgesInput);
    if (Array.isArray(filtered)) judges = filtered;
  }

  const trials = Number.isInteger(opts.trials) && opts.trials > 0 ? opts.trials : 1;
  const seed = opts.seed != null ? opts.seed : 0;
  const solve = requireFn(opts.solve, 'solve');
  const judgeFn = typeof opts.judge === 'function' ? opts.judge : judgeMod.panelJudge.bind(judgeMod);
  const buildPrompt = typeof opts.buildPrompt === 'function'
    ? opts.buildPrompt
    : ({ item, armId }) => {
        const text = item.prompt || item.problem || item.text || '';
        return `[arm=${armId}]\n\n${text}`;
      };
  const buildJudgePrompt = typeof opts.buildJudgePrompt === 'function'
    ? opts.buildJudgePrompt
    : defaultBuildJudgePrompt;

  const compatibilityKey = checkpointKey({
    studyId,
    studyVersion,
    datasetSha256: opts.dataset.sha256,
    promptSha256: sha256(arms.map(a => a.prompt_sha256 || null)),
    skillSha256: sha256(arms.map(a => a.skill_sha256 || null)),
    solver: solver.model,
    judges,
  });

  const itemsOut = [];
  const failures = [];
  let usage = emptyUsage();
  let completed = 0;
  let parsed = 0;
  let scored = 0;

  const panelEligible = judges.length >= 2;
  if (!panelEligible) {
    failures.push(failureRecord({
      type: 'scoring',
      message: `ineligible judge panel: need ≥2 independent judges, got ${judges.length}`,
      details: { judges, solver: solver.model },
    }));
  }

  for (const item of opts.items) {
    const itemId = String(item.id || item.item_id || '');
    if (!itemId) throw new TypeError('each item requires id');

    for (let trial = 1; trial <= trials; trial++) {
      const pairArmIds = [pair.left, pair.right];
      const order = deterministicArmOrder(pairArmIds, { seed, itemId, trial });
      const armA = order[0];
      const armB = order[1];
      const leftIsA = armA === pair.left;

      const responses = {};
      let solverOk = true;
      let rowUsage = emptyUsage();
      const observationKeys = {};

      // Fresh independent solves — never reuse a conversation between arms.
      for (const armId of pairArmIds) {
        const arm = armById(arms, armId);
        const obsKey = observationCheckpointKey({
          compatibilityKey,
          itemId,
          trial,
          armId,
        });
        observationKeys[armId] = obsKey;

        let prompt;
        try {
          prompt = await buildPrompt({ item, arm, trial, armId });
        } catch (err) {
          solverOk = false;
          const fail = failureRecord({
            type: 'parse',
            message: `buildPrompt failed: ${err && err.message ? err.message : err}`,
            itemId,
            armId,
            trial,
          });
          failures.push(fail);
          responses[armId] = {
            ok: false,
            completed: false,
            text: null,
            response_sha256: null,
            usage: emptyUsage(),
            failure: fail,
            observation_checkpoint_key: obsKey,
            attempts: 0,
          };
          continue;
        }

        let result;
        try {
          result = await solve({ item, arm, trial, armId, prompt });
        } catch (err) {
          result = {
            ok: false,
            text: null,
            failure: failureRecord({
              type: 'transport',
              message: `solve threw: ${err && err.message ? err.message : err}`,
              itemId,
              armId,
              trial,
            }),
          };
        }

        const ok = !!(result && result.ok);
        const text = result && result.text != null ? String(result.text) : null;
        const armUsage = normalizeSolveUsage(result && result.usage, result && result.durationMs);
        rowUsage = mergeUsage(rowUsage, armUsage);

        let failure = null;
        if (!ok) {
          solverOk = false;
          if (result && result.failure && result.failure.type) {
            failure = failureRecord({
              type: coerceFailureType(result.failure.type, 'transport'),
              message: result.failure.message || 'solver failure',
              itemId,
              armId,
              trial,
              attempt: result.attempts != null ? result.attempts : null,
              details: result.failure.details || null,
            });
          } else {
            failure = failureRecord({
              type: 'transport',
              message: (result && result.error) || 'solver failure',
              itemId,
              armId,
              trial,
              attempt: result && result.attempts != null ? result.attempts : null,
            });
          }
          failures.push(failure);
        }

        responses[armId] = {
          ok,
          completed: ok,
          text: ok ? text : null,
          response_sha256: ok && text != null ? sha256(text) : null,
          usage: armUsage,
          failure,
          observation_checkpoint_key: obsKey,
          attempts: result && result.attempts != null ? result.attempts : (ok ? 1 : 0),
        };
      }

      let panel = null;
      let winnerArm = null;
      let winnerLabel = null;
      let rowCompleted = false;
      let rowParsed = false;
      let rowScored = false;
      let rowFailure = null;
      let parsedValue = null;

      if (!panelEligible) {
        rowFailure = failureRecord({
          type: 'scoring',
          message: 'judge panel ineligible for solver family',
          itemId,
          trial,
          details: { judges, solver: solver.model },
        });
        // study-level failure already recorded once
      } else if (!solverOk) {
        rowCompleted = false;
        rowParsed = false;
        rowScored = false;
        rowFailure = failureRecord({
          type: 'transport',
          message: 'one or more arm solves failed; pair not judged',
          itemId,
          trial,
          details: {
            failed_arms: pairArmIds.filter(id => !responses[id].ok),
          },
        });
        // per-arm failures already recorded; do not double-count this summary row
      } else {
        rowCompleted = true;
        const responseA = responses[armA].text;
        const responseB = responses[armB].text;

        let rawPanel;
        let judgePrompt;
        try {
          judgePrompt = await buildJudgePrompt({
            item,
            responseA,
            responseB,
            order,
            pair,
            leftIsA,
            trial,
          });
        } catch (err) {
          rawPanel = {
            winner: null,
            unresolved: true,
            failure: {
              type: 'parse',
              message: `buildJudgePrompt failed: ${err && err.message ? err.message : err}`,
            },
            votes: [],
            tally: { A: 0, B: 0, tie: 0, missing: judges.length },
          };
        }

        if (!rawPanel) {
          try {
            rawPanel = await judgeFn(judgePrompt, judges);
          } catch (err) {
            rawPanel = {
              winner: null,
              unresolved: true,
              failure: {
                type: 'transport',
                message: `panelJudge threw: ${err && err.message ? err.message : err}`,
              },
              votes: [],
              tally: { A: 0, B: 0, tie: 0, missing: judges.length },
            };
          }
        }

        panel = normalizePanelResult(rawPanel);
        const judgeUsage = normalizeJudgeUsage(panel);
        rowUsage = mergeUsage(rowUsage, judgeUsage);

        if (panel.unresolved || !panel.resolved) {
          rowScored = false;
          // Valid parsed votes (e.g. A vs B disagreement) mean parsing succeeded;
          // only transport/parse/empty-panel failures leave parsed_success false.
          const hasValidVotes = (panel.votes || []).some(v => (
            v && (v.valid === true || v.winner === 'A' || v.winner === 'B' || v.winner === 'tie')
          ));
          const failType = coerceFailureType(panel.failure && panel.failure.type, 'scoring');
          const parseFailed = failType === 'transport' || failType === 'timeout'
            || failType === 'parse' || failType === 'tool_leakage';
          rowParsed = hasValidVotes && !parseFailed;
          rowFailure = failureRecord({
            type: failType,
            message: panel.failure ? panel.failure.message : 'unresolved panel judgment',
            itemId,
            trial,
            details: {
              tally: panel.tally,
              votes: panel.votes.map(v => ({
                model: v && v.model,
                winner: v && v.winner,
                valid: v && v.valid,
              })),
            },
          });
          failures.push(rowFailure);
          if (rowParsed) {
            parsedValue = {
              unresolved: true,
              tally: panel.tally,
              left_is_a: leftIsA,
              presentation: { A: armA, B: armB },
            };
          }
        } else {
          rowParsed = true;
          winnerLabel = panel.winner; // 'A' | 'B' | 'tie'
          if (winnerLabel === 'A') winnerArm = armA;
          else if (winnerLabel === 'B') winnerArm = armB;
          else if (winnerLabel === 'tie') winnerArm = 'tie';
          else {
            rowParsed = false;
            rowScored = false;
            rowFailure = failureRecord({
              type: 'scoring',
              message: `unexpected panel winner: ${winnerLabel}`,
              itemId,
              trial,
            });
            failures.push(rowFailure);
          }
          if (rowParsed) {
            rowScored = true;
            parsedValue = {
              winner_label: winnerLabel,
              winner_arm: winnerArm,
              left_is_a: leftIsA,
              presentation: { A: armA, B: armB },
            };
          }
        }
      }

      if (rowCompleted) completed += 1;
      if (rowParsed) parsed += 1;
      if (rowScored) scored += 1;
      usage = mergeUsage(usage, rowUsage);

      itemsOut.push({
        item_id: itemId,
        trial,
        pair: `${pair.left}:${pair.right}`,
        arm_order: order,
        left_is_a: leftIsA,
        presentation: { A: armA, B: armB },
        winner_arm: winnerArm,
        winner_label: winnerLabel,
        completed: rowCompleted,
        parsed_success: rowParsed,
        parsed: parsedValue,
        scored: rowScored,
        responses: Object.fromEntries(
          pairArmIds.map(id => [
            id,
            {
              ok: responses[id].ok,
              completed: responses[id].completed,
              response_sha256: responses[id].response_sha256,
              usage: responses[id].usage,
              failure: responses[id].failure,
              observation_checkpoint_key: responses[id].observation_checkpoint_key,
              attempts: responses[id].attempts,
              ...(opts.retainResponseText ? { text: responses[id].text } : {}),
            },
          ])
        ),
        judge: panel
          ? {
              winner: panel.winner,
              resolved: panel.resolved,
              unresolved: panel.unresolved,
              tally: panel.tally,
              votes: panel.votes,
              vocab_only: panel.vocab_only,
              whys: panel.whys,
            }
          : null,
        usage: rowUsage,
        failure: rowFailure,
        observation_checkpoint_keys: observationKeys,
        item_keys: {
          [pair.left]: itemKey({ studyId, itemId, trial, armId: pair.left }),
          [pair.right]: itemKey({ studyId, itemId, trial, armId: pair.right }),
        },
        compatibility_key: compatibilityKey,
      });
    }
  }

  const statistics = summarizePairwise(itemsOut, pair);
  const attempted = itemsOut.length;

  return createResultEnvelope({
    study_id: studyId,
    study_version: studyVersion,
    preregistration_sha256: preregistrationSha256,
    dataset: opts.dataset,
    arms,
    solver,
    judges,
    items: itemsOut,
    failures,
    usage,
    statistics,
    health: {
      attempted,
      completed,
      parsed,
      scored,
      failures: failures.length,
      decision_eligible: panelEligible
        && failures.length === 0
        && attempted === completed
        && completed === parsed
        && parsed === scored,
      panel_eligible: panelEligible,
      pair: `${pair.left}:${pair.right}`,
      seed,
      trials,
    },
    created_at: opts.createdAt || opts.created_at || new Date().toISOString(),
    checkpoint_key: compatibilityKey,
  });
}

/**
 * Summarize pairwise item rows into win/loss/tie counts for the left arm.
 * Intention-to-treat: primary `win_rate` uses the attempted denominator so
 * unresolved/failures cannot disappear. Judged-only rate is `conditional_win_rate`.
 *
 * @param {Array<object>} items
 * @param {{left:string,right:string}|null} pair
 */
function summarizePairwise(items, pair = null) {
  const rows = Array.isArray(items) ? items : [];
  let left = pair && pair.left;
  let right = pair && pair.right;
  if (!left || !right) {
    const first = rows.find(r => r && r.pair);
    if (first && typeof first.pair === 'string' && first.pair.includes(':')) {
      const [l, r] = first.pair.split(':');
      left = left || l;
      right = right || r;
    }
  }

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let unresolved = 0;
  let solver_failures = 0;
  let left_is_a_count = 0;
  let left_is_b_count = 0;

  for (const row of rows) {
    if (!row) continue;
    if (row.left_is_a === true) left_is_a_count += 1;
    else if (row.left_is_a === false) left_is_b_count += 1;

    if (!row.scored) {
      unresolved += 1;
      if (row.failure && (row.failure.type === 'transport' || row.failure.type === 'timeout' || row.failure.type === 'tool_leakage')) {
        solver_failures += 1;
      }
      continue;
    }
    if (row.winner_arm === 'tie' || row.winner_label === 'tie') {
      ties += 1;
    } else if (left && row.winner_arm === left) {
      wins += 1;
    } else if (right && row.winner_arm === right) {
      losses += 1;
    } else if (row.winner_label === 'A' && row.left_is_a) {
      wins += 1;
    } else if (row.winner_label === 'B' && row.left_is_a) {
      losses += 1;
    } else if (row.winner_label === 'A' && row.left_is_a === false) {
      losses += 1;
    } else if (row.winner_label === 'B' && row.left_is_a === false) {
      wins += 1;
    } else {
      unresolved += 1;
    }
  }

  const decisive = wins + losses;
  const judged = decisive + ties;
  const attempted = rows.length;
  // ITT: unresolved/failures remain in the primary denominator (count as non-wins).
  const winRateItt = attempted ? (wins + 0.5 * ties) / attempted : 0;
  const conditionalWinRate = judged ? (wins + 0.5 * ties) / judged : 0;

  let ci95 = [0, 1];
  let p_value = 1;
  try {
    const { summarize } = require('./stats');
    // Sign-test / Wilson stay on decisive judged outcomes; ITT rate is separate.
    const s = summarize(wins, losses, ties);
    ci95 = s.ci95;
    p_value = s.p_value;
  } catch (_) {
    // stats optional during partial foundation boots
  }

  return {
    pair: left && right ? `${left}:${right}` : null,
    left: left || null,
    right: right || null,
    attempted,
    judged,
    decisive,
    wins,
    losses,
    ties,
    unresolved,
    solver_failures,
    win_rate: +winRateItt.toFixed(6),
    conditional_win_rate: +conditionalWinRate.toFixed(6),
    lift: wins - losses,
    ci95,
    p_value,
    order_balance: {
      left_is_a: left_is_a_count,
      left_is_b: left_is_b_count,
    },
  };
}

module.exports = {
  deterministicArmOrder,
  runPairwiseItems,
  summarizePairwise,
  normalizePanelResult,
  mulberry32,
  seedToUint32,
};
