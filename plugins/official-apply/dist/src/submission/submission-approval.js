import { createHash, randomUUID } from 'node:crypto';
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
import { checkSubmissionAuthority, } from "./submission-authority.js";
const DEFAULT_TTL_MS = 30 * 60 * 1_000;
function rollbackAndRethrow(db, error) {
    if (db.isTransaction) {
        try {
            db.exec('ROLLBACK');
        }
        catch (rollbackError) {
            throw Object.assign(new Error(`submission_approval_rollback_failed: 原错误：${error instanceof Error ? error.message : String(error)}；回滚错误：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, { cause: error }), { rollbackError });
        }
    }
    throw error;
}
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
function defaultTokenFactory() {
    return `submit_${randomUUID().replaceAll('-', '')}`;
}
export function hashSubmissionApprovalToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
export function hashSubmissionApprovalSummary(summary) {
    return createHash('sha256').update(JSON.stringify(summary)).digest('hex');
}
function buildSubmissionApprovalSummary(input) {
    return {
        taskId: input.taskId,
        companyName: input.facts.companyName,
        ...(input.facts.companyKey === undefined ? {} : { companyKey: input.facts.companyKey }),
        jobTitle: input.facts.jobTitle,
        jobLocation: input.facts.jobLocation,
        ...(input.facts.jobKey === undefined ? {} : { jobKey: input.facts.jobKey }),
        jobUrl: input.facts.jobUrl,
        jobSelectionSource: input.facts.jobSelectionSource,
        jobSelectionEvidence: input.facts.jobSelectionEvidence,
        pageUrl: input.pageUrl,
        ...(input.pageTitle === undefined ? {} : { pageTitle: input.pageTitle }),
        commitLabel: input.commitLabel,
        materialRefs: input.facts.materialRefs,
        profileRecordCount: input.facts.profileRecordIds.length,
        profileRecordIdsHash: createHash('sha256')
            .update(JSON.stringify(input.facts.profileRecordIds))
            .digest('hex'),
    };
}
function parseStoredSummary(value) {
    try {
        const parsed = JSON.parse(value);
        return typeof parsed.summaryHash === 'string'
            ? parsed
            : undefined;
    }
    catch {
        return undefined;
    }
}
function summaryStillMatches(stored, facts, pageUrl) {
    const { summaryHash, ...approved } = stored;
    if (hashSubmissionApprovalSummary(approved) !== summaryHash) {
        return false;
    }
    const current = buildSubmissionApprovalSummary({
        taskId: approved.taskId,
        pageUrl,
        ...(approved.pageTitle === undefined ? {} : { pageTitle: approved.pageTitle }),
        commitLabel: approved.commitLabel,
        facts,
    });
    return hashSubmissionApprovalSummary(current) === summaryHash;
}
export function invalidatePendingSubmissionApprovals(input) {
    const runtime = openRuntimeDatabase({ paths: input.paths });
    try {
        const result = runtime.db
            .prepare(`UPDATE submission_approval_tokens
            SET status = 'invalidated'
          WHERE run_id = ? AND status = 'pending'`)
            .run(input.runId);
        return Number(result.changes);
    }
    finally {
        runtime.close();
    }
}
export function issueSubmissionApproval(input) {
    const now = input.now ?? new Date().toISOString();
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
        throw new Error('submission_approval_invalid_ttl: ttlMs 必须是正数');
    }
    const approvalId = (input.idFactory ?? defaultIdFactory)('approval');
    const approvalToken = (input.tokenFactory ?? defaultTokenFactory)();
    const tokenHash = hashSubmissionApprovalToken(approvalToken);
    const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString();
    const authority = checkSubmissionAuthority({
        paths: input.paths,
        runId: input.runId,
        taskId: input.taskId,
        mode: 'review',
    });
    if (!authority.allowed || authority.facts === undefined) {
        throw new Error(`submission_authority_refused: ${authority.blockers.join('；')}`);
    }
    const summary = buildSubmissionApprovalSummary({
        taskId: input.taskId,
        pageUrl: input.pageDigest.url,
        ...(input.summary.pageTitle === undefined ? {} : { pageTitle: input.summary.pageTitle }),
        commitLabel: input.summary.commitLabel,
        facts: authority.facts,
    });
    const summaryHash = hashSubmissionApprovalSummary(summary);
    const runtime = openRuntimeDatabase({ paths: input.paths });
    try {
        runtime.db.exec('BEGIN IMMEDIATE');
        try {
            runtime.db
                .prepare(`UPDATE submission_approval_tokens
              SET status = 'invalidated'
            WHERE run_id = ? AND status = 'pending'`)
                .run(input.runId);
            runtime.db
                .prepare(`INSERT INTO submission_approval_tokens
             (id, run_id, task_id, token_hash, idempotency_key, page_url,
              page_control_count, page_value_hash, summary_json, status,
              issued_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
                .run(approvalId, input.runId, input.taskId, tokenHash, input.idempotencyKey, input.pageDigest.url, input.pageDigest.controlCount, input.pageDigest.valueHash, JSON.stringify({ ...summary, summaryHash }), now, expiresAt);
            runtime.db.exec('COMMIT');
        }
        catch (error) {
            rollbackAndRethrow(runtime.db, error);
        }
    }
    finally {
        runtime.close();
    }
    return {
        approvalId,
        approvalToken,
        expiresAt,
        summary,
        summaryHash,
    };
}
export function consumeSubmissionApproval(input) {
    const now = input.now ?? new Date().toISOString();
    const tokenHash = hashSubmissionApprovalToken(input.approvalToken);
    const runtime = openRuntimeDatabase({ paths: input.paths });
    try {
        runtime.db.exec('BEGIN IMMEDIATE');
        try {
            const row = runtime.db
                .prepare(`SELECT id, run_id, task_id, idempotency_key, page_url,
                  page_control_count, page_value_hash, summary_json, status, expires_at
             FROM submission_approval_tokens
            WHERE token_hash = ?`)
                .get(tokenHash);
            if (row === undefined) {
                runtime.db.exec('COMMIT');
                return {
                    ok: false,
                    errorCode: 'submission_approval_unknown',
                    message: '提交批准令牌不存在；请重新执行提交前检查。',
                };
            }
            if (row.status !== 'pending') {
                runtime.db.exec('COMMIT');
                return {
                    ok: false,
                    approvalId: row.id,
                    errorCode: `submission_approval_${row.status}`,
                    message: row.status === 'consumed'
                        ? '提交批准令牌已经使用，不能再次提交。'
                        : '提交批准令牌已经失效；请重新执行提交前检查。',
                };
            }
            if (Date.parse(now) > Date.parse(row.expires_at)) {
                runtime.db
                    .prepare(`UPDATE submission_approval_tokens
                SET status = 'expired'
              WHERE id = ? AND status = 'pending'`)
                    .run(row.id);
                runtime.db.exec('COMMIT');
                return {
                    ok: false,
                    approvalId: row.id,
                    errorCode: 'submission_approval_expired',
                    message: '提交批准令牌已过期；请重新执行提交前检查。',
                };
            }
            if (row.run_id !== input.runId ||
                row.task_id !== input.taskId ||
                row.idempotency_key !== input.idempotencyKey) {
                runtime.db.exec('COMMIT');
                return {
                    ok: false,
                    approvalId: row.id,
                    errorCode: 'submission_approval_target_mismatch',
                    message: '提交批准令牌不属于当前任务或岗位。',
                };
            }
            const authority = checkSubmissionAuthority({
                paths: input.paths,
                runId: input.runId,
                taskId: input.taskId,
                mode: 'review',
            });
            const storedSummary = parseStoredSummary(row.summary_json);
            if (!authority.allowed ||
                authority.facts === undefined ||
                storedSummary === undefined ||
                !summaryStillMatches(storedSummary, authority.facts, input.pageDigest.url)) {
                runtime.db
                    .prepare(`UPDATE submission_approval_tokens
                SET status = 'invalidated'
              WHERE id = ? AND status = 'pending'`)
                    .run(row.id);
                runtime.db.exec('COMMIT');
                return {
                    ok: false,
                    approvalId: row.id,
                    errorCode: 'submission_approval_summary_changed',
                    message: '公司、岗位、地点、材料或岗位来源已经变化；请重新检查并确认。',
                };
            }
            if (row.page_url !== input.pageDigest.url ||
                row.page_control_count !== input.pageDigest.controlCount ||
                row.page_value_hash !== input.pageDigest.valueHash) {
                runtime.db
                    .prepare(`UPDATE submission_approval_tokens
                SET status = 'invalidated'
              WHERE id = ? AND status = 'pending'`)
                    .run(row.id);
                runtime.db.exec('COMMIT');
                return {
                    ok: false,
                    approvalId: row.id,
                    errorCode: 'submission_approval_page_changed',
                    message: '提交批准后页面或填写内容已经变化；请重新检查并确认。',
                };
            }
            const updated = runtime.db
                .prepare(`UPDATE submission_approval_tokens
              SET status = 'consumed', consumed_at = ?
            WHERE id = ? AND status = 'pending'`)
                .run(now, row.id);
            if (updated.changes !== 1) {
                runtime.db.exec('COMMIT');
                return {
                    ok: false,
                    approvalId: row.id,
                    errorCode: 'submission_approval_race',
                    message: '提交批准令牌未能锁定，未执行提交。',
                };
            }
            runtime.db.exec('COMMIT');
            return {
                ok: true,
                approvalId: row.id,
                tokenHash,
            };
        }
        catch (error) {
            rollbackAndRethrow(runtime.db, error);
        }
    }
    finally {
        runtime.close();
    }
}
export function verifyConsumedSubmissionApproval(input) {
    const runtime = openRuntimeDatabase({ paths: input.paths });
    try {
        const row = runtime.db
            .prepare(`SELECT idempotency_key, page_url, page_control_count, page_value_hash, summary_json
           FROM submission_approval_tokens
          WHERE id = ?
            AND token_hash = ?
            AND run_id = ?
            AND task_id = ?
            AND idempotency_key = ?
            AND status = 'consumed'`)
            .get(input.approvalId, input.tokenHash, input.runId, input.taskId, input.idempotencyKey);
        if (row === undefined) {
            return false;
        }
        const authority = checkSubmissionAuthority({
            paths: input.paths,
            runId: input.runId,
            taskId: input.taskId,
            mode: 'review',
        });
        const storedSummary = parseStoredSummary(row.summary_json);
        return (authority.allowed &&
            authority.facts !== undefined &&
            storedSummary !== undefined &&
            row.idempotency_key === input.idempotencyKey &&
            row.page_url === input.pageDigest.url &&
            row.page_control_count === input.pageDigest.controlCount &&
            row.page_value_hash === input.pageDigest.valueHash &&
            summaryStillMatches(storedSummary, authority.facts, input.pageDigest.url));
    }
    finally {
        runtime.close();
    }
}
//# sourceMappingURL=submission-approval.js.map