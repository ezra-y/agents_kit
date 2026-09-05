/**
 * 记录每次定位尝试。
 *
 * 规则文档：`docs/08_页面配方SaaS家族与跨公司复用.md §8.1`
 *
 * 分级很明确（`docs/08 §8.3`）：
 * **记录统计是第一版必须做的；自动学习排序等有数据之后再说。**
 *
 * 运行细节进 runtime 库；跨站点可复用的匿名统计进 knowledge 库。
 * 两边都不写用户答案，只写策略、耗时和结果。
 */
import { randomUUID } from 'node:crypto';
import { openRuntimeDatabase } from "../../storage/open-runtime-database.js";
import { openKnowledgeDatabase } from "../../storage/open-knowledge-database.js";
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
function openIfMigrated(open) {
    try {
        return open();
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith('database_not_migrated')) {
            return undefined;
        }
        throw error;
    }
}
export function recordLocatorAttempt(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    let writtenToRuntime = 0;
    let writtenToKnowledge = 0;
    const runtime = openIfMigrated(() => openRuntimeDatabase({ paths: request.paths }));
    if (runtime !== undefined) {
        try {
            const runExists = runtime.db
                .prepare('SELECT 1 FROM application_runs WHERE id = ?')
                .get(request.runId);
            if (runExists !== undefined) {
                const insert = runtime.db.prepare(`INSERT INTO action_attempts
             (id, run_id, runtime_ref, action_kind, strategy, outcome, candidate_count,
              duration_ms, page_changed, error_message_redacted, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`);
                for (const attempt of request.attempts) {
                    insert.run(newId('actattempt'), request.runId, attempt.runtimeRef ?? null, request.actionKind ?? 'click', attempt.strategy, attempt.outcome, attempt.candidateCount, attempt.durationMs, attempt.failureReason ?? null, now);
                    writtenToRuntime += 1;
                }
            }
        }
        finally {
            runtime.close();
        }
    }
    if (request.siteId !== undefined) {
        const knowledge = openIfMigrated(() => openKnowledgeDatabase({ paths: request.paths }));
        if (knowledge !== undefined) {
            try {
                const siteExists = knowledge.db.prepare('SELECT 1 FROM sites WHERE id = ?').get(request.siteId);
                if (siteExists !== undefined) {
                    const insert = knowledge.db.prepare(`INSERT INTO locator_attempts
               (id, site_id, source_run_id, site_field_id, action_kind, strategy,
                locator_description_redacted, candidate_count, outcome, duration_ms,
                failure_reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                    for (const attempt of request.attempts) {
                        insert.run(newId('locattempt'), request.siteId, request.runId, request.siteFieldId ?? null, request.actionKind ?? null, attempt.strategy, attempt.description, attempt.candidateCount, attempt.outcome, attempt.durationMs, attempt.failureReason ?? null, now);
                        writtenToKnowledge += 1;
                    }
                }
            }
            finally {
                knowledge.close();
            }
        }
    }
    return { writtenToKnowledge, writtenToRuntime };
}
/** 读取某个站点上各策略的历史表现，供 `rankLocatorCandidates()` 使用。 */
export function loadLocatorStats(paths, siteId) {
    const knowledge = openIfMigrated(() => openKnowledgeDatabase({ paths }));
    if (knowledge === undefined) {
        return [];
    }
    try {
        const rows = knowledge.db
            .prepare(`SELECT strategy,
                COUNT(*) AS attempts,
                SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS successes
         FROM locator_attempts
         WHERE site_id = ?
         GROUP BY strategy`)
            .all(siteId);
        return rows.map((row) => ({
            strategy: String(row['strategy']),
            attempts: Number(row['attempts']),
            successes: Number(row['successes']),
        }));
    }
    finally {
        knowledge.close();
    }
}
//# sourceMappingURL=record-locator-attempt.js.map