/**
 * 人工核对一次「提交结果不确定」的运行。
 *
 * 这条入口只修正本地事实，绝不再次点击官网：
 * - 用户在官网确认已经提交：uncertain/in_progress → confirmed。
 * - 用户在官网确认没有提交：uncertain/in_progress → failed_before_commit，释放合法重试资格。
 *
 * `submission_uncertain` 仍然是自动状态机的终态。这里是单独的人工裁决入口，
 * 必须记录确认人和状态事件，不能通过放宽自动迁移规则来实现。
 */
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
import { updateTaskFromRun } from "../tasks/update-task-from-run.js";
const REASON_BY_RESULT = {
    submitted: 'submission_reconciled_submitted',
    not_submitted: 'submission_reconciled_not_submitted',
};
const ATTEMPT_OUTCOME_BY_RESULT = {
    submitted: 'confirmed',
    not_submitted: 'failed_before_commit',
};
const RUN_STATE_BY_RESULT = {
    submitted: 'submitted_confirmed',
    not_submitted: 'failed_recoverable',
};
/** 每一次提交尝试有自己的人工裁决。一个 run 合法重试后可能产生第二次不确定尝试。 */
function resolutionEventId(attemptId) {
    return `submission_resolution:${attemptId}`;
}
function resolutionError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
function rollbackAndRethrow(db, error) {
    try {
        if (db.isTransaction) {
            db.exec('ROLLBACK');
        }
    }
    catch (rollbackError) {
        throw Object.assign(new Error(`submission_resolution_rollback_failed: 原错误：${describeError(error)}；` +
            `回滚错误：${describeError(rollbackError)}`, { cause: error }), { rollbackError });
    }
    throw error;
}
function resultFromReason(reasonCode) {
    if (reasonCode === REASON_BY_RESULT.submitted)
        return 'submitted';
    if (reasonCode === REASON_BY_RESULT.not_submitted)
        return 'not_submitted';
    return undefined;
}
function auditNote(result, confirmedBy, note) {
    const conclusion = result === 'submitted' ? '人工确认官网已经提交' : '人工确认官网没有提交';
    return [conclusion, `确认人：${confirmedBy}`, note === undefined ? undefined : `备注：${note}`]
        .filter((part) => part !== undefined)
        .join('；');
}
function reconcileTruth(request) {
    const now = request.now ?? new Date().toISOString();
    const confirmedBy = request.confirmedBy.trim();
    const note = request.note?.trim() || undefined;
    if (confirmedBy === '') {
        throw resolutionError('submission_resolution_requires_confirmer', '必须写明是谁在官网核对的');
    }
    const runtime = openRuntimeDatabase({ paths: request.paths });
    try {
        runtime.db.exec('BEGIN IMMEDIATE');
        try {
            const run = runtime.db
                .prepare('SELECT task_id, state FROM application_runs WHERE id = ?')
                .get(request.runId);
            if (run === undefined) {
                throw resolutionError('submission_resolution_run_not_found', `找不到运行 ${request.runId}`);
            }
            const attempt = runtime.db
                .prepare(`SELECT id, outcome
             FROM submission_attempts
            WHERE run_id = ?
            ORDER BY rowid DESC
            LIMIT 1`)
                .get(request.runId);
            // 幂等必须按 attempt，而不是按 run。一次 run 在人工确认“未提交”后可以合法
            // 重试；如果第二次仍不确定，它必须拥有第二次独立裁决，不能被第一次事件挡住。
            const existing = attempt === undefined
                ? undefined
                : runtime.db
                    .prepare('SELECT reason_code FROM state_events WHERE id = ?')
                    .get(resolutionEventId(attempt.id));
            if (existing !== undefined && attempt !== undefined) {
                const existingResult = resultFromReason(existing.reason_code);
                if (existingResult !== request.result) {
                    throw resolutionError('submission_resolution_conflict', `提交尝试 ${attempt.id} 已按 ${existingResult ?? existing.reason_code} 完成人工裁决，不能改成 ${request.result}`);
                }
                const expectedAttempt = ATTEMPT_OUTCOME_BY_RESULT[request.result];
                const expectedRun = RUN_STATE_BY_RESULT[request.result];
                if (attempt.outcome !== expectedAttempt || run.state !== expectedRun) {
                    throw resolutionError('submission_resolution_state_conflict', `提交尝试 ${attempt.id} 有人工裁决事件，但提交记录或运行状态与事件不一致`);
                }
                runtime.db.exec('COMMIT');
                return {
                    runId: request.runId,
                    taskId: run.task_id,
                    attemptId: attempt.id,
                    result: request.result,
                    attemptOutcome: expectedAttempt,
                    runState: expectedRun,
                    alreadyResolved: true,
                };
            }
            if (run.state !== 'submitting' && run.state !== 'submission_uncertain') {
                throw resolutionError('submission_resolution_run_not_uncertain', `运行 ${request.runId} 当前是 ${run.state}，只有 submitting 或 submission_uncertain 可以人工核对`);
            }
            if (attempt === undefined || (attempt.outcome !== 'in_progress' && attempt.outcome !== 'uncertain')) {
                throw resolutionError('submission_resolution_attempt_not_found', `运行 ${request.runId} 没有待确认的提交尝试`);
            }
            const previousOutcome = attempt.outcome;
            const attemptOutcome = ATTEMPT_OUTCOME_BY_RESULT[request.result];
            const runState = RUN_STATE_BY_RESULT[request.result];
            const noteRedacted = auditNote(request.result, confirmedBy, note);
            if (request.result === 'submitted') {
                runtime.db
                    .prepare(`UPDATE submission_attempts
                SET outcome = 'confirmed', finished_at = ?
              WHERE id = ? AND outcome IN ('in_progress', 'uncertain')`)
                    .run(now, attempt.id);
                runtime.db
                    .prepare(`UPDATE application_runs
                SET state = 'submitted_confirmed', updated_at = ?, finished_at = ?,
                    error_code = NULL, error_message_redacted = NULL
              WHERE id = ?`)
                    .run(now, now, request.runId);
            }
            else {
                // 用户已经去官网核对过「没有提交」。此时才允许把不确定尝试降为
                // failed_before_commit；系统本身绝不能根据超时或白屏自动做这个判断。
                runtime.db
                    .prepare(`UPDATE submission_attempts
                SET outcome = 'failed_before_commit', finished_at = ?,
                    idempotency_key = idempotency_key || ':reconciled-not-submitted:' || id,
                    error_code = 'submission_reconciled_not_submitted',
                    error_message_redacted = CASE
                      WHEN error_message_redacted IS NULL OR error_message_redacted = '' THEN ?
                      ELSE error_message_redacted || '；' || ?
                    END
              WHERE id = ? AND outcome IN ('in_progress', 'uncertain')`)
                    .run(now, noteRedacted, noteRedacted, attempt.id);
                runtime.db
                    .prepare(`UPDATE application_runs
                SET state = 'failed_recoverable', updated_at = ?, finished_at = NULL,
                    error_code = 'submission_reconciled_not_submitted',
                    error_message_redacted = ?
              WHERE id = ?`)
                    .run(now, noteRedacted, request.runId);
            }
            runtime.db
                .prepare(`INSERT INTO state_events
             (id, run_id, from_state, to_state, reason_code, note_redacted, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`)
                .run(resolutionEventId(attempt.id), request.runId, run.state, runState, REASON_BY_RESULT[request.result], `${noteRedacted}；原提交状态：${previousOutcome}`, now);
            runtime.db
                .prepare(`UPDATE human_takeover_requests
              SET status = 'resolved', resolved_at = ?
            WHERE run_id = ? AND status = 'pending' AND reason = 'submission_uncertain'`)
                .run(now, request.runId);
            runtime.db.exec('COMMIT');
            return {
                runId: request.runId,
                taskId: run.task_id,
                attemptId: attempt.id,
                result: request.result,
                attemptOutcome,
                runState,
                alreadyResolved: false,
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
export function resolveSubmissionOutcome(request) {
    const resolvedAt = request.now ?? new Date().toISOString();
    const confirmedBy = request.confirmedBy.trim();
    const note = request.note?.trim() || undefined;
    const truth = reconcileTruth({ ...request, confirmedBy, ...(note === undefined ? {} : { note }), now: resolvedAt });
    // 任务状态和导出 outbox 继续走唯一的共享回写函数。若这一步失败，提交真相已经保存；
    // 同一结论可幂等重试本入口，它会再次尝试同步任务，而不会重复写裁决事件。
    let taskStatus;
    try {
        taskStatus = updateTaskFromRun({ paths: request.paths, runId: request.runId, now: resolvedAt }).status;
    }
    catch (error) {
        throw new Error(`submission_resolution_saved_but_task_sync_failed: 提交结果已保存，但任务状态同步失败：${describeError(error)}`, { cause: error });
    }
    return {
        runId: truth.runId,
        taskId: truth.taskId,
        attemptId: truth.attemptId,
        result: truth.result,
        attemptOutcome: truth.attemptOutcome,
        runState: truth.runState,
        taskStatus,
        confirmedBy,
        ...(note === undefined ? {} : { note }),
        resolvedAt,
        alreadyResolved: truth.alreadyResolved,
    };
}
//# sourceMappingURL=resolve-submission-outcome.js.map