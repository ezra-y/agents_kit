/**
 * 把一次运行的结果回写到任务上，并排进待投递队列。
 *
 * 规则文档：`docs/01`、`docs/10 §8`、修复清单 P1-12
 *
 * 用户是从一份表格里来的，结果也要能回到表格里去。这一步不做就等于：
 * 投完了，但用户不知道哪些投成了、哪些卡住了。
 *
 * 三条边界：
 *
 * 1. **只根据数据库里的事实回写**，不猜。运行状态、提交结果、证据，
 *    全部来自 `application_runs` 和 `submission_attempts`。
 * 2. **结果不确定就写不确定。** 不确定绝不四舍五入成成功
 *    （`docs/13 D17`）——那会让用户以为投出去了，实际没有。
 * 3. **申请编号只留形状**，不留完整值。
 */
import { randomUUID } from 'node:crypto';
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
import { redactApplicationId } from "../submission/collect-submission-evidence.js";
import { readTaskSubmissionTruth } from "../submission/task-submission-truth.js";
function outboxError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
/**
 * 运行状态 → 任务去向。
 *
 * `submission_uncertain` 单独一档，不并进 submitted 也不并进 failed。
 * 它的含义是「点过一次，但不知道成没成」，需要用户去官网确认。
 */
const STATE_TO_STATUS = {
    queued: 'queued',
    opening: 'in_progress',
    discovering: 'in_progress',
    collecting_answers: 'in_progress',
    filling: 'in_progress',
    validating: 'in_progress',
    ready_for_review: 'needs_user',
    ready_to_submit: 'needs_user',
    submitting: 'in_progress',
    submitted_confirmed: 'submitted',
    submission_uncertain: 'submission_uncertain',
    waiting_for_user: 'needs_user',
    failed_terminal: 'failed',
    cancelled: 'skipped',
};
/** 只有真的有待处理的人工事项，才把失败标成 needs_user；否则程序可从安全点自动重试。 */
function statusForFailedRecoverable(pendingHumanWork) {
    return pendingHumanWork ? 'needs_user' : 'in_progress';
}
/** 失败可恢复但不需要用户时的公开备注，和 getRunStatus 的恢复提示同一句。 */
export const RESUMABLE_RETRY_NOTE = '程序可以从最近的安全检查点自动重试。';
/** 每种去向对应的下一步。写给人看，要能照着做。 */
const NEXT_ACTION = {
    queued: '还没开始，用 apply.open_task 打开这条任务。',
    in_progress: '还在进行中。用 applyctl status --run <runId> 看停在哪一步。',
    completed: '公司简历已保存并读回，不需要再填写。',
    submitted: '已确认投递成功，不需要再做什么。',
    submission_uncertain: '点过一次提交但没拿到确认。请你本人去官网核对，再用 apply.resolve_submission 写回结果；系统不会自动重试。',
    needs_user: '需要你处理：回答缺失问题、处理登录验证码，或确认后再提交。',
    failed: '这次运行已经失败终止。看结果备注里的原因，修好后重新导入任务。',
    skipped: '这条任务被取消了。',
};
function protectedTaskStatus(run, submissionTruth) {
    if (submissionTruth === 'submitted')
        return 'submitted';
    if (submissionTruth === 'submission_uncertain')
        return 'submission_uncertain';
    if (run.task_status === 'completed' || run.task_status === 'skipped') {
        return run.task_status;
    }
    if (submissionTruth === 'no_attempts' &&
        (run.task_status === 'submitted' || run.task_status === 'submission_uncertain')) {
        return run.task_status;
    }
    return undefined;
}
function insertTaskUpdate(db, input) {
    // pending 是「下一次要写出的最新事实」，不是历史日志。
    // 同一事务内先删掉本任务旧 pending 再插新的：最新状态只留一条。
    // delivered/failed 是已发生的交付记录，不在这里动。
    // 任何失败都进入外层 ROLLBACK，删除和插入一起恢复。
    db.prepare(`DELETE FROM task_update_outbox
      WHERE task_id = ? AND delivery_status = 'pending'`).run(input.taskId);
    db.prepare(`INSERT INTO task_update_outbox
       (id, task_id, target_status, result_note_redacted, payload_json,
        delivery_status, attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`).run(input.id, input.taskId, input.status, input.resultNote, JSON.stringify(input.payload), input.now, input.now);
}
export function updateTaskFromRun(request) {
    const now = request.now ?? new Date().toISOString();
    const outboxId = (request.idFactory ?? defaultIdFactory)('outbox');
    const runtime = openRuntimeDatabase({ paths: request.paths });
    try {
        runtime.db.exec('BEGIN IMMEDIATE');
        try {
            const run = runtime.db
                .prepare(`SELECT run.task_id, run.state,
                  task.status AS task_status, task.result_note AS task_result_note
             FROM application_runs AS run
             JOIN application_tasks AS task ON task.id = run.task_id
            WHERE run.id = ?`)
                .get(request.runId);
            if (run === undefined) {
                throw outboxError('task_outbox_run_not_found', `找不到运行 ${request.runId}`);
            }
            const taskId = run.task_id;
            const submissionTruth = readTaskSubmissionTruth(runtime.db, taskId);
            const protectedStatus = protectedTaskStatus(run, submissionTruth);
            let applicationIdRedacted;
            let evidenceSummary = [];
            // 当前运行最近一次提交尝试只用于结果备注；任务结论来自全部历史。
            const attempt = runtime.db
                .prepare(`SELECT success_evidence_json, error_message_redacted
             FROM submission_attempts WHERE run_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`)
                .get(request.runId);
            const notes = [];
            if (attempt !== undefined) {
                let evidence = [];
                try {
                    evidence = JSON.parse(attempt.success_evidence_json ?? '[]');
                }
                catch {
                    evidence = [];
                }
                evidenceSummary = evidence.map((item) => `${item.kind}（可信度 ${item.confidence.toFixed(2)}）`);
                const applicationId = evidence.find((item) => item.kind === 'application_id');
                if (applicationId !== undefined) {
                    // 证据里存的已经是脱敏值，这里再过一遍保证不会漏。
                    applicationIdRedacted = redactApplicationId(applicationId.valueRedacted);
                }
                if (submissionTruth !== 'submitted' &&
                    attempt.error_message_redacted !== null &&
                    attempt.error_message_redacted !== '') {
                    notes.push(attempt.error_message_redacted);
                }
            }
            // 还等着人处理的事，也要写进备注里。
            // failed_recoverable 的去向也由它决定：没有待办人工事项就不是 needs_user。
            const pending = runtime.db
                .prepare("SELECT COUNT(*) AS n FROM missing_answer_requests WHERE run_id = ? AND status = 'pending'")
                .get(request.runId);
            const takeover = runtime.db
                .prepare(`SELECT reason, message, resume_condition
             FROM human_takeover_requests
            WHERE run_id = ? AND status = 'pending'
            ORDER BY created_at DESC, rowid DESC
            LIMIT 1`)
                .get(request.runId);
            const hasPendingHumanWork = pending.n > 0 || takeover !== undefined;
            const status = protectedStatus ??
                (run.state === 'failed_recoverable'
                    ? statusForFailedRecoverable(hasPendingHumanWork)
                    : STATE_TO_STATUS[run.state]);
            if (pending.n > 0) {
                notes.push(`还有 ${pending.n} 个问题没回答`);
            }
            if (takeover !== undefined) {
                // 卡点说明用保存下来的 message 和恢复条件，不只用 captcha 这种枚举值。
                notes.push(`需要人工处理（${takeover.reason}）：${takeover.message}；恢复条件：${takeover.resume_condition}`);
            }
            if (status === 'in_progress' && run.state === 'failed_recoverable') {
                notes.push(RESUMABLE_RETRY_NOTE);
            }
            const resultNote = protectedStatus !== undefined && run.task_status === status
                ? (run.task_result_note ?? NEXT_ACTION[status])
                : (notes.length > 0 ? notes.join('；') : NEXT_ACTION[status]);
            runtime.db
                .prepare('UPDATE application_tasks SET status = ?, result_note = ?, updated_at = ? WHERE id = ?')
                .run(status, resultNote, now, taskId);
            insertTaskUpdate(runtime.db, {
                id: outboxId,
                taskId,
                status,
                resultNote,
                payload: {
                    runId: request.runId,
                    status,
                    resultNote,
                    applicationIdRedacted: applicationIdRedacted ?? null,
                    evidenceSummary,
                    nextAction: NEXT_ACTION[status],
                },
                now,
            });
            runtime.db.exec('COMMIT');
            return {
                taskId,
                runId: request.runId,
                status,
                resultNote,
                ...(applicationIdRedacted === undefined ? {} : { applicationIdRedacted }),
                evidenceSummary,
                nextAction: NEXT_ACTION[status],
                outboxId,
            };
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
//# sourceMappingURL=update-task-from-run.js.map