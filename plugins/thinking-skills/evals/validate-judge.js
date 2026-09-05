'use strict';

/**
 * Judge reliability validator — estimates inter-judge agreement (percent agreement
 * and Cohen's kappa) and detects format/length preference (a judge systematically
 * favoring longer/more-structured answers independent of substance).
 *
 * Exports:
 *   agreement(votes)       — pure function on offline vote fixtures
 *   biasDetection(votes, metadata) — pure function for format/length bias
 *   main()                 — CLI entry: runs panel judge and reports reliability
 *
 * With a single judge, agreement() reports it cannot estimate agreement.
 * With >=2 judges, agreement() returns percent agreement and pairwise Cohen's kappa.
 *
 * Uses lib/droid.js + lib/judge.js for the CLI path; pure functions require no
 * model calls and are verifiable on deterministic fixtures.
 */

const { panelJudge, panelModels } = require('./lib/judge');

// ─── agreement(): pure, verifiable on offline vote fixtures ──────────────

/**
 * Compute inter-judge agreement from pre-recorded votes.
 *
 * @param {Array<Object>} votes - Array of vote objects, each mapping judge name → vote.
 *   Example: [{A:'A',B:'A'}, {A:'B',B:'B'}, {A:'A',B:'B'}] for 2 judges over 3 pairs.
 * @param {Object} [opts]
 * @param {string} [opts.method='pairwise'] - 'pairwise' for average pairwise agreement/kappa.
 * @returns {{
 *   n_judges: number,
 *   n_pairs: number,
 *   percent?: number,        // percent agreement (omit if single judge)
 *   kappa?: number,          // Cohen's kappa (omit if single judge)
 *   singleJudge?: boolean,   // true if only one judge
 *   error?: string,          // explanation when agreement cannot be estimated
 *   judge_names: string[],
 *   pair_agreements?: number[],  // per-pair agreement flags
 * }}
 */
