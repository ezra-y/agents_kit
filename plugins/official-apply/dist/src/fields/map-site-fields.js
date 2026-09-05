/**
 * 把官网字段实例映射到公共字段概念。
 *
 * 规则文档：
 * - `docs/03_字段答案与保存模型.md §2.4`
 * - `docs/04_官网扫描与字段识别算法.md §18`
 * - `docs/06_函数接口与执行循环.md §3.5`
 *
 * 三条硬规则：
 * 1. **不能把官网 HTML name 直接变成公共字段 key。** 公共目录只放通用语义。
 * 2. **低置信度不自动填值。** 只标 `requiresReview`，把决定权交回人。
 * 3. **认不出来就进候选池**，绝不自动改 `knowledge/field-catalog.yaml`。
 *
 * 公共目录的单一事实源是 `knowledge/field-catalog.yaml`；
 * `catalog_fields_cache` 只是运行期缓存。
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { openKnowledgeDatabase } from "../storage/open-knowledge-database.js";
import { scoreFieldMapping, normalizeForMatch } from "./score-field-mapping.js";
/**
 * 置信度门槛。
 *
 * `docs/04 §18.3` 明确说不要在文档里写死一个永远不变的数字，
 * 所以这里集中成常量，方便按真实数据调整。
 */
export const MAPPING_THRESHOLDS = {
    /** 高于这个分且与第二名拉开差距，才允许自动填。 */
    auto: 0.45,
    /** 低于这个分算认不出来，进候选池。 */
    unresolved: 0.2,
    /** 前两名差距小于这个值算冲突，不自动填。 */
    conflictGap: 0.08,
};
function fieldsError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
export function fieldCatalogPath(paths) {
    return path.join(paths.publicKnowledgeDir, 'field-catalog.yaml');
}
/**
 * 公共目录用 HTML 习惯的控件名，合同用归一化后的 `ControlKind`。
 * 这里做一次对照，让「控件类型」这条证据真的能命中。
 */
const CATALOG_CONTROL_ALIASES = {
    text: 'text',
    textbox: 'text',
    textarea: 'textarea',
    email: 'email',
    tel: 'phone',
    phone: 'phone',
    number: 'number',
    date: 'date',
    datepicker: 'date_picker',
    date_picker: 'date_picker',
    select: 'native_select',
    native_select: 'native_select',
    multiselect: 'checkbox_group',
    combobox: 'combobox',
    radio: 'radio_group',
    radio_group: 'radio_group',
    checkbox: 'checkbox',
    checkbox_group: 'checkbox_group',
    file: 'file_upload',
    file_upload: 'file_upload',
    contenteditable: 'contenteditable',
    cascading_select: 'cascading_select',
};
const ALLOWED_SENSITIVITY = new Set([
    'normal',
    'personal',
    'sensitive',
    'highly_sensitive',
    'credential',
]);
const ALLOWED_SCOPE = new Set([
    'global',
    'profile_record',
    'company',
    'job',
    'application',
    'session',
]);
const ALLOWED_POLICY = new Set([
    'extract_or_ask',
    'reuse_if_explicit',
    'confirm_each_application',
    'never_infer',
]);
const ALLOWED_STATUS = new Set(['candidate', 'verified', 'stable', 'deprecated']);
/**
 * 读取公共字段目录。
 *
 * YAML 用 snake_case，合同用 camelCase，这里做一次转换。
 *
 * 枚举值必须落在数据库 CHECK 允许的集合里。
 * 对不上就**当场报错并指名道姓**，不悄悄替换成一个可能错的值。
 */
