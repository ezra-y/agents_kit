'use strict';

/**
 * Evidence reader for declared study bundles only.
 * Confirmatory claims require prereg hash, eligible split, exact hashes,
 * final-rule power, complete health, replication, and archive readback+SHA.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { loadRegistry, getDeclaredStudyBundle } = require('./registry');
const { sha256, validateResultEnvelope } = require('./result');

const REPO_ROOT = path.join(__dirname, '..', '..');
const STUDIES_ROOT = path.join(REPO_ROOT, 'evals', 'studies');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function resolveBundleDir(bundle) {
  if (!bundle) return null;
  if (bundle.declared_inline || bundle.path == null) return null;
  return path.isAbsolute(bundle.path) ? bundle.path : path.join(REPO_ROOT, bundle.path);
}

/**
 * List only registry-declared study bundles (no recursive results scan).
 */
function listDeclaredBundles(registry) {
  const reg = registry || loadRegistry().registry;
  return (reg.declared_study_bundles || []).map(b => ({
    ...b,
    absolute_path: resolveBundleDir(b),
  }));
}

function loadBundleArtifacts(bundleDir) {
  const manifestPath = path.join(bundleDir, 'manifest.json');
  const aggregatePath = path.join(bundleDir, 'aggregate.json');
  const itemsPath = path.join(bundleDir, 'items.jsonl');
  const out = {
    dir: bundleDir,
    manifest: null,
    aggregate: null,
    items: [],
    paths: { manifest: manifestPath, aggregate: aggregatePath, items: itemsPath },
    missing: [],
  };
  if (!fs.existsSync(manifestPath)) out.missing.push('manifest.json');
  else out.manifest = readJson(manifestPath);
  if (fs.existsSync(aggregatePath)) out.aggregate = readJson(aggregatePath);
  else out.missing.push('aggregate.json');
  if (fs.existsSync(itemsPath)) {
    out.items = fs.readFileSync(itemsPath, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } else {
    out.missing.push('items.jsonl');
  }
  return out;
}

function extractHealth(artifact) {
  return artifact?.health || artifact?.run_health || artifact?.aggregate?.health || null;
}
function healthComplete(health) {
  if (!health || typeof health !== 'object') {
    return { ok: false, reasons: ['missing health'] };
  }
  const reasons = [];
  const fields = ['attempted', 'completed', 'parsed', 'scored', 'failures'];
  for (const f of fields) {
    if (!Number.isInteger(health[f]) || health[f] < 0) reasons.push(`health.${f} missing or invalid`);
  }
  if (health.decision_eligible !== true) reasons.push('health.decision_eligible is not true');
  if (Number.isInteger(health.failures) && health.failures > 0) reasons.push(`health.failures=${health.failures}`);
  if (
    Number.isInteger(health.attempted) &&
    Number.isInteger(health.completed) &&
    Number.isInteger(health.parsed) &&
    Number.isInteger(health.scored)
  ) {
    if (!(health.attempted === health.completed &&
          health.completed === health.parsed &&
          health.parsed === health.scored)) {
      reasons.push(
        `health denominators not equal attempted=${health.attempted} completed=${health.completed} parsed=${health.parsed} scored=${health.scored}`
      );
    }
  }
  return { ok: reasons.length === 0, reasons, health };
}
function powerConfigPresent(stats, gates) {
  const power = stats?.power || stats?.power_config || stats?.final_rule_power || null;
  if (!power || typeof power !== 'object') {
    return { ok: false, reasons: ['missing final-rule power config'] };
  }
  const reasons = [];
  const target = power.power_target ?? power.target ?? power.power;
  if (target == null || Number(target) < (gates?.power_target ?? 0.9)) {
    reasons.push(`power_target ${target} below required ${gates?.power_target ?? 0.9}`);
  }
  if (power.decision_eligible === false) reasons.push('power.decision_eligible=false');
  if (power.powered === true && power.decision_eligible == null && power.multiplicity_adjusted == null) {
    // legacy "powered means CI excludes null" is insufficient
    reasons.push('legacy powered flag without final-rule multiplicity/power config');
  }
  const hasFinalRule =
    power.multiplicity_adjusted === true ||
    power.final_rule === true ||
    power.familywise === true ||
    isNonEmptyString(power.disposition_rule) ||
    isNonEmptyString(power.rule);
  if (!hasFinalRule) reasons.push('power config does not declare final disposition rule / multiplicity adjustment');
  return { ok: reasons.length === 0, reasons, power };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Verify exact hashes against bytes/config identities when paths are available.
 * Fails closed on missing or mismatched hashes.
 *
 * @param {object} manifest
 * @param {object|null} envelope
 * @param {object} [opts]
 * @param {string|null} [opts.currentPreregSha256]
 * @param {string} [opts.repoRoot]
 */
function verifyExactHashes(manifest, envelope, opts = {}) {
  const reasons = [];
  const repoRoot = opts.repoRoot || REPO_ROOT;
  const currentPreregSha256 = opts.currentPreregSha256 || null;

  const declaredPrereg =
    envelope?.preregistration_sha256 ||
    manifest?.preregistration?.sha256 ||
    manifest?.preregistration_sha256 ||
    null;
  const hex64 = /^[a-f0-9]{64}$/i;
  if (!isNonEmptyString(declaredPrereg)) {
    reasons.push('missing preregistration_sha256');
  } else if (!hex64.test(declaredPrereg)) {
    reasons.push('preregistration_sha256 must be 64-hex');
  } else {
    const preregPath = manifest?.preregistration?.path
      ? (path.isAbsolute(manifest.preregistration.path)
        ? manifest.preregistration.path
        : path.join(repoRoot, manifest.preregistration.path))
      : null;
    const hasCurrent = isNonEmptyString(currentPreregSha256);
    const hasPath = isNonEmptyString(preregPath);
    if (!hasCurrent && !hasPath) {
      reasons.push('preregistration_sha256 not verifiable (need currentPreregSha256 or readable prereg path)');
    } else {
      if (hasCurrent && declaredPrereg !== currentPreregSha256) {
        reasons.push('preregistration_sha256 does not match current prereg file');
      }
      if (hasPath) {
        if (!fs.existsSync(preregPath)) {
          reasons.push(`preregistration path not readable: ${manifest.preregistration.path}`);
        } else {
          const actual = fileSha256(preregPath);
          if (actual !== declaredPrereg) {
            reasons.push('preregistration_sha256 does not match prereg file bytes');
          }
        }
      }
    }
  }

  const declaredDatasetSha =
    envelope?.dataset?.sha256 ||
    manifest?.dataset?.sha256 ||
    manifest?.dataset?.sha256_preregistered ||
    null;
  if (!isNonEmptyString(declaredDatasetSha)) {
    reasons.push('missing dataset sha256');
  } else {
    const datasetPath =
      envelope?.dataset?.source ||
      manifest?.dataset?.path ||
      manifest?.dataset?.source ||
      null;
    if (isNonEmptyString(datasetPath)) {
      const abs = path.isAbsolute(datasetPath) ? datasetPath : path.join(repoRoot, datasetPath);
      if (fs.existsSync(abs)) {
        const actual = fileSha256(abs);
        if (actual !== declaredDatasetSha) {
          reasons.push('dataset sha256 does not match dataset file bytes');
        }
      } else {
        reasons.push(`dataset path not readable for hash verify: ${datasetPath}`);
      }
    } else {
      reasons.push('dataset path missing; cannot verify dataset sha256 against bytes');
    }
  }

  // Solver: require model + exact config identity (config_sha256 of canonical payload or path+sha)
  const solver = envelope?.solver || manifest?.solver || null;
  const solverModel = solver?.model || null;
  if (!isNonEmptyString(solverModel)) {
    reasons.push('missing solver.model');
  } else {
    const solverConfigSha = solver.config_sha256 || solver.sha256 || null;
    const solverConfigPath = solver.config_path || solver.path || null;
    const solverConfig = solver.config || null;
    if (isNonEmptyString(solverConfigPath) && isNonEmptyString(solverConfigSha)) {
      const abs = path.isAbsolute(solverConfigPath) ? solverConfigPath : path.join(repoRoot, solverConfigPath);
      if (!fs.existsSync(abs)) reasons.push(`solver config path not readable: ${solverConfigPath}`);
      else if (fileSha256(abs) !== solverConfigSha) reasons.push('solver config_sha256 does not match file bytes');
    } else if (solverConfig && typeof solverConfig === 'object' && isNonEmptyString(solverConfigSha)) {
      const actual = sha256(solverConfig);
      if (actual !== solverConfigSha) reasons.push('solver config_sha256 does not match config payload');
    } else if (isNonEmptyString(solverConfigSha)) {
      // declared sha without payload/path cannot be verified
      reasons.push('solver config_sha256 present without config payload or path for byte verify');
    } else {
      reasons.push('missing solver config_sha256 (path+sha or config payload required)');
    }
  }

  const arms = envelope?.arms || manifest?.arms || [];
  if (!Array.isArray(arms) || arms.length === 0) {
    reasons.push('missing arms with prompt/skill hashes');
  } else {
    for (const arm of arms) {
      if (!arm || !isNonEmptyString(arm.id)) {
        reasons.push('arm missing id');
        continue;
      }
      // prompt: require prompt_sha256 and path or body for recompute
      if (!isNonEmptyString(arm.prompt_sha256)) {
        reasons.push(`arm ${arm.id} missing prompt_sha256`);
      } else if (isNonEmptyString(arm.prompt_path)) {
        const abs = path.isAbsolute(arm.prompt_path) ? arm.prompt_path : path.join(repoRoot, arm.prompt_path);
        if (!fs.existsSync(abs)) reasons.push(`arm ${arm.id} prompt_path not readable`);
        else if (fileSha256(abs) !== arm.prompt_sha256) reasons.push(`arm ${arm.id} prompt_sha256 does not match prompt file bytes`);
      } else if (typeof arm.prompt === 'string') {
        const actual = sha256(arm.prompt);
        if (actual !== arm.prompt_sha256) reasons.push(`arm ${arm.id} prompt_sha256 does not match prompt bytes`);
      } else {
        reasons.push(`arm ${arm.id} prompt_sha256 not byte-verifiable (need prompt_path or prompt body)`);
      }

      // skill: none arm may have null skill; others need skill_sha256 + path/body
      if (arm.id === 'none') {
        if (arm.skill_sha256 != null && arm.skill_sha256 !== '' && arm.skill_sha256 !== null) {
          // allow explicit null only
        }
      } else if (!isNonEmptyString(arm.skill_sha256)) {
        reasons.push(`arm ${arm.id} missing skill_sha256`);
      } else if (isNonEmptyString(arm.skill_path)) {
        const abs = path.isAbsolute(arm.skill_path) ? arm.skill_path : path.join(repoRoot, arm.skill_path);
        if (!fs.existsSync(abs)) reasons.push(`arm ${arm.id} skill_path not readable`);
        else if (fileSha256(abs) !== arm.skill_sha256) reasons.push(`arm ${arm.id} skill_sha256 does not match skill file bytes`);
      } else if (typeof arm.skill_body === 'string') {
        if (sha256(arm.skill_body) !== arm.skill_sha256) reasons.push(`arm ${arm.id} skill_sha256 does not match skill_body`);
      } else if (manifest?.skill?.path) {
        const abs = path.isAbsolute(manifest.skill.path) ? manifest.skill.path : path.join(repoRoot, manifest.skill.path);
        if (!fs.existsSync(abs)) reasons.push(`skill path not readable for arm ${arm.id}`);
        else if (fileSha256(abs) !== arm.skill_sha256) reasons.push(`arm ${arm.id} skill_sha256 does not match skill path bytes`);
      } else {
        reasons.push(`arm ${arm.id} skill_sha256 not byte-verifiable (need skill_path, skill_body, or manifest.skill.path)`);
      }
    }
  }

  // Judges: require non-empty panel with per-judge model + config identity
  const judges = envelope?.judges || manifest?.judges || null;
  if (!Array.isArray(judges) || judges.length === 0) {
    reasons.push('missing judges array with model/config identities');
  } else {
    for (let i = 0; i < judges.length; i++) {
      const j = judges[i];
      const model = typeof j === 'string' ? j : j?.model;
      if (!isNonEmptyString(model)) {
        reasons.push(`judge[${i}] missing model identity`);
        continue;
      }
      if (typeof j === 'string') {
        reasons.push(`judge[${i}] model-only string lacks config_sha256`);
        continue;
      }
      const jSha = j.config_sha256 || j.sha256 || null;
      if (!isNonEmptyString(jSha)) {
        reasons.push(`judge[${i}] missing config_sha256`);
      } else if (isNonEmptyString(j.config_path)) {
        const abs = path.isAbsolute(j.config_path) ? j.config_path : path.join(repoRoot, j.config_path);
        if (!fs.existsSync(abs)) reasons.push(`judge[${i}] config_path not readable`);
        else if (fileSha256(abs) !== jSha) reasons.push(`judge[${i}] config_sha256 does not match file bytes`);
      } else if (j.config && typeof j.config === 'object') {
        if (sha256(j.config) !== jSha) reasons.push(`judge[${i}] config_sha256 does not match config payload`);
      } else {
        reasons.push(`judge[${i}] config_sha256 not byte-verifiable`);
      }
    }
  }

  // Aggregate skill/prompt hashes for reporting (first verifiable values)
  const skillHash = Array.isArray(arms)
    ? (arms.map(a => a && a.skill_sha256).find(Boolean) || manifest?.skill?.skill_md_sha256_preregistered || null)
    : null;
  const promptHash = Array.isArray(arms)
    ? (arms.map(a => a && a.prompt_sha256).find(Boolean) || null)
    : null;

  return {
    ok: reasons.length === 0,
    reasons,
    hashes: {
      preregistration_sha256: declaredPrereg,
      dataset_sha256: declaredDatasetSha,
      skill_sha256: skillHash,
      prompt_sha256: promptHash,
      solver_model: solverModel,
      solver_config_sha256: solver?.config_sha256 || solver?.sha256 || null,
      judges: Array.isArray(judges)
        ? judges.map(j => (typeof j === 'string' ? { model: j } : { model: j?.model, config_sha256: j?.config_sha256 || j?.sha256 || null }))
        : [],
    },
  };
}

// Back-compat alias used by tests/callers expecting presence helper name
function hashFieldsPresent(manifest, envelope, opts = {}) {
  return verifyExactHashes(manifest, envelope, opts);
}

function eligibleSplitOk(manifest, envelope, requiredSplit = 'replication') {
  const split =
    envelope?.dataset?.split ||
    manifest?.dataset?.split ||
    manifest?.split ||
    null;
  if (!isNonEmptyString(split)) {
    return { ok: false, reasons: ['missing dataset split'], split: null };
  }
  if (split !== requiredSplit && split !== 'untouched_replication' && split !== 'replication') {
    return {
      ok: false,
      reasons: [`split '${split}' is not eligible for confirmation (need ${requiredSplit})`],
      split,
    };
  }
  return { ok: true, reasons: [], split };
}

function replicationOk(manifest, aggregate) {
  const status =
    manifest?.replication_status ||
    aggregate?.replication_status ||
    manifest?.statistics?.replication_status ||
    null;
  if (!isNonEmptyString(status)) {
    return { ok: false, reasons: ['missing replication_status'] };
  }
  const okStatuses = new Set([
    'passed',
    'success',
    'replicated',
    'replication_passed',
    'confirmed',
  ]);
  if (!okStatuses.has(String(status).toLowerCase()) && status !== true) {
    return { ok: false, reasons: [`replication_status='${status}' is not successful`] };
  }
  return { ok: true, reasons: [], status };
}

/**
 * Verify per-object archive URI readback and SHA match.
 * Supports:
 *  - absolute/relative local files
 *  - content-addressed path ending with sha256 hex
 *  - explicit {uri, sha256, bytes} objects
 */
function verifyArchiveObject(archiveObj, repoRoot = REPO_ROOT) {
  if (!archiveObj || typeof archiveObj !== 'object') {
    return { ok: false, reasons: ['archive object missing'] };
  }
  const status = archiveObj.status || archiveObj.raw_responses || null;
  if (status === 'absent' || archiveObj.uri == null) {
    return { ok: false, reasons: ['archive uri absent'], status: status || 'absent' };
  }
  const uri = archiveObj.uri || archiveObj.path;
  const expectedSha = archiveObj.sha256 || archiveObj.content_sha256 || null;
  if (!isNonEmptyString(uri)) return { ok: false, reasons: ['archive uri empty'] };
  if (!isNonEmptyString(expectedSha)) return { ok: false, reasons: ['archive sha256 missing'] };

  let filePath = uri;
  if (uri.startsWith('file://')) filePath = uri.slice('file://'.length);
  if (!path.isAbsolute(filePath)) filePath = path.join(repoRoot, filePath);
  if (!fs.existsSync(filePath)) {
    return { ok: false, reasons: [`archive file not readable: ${uri}`], uri, expectedSha };
  }
  const actual = fileSha256(filePath);
  if (actual !== expectedSha) {
    return {
      ok: false,
      reasons: [`archive sha mismatch for ${uri}`],
      uri,
      expectedSha,
      actualSha: actual,
    };
  }
  return { ok: true, reasons: [], uri, expectedSha, actualSha: actual };
}

function collectArchiveObjects(manifest, aggregate) {
  const objects = [];
  const archive = manifest?.archive || {};
  if (archive.raw_response_objects && Array.isArray(archive.raw_response_objects)) {
    for (const obj of archive.raw_response_objects) objects.push(obj);
  }
  if (archive.objects && Array.isArray(archive.objects)) {
    for (const obj of archive.objects) objects.push(obj);
  }
  // source_artifacts may each declare raw_response_archive
  for (const src of manifest?.source_artifacts || []) {
    if (src.raw_response_archive) objects.push({ ...src.raw_response_archive, source_path: src.path });
  }
  if (aggregate?.archive_objects && Array.isArray(aggregate.archive_objects)) {
    for (const obj of aggregate.archive_objects) objects.push(obj);
  }
  // single object form
  if (archive.uri || archive.raw_response_uri) {
    objects.push({
      uri: archive.uri || archive.raw_response_uri,
      sha256: archive.sha256 || archive.raw_response_sha256,
      status: archive.status || archive.raw_responses,
    });
  }
  return objects;
}

/**
 * Evaluate whether a declared study bundle can support a confirmatory claim.
 */
function evaluateConfirmationEligibility({
  studyId,
  registry = null,
  requiredSplit = 'replication',
  envelope = null,
  currentPreregSha256 = null,
  preregFile = null,
} = {}) {
  const reg = registry || loadRegistry().registry;
  const blockers = [];
  const warnings = [];

  let preregSha = currentPreregSha256;
  if (!preregSha && preregFile && fs.existsSync(preregFile)) {
    preregSha = fileSha256(preregFile);
  }

  const declared = getDeclaredStudyBundle(reg, studyId);
  if (!declared) {
    return {
      eligible: false,
      confirmatory: false,
      status: 'undeclared_bundle',
      blockers: [`study_id '${studyId}' is not in registry.declared_study_bundles`],
      warnings: [],
      study_id: studyId,
    };
  }

  if (declared.confirmatory_eligible_by_default === false) {
    warnings.push('bundle marked confirmatory_eligible_by_default=false');
  }

  // Inline declarations (e.g. blocked judge calibration) have no filesystem path.
  if (declared.declared_inline || declared.path == null) {
    const blockersInline = [
      `inline bundle '${studyId}' has no filesystem artifacts`,
    ];
    if (declared.status === 'blocked_missing_human_labels' || declared.decision_eligible === false) {
      blockersInline.push(`status=${declared.status || 'unknown'}; decision_eligible=false`);
    }
    if (declared.judged_studies_policy === 'manual_only') {
      blockersInline.push('judged studies remain manual_only');
    }
    return {
      eligible: false,
      confirmatory: false,
      status: declared.status || 'inline_ineligible',
      blockers: blockersInline,
      warnings,
      study_id: studyId,
      bundle: declared,
      hashes: {},
      split: null,
      health: null,
      replication_status: null,
      archive_objects: 0,
    };
  }

  const dir = resolveBundleDir(declared);
  if (!dir || !fs.existsSync(dir)) {
    blockers.push(`bundle path missing: ${declared.path}`);
    return {
      eligible: false,
      confirmatory: false,
      status: 'missing_bundle',
      blockers,
      warnings,
      study_id: studyId,
      bundle: declared,
    };
  }

  const artifacts = loadBundleArtifacts(dir);
  for (const m of artifacts.missing) {
    if (m === 'manifest.json') blockers.push('missing manifest.json');
    else warnings.push(`missing optional bundle file: ${m}`);
  }

  const manifest = artifacts.manifest || {};
  const aggregate = artifacts.aggregate || {};
  const env = envelope || aggregate?.result_envelope || manifest?.result_envelope || null;

  if (env) {
    const envCheck = validateResultEnvelope(env);
    if (!envCheck.ok) blockers.push(...envCheck.errors.map(e => `envelope: ${e}`));
  }

  // Judged studies cannot confirm while panel calibration is blocked.
  const judgesPresent = (
    (Array.isArray(env?.judges) && env.judges.length > 0) ||
    (Array.isArray(manifest?.judges) && manifest.judges.length > 0) ||
    declared.kind === 'pairwise' ||
    declared.kind === 'judged' ||
    declared.requires_judges === true ||
    manifest?.study_type === 'pairwise' ||
    manifest?.requires_judges === true
  );
  const panel = reg.judge_panel || {};
  if (judgesPresent) {
    if (panel.decision_eligible === false ||
        panel.calibration_status === 'blocked_missing_human_labels') {
      blockers.push(
        `judge panel calibration blocked (${panel.calibration_status || 'unknown'}); judged studies remain manual_only`
      );
    }
  }

  // 1. exact prereg/dataset/prompt/skill/solver/judge hashes
  const hashes = verifyExactHashes(manifest, env, {
    currentPreregSha256: preregSha,
    repoRoot: REPO_ROOT,
  });
  blockers.push(...hashes.reasons);

  // 2. eligible split
  const split = eligibleSplitOk(manifest, env, requiredSplit);
  blockers.push(...split.reasons);

  // 3. complete health
  const health = healthComplete(extractHealth(env) || extractHealth(aggregate) || extractHealth(manifest));
  blockers.push(...health.reasons);

  // 4. final-rule power
  const stats = env?.statistics || aggregate?.statistics || manifest?.statistics || aggregate || {};
  const power = powerConfigPresent(stats, reg.gates);
  blockers.push(...power.reasons);

  // 5. replication
  const repl = replicationOk(manifest, aggregate);
  blockers.push(...repl.reasons);

  // 6. archive readback + SHA for every confirmatory observation/object
  const archiveObjects = collectArchiveObjects(manifest, aggregate);
  const itemRows = artifacts.items || [];
  const envItems = env?.items || [];
  const expectedItems = itemRows.length > 0 ? itemRows : envItems;

  function observationKey(row, index) {
    if (!row || typeof row !== 'object') return `index:${index}`;
    if (row.item_key) return String(row.item_key);
    if (row.observation_key) return String(row.observation_key);
    const study = studyId || manifest.study_id || 'study';
    const itemId = row.item_id || row.id || row.case_id || `idx${index}`;
    const trial = row.trial != null ? row.trial : 1;
    const armId = row.arm_id || row.arm || 'unknown';
    return `${study}:${itemId}:${trial}:${armId}`;
  }

  const expectedKeys = expectedItems.map((row, i) => observationKey(row, i));
  const expectedCount =
    (Number.isInteger(health.health?.scored) && health.health.scored > 0 && health.health.scored) ||
    (Number.isInteger(manifest?.counts?.scored) && manifest.counts.scored) ||
    (Number.isInteger(manifest?.counts?.bundled_items) && manifest.counts.bundled_items) ||
    expectedKeys.length;

  if (archiveObjects.length === 0) {
    blockers.push('no archive objects declared for readback');
  } else {
    const keyToArchives = new Map();
    const duplicateKeys = new Set();
    let verifiedCount = 0;
    for (let i = 0; i < archiveObjects.length; i++) {
      const obj = archiveObjects[i];
      const key = obj.item_key || obj.observation_key || obj.object_key ||
        (obj.item_id != null ? observationKey(obj, i) : null);
      if (!isNonEmptyString(key)) {
        blockers.push(`archive object[${i}] missing stable item/observation key`);
        continue;
      }
      if (keyToArchives.has(key)) {
        duplicateKeys.add(key);
        blockers.push(`duplicate archive object key '${key}'`);
      }
      keyToArchives.set(key, obj);
      const verified = verifyArchiveObject(obj, REPO_ROOT);
      if (!verified.ok) blockers.push(...verified.reasons.map(r => `archive[${key}]: ${r}`));
      else verifiedCount++;
    }

    if (expectedCount > 0 && keyToArchives.size !== expectedCount) {
      blockers.push(
        `archive object count ${keyToArchives.size} != expected confirmatory observations ${expectedCount}`
      );
    }
    if (expectedKeys.length > 0) {
      for (const key of expectedKeys) {
        if (!keyToArchives.has(key)) {
          blockers.push(`missing archive object for observation key '${key}'`);
        }
      }
    }
    if (verifiedCount === 0) {
      blockers.push('no archive object passed readback+SHA verification');
    } else if (expectedCount > 0 && verifiedCount !== expectedCount) {
      blockers.push(`verified archive objects ${verifiedCount} != expected ${expectedCount}`);
    }
  }

  // evidence_validity explicit provisional blocks confirmation
  const validity = manifest.evidence_validity || aggregate.evidence_validity;
  if (validity && validity !== 'confirmatory' && validity !== 'confirmed') {
    blockers.push(`evidence_validity='${validity}' is not confirmatory`);
  }

  const confirmatory = blockers.length === 0;
  return {
    eligible: confirmatory,
    confirmatory,
    status: confirmatory ? 'confirmatory' : 'ineligible',
    blockers,
    warnings,
    study_id: studyId,
    bundle: declared,
    hashes: hashes.hashes,
    split: split.split,
    health: health.health || null,
    replication_status: repl.status || null,
    archive_objects: archiveObjects.length,
  };
}

/**
 * Load a declared bundle only. Undeclared paths are rejected.
 */
function readDeclaredBundle(studyId, registry = null) {
  const reg = registry || loadRegistry().registry;
  const declared = getDeclaredStudyBundle(reg, studyId);
  if (!declared) {
    const err = new Error(`undeclared study bundle: ${studyId}`);
    err.code = 'UNDECLARED_BUNDLE';
    throw err;
  }
  const dir = resolveBundleDir(declared);
  if (!dir || !fs.existsSync(dir)) {
    const err = new Error(`bundle path missing for ${studyId}: ${declared.path}`);
    err.code = 'BUNDLE_MISSING';
    throw err;
  }
  return {
    declaration: declared,
    ...loadBundleArtifacts(dir),
    confirmation: evaluateConfirmationEligibility({ studyId, registry: reg }),
  };
}

/**
 * Replace recursive JSON scanning: claim candidates come only from declared bundles.
 */
function listConfirmatoryCandidates(registry = null) {
  const reg = registry || loadRegistry().registry;
  return listDeclaredBundles(reg).map(b => evaluateConfirmationEligibility({
    studyId: b.study_id,
    registry: reg,
  }));
}
module.exports = {
  REPO_ROOT,
  STUDIES_ROOT,
  listDeclaredBundles,
  loadBundleArtifacts,
  evaluateConfirmationEligibility,
  readDeclaredBundle,
  listConfirmatoryCandidates,
  verifyArchiveObject,
  verifyExactHashes,
  healthComplete,
  powerConfigPresent,
  hashFieldsPresent,
  eligibleSplitOk,
  replicationOk,
  fileSha256,
  sha256,
};
