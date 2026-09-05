/**
 * 每个 run 只有一个「当前 pending 人工卡点」，历史变化保留 resolved。
 *
 * 规则文档：docs/10_状态提交安全隐私与错误恢复.md §7、§17
 *
 * 为什么单独抽出来：登录失败、验证码、站点拦截都会产生同一类东西——
 * 「需要人去做一件事，做完才能继续」。这些信息如果只存在于返回值，
 * Agent 换上下文或进程重启后就不见了。写进运行库，`getRunStatus` 才能
 * 在任何时刻回答「停在哪里、为什么停」。
 *
 * 数据语义：
 * - pending = 当前正在等人的那一条。每个 run 最多一条（v9 唯一索引兜底）。
 * - resolved = 已经度过的一关。保留作历史，不删除。
 * - 同一内容重复同步不新增；内容变化先 resolve 旧再 insert 新；
 *   不提供 active 表示「当前没有卡点」，把旧 pending 标 resolved。
 * - URL 只留 origin+pathname，去掉 query 和 hash。
 */
import { randomUUID } from 'node:crypto';
import { redactUrl } from "../browser/session/open-application-page.js";
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
function takeoverError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
function readPending(db, runId) {
    return db
        .prepare(`SELECT id, reason, message, resume_condition, current_url_redacted
         FROM human_takeover_requests
        WHERE run_id = ? AND status = 'pending'
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1`)
        .get(runId);
}
function resolvePending(db, id, now) {
    db.prepare(`UPDATE human_takeover_requests
        SET status = 'resolved', resolved_at = ?
      WHERE id = ? AND status = 'pending'`).run(now, id);
}
function sameContent(row, active) {
    return (row.reason === active.reason &&
        row.message === active.message &&
        row.resume_condition === active.resumeCondition &&
        row.current_url_redacted === redactUrl(active.currentUrl));
}
export function syncHumanTakeover(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    if (request.active !== undefined && request.active.runId !== request.runId) {
        throw takeoverError('human_takeover_run_id_mismatch', `active.runId 是 ${request.active.runId}，与参数 runId ${request.runId} 不一致`);
    }
    const runtime = openRuntimeDatabase({ paths: request.paths });
    try {
        runtime.db.exec('BEGIN IMMEDIATE');
        try {
            const current = readPending(runtime.db, request.runId);
            if (request.active === undefined) {
                if (current !== undefined) {
                    // 每个入口只知道自己负责的 reason。给了 resolveReasons 时，
                    // 不命中就原样保留——别的流程真相不能被清掉。
                    const scoped = request.resolveReasons === undefined ||
                        request.resolveReasons.includes(current.reason);
                    if (scoped) {
                        resolvePending(runtime.db, current.id, now);
                    }
                }
                runtime.db.exec('COMMIT');
                return;
            }
            if (current !== undefined && sameContent(current, request.active)) {
                // 内容没变：幂等，不新增也不动。
                runtime.db.exec('COMMIT');
                return;
            }
            if (current !== undefined) {
                resolvePending(runtime.db, current.id, now);
            }
            runtime.db
                .prepare(`INSERT INTO human_takeover_requests
             (id, run_id, reason, message, resume_condition, current_url_redacted,
              status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)
                .run(newId('takeover'), request.runId, request.active.reason, request.active.message, request.active.resumeCondition, redactUrl(request.active.currentUrl), now);
            runtime.db.exec('COMMIT');
        }
        catch (error) {
            runtime.db.exec('ROLLBACK');
            throw error;
        }
    }
    finally {
        runtime.close();
    }
}
//# sourceMappingURL=sync-human-takeover.js.map