export function loadFieldCatalog(paths) {
    const file = fieldCatalogPath(paths);
    if (!existsSync(file)) {
        throw fieldsError('field_catalog_missing', `找不到公共字段目录 ${file}`);
    }
    let parsed;
    try {
        parsed = parseYaml(readFileSync(file, 'utf8'));
    }
    catch (error) {
        throw fieldsError('field_catalog_invalid', `${file} 不是合法 YAML：${error instanceof Error ? error.message.split('\n')[0] : ''}`);
    }
    const rawFields = parsed?.fields;
    if (!Array.isArray(rawFields)) {
        throw fieldsError('field_catalog_invalid', `${file} 缺少 fields 列表`);
    }
    return rawFields
        .filter((raw) => typeof raw.key === 'string' && typeof raw.name === 'string')
        .map((raw) => ({
        key: raw.key,
        name: raw.name,
        ...(raw.description === undefined ? {} : { description: raw.description }),
        category: raw.category ?? 'other',
        aliases: raw.aliases ?? [],
        valueType: raw.value_type ?? 'text',
        commonControls: (raw.common_controls ?? [])
            .map((control) => CATALOG_CONTROL_ALIASES[control.toLowerCase()])
            .filter((control) => control !== undefined),
        answerScope: (raw.answer_scope ?? 'global'),
        answerPolicy: (raw.answer_policy ?? 'extract_or_ask'),
        sensitivity: (raw.sensitivity ?? 'normal'),
        ...(raw.validation_rule === undefined ? {} : { validationRule: raw.validation_rule }),
        ...(raw.option_normalization === undefined
            ? {}
            : { optionNormalization: raw.option_normalization }),
        status: (raw.status ?? 'candidate'),
        ...(raw.superseded_by === undefined ? {} : { supersededBy: raw.superseded_by }),
    }))
        .map((entry) => {
        assertAllowed(entry.key, 'sensitivity', entry.sensitivity, ALLOWED_SENSITIVITY);
        assertAllowed(entry.key, 'answer_scope', entry.answerScope, ALLOWED_SCOPE);
        assertAllowed(entry.key, 'answer_policy', entry.answerPolicy, ALLOWED_POLICY);
        assertAllowed(entry.key, 'status', entry.status, ALLOWED_STATUS);
        return entry;
    });
}
function assertAllowed(fieldKey, attribute, value, allowed) {
    if (!allowed.has(value)) {
        throw fieldsError('field_catalog_invalid', `字段 ${fieldKey} 的 ${attribute}=${value} 不在允许集合里（${[...allowed].join(' / ')}）`);
    }
}
/**
 * 把公共目录导入运行期缓存。
 *
 * 缓存只是为了让 `field_mappings.canonical_key` 有外键可指，
 * 真正的事实源仍是 YAML 文件。
 */