function agreement(votes, opts = {}) {
  if (!votes || votes.length === 0) {
    return { n_judges: 0, n_pairs: 0, error: 'no vote data', judge_names: [] };
  }

  // Discover judges from the first vote object
  const judgeNames = Object.keys(votes[0]).sort();
  const nJudges = judgeNames.length;
  const nPairs = votes.length;

  if (nJudges < 2) {
    return {
      n_judges: nJudges,
      n_pairs: nPairs,
      singleJudge: true,
      error: 'cannot estimate inter-judge agreement with only one judge; need >=2 judges',
      judge_names: judgeNames,
    };
  }

  // For 2 judges: simple pairwise
  if (nJudges === 2) {
    const [j0, j1] = judgeNames;
    let agreements = 0;
    const pairAgreements = [];
    // Build confusion / contingency table for kappa
    // Categories are the unique vote values observed
    const catSet = new Set();
    for (const v of votes) {
      if (v[j0] != null) catSet.add(v[j0]);
      if (v[j1] != null) catSet.add(v[j1]);
    }
    const cats = [...catSet];

    // Contingency table: judge0 rows, judge1 cols
    const table = {};
    for (const c0 of cats) {
      table[c0] = {};
      for (const c1 of cats) table[c0][c1] = 0;
    }

    for (const v of votes) {
      const a = v[j0];
      const b = v[j1];
      if (a != null && b != null) {
        if (a === b) agreements++;
        pairAgreements.push(a === b ? 1 : 0);
        if (table[a] && table[a][b] !== undefined) {
          table[a][b]++;
        }
      }
    }

    const validPairs = pairAgreements.length;
    const percent = validPairs > 0 ? agreements / validPairs : 0;

    // Cohen's kappa for 2 raters
    // Po = observed agreement proportion
    // Pe = sum over categories of (P(cat for judge0) * P(cat for judge1))
    let po = percent;
    let pe = 0;
    for (const c0 of cats) {
      const rowSum = Object.values(table[c0] || {}).reduce((a, b) => a + b, 0);
      let colSum = 0;
      for (const c1 of cats) {
        const tRow = table[c1] || {};
        colSum += (tRow[c0] || 0);
      }
      if (validPairs > 0) {
        pe += (rowSum / validPairs) * (colSum / validPairs);
      }
    }

    let kappa;
    if (Math.abs(1 - pe) < 1e-12) {
      kappa = po >= 0.999 ? 1.0 : 0.0;
    } else {
      kappa = (po - pe) / (1 - pe);
    }

    return {
      n_judges: nJudges,
      n_pairs: validPairs,
      percent: +percent.toFixed(6),
      kappa: +kappa.toFixed(6),
      judge_names: judgeNames,
      pair_agreements: pairAgreements,
    };
  }

  // >2 judges: pairwise average
  let totalAgreements = 0;
  let totalPairs = 0;
  const pairKappas = [];
  const pairAgreements = [];

  // For each pair of judges, compute agreement and kappa
  for (let i = 0; i < nJudges; i++) {
    for (let j = i + 1; j < nJudges; j++) {
      const subVotes = votes.map(v => {
        const obj = {};
        obj.A = v[judgeNames[i]];
        obj.B = v[judgeNames[j]];
        return obj;
      });
      const sub = agreement(subVotes);
      if (sub.percent !== undefined && sub.kappa !== undefined) {
        totalAgreements += sub.percent * sub.n_pairs;
        totalPairs += sub.n_pairs;
        pairKappas.push(sub.kappa);
        if (i === 0 && j === 1) {
          // Use first pair's per-pair agreements as representative
          for (const a of (sub.pair_agreements || [])) pairAgreements.push(a);
        }
      }
    }
  }

  const avgPercent = totalPairs > 0 ? totalAgreements / totalPairs : 0;
  const avgKappa = pairKappas.length > 0
    ? pairKappas.reduce((a, b) => a + b, 0) / pairKappas.length
    : 0;

  return {
    n_judges: nJudges,
    n_pairs: nPairs,
    percent: +avgPercent.toFixed(6),
    kappa: +avgKappa.toFixed(6),
    judge_names: judgeNames,
    pair_agreements: pairAgreements.length > 0 ? pairAgreements : undefined,
    pairwise_kappas: pairKappas.length > 0 ? pairKappas : undefined,
  };
}

// ─── biasDetection(): format/length preference ───────────────────────────

/**
 * Detect format/length preference in judge votes.
 *
 * Given vote records and optional per-pair metadata about answer characteristics
 * (length, structure), checks whether each judge systematically favors the
 * longer or more-structured answer independent of substance.
 *
 * @param {Array<Object>} votes - Array of vote objects mapping judge → 'A'|'B'|'tie'.
 * @param {Object|null} metadata - { lengths: Array<{A:number, B:number}> } or null.
 *   Each entry gives the character/word length of answer A and answer B for that pair.
 *   Also accepts: { structures: Array<{A:string, B:string}> } for format preference.
 * @returns {{
 *   perJudge: Object<string, {lengthBias: number|null, nLengthPairs: number,
 *     pickedLonger: number, formatBias: number|null}>,
 *   format_preference?: number,   // aggregate signal: max length bias across judges
 *   length_bias?: number,         // alias for format_preference
 *   note?: string
 * }}
 */
