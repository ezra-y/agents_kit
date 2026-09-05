'use strict';

/** Significance helpers shared by all eval runners. No deps. */

function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normCdf = z => 0.5 * (1 + erf(z / Math.SQRT2));

/** Log gamma function (Lanczos approximation) for exact binomial / mid-p calculations. */
function lgamma(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Exact log binomial coefficient: ln(C(n,k)) = lgamma(n+1) - lgamma(k+1) - lgamma(n-k+1). */
function lnBinom(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

/** Exact two-sided binomial p-value vs p=0.5 (sum of probabilities <= observed). */
function binomExactTwoSided(k, n) {
  const logPmf = i => lnBinom(n, i) - n * Math.LN2;
  const target = logPmf(k);
  let p = 0;
  for (let i = 0; i <= n; i++) if (logPmf(i) <= target + 1e-12) p += Math.exp(logPmf(i));
  return Math.min(1, p);
}

/** Mid-p McNemar: exact two-sided p minus half the probability of the observed outcome(s). */
function mcnemarMidp(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.max(b, c);
  const logPmf = i => lnBinom(n, i) - n * Math.LN2;
  const logPobs = logPmf(k);
  let exact = 0;
  for (let i = 0; i <= n; i++) {
    const lp = logPmf(i);
    if (lp <= logPobs + 1e-12) exact += Math.exp(lp);
  }
  // mid-p = exact - 0.5 * P(observed outcome(s))
  // Observed outcomes are k and n-k (if distinct)
  const pObs = Math.exp(logPobs);
  const pOther = (k !== n - k) ? Math.exp(logPmf(n - k)) : 0;
  const midp = exact - 0.5 * (pObs + pOther);
  return Math.min(1, midp);
}

/** Returns both continuity-corrected McNemar (legacy scalar) AND mid-p.
 *  Also exposes validation-compatible aliases cc (=continuityCorrected) and
 *  midp (=midP) to satisfy VAL-HARNESS-005/006 probes. */
function mcnemarFull(b, c) {
  const n = b + c;
  if (n === 0) return { continuityCorrected: 1, midP: 1, cc: 1, midp: 1 };
  const chi = Math.pow(Math.abs(b - c) - 1, 2) / n;
  const continuityCorrected = Math.min(1, 2 * (1 - normCdf(Math.sqrt(chi))));
  const midP = mcnemarMidp(b, c);
  return { continuityCorrected, midP, cc: continuityCorrected, midp: midP };
}

/** Wilson score interval for a binomial proportion. */
function wilson(k, n, z = 1.959964) {
  if (n === 0) return [0, 1];
  const p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}

/** Two-sided sign test (normal approx + continuity correction) for k successes of n vs p=0.5. */
function signTest(k, n) {
  if (n === 0) return 1;
  const z = (Math.abs(k - n / 2) - 0.5) / (0.5 * Math.sqrt(n));
  return Math.min(1, 2 * (1 - normCdf(z)));
}

/** McNemar test for paired binary outcomes: b = treatment-only successes, c = control-only successes. */
function mcnemar(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const chi = Math.pow(Math.abs(b - c) - 1, 2) / n; // continuity-corrected
  // p from chi-square(1) = 2*(1-Phi(sqrt(chi)))
  return Math.min(1, 2 * (1 - normCdf(Math.sqrt(chi))));
}

/**
 * Paired difference statistics for paired binary/continuous arrays.
 * Returns { mean_diff, ci95: [lo, hi], correlation }.
 * Uses normal approximation CI for mean difference (paired t-like with z=1.96).
 * Correlation is Pearson's r between treatment and control.
 */
function pairedDiff(treatment, control) {
  if (!treatment || !control || treatment.length !== control.length || treatment.length === 0) {
    return { mean_diff: 0, ci95: [0, 0], correlation: 1 };
  }
  const n = treatment.length;
  const diffs = treatment.map((t, i) => t - control[i]);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / n;
  // Standard error of mean difference
  const varDiff = diffs.reduce((s, d) => s + (d - meanDiff) ** 2, 0) / (n - 1 || 1);
  const se = Math.sqrt(varDiff / n);
  const z = 1.959964; // 95% CI
  const ci = [meanDiff - z * se, meanDiff + z * se];
  // Pearson correlation between treatment and control
  const meanT = treatment.reduce((a, b) => a + b, 0) / n;
  const meanC = control.reduce((a, b) => a + b, 0) / n;
  let cov = 0, varT = 0, varC = 0;
  for (let i = 0; i < n; i++) {
    const dt = treatment[i] - meanT;
    const dc = control[i] - meanC;
    cov += dt * dc;
    varT += dt * dt;
    varC += dc * dc;
  }
  const correlation = (varT > 0 && varC > 0) ? cov / Math.sqrt(varT * varC) : 1;
  return { mean_diff: meanDiff, ci95: ci, correlation };
}

/**
 * Summarize win/loss/tie counts.
 * Legacy field `powered` is retained for callers but is ALWAYS false unless an
 * explicit power config validates decision eligibility — simple CI exclusion of
 * 0.5 is no longer treated as powered.
 */
function summarize(wins, losses, ties = 0, powerConfig = null) {
  const decisive = wins + losses;
  const n = decisive + ties;
  const winRate = n ? (wins + 0.5 * ties) / n : 0;
  const ci = wilson(wins, decisive || 1);
  const p = signTest(wins, decisive);
  const ciExcludesNull = ci[0] > 0.5 || ci[1] < 0.5;
  let decision_eligible = false;
  let powered = false;
  if (powerConfig) {
    const v = validatePowerConfig(powerConfig);
    decision_eligible = v.ok && !!powerConfig.achieved_power_ok;
    powered = decision_eligible;
  }
  return {
    wins, losses, ties, n, decisive,
    win_rate: +winRate.toFixed(3),
    ci95: [+ci[0].toFixed(3), +ci[1].toFixed(3)],
    p_value: +p.toFixed(3),
    significant: p < 0.05,
    // Legacy field retained; no longer means "CI excludes 0.5".
    powered,
    ci_excludes_null: ciExcludesNull,
    decision_eligible,
  };
}

/**
 * Distractor-aware scoring for routing/behavioral items carrying a `target` boolean flag.
 * Items are objects with { target: boolean, fired: boolean }.
 *   target=true  -> in-domain item (should fire)
 *   target=false -> off-target distractor (should NOT fire)
 *   fired=true   -> the router/behavioral model chose to invoke/fire
 *
 * Reports:
 *   fpr (false positive rate) = FP / (FP + TN) = fires on off-target / all off-target
 *   fnr (false negative rate) = FN / (TP + FN) = misses on target / all target
 *   net_utility = (TP - FP) / N  (positive for correct fires, negative for wrong fires)
 * Also returns raw counts for transparency.
 */
function scoreDistractor(items) {
  if (!items || items.length === 0) {
    return { fpr: 0, fnr: 0, net_utility: 0, tp: 0, fp: 0, tn: 0, fn: 0, n_target: 0, n_offtarget: 0, n_total: 0 };
  }
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const item of items) {
    const isTarget = !!item.target;
    const didFire = !!item.fired;
    if (isTarget && didFire) tp++;
    else if (isTarget && !didFire) fn++;
    else if (!isTarget && didFire) fp++;
    else if (!isTarget && !didFire) tn++;
  }
  const nTarget = tp + fn;
  const nOfftarget = fp + tn;
  const nTotal = nTarget + nOfftarget;
  const fpr = nOfftarget > 0 ? fp / nOfftarget : 0;
  const fnr = nTarget > 0 ? fn / nTarget : 0;
  const netUtility = nTotal > 0 ? (tp - fp) / nTotal : 0;
  return {
    fpr: +fpr.toFixed(6),
    fnr: +fnr.toFixed(6),
    net_utility: +netUtility.toFixed(6),
    tp, fp, tn, fn,
    n_target: nTarget,
    n_offtarget: nOfftarget,
    n_total: nTotal
  };
}

/**
 * Balanced accuracy for binary labels with nullable predictions.
 * Null predictions are always incorrect — never true negatives/positives.
 * `who` is a prediction field such as 'skill_yes' | 'placebo_yes' (true/false/null).
 */
function balancedAcc(rows, who) {
  const pos = (rows || []).filter((r) => r.label);
  const neg = (rows || []).filter((r) => !r.label);
  const tpr = pos.length ? pos.filter((r) => r[who] === true).length / pos.length : 0;
  const tnr = neg.length ? neg.filter((r) => r[who] === false).length / neg.length : 0;
  return +(((tpr + tnr) / 2)).toFixed(3);
}

/** Clamp probability to [0, 1]. Non-finite → null. */
function clampProbability(p) {
  if (p == null || typeof p !== 'number' || !Number.isFinite(p)) return null;
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

// ─── Seeded PRNG (Mulberry32) ────────────────────────────────────────────

function mulberry32(seed) {
  let t = (seed >>> 0) || 1;
  return function next() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed == null ? 0 : seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ─── Hierarchical cluster bootstrap ──────────────────────────────────────

/**
 * Build nested hierarchy: leakage_family/cluster → item → trials.
 * Each observation: { treatment, control, item_id?, leakage_family?, cluster_id?, trial? }
 */
function itemKeyFor(obs, index) {
  if (obs == null) return `idx:${index}`;
  if (obs.item_id != null && obs.item_id !== '') return String(obs.item_id);
  if (obs.id != null && obs.id !== '') return String(obs.id);
  return `idx:${index}`;
}

function familyKeyFor(obs, index) {
  if (obs == null) return `idx:${index}`;
  if (obs.leakage_family != null && obs.leakage_family !== '') return `fam:${obs.leakage_family}`;
  if (obs.cluster_id != null && obs.cluster_id !== '') return `cid:${obs.cluster_id}`;
  // Fall back to item-level family when no leakage family is declared
  return `itemfam:${itemKeyFor(obs, index)}`;
}

/** @deprecated use familyKeyFor; retained for callers of clusterKeyFor */
function clusterKeyFor(obs, index) {
  return familyKeyFor(obs, index);
}

/**
 * Hierarchy node shape:
 * { key, items: [{ key, trials: [obs,...] }] }
 */
function buildHierarchy(observations) {
  const families = new Map();
  (observations || []).forEach((obs, i) => {
    const fKey = familyKeyFor(obs, i);
    const iKey = itemKeyFor(obs, i);
    if (!families.has(fKey)) families.set(fKey, new Map());
    const items = families.get(fKey);
    if (!items.has(iKey)) items.set(iKey, []);
    items.get(iKey).push(obs);
  });
  return [...families.entries()].map(([key, itemMap]) => ({
    key,
    items: [...itemMap.entries()].map(([itemKey, trials]) => ({
      key: itemKey,
      trials,
    })),
  }));
}

/** Flat clusters (family-level) for randomization sign-flip unit. */
function groupClusters(observations) {
  return buildHierarchy(observations).map(f => ({
    key: f.key,
    items: f.items.flatMap(it => it.trials),
  }));
}

function meanPairedRiskDiff(observations) {
  if (!observations || observations.length === 0) return 0;
  let sum = 0;
  for (const o of observations) {
    const t = Number(o.treatment);
    const c = Number(o.control);
    sum += (Number.isFinite(t) ? t : 0) - (Number.isFinite(c) ? c : 0);
  }
  return sum / observations.length;
}

function sampleWithReplacement(arr, rng) {
  if (!arr || arr.length === 0) return [];
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = arr[Math.floor(rng() * arr.length)];
  }
  return out;
}

/**
 * Nested hierarchical resample:
 * 1) resample families with replacement
 * 2) within each sampled family, resample items with replacement
 * 3) within each sampled item, resample trials with replacement
 */
function hierarchicalResample(hierarchy, rng) {
  const out = [];
  if (!hierarchy.length) return out;
  const sampledFamilies = sampleWithReplacement(hierarchy, rng);
  for (const fam of sampledFamilies) {
    if (!fam.items.length) continue;
    const sampledItems = sampleWithReplacement(fam.items, rng);
    for (const item of sampledItems) {
      if (!item.trials.length) continue;
      const sampledTrials = sampleWithReplacement(item.trials, rng);
      for (const trial of sampledTrials) out.push(trial);
    }
  }
  return out;
}

function flattenClusterSample(clusters, indices) {
  const out = [];
  for (const idx of indices) {
    const c = clusters[idx];
    for (const item of c.items) out.push(item);
  }
  return out;
}

/**
 * Deterministic hierarchical cluster-bootstrap paired risk difference.
 * Resamples families → items → trials with replacement (nested).
 *
 * @param {Array} observations
 * @param {{seed?:number|string, resamples?:number, alpha?:number, alternative?:'two-sided'|'greater'|'less'}} [opts]
 */
function clusterBootstrapPairedRiskDiff(observations, opts = {}) {
  const seed = hashSeed(opts.seed == null ? 0 : opts.seed);
  const resamples = opts.resamples == null ? 10000 : opts.resamples;
  const alpha = opts.alpha == null ? 0.05 : opts.alpha;
  const alternative = opts.alternative || 'two-sided';
  const hierarchy = buildHierarchy(observations);
  const nClusters = hierarchy.length;
  const nItems = hierarchy.reduce((s, f) => s + f.items.length, 0);
  const observed = meanPairedRiskDiff(observations);
  if (nClusters === 0 || resamples <= 0) {
    return {
      estimate: observed,
      ci: [observed, observed],
      alpha,
      resamples,
      seed,
      n_clusters: nClusters,
      n_items: nItems,
      n_obs: (observations || []).length,
      method: 'hierarchical-cluster-bootstrap-paired-rd',
    };
  }

  const rng = mulberry32(seed);
  const boots = new Array(resamples);
  for (let b = 0; b < resamples; b++) {
    boots[b] = meanPairedRiskDiff(hierarchicalResample(hierarchy, rng));
  }
  boots.sort((a, b) => a - b);
  const loQ = alternative === 'greater' ? alpha : alpha / 2;
  const hiQ = alternative === 'less' ? 1 - alpha : 1 - alpha / 2;
  const loIdx = Math.max(0, Math.min(resamples - 1, Math.floor(loQ * resamples)));
  const hiIdx = Math.max(0, Math.min(resamples - 1, Math.floor(hiQ * resamples)));
  return {
    estimate: observed,
    ci: [boots[loIdx], boots[hiIdx]],
    alpha,
    resamples,
    seed,
    n_clusters: nClusters,
    n_items: nItems,
    n_obs: (observations || []).length,
    method: 'hierarchical-cluster-bootstrap-paired-rd',
  };
}

/**
 * Cluster-aware randomization (sign-flip) test for paired risk difference.
 * Null: within each cluster, treatment/control labels are exchangeable.
 * p-value = proportion of |null stats| >= |observed| (two-sided) or directional.
 */
function clusterRandomizationTest(observations, opts = {}) {
  const seed = hashSeed(opts.seed == null ? 0 : opts.seed);
  const resamples = opts.resamples == null ? 10000 : opts.resamples;
  const alternative = opts.alternative || 'two-sided';
  const clusters = groupClusters(observations);
  const observed = meanPairedRiskDiff(observations);
  if (clusters.length === 0 || resamples <= 0) {
    return { estimate: observed, p_value: 1, resamples, seed, n_clusters: clusters.length };
  }
  const rng = mulberry32(seed);
  let extreme = 0;
  for (let b = 0; b < resamples; b++) {
    const flipped = [];
    for (const cl of clusters) {
      const flip = rng() < 0.5;
      for (const o of cl.items) {
        if (flip) flipped.push({ treatment: o.control, control: o.treatment });
        else flipped.push(o);
      }
    }
    const stat = meanPairedRiskDiff(flipped);
    if (alternative === 'greater') {
      if (stat >= observed - 1e-15) extreme++;
    } else if (alternative === 'less') {
      if (stat <= observed + 1e-15) extreme++;
    } else if (Math.abs(stat) >= Math.abs(observed) - 1e-15) {
      extreme++;
    }
  }
  // Include observed under null (standard Monte Carlo p)
  const p = Math.min(1, (extreme + 1) / (resamples + 1));
  return {
    estimate: observed,
    p_value: p,
    resamples,
    seed,
    n_clusters: clusters.length,
    n_obs: (observations || []).length,
    alternative,
    method: 'cluster-randomization',
  };
}

/**
 * Holm–Bonferroni adjustment for a family of p-values.
 * @param {Array<{id?:string, p:number}|number>} pValues
 * @returns {Array<{id:string|number, p:number, p_adjusted:number, rank:number}>}
 */
function holmAdjustment(pValues) {
  const items = (pValues || []).map((v, i) => {
    if (typeof v === 'number') return { id: i, p: v, index: i };
    return { id: v.id != null ? v.id : i, p: v.p, index: i };
  });
  const m = items.length;
  if (m === 0) return [];
  const sorted = items.slice().sort((a, b) => a.p - b.p);
  const adjusted = new Array(m);
  let running = 0;
  for (let i = 0; i < m; i++) {
    const raw = (m - i) * sorted[i].p;
    const adj = Math.min(1, Math.max(running, raw));
    running = adj;
    adjusted[i] = {
      id: sorted[i].id,
      p: sorted[i].p,
      p_adjusted: adj,
      rank: i + 1,
      index: sorted[i].index,
    };
  }
  // Return in original order
  return adjusted.sort((a, b) => a.index - b.index).map(({ index, ...rest }) => rest);
}

/**
 * Bootstrap ratio interval for positive metrics (e.g. cost_workflow / cost_baseline).
 * observations: [{numerator, denominator, item_id?, leakage_family?}]
 */
function ratioBootstrapInterval(observations, opts = {}) {
  const seed = hashSeed(opts.seed == null ? 0 : opts.seed);
  const resamples = opts.resamples == null ? 10000 : opts.resamples;
  const alpha = opts.alpha == null ? 0.05 : opts.alpha;
  const hierarchy = buildHierarchy(observations);
  const sumRatio = (obs) => {
    let num = 0, den = 0;
    for (const o of obs || []) {
      num += Number(o.numerator) || 0;
      den += Number(o.denominator) || 0;
    }
    return den === 0 ? null : num / den;
  };
  const observed = sumRatio(observations);
  if (hierarchy.length === 0 || resamples <= 0 || observed == null) {
    return {
      estimate: observed,
      ci: [observed, observed],
      alpha,
      resamples,
      seed,
      n_clusters: hierarchy.length,
      method: 'hierarchical-cluster-bootstrap-ratio',
    };
  }
  const rng = mulberry32(seed);
  const boots = [];
  for (let b = 0; b < resamples; b++) {
    const r = sumRatio(hierarchicalResample(hierarchy, rng));
    if (r != null && Number.isFinite(r)) boots.push(r);
  }
  boots.sort((a, b) => a - b);
  if (boots.length === 0) {
    return {
      estimate: observed,
      ci: [observed, observed],
      alpha,
      resamples,
      seed,
      n_clusters: hierarchy.length,
      method: 'hierarchical-cluster-bootstrap-ratio',
    };
  }
  const loIdx = Math.max(0, Math.min(boots.length - 1, Math.floor((alpha / 2) * boots.length)));
  const hiIdx = Math.max(0, Math.min(boots.length - 1, Math.floor((1 - alpha / 2) * boots.length)));
  return {
    estimate: observed,
    ci: [boots[loIdx], boots[hiIdx]],
    alpha,
    resamples,
    seed,
    n_clusters: hierarchy.length,
    n_obs: (observations || []).length,
    method: 'hierarchical-cluster-bootstrap-ratio',
  };
}

/**
 * Validate explicit final-family power config.
 * `powered` / decision_eligible requires this — not mere CI exclusion of null.
 *
 * Required fields:
 *  - family_size (H) > 0
 *  - alpha_family (e.g. 0.05)
 *  - target_power >= 0.90 (or power >= 0.90)
 *  - margin (utility/harm) defined
 *  - seed frozen
 * Optional: method, one_sided, achieved_power
 */
function validatePowerConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { ok: false, errors: ['power config missing'] };
  }
  const familySize = config.family_size ?? config.H ?? config.hypotheses;
  if (!(Number.isInteger(familySize) && familySize > 0)) {
    errors.push('family_size (H) must be a positive integer');
  }
  const alpha = config.alpha_family ?? config.alpha;
  if (!(typeof alpha === 'number' && Number.isFinite(alpha) && alpha > 0 && alpha < 1)) {
    errors.push('alpha_family must be a finite number in (0,1)');
  }
  const power = config.target_power ?? config.power;
  if (!(typeof power === 'number' && Number.isFinite(power) && power >= 0.90 && power <= 1)) {
    errors.push('target_power must be a finite number in [0.90, 1]');
  }
  const margin = config.margin;
  if (!(typeof margin === 'number' && Number.isFinite(margin) && margin > 0)) {
    errors.push('margin must be a finite positive number');
  }
  if (config.seed == null || config.seed === '') {
    errors.push('seed must be frozen in power config');
  }
  if (config.method == null || String(config.method).trim() === '') {
    errors.push('method must be declared (e.g. cluster-bootstrap-holm)');
  }
  return {
    ok: errors.length === 0,
    errors,
    config: {
      family_size: familySize,
      alpha_family: alpha,
      target_power: power,
      margin: config.margin,
      seed: config.seed,
      method: config.method,
      one_sided: config.one_sided !== false,
      achieved_power: config.achieved_power,
      achieved_power_ok: !!config.achieved_power_ok,
    },
  };
}