export function importFieldCatalog(paths, now = new Date().toISOString()) {
    const catalog = loadFieldCatalog(paths);
    const hash = createHash('sha256')
        .update(readFileSync(fieldCatalogPath(paths)))
        .digest('hex')
        .slice(0, 32);
    const handle = openKnowledgeDatabase({ paths });
    try {
        handle.db.exec('BEGIN');
        try {
            const upsert = handle.db.prepare(`INSERT OR REPLACE INTO catalog_fields_cache
           (canonical_key, name, description, category, value_type, common_controls_json,
            answer_scope, answer_policy, sensitivity, validation_rule,
            option_normalization_json, status, superseded_by, source_catalog_hash, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            const upsertAlias = handle.db.prepare(`INSERT OR IGNORE INTO catalog_aliases_cache
           (id, canonical_key, alias, normalized_alias, source)
         VALUES (?, ?, ?, ?, 'catalog')`);
            for (const field of catalog) {
                upsert.run(field.key, field.name, field.description ?? null, field.category, field.valueType, JSON.stringify(field.commonControls), field.answerScope, field.answerPolicy, field.sensitivity, field.validationRule ?? null, field.optionNormalization === undefined ? null : JSON.stringify(field.optionNormalization), field.status, field.supersededBy ?? null, hash, now);
                for (const alias of [field.name, ...field.aliases]) {
                    upsertAlias.run(`alias_${createHash('sha1').update(`${field.key}|${alias}`).digest('hex').slice(0, 16)}`, field.key, alias, normalizeForMatch(alias));
                }
            }
            handle.db.exec('COMMIT');
        }
        catch (error) {
            handle.db.exec('ROLLBACK');
            throw error;
        }
    }
    finally {
        handle.close();
    }
    return catalog.length;
}
/** 这个站点上已经人工确认过的映射，用指纹匹配。 */
function loadSiteHistory(handle, siteId) {
    const rows = handle.db
        .prepare(`SELECT o.field_fingerprint AS fingerprint, m.canonical_key AS canonicalKey
       FROM field_mappings m
       JOIN site_field_observations o ON o.id = m.site_field_id
       WHERE o.site_id = ? AND m.status = 'verified' AND m.canonical_key IS NOT NULL`)
        .all(siteId);
    return new Map(rows.map((row) => [row.fingerprint, row.canonicalKey]));
}
/**
 * 配方提示的可信度。
 *
 * 人工审核过的公共配方（`knowledge/`）比本机刚学到的候选更可信，
 * 但两者都**不等于**用户亲自确认过这个站点的这个字段——
 * 所以状态是 `candidate` 而不是 `verified`，也就不会被当成人工确认写回历史。
 */
const RECIPE_HINT_CONFIDENCE = {
    reviewed: 0.9,
    candidate: 0.75,
};
/** 提示和字段对得上吗。题干必须一致；有 section 限定时也要对得上。 */
function hintMatchesField(hint, field) {
    if (normalizeForMatch(hint.rawLabel) !== normalizeForMatch(field.rawLabel)) {
        return false;
    }
    const required = hint.sectionPathContains ?? [];
    if (required.length === 0) {
        return true;
    }
    const actual = field.sectionPath.map((part) => normalizeForMatch(part));
    return required.every((part) => actual.includes(normalizeForMatch(part)));
}
export function mapSiteFields(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    const catalog = loadFieldCatalog(request.paths);
    const scorable = catalog.filter((canonical) => canonical.status !== 'deprecated');
    const recipeHints = request.recipeHints ?? [];
    const handle = openKnowledgeDatabase({ paths: request.paths });
    const mappings = [];
    const newCandidates = [];
    let recipeHintFieldCount = 0;
    let scoredFieldCount = 0;
    let scoreCallCount = 0;
    try {
        const siteHistory = loadSiteHistory(handle, request.siteId);
        for (const field of request.fields) {
            // 按钮之类不是要填的字段，不参与映射。
            if (field.controlKind === 'action_button') {
                continue;
            }
            const siteFieldId = request.observationIdByRuntimeRef?.[field.runtimeRef];
            // 人确认过的映射就到此为止：不再打分，也不再报「要人确认」。
            //
            // 之前这里只是把历史映射当成一个高权重信号扔进打分，
            // 结果分数还是可能低于自动阈值，于是每一轮都重新问一遍同一个字段——
            // 用户确认了也没用，永远填不进去。完整 E2E 就是卡在这。
            const confirmedKey = siteHistory.get(field.fieldFingerprint);
            if (confirmedKey !== undefined) {
                mappings.push({
                    ...(siteFieldId === undefined ? {} : { siteFieldId }),
                    runtimeRef: field.runtimeRef,
                    canonicalKey: confirmedKey,
                    status: 'verified',
                    confidence: 1,
                    evidence: [
                        {
                            source: 'user_review',
                            detail: `这个站点上人已经确认过这个字段就是 ${confirmedKey}`,
                            score: 1,
                        },
                    ],
                    alternativeCandidates: [],
                    requiresReview: false,
                });
                continue;
            }
            // 配方提示：这一页的问题是什么意思，之前已经弄明白过了。
            //
            // 命中就不再跑一遍全目录打分。省下来的不只是 CPU——
            // 打分是有可能选错的一步，查表不会。
            //
            // 但它只是**候选**，不是人工确认：写回数据库时不会变成 verified，
            // 所以用户后来的确认永远能覆盖它。
            const hit = recipeHints.find((hint) => hintMatchesField(hint, field));
            if (hit !== undefined && catalog.some((canonical) => canonical.key === hit.canonicalKey)) {
                recipeHintFieldCount += 1;
                const reviewed = hit.recipeStatus === 'verified' || hit.recipeStatus === 'stable';
                mappings.push({
                    ...(siteFieldId === undefined ? {} : { siteFieldId }),
                    runtimeRef: field.runtimeRef,
                    canonicalKey: hit.canonicalKey,
                    status: 'candidate',
                    confidence: reviewed
                        ? RECIPE_HINT_CONFIDENCE.reviewed
                        : RECIPE_HINT_CONFIDENCE.candidate,
                    evidence: [
                        {
                            source: hit.recipeKind === 'family' ? 'family_history' : 'site_history',
                            detail: `${hit.recipeKind} 配方 ${hit.recipeKey}` +
                                `（${reviewed ? '人工审核过' : '本机候选，未审核'}）说这个问题是 ${hit.canonicalKey}`,
                            score: reviewed
                                ? RECIPE_HINT_CONFIDENCE.reviewed
                                : RECIPE_HINT_CONFIDENCE.candidate,
                        },
                    ],
                    alternativeCandidates: [],
                    requiresReview: false,
                });
                continue;
            }
            scoredFieldCount += 1;
            scoreCallCount += scorable.length;
            const scored = scorable
                .map((canonical) => scoreFieldMapping({
                siteField: field,
                canonical,
                ...(siteHistory.get(field.fieldFingerprint) === undefined
                    ? {}
                    : { siteHistoryCanonicalKey: siteHistory.get(field.fieldFingerprint) }),
            }))
                .filter((result) => result.score > 0)
                .sort((a, b) => b.score - a.score);
            const best = scored[0];
            const second = scored[1];
            if (best === undefined || best.score < MAPPING_THRESHOLDS.unresolved) {
                // 认不出来：不硬猜，进候选池。
                mappings.push({
                    ...(siteFieldId === undefined ? {} : { siteFieldId }),
                    runtimeRef: field.runtimeRef,
                    status: 'unresolved',
                    confidence: best?.score ?? 0,
                    evidence: best?.evidence ?? [],
                    alternativeCandidates: [],
                    requiresReview: true,
                });
                newCandidates.push({
                    id: newId('candidate'),
                    proposedName: field.rawLabel === '' ? field.htmlName ?? '未命名字段' : field.rawLabel,
                    meaningSummary: `站点新字段：${field.sectionPath.join('>')}｜${field.rawLabel}`,
                    sourceSiteFieldIds: siteFieldId === undefined ? [] : [siteFieldId],
                    status: 'candidate',
                });
                continue;
            }
            const gap = best.score - (second?.score ?? 0);
            const conflicted = second !== undefined && gap < MAPPING_THRESHOLDS.conflictGap;
            const status = conflicted ? 'conflict' : 'candidate';
            const requiresReview = conflicted || best.score < MAPPING_THRESHOLDS.auto;
            mappings.push({
                ...(siteFieldId === undefined ? {} : { siteFieldId }),
                runtimeRef: field.runtimeRef,
                canonicalKey: best.canonicalKey,
                status,
                confidence: best.score,
                evidence: best.evidence,
                alternativeCandidates: scored.slice(1, 4).map((item) => ({
                    canonicalKey: item.canonicalKey,
                    confidence: item.score,
                    reason: item.evidence.map((evidence) => evidence.detail).join('；'),
                })),
                requiresReview,
            });
        }
        persistMappings(handle, mappings, now, newId);
    }
    finally {
        handle.close();
    }
    return { mappings, newCandidates, recipeHintFieldCount, scoredFieldCount, scoreCallCount };
}
function persistMappings(handle, mappings, now, newId) {
    const withId = mappings.filter((mapping) => mapping.siteFieldId !== undefined);
    if (withId.length === 0) {
        return;
    }
    handle.db.exec('BEGIN');
    try {
        for (const mapping of withId) {
            // 人工确认过的映射不能被自动结果覆盖。
            const verified = handle.db
                .prepare("SELECT id FROM field_mappings WHERE site_field_id = ? AND status = 'verified'")
                .get(mapping.siteFieldId);
            if (verified !== undefined) {
                continue;
            }
            handle.db
                .prepare('DELETE FROM field_mappings WHERE site_field_id = ?')
                .run(mapping.siteFieldId);
            // canonical_key 有外键，缓存里没有就先不写 key，只留证据。
            const known = mapping.canonicalKey === undefined
                ? undefined
                : handle.db
                    .prepare('SELECT canonical_key FROM catalog_fields_cache WHERE canonical_key = ?')
                    .get(mapping.canonicalKey);
            handle.db
                .prepare(`INSERT INTO field_mappings
             (id, site_field_id, canonical_key, status, confidence, evidence_json,
              alternative_candidates_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(newId('mapping'), mapping.siteFieldId, known === undefined ? null : mapping.canonicalKey, mapping.status, mapping.confidence, JSON.stringify(mapping.evidence), JSON.stringify(mapping.alternativeCandidates), now, now);
        }
        handle.db.exec('COMMIT');
    }
    catch (error) {
        handle.db.exec('ROLLBACK');
        throw error;
    }
}
//# sourceMappingURL=map-site-fields.js.map