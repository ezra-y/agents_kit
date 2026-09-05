'use strict';

/**
 * Study/catalog registry loader and validator.
 * Source of truth: evals/studies/registry.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_REGISTRY_PATH = path.join(REPO_ROOT, 'evals', 'studies', 'registry.json');

function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const resolved = path.resolve(registryPath);
  if (!fs.existsSync(resolved)) {
    const err = new Error(`registry not found: ${resolved}`);
    err.code = 'REGISTRY_MISSING';
    throw err;
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const registry = JSON.parse(raw);
  return { path: resolved, registry };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Validate registry shape and make unknown/inadequate data explicit.
 * @returns {{ok:boolean, errors:string[], warnings:string[], summary:object}}
 */
function validateRegistry(registry) {
  const errors = [];
  const warnings = [];

  if (!registry || typeof registry !== 'object') {
    return { ok: false, errors: ['registry must be an object'], warnings, summary: {} };
  }
  if (registry.schema_version !== 1) errors.push('schema_version must equal 1');
  if (!registry.catalog || typeof registry.catalog !== 'object') errors.push('catalog is required');
  if (!registry.skills || typeof registry.skills !== 'object') errors.push('skills is required');
  if (!registry.deleted_skills || typeof registry.deleted_skills !== 'object') {
    errors.push('deleted_skills is required for cutover provenance');
  }
  if (!registry.models || typeof registry.models !== 'object') errors.push('models is required');
  if (!registry.judge_panel || typeof registry.judge_panel !== 'object') errors.push('judge_panel is required');
  if (!registry.arms || typeof registry.arms !== 'object') errors.push('arms is required');
  if (!registry.gates || typeof registry.gates !== 'object') errors.push('gates is required');
  if (!Array.isArray(registry.required_skill_sections) || registry.required_skill_sections.length === 0) {
    errors.push('required_skill_sections must be a non-empty array');
  }
  if (!Array.isArray(registry.declared_study_bundles)) errors.push('declared_study_bundles must be an array');

  const skills = registry.skills || {};
  const deletedSkills = registry.deleted_skills || {};
  const skillIds = Object.keys(skills);
  const deletedIds = Object.keys(deletedSkills);
  const catalog = registry.catalog || {};
  const expectedCount = catalog.expected_count ?? catalog.cutover_count;
  const baselineCount = catalog.baseline_count;
  if (expectedCount != null && skillIds.length !== expectedCount) {
    errors.push(`skills count ${skillIds.length} != expected_count ${expectedCount}`);
  }
  if (baselineCount != null && skillIds.length + deletedIds.length !== baselineCount) {
    errors.push(
      `skills(${skillIds.length})+deleted_skills(${deletedIds.length}) != baseline_count ${baselineCount}`
    );
  }

  const survivors = new Set(catalog.survivors || []);
  const deletions = new Set(catalog.deletions || []);
  const budgets = catalog.survivor_budgets || {};

  for (const id of survivors) {
    if (!skills[id]) errors.push(`survivor missing from skills: ${id}`);
    else if (skills[id].disposition?.cutover !== 'survive') errors.push(`survivor ${id} cutover must be survive`);
    if (deletedSkills[id]) errors.push(`survivor ${id} must not appear in deleted_skills`);
    if (budgets[id] == null) errors.push(`survivor budget missing for ${id}`);
  }
  for (const id of deletions) {
    if (!deletedSkills[id]) errors.push(`deletion missing from deleted_skills: ${id}`);
    else if (deletedSkills[id].disposition?.cutover !== 'delete') {
      errors.push(`deletion ${id} cutover must be delete`);
    }
    if (skills[id]) errors.push(`deletion ${id} must not appear in active skills`);
  }
  if (survivors.size && skillIds.length !== survivors.size) {
    errors.push(`survivors(${survivors.size}) != skills(${skillIds.length})`);
  }
  if (deletions.size && deletedIds.length !== deletions.size) {
    errors.push(`deletions(${deletions.size}) != deleted_skills(${deletedIds.length})`);
  }
  const union = new Set([...skillIds, ...deletedIds]);
  if (union.size !== skillIds.length + deletedIds.length) {
    errors.push('skills and deleted_skills must be disjoint');
  }
  let adequate = 0;
  let inadequate = 0;
  let unknown = 0;
  const inadequateIds = [];
  const unknownIds = [];

  function validateSkillRow(id, skill, { active }) {
    const label = active ? 'skill' : 'deleted_skill';
    if (!isNonEmptyString(skill.id) || skill.id !== id) errors.push(`${label} key/id mismatch for ${id}`);
    if (!isNonEmptyString(skill.dir)) errors.push(`${label} ${id} missing dir`);
    if (!isNonEmptyString(skill.primary_metric)) errors.push(`${label} ${id} missing primary_metric`);
    if (!skill.disposition || typeof skill.disposition !== 'object') {
      errors.push(`${label} ${id} missing disposition`);
      return;
    }
    if (active && skill.disposition.cutover !== 'survive') {
      errors.push(`active skill ${id} cutover must be survive`);
    }
    if (!active && skill.disposition.cutover !== 'delete') {
      errors.push(`deleted_skill ${id} cutover must be delete`);
    }
    if (!active) {
      if (!isNonEmptyString(skill.contract_path)) {
        errors.push(`deleted_skill ${id} missing contract_path`);
      }
      if (!Array.isArray(skill.study_ids)) {
        errors.push(`deleted_skill ${id} study_ids must be an array`);
      } else {
        for (const sid of skill.study_ids) {
          if (!isNonEmptyString(sid)) {
            errors.push(`deleted_skill ${id} study_ids entries must be non-empty strings`);
            break;
          }
        }
      }
      if (!Array.isArray(skill.disposition.absorb_into)) {
        errors.push(`deleted_skill ${id} absorb_into must be an array`);
      } else {
        for (const target of skill.disposition.absorb_into) {
          if (!isNonEmptyString(target)) {
            errors.push(`deleted_skill ${id} absorb_into entries must be non-empty strings`);
            break;
          }
          if (!skills[target] && !survivors.has(target)) {
            errors.push(`deleted_skill ${id} absorb_into target missing from active skills: ${target}`);
          }
        }
      }
      if (!isNonEmptyString(skill.disposition.mechanism)) {
        errors.push(`deleted_skill ${id} missing disposition.mechanism`);
      }
    }
    if (!skill.data || typeof skill.data !== 'object') {
      errors.push(`${label} ${id} missing data block`);
      return;
    }
    const status = skill.data.status;
    if (!['adequate', 'inadequate', 'unknown'].includes(status)) {
      errors.push(`${label} ${id} data.status must be adequate|inadequate|unknown (got ${status})`);
    }
    if (active) {
      if (status === 'adequate') adequate++;
      else if (status === 'inadequate') {
        inadequate++;
        inadequateIds.push(id);
        if (!Array.isArray(skill.data.gaps) || skill.data.gaps.length === 0) {
          errors.push(`skill ${id} inadequate without explicit gaps`);
        }
      } else if (status === 'unknown') {
        unknown++;
        unknownIds.push(id);
        if (!Array.isArray(skill.data.gaps) || skill.data.gaps.length === 0) {
          errors.push(`skill ${id} unknown without explicit gaps`);
        }
      }
      const migration = skill.data.migration_coverage;
      if (migration !== undefined) {
        if (!migration || typeof migration !== 'object') {
          errors.push(`skill ${id} data.migration_coverage must be an object`);
        } else {
          if (migration.status !== 'consumed_provisional') {
            errors.push(`skill ${id} migration coverage must be consumed_provisional`);
          }
          if (migration.freshness_eligible !== false) {
            errors.push(`skill ${id} migration coverage must set freshness_eligible=false`);
          }
          if (migration.excluded_from_confirmatory_counts !== true) {
            errors.push(`skill ${id} migration coverage must be excluded from confirmatory counts`);
          }
          if (!Array.isArray(migration.sources) || migration.sources.length === 0) {
            errors.push(`skill ${id} migration coverage sources must be a non-empty array`);
          } else {
            const confirmatoryPaths = new Set((skill.data.sources || []).map(source => source?.path));
            for (const source of migration.sources) {
              if (!isNonEmptyString(source?.path) ||
                  !/^[a-f0-9]{64}$/.test(source?.sha256 || '') ||
                  !Number.isInteger(source?.rows) ||
                  source.rows <= 0) {
                errors.push(`skill ${id} migration coverage source is incomplete`);
                continue;
              }
              if (confirmatoryPaths.has(source.path)) {
                errors.push(`skill ${id} migration source cannot be a confirmatory data source: ${source.path}`);
              }
            }
          }
        }
      }
      if (survivors.has(id)) {
        const maxWords = skill.max_words ?? skill.disposition?.max_words ?? budgets[id];
        if (!isPositiveNumber(maxWords)) errors.push(`survivor ${id} missing positive max_words`);
      }
    } else if ((status === 'inadequate' || status === 'unknown') &&
        (!Array.isArray(skill.data.gaps) || skill.data.gaps.length === 0)) {
      errors.push(`deleted_skill ${id} ${status} without explicit gaps`);
    }
  }

  for (const [id, skill] of Object.entries(skills)) {
    validateSkillRow(id, skill, { active: true });
  }
  for (const [id, skill] of Object.entries(deletedSkills)) {
    validateSkillRow(id, skill, { active: false });
  }

  // Every declared absorption must be recorded symmetrically at its active
  // destination, including the exact mechanism contract. This prevents a
  // deleted skill from silently losing its active ingredient at cutover.
  for (const [deletedId, deleted] of Object.entries(deletedSkills)) {
    const targets = deleted.disposition?.absorb_into || [];
    for (const targetId of targets) {
      const destination = skills[targetId];
      if (!destination) continue; // Missing target is reported above.
      const absorbs = destination.disposition?.absorbs;
      const mechanisms = destination.disposition?.absorbed_mechanisms;
      if (!Array.isArray(absorbs) || !absorbs.includes(deletedId)) {
        errors.push(`skill ${targetId} missing absorbed source ${deletedId}`);
      }
      const matches = Array.isArray(mechanisms)
        ? mechanisms.filter(entry => entry?.id === deletedId)
        : [];
      if (matches.length !== 1) {
        errors.push(`skill ${targetId} must declare exactly one absorbed mechanism for ${deletedId}`);
      } else if (matches[0].mechanism !== deleted.disposition.mechanism) {
        errors.push(`skill ${targetId} absorbed mechanism mismatch for ${deletedId}`);
      }
    }
  }
  for (const [targetId, destination] of Object.entries(skills)) {
    const absorbs = destination.disposition?.absorbs;
    const mechanisms = destination.disposition?.absorbed_mechanisms;
    if (!Array.isArray(absorbs)) {
      errors.push(`skill ${targetId} disposition.absorbs must be an array`);
      continue;
    }
    if (!Array.isArray(mechanisms)) {
      errors.push(`skill ${targetId} disposition.absorbed_mechanisms must be an array`);
      continue;
    }
    if (new Set(absorbs).size !== absorbs.length) {
      errors.push(`skill ${targetId} disposition.absorbs contains duplicates`);
    }
    for (const deletedId of absorbs) {
      if (!deletedSkills[deletedId]) {
        errors.push(`skill ${targetId} absorbs unknown deleted skill ${deletedId}`);
      } else if (!(deletedSkills[deletedId].disposition?.absorb_into || []).includes(targetId)) {
        errors.push(`skill ${targetId} absorption not declared by deleted skill ${deletedId}`);
      }
    }
    for (const entry of mechanisms) {
      if (!absorbs.includes(entry?.id)) {
        errors.push(`skill ${targetId} has orphan absorbed mechanism ${entry?.id || 'missing'}`);
      }
    }
  }

  // declared data_adequacy must match computed active statuses (explicit, no silent filter)
  if (registry.data_adequacy) {
    const declaredUnknown = new Set(registry.data_adequacy.unknown_skill_ids || []);
    const declaredInadequate = new Set(registry.data_adequacy.inadequate_skill_ids || []);
    for (const id of unknownIds) {
      if (!declaredUnknown.has(id)) errors.push(`data_adequacy.unknown_skill_ids missing ${id}`);
    }
    for (const id of inadequateIds) {
      if (!declaredInadequate.has(id)) errors.push(`data_adequacy.inadequate_skill_ids missing ${id}`);
    }
    for (const id of declaredUnknown) {
      if (!unknownIds.includes(id)) errors.push(`data_adequacy.unknown_skill_ids has stale ${id}`);
      if (deletedSkills[id]) errors.push(`data_adequacy.unknown_skill_ids must not list deleted ${id}`);
    }
    for (const id of declaredInadequate) {
      if (!inadequateIds.includes(id)) errors.push(`data_adequacy.inadequate_skill_ids has stale ${id}`);
      if (deletedSkills[id]) errors.push(`data_adequacy.inadequate_skill_ids must not list deleted ${id}`);
    }

    const prov = registry.data_adequacy.deleted_skills_provenance || {};
    const provUnknown = new Set(prov.unknown_skill_ids || []);
    const provInadequate = new Set(prov.inadequate_skill_ids || []);
    const provAdequate = new Set(prov.adequate_skill_ids || []);
    for (const [id, skill] of Object.entries(deletedSkills)) {
      const status = skill?.data?.status;
      if (status === 'unknown' && !provUnknown.has(id)) {
        errors.push(`data_adequacy.deleted_skills_provenance.unknown_skill_ids missing ${id}`);
      }
      if (status === 'inadequate' && !provInadequate.has(id)) {
        errors.push(`data_adequacy.deleted_skills_provenance.inadequate_skill_ids missing ${id}`);
      }
      if (status === 'adequate' && !provAdequate.has(id)) {
        errors.push(`data_adequacy.deleted_skills_provenance.adequate_skill_ids missing ${id}`);
      }
    }
    for (const id of provUnknown) {
      if (!deletedSkills[id]) errors.push(`deleted provenance unknown has non-deleted ${id}`);
      else if (deletedSkills[id].data?.status !== 'unknown') {
        errors.push(`deleted provenance unknown stale for ${id}`);
      }
    }
    for (const id of provInadequate) {
      if (!deletedSkills[id]) errors.push(`deleted provenance inadequate has non-deleted ${id}`);
      else if (deletedSkills[id].data?.status !== 'inadequate') {
        errors.push(`deleted provenance inadequate stale for ${id}`);
      }
    }
    for (const id of provAdequate) {
      if (!deletedSkills[id]) errors.push(`deleted provenance adequate has non-deleted ${id}`);
      else if (deletedSkills[id].data?.status !== 'adequate') {
        errors.push(`deleted provenance adequate stale for ${id}`);
      }
    }
  } else {
    errors.push('data_adequacy block required so unknown/inadequate are explicit');
  }

  const gates = registry.gates || {};
  for (const field of ['utility_margin_pp', 'noninferiority_margin_pp', 'harm_margin_pp', 'efficacy_hypotheses', 'power_target']) {
    if (gates[field] == null) errors.push(`gates.${field} required`);
  }
  if (gates.utility_margin_pp !== 5) errors.push('gates.utility_margin_pp must equal 5');
  if (gates.noninferiority_margin_pp !== 3) errors.push('gates.noninferiority_margin_pp must equal 3');
  if (gates.harm_margin_pp !== 2) errors.push('gates.harm_margin_pp must equal 2');
  if (gates.efficacy_hypotheses !== 84) errors.push('gates.efficacy_hypotheses must equal 84');

  const panel = registry.judge_panel || {};
  if (!Array.isArray(panel.models) || panel.models.length < 2) {
    errors.push('judge_panel.models must list at least 2 judges');
  }
  const panelSize = panel.panel_size ?? (Array.isArray(panel.models) ? panel.models.length : 0);
  const votesPerJudge = panel.votes_per_judge ?? panel.votes_per_item ?? 1;
  const maxVotes = panel.max_votes_per_item ?? (panelSize * votesPerJudge);
  const minValid = panel.min_valid_votes_to_decide;
  if (!Number.isInteger(minValid) || minValid < 2) {
    errors.push('judge_panel.min_valid_votes_to_decide must be an integer >= 2');
  }
  if (!Number.isInteger(maxVotes) || maxVotes < 1) {
    errors.push('judge_panel.max_votes_per_item must be a positive integer');
  } else if (Number.isInteger(minValid) && maxVotes < minValid) {
    errors.push(
      `judge_panel max_votes_per_item (${maxVotes}) must be >= min_valid_votes_to_decide (${minValid})`
    );
  }
  if (panel.votes_per_item != null && panel.min_valid_votes_to_decide != null &&
      panel.votes_per_item < panel.min_valid_votes_to_decide) {
    errors.push('judge_panel.votes_per_item must be >= min_valid_votes_to_decide');
  }
  if (!panel.calibration || typeof panel.calibration !== 'object') {
    errors.push('judge_panel.calibration thresholds required');
  } else if (panel.calibration.min_pairs !== 30) {
    errors.push('judge_panel.calibration.min_pairs must equal 30');
  }
  if (panel.calibration_status !== 'blocked_missing_human_labels' && panel.decision_eligible === true) {
    // calibrated path must still declare study
  }
  if (panel.calibration_status === 'blocked_missing_human_labels') {
    if (panel.decision_eligible !== false) {
      errors.push('judge_panel.decision_eligible must be false while calibration is blocked');
    }
    if (panel.judged_studies_policy_while_blocked !== 'manual_only') {
      errors.push('judge_panel.judged_studies_policy_while_blocked must be manual_only while blocked');
    }
  }
  if (!isNonEmptyString(panel.calibration_status)) {
    errors.push('judge_panel.calibration_status required');
  }

  const arms = registry.arms || {};
  if (!Array.isArray(arms.all) || !arms.all.includes('none') || !arms.all.includes('lean')) {
    errors.push('arms.all must include none and lean');
  }

  if (!registry.study_contracts || typeof registry.study_contracts !== 'object') {
    errors.push('study_contracts required');
  }

  // Family counts must exist and sum to active skill count
  if (!registry.family_counts || typeof registry.family_counts !== 'object') {
    errors.push('family_counts required');
  } else {
    const byFamily = registry.family_counts.by_eval_family || {};
    const computed = {};
    for (const skill of Object.values(skills)) {
      const fam = skill.eval_family || 'unknown';
      computed[fam] = (computed[fam] || 0) + 1;
    }
    const declaredTotal = registry.family_counts.total_skills;
    const sumFamilies = Object.values(byFamily).reduce((a, b) => a + Number(b || 0), 0);
    if (declaredTotal !== skillIds.length) {
      errors.push(`family_counts.total_skills ${declaredTotal} != skills ${skillIds.length}`);
    }
    if (sumFamilies !== skillIds.length) {
      errors.push(`family_counts.by_eval_family sum ${sumFamilies} != skills ${skillIds.length}`);
    }
    for (const [fam, n] of Object.entries(computed)) {
      if (byFamily[fam] !== n) errors.push(`family_counts mismatch for ${fam}: declared ${byFamily[fam]} computed ${n}`);
    }
    for (const fam of Object.keys(byFamily)) {
      if (computed[fam] == null) errors.push(`family_counts has unknown family ${fam}`);
    }
    if (registry.family_counts.survivors != null && registry.family_counts.survivors !== survivors.size) {
      errors.push('family_counts.survivors mismatch');
    }
    if (registry.family_counts.deletions != null && registry.family_counts.deletions !== deletions.size) {
      errors.push('family_counts.deletions mismatch');
    }
    if (registry.family_counts.deleted_total_skills != null &&
        registry.family_counts.deleted_total_skills !== deletedIds.length) {
      errors.push('family_counts.deleted_total_skills mismatch');
    }
    if (registry.family_counts.baseline_total_skills != null &&
        registry.family_counts.baseline_total_skills !== skillIds.length + deletedIds.length) {
      errors.push('family_counts.baseline_total_skills mismatch');
    }
    if (registry.family_counts.deleted_by_eval_family) {
      const deletedComputed = {};
      for (const skill of Object.values(deletedSkills)) {
        const fam = skill.eval_family || 'unknown';
        deletedComputed[fam] = (deletedComputed[fam] || 0) + 1;
      }
      const deletedDeclared = registry.family_counts.deleted_by_eval_family;
      const deletedSum = Object.values(deletedDeclared).reduce((a, b) => a + Number(b || 0), 0);
      if (deletedSum !== deletedIds.length) {
        errors.push(`family_counts.deleted_by_eval_family sum ${deletedSum} != deleted_skills ${deletedIds.length}`);
      }
      for (const [fam, n] of Object.entries(deletedComputed)) {
        if (deletedDeclared[fam] !== n) {
          errors.push(`family_counts.deleted_by_eval_family mismatch for ${fam}`);
        }
      }
    }
    if (registry.family_counts.efficacy_hypotheses != null && registry.family_counts.efficacy_hypotheses !== 84) {
      errors.push('family_counts.efficacy_hypotheses must equal 84');
    }
  }

  // Declared calibration study required (inline registry declaration is enough)
  const bundles = registry.declared_study_bundles || [];
  const calib = bundles.find(b => b.study_id === 'judge-panel-calibration' || b.kind === 'judge_panel_calibration');
  const calibContract = registry.study_contracts?.judge_panel_calibration;
  if (!calib && !calibContract) {
    errors.push('judge-panel-calibration must be declared in study_contracts or declared_study_bundles');
  } else {
    const status = calib?.status || calibContract?.status;
    const decisionEligible = calib?.decision_eligible ?? calibContract?.decision_eligible;
    const policy = calib?.judged_studies_policy || calibContract?.rule?.judged_studies_while_blocked;
    if (panel.calibration_status === 'blocked_missing_human_labels') {
      if (status !== 'blocked_missing_human_labels') {
        errors.push('judge-panel-calibration status must be blocked_missing_human_labels while panel blocked');
      }
      if (decisionEligible !== false) {
        errors.push('judge-panel-calibration decision_eligible must be false until calibrated');
      }
      if (policy !== 'manual_only') {
        errors.push('judge-panel-calibration judged studies policy must be manual_only while blocked');
      }
    }
  }

  const summary = {
    skill_count: skillIds.length,
    deleted_skill_count: deletedIds.length,
    baseline_skill_count: skillIds.length + deletedIds.length,
    survivors: survivors.size,
    deletions: deletions.size,
    data_adequate: adequate,
    data_inadequate: inadequate,
    data_unknown: unknown,
    inadequate_skill_ids: inadequateIds.sort(),
    unknown_skill_ids: unknownIds.sort(),
    declared_study_bundles: bundles.length,
    judge_panel_calibration_status: panel.calibration_status || null,
    judge_panel_decision_eligible: panel.decision_eligible,
  };

  return { ok: errors.length === 0, errors, warnings, summary };
}

