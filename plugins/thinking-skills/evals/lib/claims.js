'use strict';

/**
 * Claim automation: artifact eligibility classification, preregistration drift
 * detection, and claim ledger generation.
 *
 * Confirmatory claims use declared study bundles via evidence.js only.
 * Recursive results scanning remains for diagnostic/legacy ledger output but
 * cannot alone mark a claim confirmatory.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  listConfirmatoryCandidates,
  evaluateConfirmationEligibility,
  listDeclaredBundles,
} = require('./evidence');
const { loadRegistry } = require('./registry');

/**
 * Classify a legacy runner artifact's eligibility for non-confirmatory evidence.
 * @param {object} artifact - parsed JSON artifact from a runner
 * @returns {{eligible: boolean, status: string, blockers: string[], warnings: string[]}}
 */
function classifyArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    return { eligible: false, status: 'invalid', blockers: ['artifact is not a valid object'], warnings: [] };
  }

  const blockers = [];
  const warnings = [];

  // Check run_health / health
  const health = artifact.run_health || artifact.health;
  if (!health) {
    warnings.push('missing run_health; cannot verify solver reliability');
  } else {
    if (health.decision_eligible === false) {
      blockers.push(`solver_failures=${health.solver_failures || health.failures || 0}; not decision-eligible`);
    }
    const rate = health.failure_rate || 0;
    if (rate > 0.05) {
      blockers.push(`failure_rate=${rate} exceeds 5% threshold; artifact is diagnostic only`);
    }
  }

  // Check warnings array
  if (Array.isArray(artifact.warnings)) {
    for (const w of artifact.warnings) {
      if (w.severity === 'major') blockers.push(w.message);
      else warnings.push(w.message);
    }
  }

  // Check mode — pilot/behavioral/factorial modes are NOT confirmatory
  const mode = artifact.mode || '';
  const isPilotMode = mode.includes('pilot') || mode.includes('behavioral') || mode.includes('factorial') || mode.includes('workflow-vs-skill') || mode.includes('workflow-factorial');
  if (isPilotMode) {
    blockers.push(`mode='${mode}' is exploratory/pilot; not eligible for confirmatory claims`);
  }
  // claim_status: 'confirmed' is confirmatory; 'inconclusive' is citable as evidence but not confirmatory
  const claimStat = artifact.claim_status || 'missing';
  const isConfirmed = claimStat === 'confirmed';
  const isInconclusive = claimStat === 'inconclusive';
  if (!isConfirmed && !isInconclusive) {
    blockers.push(`claim_status='${claimStat}'; not eligible for any claim`);
  }
  if (!isConfirmed) {
    warnings.push(`claim_status='${claimStat}'; citable as evidence only, not confirmatory`);
  }

  // Recursive scan artifacts are never confirmatory without declared-bundle gates
  warnings.push('legacy artifact path cannot alone confirm; requires declared study bundle evaluation');

  // Determine status
  let status;
  if (blockers.length > 0) status = 'ineligible';
  else if (warnings.length > 0) status = 'eligible_as_evidence';
  else status = 'eligible';

  return {
    eligible: blockers.length === 0,
    // never confirmatory from legacy scan alone
    confirmatory_eligible: false,
    status,
    blockers,
    warnings,
  };
}

/**
 * Detect preregistration drift between an artifact and the current preregistration.
 * @param {object} artifact - parsed JSON artifact
 * @param {string} currentPreregSha256 - SHA-256 of current prereg file
 * @returns {{drifted: boolean, artifact_sha: string|null, current_sha: string, status: string}}
 */
function detectPreregDrift(artifact, currentPreregSha256) {
  const artifactPrereg = artifact?.preregistration;
  const artifactSha = artifactPrereg?.sha256 || artifact?.preregistration_sha256 || null;
  const currentSha = currentPreregSha256;

  if (!artifactSha) {
    return { drifted: true, artifact_sha: null, current_sha: currentSha, status: 'missing_prereg_in_artifact' };
  }
  if (artifactSha !== currentSha) {
    return { drifted: true, artifact_sha: artifactSha, current_sha: currentSha, status: 'drifted' };
  }
  return { drifted: false, artifact_sha: artifactSha, current_sha: currentSha, status: 'current' };
}

