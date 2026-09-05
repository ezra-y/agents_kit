/**
 * 只为本次官网实际出现并已映射的字段找答案。
 *
 * 规则文档：
 * - `docs/05_答案收集范围与复用规则.md §1、§3、§6`
 * - `docs/06_函数接口与执行循环.md §3.6`
 *
 * 顺序不能反（`docs/13 D03`）：
 *
 * ```text
 * 官网字段实例 → 公共字段概念 → 按概念规定的范围查答案
 * ```
 *
 * 四条硬规则：
 * 1. 官网没问的内容不会被生成或填写。
 * 2. scope 不匹配的答案不得复用。
 * 3. 冲突值不静默选择。
 * 4. 官网选项里对不上就问用户，不猜。
 */
import { openPrivateDatabase } from "../storage/open-private-database.js";
import { loadFieldCatalog } from "../fields/map-site-fields.js";
import { resolveAnswerScope, isScopeUsable } from "./resolve-answer-scope.js";
import { normalizeAnswerValue } from "./normalize-answer-value.js";
import { detectAnswerConflicts } from "./detect-answer-conflicts.js";
import { extractMaterialFacts } from "./extract-material-facts.js";
import { buildMissingAnswerBundle } from "./build-missing-answer-bundle.js";
/**
 * 官网自己的问题用的键。
 *
 * 用字段指纹，不用标签文字——标签里可能带用户名字或岗位名，
 * 而且改一个字就变成另一个键了。
 */