function biasDetection(votes, metadata) {
  if (!votes || votes.length === 0) {
    return { perJudge: {}, format_preference: 0, length_bias: 0, note: 'no vote data' };
  }

  const judgeNames = Object.keys(votes[0]).sort();
  const perJudge = {};
  let maxLengthBias = 0;

  const lengths = metadata && metadata.lengths ? metadata.lengths : null;

  for (const judge of judgeNames) {
    let pickedLonger = 0;
    let nLengthPairs = 0;
    let formatBias = null;

    if (lengths && lengths.length === votes.length) {
      for (let i = 0; i < votes.length; i++) {
        const vote = votes[i][judge];
        const len = lengths[i];
        if (vote == null || len == null) continue;
        // Only consider pairs where lengths differ meaningfully (>10% difference)
        const lenA = len.A || 0;
        const lenB = len.B || 0;
        if (Math.abs(lenA - lenB) / Math.max(lenA, lenB, 1) < 0.1) continue;
        nLengthPairs++;
        if (lenB > lenA && vote === 'B') pickedLonger++;
        else if (lenA > lenB && vote === 'A') pickedLonger++;
      }
    }

    const lengthBias = nLengthPairs > 0
      ? +(pickedLonger / nLengthPairs).toFixed(6)
      : null;

    if (lengthBias !== null && lengthBias > maxLengthBias) {
      maxLengthBias = lengthBias;
    }

    perJudge[judge] = {
      lengthBias,
      nLengthPairs,
      pickedLonger,
      formatBias,
    };
  }

  // Aggregate signal: the maximum length bias across judges.
  // Values > 0.7 suggest a strong systematic preference for longer answers.
  const formatPreference = Object.keys(perJudge).length > 0 ? maxLengthBias : 0;

  return {
    perJudge,
    format_preference: formatPreference,
    length_bias: formatPreference,
    note: lengths ? null : 'no length metadata provided; supply {lengths:[{A:N,B:N},...]} for length-bias detection',
  };
}

// ─── CLI: droid-based judge reliability run ──────────────────────────────

/**
 * Run a judge reliability evaluation using live droid judges.
 * Compares >=2 judge models on a set of paired comparison prompts.
 *
 * Environment:
 *   JUDGES         - comma-separated judge models (default: gemini-3.1-pro-preview)
 *   SOLVER_MODEL   - solver model producing the answers to judge
 *   LIMIT          - max pairs to evaluate (default: 10)
 *   JUDGE_PROMPTS  - path to JSON file with pre-built judge prompts
 *
 * If only one judge is configured, the run reports inability to estimate agreement.
 */
