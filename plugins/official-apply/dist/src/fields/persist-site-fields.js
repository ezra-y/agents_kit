/**
 * 先把官网真实出现的字段保存为**各自站点**的字段实例。
 *
 * 规则文档：
 * - `docs/03_字段答案与保存模型.md §2.2`
 * - `docs/06_函数接口与执行循环.md §3.4`
 *
 * 三条硬规则：
 * 1. **不同站点的字段分开保存。** 同一个意思的问题，在两家公司是两道不同的原题。
 * 2. **未知字段不能丢。** 看不懂也要先存下来。
 * 3. **公司专属选项留在各自站点记录里**，绝不塞进公共字段目录。
 *
 * 全部写入 `.local/db/knowledge.sqlite`，不碰 private 和 runtime 库。
 */
import { randomUUID } from 'node:crypto';
import { openKnowledgeDatabase } from "../storage/open-knowledge-database.js";
import { normalizeFieldOption } from "./normalize-field-option.js";
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
/** 站点按 host 唯一。公司和站点不是强制一对一（`schemas/knowledge.sql`）。 */
function ensureSite(handle, request, now, newId) {
    const existing = handle.db.prepare('SELECT id FROM sites WHERE host = ?').get(request.siteHost);
    if (existing !== undefined) {
        handle.db
            .prepare('UPDATE sites SET last_seen_at = ?, company_name = COALESCE(?, company_name) WHERE id = ?')
            .run(now, request.companyName ?? null, existing.id);
        return existing.id;
    }
    const siteId = newId('site');
    handle.db
        .prepare(`INSERT INTO sites(id, host, company_key, company_name, family_confidence,
                         detection_evidence_json, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`)
        .run(siteId, request.siteHost, request.companyKey ?? null, request.companyName ?? null, request.familyConfidence ?? null, now, now);
    return siteId;
}
function upsertObservation(handle, siteId, request, field, now, newId) {
    // 同一站点里，字段指纹相同就是同一道题的再次出现，不重复建记录。
    const existing = handle.db
        .prepare('SELECT id FROM site_field_observations WHERE site_id = ? AND field_fingerprint = ?')
        .get(siteId, field.fieldFingerprint);
    if (existing !== undefined) {
        handle.db
            .prepare(`UPDATE site_field_observations
         SET last_observed_at = ?, observation_count = observation_count + 1,
             required = ?, disabled = ?, readonly = ?,
             page_snapshot_id = ?, source_run_id = ?
         WHERE id = ?`)
            .run(now, field.required ? 1 : 0, field.disabled ? 1 : 0, field.readonly ? 1 : 0, request.pageSchema.snapshotId, request.runId, existing.id);
        return { id: existing.id, created: false };
    }
    const id = newId('sitefield');
    handle.db
        .prepare(`INSERT INTO site_field_observations
         (id, site_id, source_task_id, source_run_id, page_snapshot_id, page_url_pattern,
          page_type, step_key, step_label, frame_path_json, section_path_json,
          repeat_group_key, repeat_instance_index, raw_label, accessible_name,
          label_evidence_json, role, html_tag, input_type, html_name, html_id, autocomplete,
          control_kind, required, disabled, readonly, conditional_json, field_fingerprint,
          locator_candidates_json, first_observed_at, last_observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, siteId, request.taskId ?? null, request.runId, request.pageSchema.snapshotId, urlPatternOf(request.pageSchema.url), request.pageSchema.pageType, field.stepKey ?? null, field.stepLabel ?? null, JSON.stringify(field.frame.path), JSON.stringify(field.sectionPath), field.repeatGroupKey ?? null, field.repeatInstanceIndex ?? null, field.rawLabel, field.accessibleName ?? null, JSON.stringify(field.labelEvidence), field.role ?? null, field.htmlTag ?? null, field.inputType ?? null, field.htmlName ?? null, field.htmlId ?? null, field.autocomplete ?? null, field.controlKind, field.required ? 1 : 0, field.disabled ? 1 : 0, field.readonly ? 1 : 0, field.conditional === undefined ? null : JSON.stringify(field.conditional), field.fieldFingerprint, JSON.stringify(field.locatorCandidates), now, now);
    return { id, created: true };
}
/** 只保留 origin + 路径形状，不保存 query。招聘链接的 query 常带候选人标识。 */
function urlPatternOf(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        return `${parsed.origin}${parsed.pathname.replace(/\/\d+/g, '/:num')}`;
    }
    catch {
        return '';
    }
}
function saveOptions(handle, siteFieldId, field, now, newId) {
    if (field.options.length === 0) {
        return 0;
    }
    // 重存前先清掉旧选项：官网改了选项就该以最新一次为准。
    handle.db.prepare('DELETE FROM site_field_options WHERE site_field_id = ?').run(siteFieldId);
    const insert = handle.db.prepare(`INSERT INTO site_field_options
       (id, site_field_id, raw_label, raw_value, normalized_value_json, source,
        sort_order, disabled, first_observed_at, last_observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let count = 0;
    field.options.forEach((option, order) => {
        const normalized = normalizeFieldOption(option);
        insert.run(newId('option'), siteFieldId, option.rawLabel, option.rawValue ?? null, normalized.normalizedValue === undefined ? null : JSON.stringify(normalized.normalizedValue), option.source, order, option.disabled === true ? 1 : 0, now, now);
        count += 1;
    });
    return count;
}
export function persistSiteFields(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    const handle = openKnowledgeDatabase({ paths: request.paths });
    try {
        handle.db.exec('BEGIN');
        try {
            const siteId = ensureSite(handle, request, now, newId);
            const observationIdByRuntimeRef = {};
            const createdObservationIds = [];
            const reusedObservationIds = [];
            let savedOptionCount = 0;
            for (const field of request.pageSchema.fields) {
                const { id, created } = upsertObservation(handle, siteId, request, field, now, newId);
                observationIdByRuntimeRef[field.runtimeRef] = id;
                if (created) {
                    createdObservationIds.push(id);
                }
                else {
                    reusedObservationIds.push(id);
                }
                savedOptionCount += saveOptions(handle, id, field, now, newId);
            }
            handle.db.exec('COMMIT');
            return {
                siteId,
                observationIdByRuntimeRef,
                createdObservationIds,
                reusedObservationIds,
                savedOptionCount,
            };
        }
        catch (error) {
            handle.db.exec('ROLLBACK');
            throw error;
        }
    }
    finally {
        handle.close();
    }
}
//# sourceMappingURL=persist-site-fields.js.map