function countJsonlSplits(filePath) {
  const splits = { dev: 0, heldout: 0, replication: 0, other: 0 };
  let n = 0;
  if (!fs.existsSync(filePath)) return { n, splits, exists: false };
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    n++;
    try {
      const row = JSON.parse(line);
      if (row.split && splits[row.split] !== undefined) splits[row.split]++;
      else splits.other++;
    } catch (_) {
      splits.other++;
    }
  }
  return { n, splits, exists: true };
}

/**
 * File-aware source integrity: path exists, sha matches, split counts match registry.
 */
function validateRegistrySources(registry, repoRoot = REPO_ROOT) {
  const errors = [];
  const warnings = [];
  const skills = registry.skills || {};
  for (const [id, skill] of Object.entries(skills)) {
    const data = skill.data || {};
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const declared = data.row_counts || {};
    let totalN = 0;
    const observedSplits = { dev: 0, heldout: 0, replication: 0, other: 0 };

    for (const src of sources) {
      if (!src || !isNonEmptyString(src.path)) {
        errors.push(`skill ${id}: source missing path`);
        continue;
      }
      const abs = path.isAbsolute(src.path) ? src.path : path.join(repoRoot, src.path);
      if (!fs.existsSync(abs)) {
        errors.push(`skill ${id}: source path missing ${src.path}`);
        continue;
      }
      const actualSha = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      if (src.sha256 && src.sha256 !== actualSha) {
        errors.push(`skill ${id}: source sha mismatch for ${src.path}`);
      } else if (!src.sha256) {
        errors.push(`skill ${id}: source missing sha256 for ${src.path}`);
      }
      const counts = countJsonlSplits(abs);
      totalN += counts.n;
      for (const k of Object.keys(observedSplits)) observedSplits[k] += counts.splits[k] || 0;
    }

    if (sources.length === 0) {
      if (data.status !== 'unknown') {
        errors.push(`skill ${id}: no sources but data.status=${data.status}`);
      }
      continue;
    }

    if (declared.n != null && declared.n !== totalN) {
      errors.push(`skill ${id}: row_counts.n ${declared.n} != observed ${totalN}`);
    }
    if (declared.splits) {
      for (const k of ['dev', 'heldout', 'replication']) {
        if (declared.splits[k] != null && declared.splits[k] !== observedSplits[k]) {
          errors.push(`skill ${id}: row_counts.splits.${k} ${declared.splits[k]} != observed ${observedSplits[k]}`);
        }
      }
    }
  }

  // Inline calibration contract integrity (no external manifest required in this phase)
  const calib = (registry.declared_study_bundles || []).find(b => b.study_id === 'judge-panel-calibration');
  const contract = registry.study_contracts?.judge_panel_calibration;
  if (calib || contract) {
    const status = calib?.status || contract?.status;
    const decisionEligible = calib?.decision_eligible ?? contract?.decision_eligible;
    const policy = calib?.judged_studies_policy || contract?.rule?.judged_studies_while_blocked;
    if (status !== 'blocked_missing_human_labels') {
      errors.push('judge-panel-calibration status must be blocked_missing_human_labels');
    }
    if (decisionEligible !== false) {
      errors.push('judge-panel-calibration decision_eligible must be false');
    }
    if (policy !== 'manual_only') {
      errors.push('judge-panel-calibration judged studies policy must be manual_only');
    }
    if ((contract?.human_labeled_pairs?.count ?? registry.judge_panel?.human_labeled_pairs?.count ?? 0) !== 0) {
      // non-zero without calibrated status is inconsistent for blocked state
      if (registry.judge_panel?.calibration_status === 'blocked_missing_human_labels') {
        errors.push('blocked calibration cannot claim non-zero human_labeled_pairs');
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function getSkillBudget(registry, skillId) {
  const skill = registry.skills?.[skillId];
  if (!skill) return null;
  return skill.max_words ?? skill.disposition?.max_words ?? registry.catalog?.survivor_budgets?.[skillId] ?? null;
}

function listSkillEntries(registry) {
  return Object.values(registry.skills || {}).slice().sort((a, b) => a.id.localeCompare(b.id));
}

function getDeclaredStudyBundle(registry, studyId) {
  return (registry.declared_study_bundles || []).find(b => b.study_id === studyId) || null;
}

function loadAndValidateRegistry(registryPath = DEFAULT_REGISTRY_PATH, opts = {}) {
  const { path: resolved, registry } = loadRegistry(registryPath);
  const validation = validateRegistry(registry);
  const checkSources = opts.checkSources !== false &&
    (registry.source_integrity?.validate_on_load !== false);
  if (checkSources) {
    const sourceValidation = validateRegistrySources(registry, opts.repoRoot || REPO_ROOT);
    validation.source_validation = sourceValidation;
    if (!sourceValidation.ok) {
      validation.ok = false;
      validation.errors = validation.errors.concat(sourceValidation.errors.map(e => `source: ${e}`));
    }
  }
  return { path: resolved, registry, validation };
}

module.exports = {
  REPO_ROOT,
  DEFAULT_REGISTRY_PATH,
  loadRegistry,
  validateRegistry,
  validateRegistrySources,
  loadAndValidateRegistry,
  getSkillBudget,
  listSkillEntries,
  getDeclaredStudyBundle,
};