/**
 * Convenience: disposition-ready paired analysis using cluster bootstrap + randomization p
 * and optional Holm family.
 */
function pairedClusterAnalysis(observations, opts = {}) {
  const boot = clusterBootstrapPairedRiskDiff(observations, opts);
  const rand = clusterRandomizationTest(observations, opts);
  // Secondary diagnostic: McNemar on collapsed per-observation binary pairs
  let b = 0, c = 0;
  for (const o of observations || []) {
    const t = Number(o.treatment) ? 1 : 0;
    const ctrl = Number(o.control) ? 1 : 0;
    if (t === 1 && ctrl === 0) b++;
    else if (t === 0 && ctrl === 1) c++;
  }
  const mcn = mcnemarFull(b, c);
  return {
    risk_difference: boot.estimate,
    ci95: boot.ci,
    p_value: rand.p_value,
    mcnemar: mcn,
    discordant: { b, c },
    bootstrap: boot,
    randomization: rand,
    n_obs: (observations || []).length,
    n_clusters: boot.n_clusters,
  };
}

module.exports = {
  normCdf,
  wilson,
  signTest,
  mcnemar,
  mcnemarMidp,
  mcnemarFull,
  binomExactTwoSided,
  lgamma,
  lnBinom,
  pairedDiff,
  summarize,
  scoreDistractor,
  balancedAcc,
  clampProbability,
  mulberry32,
  hashSeed,
  groupClusters,
  buildHierarchy,
  hierarchicalResample,
  clusterKeyFor,
  clusterBootstrapPairedRiskDiff,
  clusterRandomizationTest,
  holmAdjustment,
  ratioBootstrapInterval,
  validatePowerConfig,
  pairedClusterAnalysis,
  meanPairedRiskDiff,
};