async function main() {
  const judges = panelModels();
  const limit = parseInt(process.env.LIMIT || '10', 10);

  console.log('=== Judge Reliability Validator ===');
  console.log(`Judges: ${judges.join(', ')} (${judges.length} model${judges.length !== 1 ? 's' : ''})`);
  console.log(`Limit: ${limit} pairs`);
  console.log('');

  if (judges.length < 2) {
    console.log('⚠️  WARNING: Only one judge configured. Cannot estimate inter-judge agreement.');
    console.log('   Set JUDGES=model1,model2,... to enable agreement estimation.');
  }

  // Collect votes by running the panel judge on test prompts
  const votes = [];
  const lengthMetadata = [];

  // Build a simple set of test prompts if none provided
  let prompts;
  const promptFile = process.env.JUDGE_PROMPTS;
  if (promptFile) {
    const fs = require('fs');
    prompts = JSON.parse(fs.readFileSync(promptFile, 'utf8'));
  } else {
    // Default prompts: simple paired comparisons
    prompts = Array.from({ length: limit }, (_, i) => ({
      id: `pair-${i + 1}`,
      prompt: `You are a judge evaluating two answers to the question: "Explain the concept of opportunity cost."

Answer A: Opportunity cost is the value of the next best alternative foregone when making a choice.

Answer B: Opportunity cost represents the potential benefits an individual, investor, or business misses out on when choosing one alternative over another. It is a fundamental concept in economics and decision theory, highlighting the trade-offs inherent in every decision. By considering what must be given up, decision-makers can better evaluate the true cost of their choices.

Which answer is better? Respond with {"winner":"A"} or {"winner":"B"} and a brief "why".`,
    }));
  }

  console.log(`Running ${Math.min(limit, prompts.length)} judge prompts...`);

  for (let i = 0; i < Math.min(limit, prompts.length); i++) {
    const p = prompts[i];
    try {
      const result = await panelJudge(p.prompt, judges);
      const voteEntry = {};
      for (const v of result.votes) {
        voteEntry[v.model] = v.winner || 'tie';
      }
      votes.push(voteEntry);

      // Estimate lengths for bias detection (word count approximation)
      // Extract answer A and B from the prompt if possible
      const aMatch = p.prompt.match(/Answer A[:\s]*(.+?)(?=Answer B|$)/s);
      const bMatch = p.prompt.match(/Answer B[:\s]*(.+?)(?=$)/s);
      lengthMetadata.push({
        A: aMatch ? aMatch[1].trim().split(/\s+/).length : 0,
        B: bMatch ? bMatch[1].trim().split(/\s+/).length : 0,
      });

      if ((i + 1) % 5 === 0 || i === Math.min(limit, prompts.length) - 1) {
        console.log(`  ... ${i + 1}/${Math.min(limit, prompts.length)} pairs judged`);
      }
    } catch (err) {
      console.error(`  ✗ pair ${i + 1} failed: ${err.message}`);
    }
  }

  console.log('');

  // Compute agreement
  const agreeResult = agreement(votes);
  console.log('--- Inter-Judge Agreement ---');
  if (agreeResult.singleJudge) {
    console.log(`  Status: ${agreeResult.error}`);
  } else {
    console.log(`  Percent Agreement: ${(agreeResult.percent * 100).toFixed(1)}%`);
    console.log(`  Cohen's Kappa:     ${agreeResult.kappa.toFixed(4)}`);
    console.log(`  Pairs Evaluated:   ${agreeResult.n_pairs}`);
    console.log(`  Judges:            ${agreeResult.judge_names.join(', ')}`);

    // Interpret kappa
    let interpretation;
    const k = agreeResult.kappa;
    if (k < 0) interpretation = 'less than chance agreement';
    else if (k < 0.20) interpretation = 'slight agreement';
    else if (k < 0.40) interpretation = 'fair agreement';
    else if (k < 0.60) interpretation = 'moderate agreement';
    else if (k < 0.80) interpretation = 'substantial agreement';
    else interpretation = 'almost perfect agreement';
    console.log(`  Interpretation:    ${interpretation}`);
  }

  console.log('');

  // Compute bias detection
  const biasResult = biasDetection(votes, { lengths: lengthMetadata });
  console.log('--- Format/Length Preference ---');
  const hasBiasData = biasResult.note === null || !biasResult.note.includes('no length metadata');
  if (!hasBiasData) {
    console.log(`  ${biasResult.note}`);
  } else {
    for (const [judge, info] of Object.entries(biasResult.perJudge)) {
      const biasStr = info.lengthBias !== null
        ? `${(info.lengthBias * 100).toFixed(0)}% (${info.pickedLonger}/${info.nLengthPairs} length-differing pairs)`
        : 'no length-differing pairs';
      const flag = info.lengthBias !== null && (info.lengthBias > 0.7 || info.lengthBias < 0.3)
        ? ' ⚠️ BIAS DETECTED'
        : '';
      console.log(`  ${judge}: length-bias = ${biasStr}${flag}`);
    }
    const maxBias = biasResult.format_preference;
    if (maxBias > 0.7 || maxBias < 0.3) {
      console.log(`  ⚠️  Format/length preference signal: ${(maxBias * 100).toFixed(0)}% toward longer answers`);
      console.log(`      One or more judges may be favoring longer/more-structured answers over substance.`);
    }
  }

  // Write results if EVAL_RUN is set
  const runId = process.env.EVAL_RUN;
  if (runId) {
    const path = require('path');
    const { runDir, writeJson } = require('./lib/io');
    const dir = runDir();
    const output = {
      config: { judges, limit },
      agreement: agreeResult,
      bias: biasResult,
      votes,
      lengths: lengthMetadata,
      runId,
      timestamp: new Date().toISOString(),
    };
    // writeJson(file, obj) — single path argument (not dir, name, obj)
    const outPath = path.join(dir, `judge-reliability-${runId}.json`);
    writeJson(outPath, output);
    console.log(`\nResults written to: ${outPath}`);
  }
}

module.exports = { agreement, biasDetection, main };

// Run as CLI if invoked directly
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