export function siteQuestionKeyOf(field) {
    return `site_question:${field.fieldFingerprint}`;
}
/** 查这个站点专属问题在本次申请里有没有答案。 */
function collectSiteQuestionAnswer(priv, key, scope, now) {
    const row = priv.db
        .prepare(`SELECT value_json, valid_until FROM answer_values
        WHERE canonical_key = ? AND scope_type = ? AND scope_key = ? AND status = 'active'
        ORDER BY updated_at DESC LIMIT 1`)
        .get(key, scope.type, scope.key);
    if (row === undefined) {
        return undefined;
    }
    if (typeof row.valid_until === 'string' && row.valid_until !== '' && row.valid_until < now) {
        return undefined;
    }
    try {
        return JSON.parse(row.value_json);
    }
    catch {
        return undefined;
    }
}
export function resolveAnswers(request) {
    const now = request.now ?? new Date().toISOString();
    const catalog = new Map(loadFieldCatalog(request.paths).map((item) => [item.key, item]));
    const fieldByRef = new Map(request.pageSchema.fields.map((field) => [field.runtimeRef, field]));
    // 只提取这一页真正问到的公共字段。官网没问就不看材料。
    const askedKeys = [
        ...new Set(request.mappings
            .map((mapping) => mapping.canonicalKey)
            .filter((key) => key !== undefined)),
    ];
    const { facts } = extractMaterialFacts({
        paths: request.paths,
        canonicalKeys: askedKeys,
        // 只读这次任务绑定的材料，不扫全部（修复清单 P0-2）。
        materialRefs: request.materialRefs,
        profileRecordIds: request.profileRecordIds ?? [],
        now,
        ...(request.idFactory === undefined ? {} : { idFactory: request.idFactory }),
    });
    const resolved = [];
    const conflicts = [];
    const missingEntries = [];
    const priv = openPrivateDatabase({ paths: request.paths });
    try {
        const profileHandledRefs = profileHandledRuntimeRefs(priv, request);
        for (const mapping of request.mappings) {
            const field = fieldByRef.get(mapping.runtimeRef);
            if (field === undefined) {
                continue;
            }
            if (profileHandledRefs.has(field.runtimeRef)) {
                continue;
            }
            // 1. 认不出含义：当成「官网自己的问题」。
            //
            // 公共字段目录里没有对应概念的开放题（「你最擅长什么」这类）很常见。
            // 以前这里只报「要问用户」，但用户回答之后**没地方存**——
            // 没有 canonical key 就没有存放的位置，于是下一轮又问一遍，
            // 永远填不进去。
            //
            // 现在给它一个站点专属的键，并且**只允许存成「仅本次申请有效」**：
            // 我们不知道这个问题是什么意思，绝不能把答案复用到别的公司去。
            if (mapping.canonicalKey === undefined) {
                const siteKey = siteQuestionKeyOf(field);
                const siteScope = request.taskId === undefined || request.taskId === ''
                    ? undefined
                    : { type: 'application', key: `application:${request.taskId}` };
                if (siteScope !== undefined) {
                    const saved = collectSiteQuestionAnswer(priv, siteKey, siteScope, now);
                    if (saved !== undefined) {
                        const normalized = normalizeAnswerValue({
                            value: saved,
                            controlKind: field.controlKind,
                            siteOptions: field.options,
                            ...(field.inputType === undefined ? {} : { inputType: field.inputType }),
                        });
                        if (normalized.matched) {
                            resolved.push({
                                runtimeRef: field.runtimeRef,
                                canonicalKey: siteKey,
                                value: saved,
                                formattedValue: normalized.formattedValue,
                                sourceType: 'private_answer',
                                scope: siteScope,
                                confidence: 1,
                                requiresConfirmation: false,
                                warnings: [],
                                ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
                            });
                            continue;
                        }
                    }
                }
                missingEntries.push({
                    field,
                    canonicalKey: siteKey,
                    reason: 'no_mapping',
                    ...(siteScope === undefined ? {} : { suggestedScope: siteScope }),
                    ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
                });
                continue;
            }
            const canonical = catalog.get(mapping.canonicalKey);
            if (canonical === undefined) {
                missingEntries.push({
                    field,
                    canonicalKey: mapping.canonicalKey,
                    reason: 'no_mapping',
                    ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
                });
                continue;
            }
            // 2. 先把这个字段该存到哪个 scope 算出来。
            //
            // 提前算是为了让**每一条**要问的问题都能带上建议 scope。
            // 不带回去的话，调用方只能自己猜一个，存进去的答案和下次解析时
            // 算出来的对不上，于是永远 scope_mismatch、永远填不进去。
            let scope;
            let scopeError;
            try {
                scope = resolveAnswerScope({
                    canonical,
                    ...(request.companyKey === undefined ? {} : { companyKey: request.companyKey }),
                    ...(request.jobKey === undefined ? {} : { jobKey: request.jobKey }),
                    ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
                    ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
                    ...(field.repeatGroupKey === undefined
                        ? {}
                        : { profileRecordKey: `${field.repeatGroupKey}#${field.repeatInstanceIndex ?? 0}` }),
                });
            }
            catch (error) {
                scopeError = error instanceof Error ? error.message : String(error);
            }
            // 3. 映射置信度不够就问人。低置信度绝不自动填。
            //
            // 这条问题也要带上建议 scope 和 siteFieldId：
            // 用户回答时把它们带回来，答案才存得对，映射也才能被确认下来。
            if (mapping.requiresReview) {
                missingEntries.push({
                    field,
                    canonicalKey: canonical.key,
                    reason: 'no_mapping',
                    ...(scope === undefined ? {} : { suggestedScope: scope }),
                    ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
                });
                continue;
            }
            // scope 算不出来说明缺上下文（比如没有 jobKey），也要问人。
            if (scope === undefined) {
                missingEntries.push({
                    field,
                    canonicalKey: canonical.key,
                    reason: 'scope_mismatch',
                    ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
                });
                continue;
            }
            void scopeError;
            // 4. 收集候选：私有答案库 + 本次材料提取。
            const candidates = collectCandidates(priv, canonical, scope, facts, now);
            if (candidates.length === 0) {
                missingEntries.push({
                    field,
                    canonicalKey: canonical.key,
                    reason: 'no_answer',
                    suggestedScope: scope,
                    ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
                });
                continue;
            }
            const conflictResult = detectAnswerConflicts({
                runtimeRef: mapping.runtimeRef,
                candidates,
            });
            if (conflictResult.chosen === undefined) {
                conflicts.push({
                    runtimeRef: mapping.runtimeRef,
                    reason: conflictResult.reason ?? '存在冲突值',
                    candidateAnswerIds: conflictResult.conflicting
                        .map((candidate) => candidate.answerId)
                        .filter((id) => id !== undefined),
                });
                missingEntries.push({
                    field,
                    canonicalKey: canonical.key,
                    reason: 'multiple_answers',
                    suggestedScope: scope,
                    ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
                });
                continue;
            }
            const chosen = conflictResult.chosen;
            // 5. 政策要求每次确认的字段，即使有历史答案也要问。
            if (canonical.answerPolicy === 'confirm_each_application' && !isFreshlyConfirmed(chosen)) {
                missingEntries.push({
                    field,
                    canonicalKey: canonical.key,
                    reason: 'policy_requires_confirmation',
                    suggestedScope: scope,
                    ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
                });
                continue;
            }
            // 6. `never_infer` 只接受用户明确确认过的答案。
            if (canonical.answerPolicy === 'never_infer' && !chosen.userConfirmed) {
                missingEntries.push({
                    field,
                    canonicalKey: canonical.key,
                    reason: 'sensitive_requires_confirmation',
                    suggestedScope: scope,
                    ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
                });
                continue;
            }
            // 7. `reuse_if_explicit` 不接受从材料推断出来的值。
            if (canonical.answerPolicy === 'reuse_if_explicit' &&
                (chosen.sourceType === 'resume' || chosen.sourceType === 'attachment_metadata')) {
                missingEntries.push({
                    field,
                    canonicalKey: canonical.key,
                    reason: 'policy_requires_confirmation',
                    suggestedScope: scope,
                    ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
                });
                continue;
            }
            // 8. 转成官网要的格式。选项对不上就问，不猜。
            const normalized = normalizeAnswerValue({
                value: chosen.value,
                controlKind: field.controlKind,
                siteOptions: field.options,
                inputType: field.inputType ?? null,
            });
            if (!normalized.matched) {
                missingEntries.push({
                    field,
                    canonicalKey: canonical.key,
                    reason: 'format_conflict',
                    suggestedScope: scope,
                    ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
                });
                continue;
            }
            resolved.push({
                runtimeRef: mapping.runtimeRef,
                ...(mapping.siteFieldId === undefined ? {} : { siteFieldId: mapping.siteFieldId }),
                canonicalKey: canonical.key,
                value: chosen.value,
                formattedValue: normalized.formattedValue,
                ...(chosen.answerId === undefined ? {} : { answerId: chosen.answerId }),
                sourceType: chosen.sourceType,
                scope,
                confidence: chosen.confidence,
                requiresConfirmation: false,
                warnings: buildWarnings(canonical, chosen),
            });
        }
    }
    finally {
        priv.close();
    }
    const bundle = buildMissingAnswerBundle({
        runId: request.runId,
        ...(request.pageSchema.stepLabel === undefined
            ? {}
            : { stepLabel: request.pageSchema.stepLabel }),
        entries: missingEntries,
        ...(request.idFactory === undefined ? {} : { idFactory: request.idFactory }),
    });
    return { resolved, missing: bundle.requests, conflicts, bundle };
}
function profileHandledRuntimeRefs(priv, request) {
    const ids = request.profileRecordIds ?? [];
    if (ids.length === 0) {
        return new Set();
    }
    const rows = priv.db
        .prepare(`SELECT DISTINCT record_type FROM profile_records
        WHERE active = 1 AND id IN (${ids.map(() => '?').join(', ')})`)
        .all(...ids);
    const recordTypes = new Set(rows.map((row) => row.record_type));
    const handledGroups = new Set(request.pageSchema.repeatableGroups
        .filter((group) => group.canonicalRecordType !== undefined &&
        recordTypes.has(group.canonicalRecordType))
        .map((group) => group.groupKey));
    return new Set(request.pageSchema.fields
        .filter((field) => field.repeatGroupKey !== undefined && handledGroups.has(field.repeatGroupKey))
        .map((field) => field.runtimeRef));
}
function collectCandidates(priv, canonical, scope, facts, now) {
    const rows = priv.db
        .prepare(`SELECT * FROM answer_values
       WHERE canonical_key = ? AND status = 'active'
       ORDER BY updated_at DESC`)
        .all(canonical.key);
    const candidates = [];
    for (const row of rows) {
        const saved = {
            type: String(row['scope_type']),
            key: String(row['scope_key']),
        };
        // scope 不一致就不能用。这是「A 公司的答案不会填到 B 公司」的那道闸。
        if (!isScopeUsable(saved, scope)) {
            continue;
        }
        const validUntil = row['valid_until'];
        if (typeof validUntil === 'string' && validUntil !== '' && validUntil < now) {
            continue;
        }
        candidates.push({
            canonicalKey: canonical.key,
            value: JSON.parse(String(row['value_json'])),
            scope: saved,
            sourceType: String(row['source_type']),
            ...(row['source_ref'] === null ? {} : { sourceRef: String(row['source_ref']) }),
            confidence: Number(row['confidence']),
            userConfirmed: Number(row['user_confirmed']) === 1,
            answerId: String(row['id']),
        });
    }
    // 材料提取只作为 global 范围的候选。公司和岗位问题不能从简历推断。
    if (scope.type === 'global') {
        for (const fact of facts) {
            if (fact.canonicalKey !== canonical.key) {
                continue;
            }
            candidates.push({
                canonicalKey: canonical.key,
                value: fact.value,
                scope,
                sourceType: fact.sourceType,
                sourceRef: fact.sourceRef,
                confidence: fact.confidence,
                userConfirmed: false,
            });
        }
    }
    return candidates;
}
function isFreshlyConfirmed(candidate) {
    return candidate.sourceType === 'current_user_input';
}
function buildWarnings(canonical, candidate) {
    const warnings = [];
    if (canonical.sensitivity === 'highly_sensitive' || canonical.sensitivity === 'credential') {
        warnings.push('敏感字段，提交前请人工复核');
    }
    if (!candidate.userConfirmed) {
        warnings.push('该值来自自动提取，尚未经过用户确认');
    }
    return warnings;
}
//# sourceMappingURL=resolve-answers.js.map