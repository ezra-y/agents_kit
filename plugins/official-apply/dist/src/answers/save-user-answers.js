/**
 * 把用户补充的答案写入正确 scope。
 *
 * 规则文档：
 * - `docs/05_答案收集范围与复用规则.md §9.3、§11`
 * - `docs/06_函数接口与执行循环.md §3.7`
 *
 * 两条硬规则：
 * 1. **旧值不删，只标 superseded。** 历史投递记录里的事实不能被改掉。
 * 2. **session 范围的值不进长期答案库**（`docs/05 §4.6`）。
 */
import { randomUUID } from 'node:crypto';
import { openPrivateDatabase } from "../storage/open-private-database.js";
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
import { isPersistableScope } from "./resolve-answer-scope.js";
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
export function saveUserAnswers(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    const savedAnswerIds = [];
    const supersededAnswerIds = [];
    const priv = openPrivateDatabase({ paths: request.paths });
    try {
        priv.db.exec('BEGIN');
        try {
            for (const answer of request.answers) {
                if (!isPersistableScope(answer.scope)) {
                    // 验证码这类只在会话内有效，绝不落长期库。
                    continue;
                }
                const previous = priv.db
                    .prepare(`SELECT id FROM answer_values
             WHERE canonical_key = ? AND scope_type = ? AND scope_key = ? AND status = 'active'`)
                    .all(answer.canonicalKey, answer.scope.type, answer.scope.key);
                const answerId = newId('answer');
                priv.db
                    .prepare(`INSERT INTO answer_values
               (id, canonical_key, scope_type, scope_key, value_json, source_type, source_ref,
                status, user_confirmed, confidence, valid_until, last_confirmed_at,
                supersedes_answer_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'current_user_input', ?, 'active', 1, 1, ?, ?, ?, ?, ?)`)
                    .run(answerId, answer.canonicalKey, answer.scope.type, answer.scope.key, JSON.stringify(answer.value), `run:${request.runId}`, answer.validUntil ?? null, now, previous[0]?.id ?? null, now, now);
                savedAnswerIds.push(answerId);
                for (const old of previous) {
                    priv.db
                        .prepare("UPDATE answer_values SET status = 'superseded', updated_at = ? WHERE id = ?")
                        .run(now, old.id);
                    priv.db
                        .prepare(`INSERT INTO private_change_log(id, entity_type, entity_id, change_kind, note, created_at)
               VALUES (?, 'answer_value', ?, 'supersede', ?, ?)`)
                        .run(newId('change'), old.id, `被 ${answerId} 取代`, now);
                    supersededAnswerIds.push(old.id);
                }
            }
            priv.db.exec('COMMIT');
        }
        catch (error) {
            priv.db.exec('ROLLBACK');
            throw error;
        }
    }
    finally {
        priv.close();
    }
    markMissingRequestsAnswered(request, savedAnswerIds, now);
    return { savedAnswerIds, supersededAnswerIds };
}
/**
 * 把提问和回答对上。
 *
 * 缺失问题记在 runtime 库，答案记在 private 库。
 * 这里只回填一个 id 引用，不把真实答案复制到运行库。
 */
function markMissingRequestsAnswered(request, savedAnswerIds, now) {
    const pairs = request.answers
        .map((answer, index) => ({ requestId: answer.missingRequestId, answerId: savedAnswerIds[index] }))
        .filter((pair) => pair.requestId !== undefined && pair.answerId !== undefined);
    if (pairs.length === 0) {
        return;
    }
    let runtime;
    try {
        runtime = openRuntimeDatabase({ paths: request.paths });
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith('database_not_migrated')) {
            return;
        }
        throw error;
    }
    try {
        const update = runtime.db.prepare(`UPDATE missing_answer_requests
       SET status = 'answered', answer_id_ref = ?, resolved_at = ?
       WHERE id = ?`);
        for (const pair of pairs) {
            update.run(pair.answerId, now, pair.requestId);
        }
    }
    finally {
        runtime.close();
    }
}
/** 把一批缺失问题写进 runtime 库，供恢复和审计使用。 */
export function persistMissingAnswerRequests(request, requests) {
    if (requests.length === 0) {
        return 0;
    }
    const now = request.now ?? new Date().toISOString();
    let runtime;
    try {
        runtime = openRuntimeDatabase({ paths: request.paths });
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith('database_not_migrated')) {
            return 0;
        }
        throw error;
    }
    try {
        const runExists = runtime.db
            .prepare('SELECT 1 FROM application_runs WHERE id = ?')
            .get(request.runId);
        if (runExists === undefined) {
            return 0;
        }
        const insert = runtime.db.prepare(`INSERT OR REPLACE INTO missing_answer_requests
         (id, run_id, runtime_ref, site_field_id, canonical_key, raw_question,
          section_path_json, required, control_kind, options_json, reason,
          suggested_scope_type, suggested_scope_key, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`);
        let count = 0;
        for (const item of requests) {
            insert.run(item.id, request.runId, item.runtimeRef, item.siteFieldId ?? null, item.canonicalKey ?? null, item.rawQuestion, JSON.stringify(item.sectionPath), item.required ? 1 : 0, item.controlKind, JSON.stringify(item.options), item.reason, item.suggestedScope?.type ?? null, item.suggestedScope?.key ?? null, now);
            count += 1;
        }
        return count;
    }
    finally {
        runtime.close();
    }
}
//# sourceMappingURL=save-user-answers.js.map