/**
 * Generate a claim ledger from declared study bundles (confirmatory path)
 * plus optional legacy results scan (diagnostic only).
 * @param {string} resultsDir - path to results directory (legacy diagnostic)
 * @param {string} preregFile - path to current preregistration file
 * @returns {object} claim ledger
 */
function generateClaimLedger(resultsDir, preregFile) {
  const preregSha = fs.existsSync(preregFile)
    ? crypto.createHash('sha256').update(fs.readFileSync(preregFile, 'utf8')).digest('hex')
    : null;

  let registry = null;
  try {
    registry = loadRegistry().registry;
  } catch (_) {
    registry = null;
  }

  const ledger = {
    generated_at: new Date().toISOString(),
    preregistration_sha256: preregSha,
    claims: [],
    declared_bundle_evaluations: [],
  };

  // Primary: declared study bundles only for confirmatory eligibility
  if (registry) {
    const evaluations = listConfirmatoryCandidates(registry).map(evaluation => {
      // Re-evaluate with current prereg sha so drift is exact, not presence-only
      return evaluateConfirmationEligibility({
        studyId: evaluation.study_id,
        registry,
        currentPreregSha256: preregSha,
        preregFile,
      });
    });
    ledger.declared_bundle_evaluations = evaluations;
    for (const evaluation of evaluations) {
      const artifactSha = evaluation.hashes?.preregistration_sha256 || null;
      const drift = detectPreregDrift(
        { preregistration_sha256: artifactSha },
        preregSha
      );
      const blockers = [...(evaluation.blockers || [])];
      if (drift.drifted) {
        if (!blockers.some(b => /prereg/i.test(b))) {
          blockers.push('prereg drift: artifact sha ≠ current');
        }
      }
      const confirmatory = evaluation.confirmatory === true && !drift.drifted;
      ledger.claims.push({
        file: evaluation.bundle?.path || evaluation.study_id,
        mode: 'declared_study_bundle',
        claim: evaluation.study_id,
        study_id: evaluation.study_id,
        eligible: confirmatory,
        confirmatory_eligible: confirmatory,
        status: drift.drifted ? 'stale' : evaluation.status,
        blockers,
        warnings: evaluation.warnings,
        prereg_drift: drift,
        run_health: evaluation.health,
        source: 'declared_bundle',
      });
    }
  }

  // Legacy recursive scan: diagnostic only, never confirmatory
  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.json') && entry.name !== 'claim-ledger.json') {
        try {
          const artifact = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          const classification = classifyArtifact(artifact);
          const drift = detectPreregDrift(artifact, preregSha);
          const claimKey = artifact.mode || path.basename(fullPath, '.json');
          const blockers = [...classification.blockers];
          if (drift.drifted) blockers.push('prereg drift: artifact sha ≠ current');

          ledger.claims.push({
            file: path.relative(resultsDir, fullPath),
            mode: artifact.mode || 'unknown',
            claim: claimKey,
            eligible: classification.eligible && !drift.drifted,
            confirmatory_eligible: false,
            status: drift.drifted ? 'stale' : classification.status,
            blockers,
            warnings: classification.warnings,
            prereg_drift: drift,
            run_health: (artifact.run_health || artifact.health) ? {
              solver_calls: artifact.run_health?.solver_calls,
              solver_failures: artifact.run_health?.solver_failures ?? artifact.health?.failures,
              failure_rate: (artifact.run_health || artifact.health)?.failure_rate,
              decision_eligible: (artifact.run_health || artifact.health)?.decision_eligible,
            } : null,
            source: 'legacy_results_scan',
          });
        } catch (_) { /* skip unparseable files */ }
      }
    }
  }

  if (resultsDir) scanDir(resultsDir);
  return ledger;
}

/**
 * Confirmatory claim check for a study id via declared bundles only.
 */
function evaluateStudyClaim(studyId, registry = null) {
  return evaluateConfirmationEligibility({ studyId, registry });
}

module.exports = {
  classifyArtifact,
  detectPreregDrift,
  generateClaimLedger,
  evaluateStudyClaim,
  listDeclaredBundles,
  evaluateConfirmationEligibility,
};
