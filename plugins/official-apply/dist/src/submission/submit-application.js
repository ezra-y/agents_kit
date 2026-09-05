/**
 * 最终提交。**只执行一次。**
 *
 * 规则文档：
 * - `docs/06_函数接口与执行循环.md §3.14`
 * - `docs/10_状态提交安全隐私与错误恢复.md §4-§5`
 * - `docs/13 D17`、`R17`
 *
 * 这是整个系统里最危险的函数。它绝不做两件事：
 *
 * 1. **超时后自动再点一次。**
 * 2. **页面白屏后猜测失败并再次提交。**
 *
 * 幂等保护的做法是：**点击之前先把 attempt 写进数据库**。
 * `idempotency_key` 有唯一约束，所以第二次尝试连记录都插不进去，
 * 更不会走到点击那一步。
 *
 * 结果不确定时进入 `submission_uncertain` 并**锁死**——
 * 状态机不允许从这个状态自动回到提交流程。
 */
import { randomUUID } from 'node:crypto';
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
import { transitionRunState } from "../application/run-state-machine.js";
import { hashSubmissionApprovalToken, verifyConsumedSubmissionApproval, } from "./submission-approval.js";
import { checkSubmissionAuthority } from "./submission-authority.js";
import { computeSubmissionIdempotencyKey } from "./compute-submission-idempotency-key.js";
import { findCrossTaskSubmissionConflict, submissionOutcomeLabel, } from "./job-identity.js";
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
function refuse(reason, finalState) {
    return { finalState, refusedReason: reason, evidence: [] };
}
function samePageDigest(left, right) {
    return (left.controlCount >= 0 &&
        right.controlCount >= 0 &&
        left.url === right.url &&
        left.controlCount === right.controlCount &&
        left.valueHash === right.valueHash);
}
export async function submitApplication(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    // 1. 权限由最终提交核心再次检查，不能只信调用方传入的准备结果。
    const authority = checkSubmissionAuthority({
        paths: request.paths,
        runId: request.runId,
        taskId: request.taskId,
        mode: request.mode,
    });
    if (!authority.allowed) {
        return refuse(`submission_authority_refused: ${authority.blockers.join('；')}`, request.mode === 'review' ? 'ready_for_review' : 'ready_to_submit');
    }
    // 2. 准备阶段没通过，一律不提交。
    if (!request.prepared.ready) {
        return refuse(`submission_not_ready: ${request.prepared.blockers.join('；')}`, 'ready_to_submit');
    }
    const commitActions = request.pageSchema.actions.filter((action) => action.commitAction);
    const expectedIdempotencyKey = computeSubmissionIdempotencyKey({
        taskId: request.taskId,
        runId: request.runId,
        pageSchema: request.pageSchema,
        commitAction: commitActions[0],
    });
    if (request.prepared.idempotencyKey !== expectedIdempotencyKey) {
        return refuse('submission_idempotency_key_mismatch: 提交页面或提交动作已经变化，请重新预检', request.mode === 'review' ? 'ready_for_review' : 'ready_to_submit');
    }
    // 3. review 是默认模式，永远停在提交前，除非用户明确批准。
    if (request.mode === 'review') {
        if (request.explicitApprovalToken === undefined ||
            request.approvalReceipt === undefined) {
            return refuse('submission_mode_review: review 模式需要提交前检查签发并消费一次性批准令牌', 'ready_for_review');
        }
        if (request.approvalReceipt.tokenHash !==
            hashSubmissionApprovalToken(request.explicitApprovalToken) ||
            !verifyConsumedSubmissionApproval({
                paths: request.paths,
                approvalId: request.approvalReceipt.approvalId,
                tokenHash: request.approvalReceipt.tokenHash,
                runId: request.runId,
                taskId: request.taskId,
                idempotencyKey: request.prepared.idempotencyKey,
                pageDigest: request.prepared.pageDigest,
            })) {
            return refuse('submission_approval_receipt_invalid: 批准令牌没有通过当前任务的程序校验', 'ready_for_review');
        }
    }
    // 4. 必须真的有一个被标成 commit 的按钮。
    const commitAction = commitActions[0];
    if (commitAction === undefined) {
        return refuse('submission_no_commit_action: 页面上没有最终提交按钮', 'ready_to_submit');
    }
    // 5. **执行器必须齐**，而且要在写 attempt 之前检查（修复清单 P0-5）。
    //
    // 下面第 5 步会先把 attempt 写进数据库来保证幂等。如果那之后才发现
    // 没有点击执行器，这条 attempt 就白占了唯一的提交机会——
    // 幂等键已经用掉，这条任务之后再也提交不了了。
    //
    // 所以宁可在这里早退：没有执行器就等于「这次根本没提交」，状态不变。
    if (request.clickCommit === undefined) {
        return refuse('submission_executor_missing: 没有注入提交执行器，拒绝提交（不会占用这次任务的提交机会）', 'ready_to_submit');
    }
    if (request.collectEvidence === undefined) {
        return refuse('submission_executor_missing: 没有注入证据收集器，点了也判不出成没成，拒绝提交', 'ready_to_submit');
    }
    if (request.readCurrentPageDigest === undefined) {
        return refuse('submission_executor_missing: 没有注入最终页面摘要读取器，拒绝提交', 'ready_to_submit');
    }
    const finalPageDigest = await request.readCurrentPageDigest().catch(() => undefined);
    if (finalPageDigest === undefined ||
        !samePageDigest(request.prepared.pageDigest, finalPageDigest)) {
        return refuse('submission_page_changed: 页面在准备提交后已经变化，请重新预检', request.mode === 'review' ? 'ready_for_review' : 'ready_to_submit');
    }
    // 6. 先占位再点击。这是幂等保护的核心。
    //
    // 跨任务检查和占位插入必须在**同一个写事务**里：
    // `BEGIN IMMEDIATE` 拿到写锁后，第二个并发提交会在这里排队；
    // 第一个提交完成（或回滚）后，第二个才读得到最新事实。
    // 只做预检层检查的话，两个并发运行可能同时通过检查再各自插入——
    // 同任务有唯一索引兜底，但«不同任务、同一岗位»没有。
    const attemptId = newId('submission');
    const runtime = openRuntimeDatabase({ paths: request.paths });
    try {
        // BEGIN 失败时事务还没有打开，没有可回滚的东西，原样向上抛。
        runtime.db.exec('BEGIN IMMEDIATE');
        try {
            const crossTaskConflict = findCrossTaskSubmissionConflict(runtime.db, request.taskId);
            if (crossTaskConflict !== undefined) {
                // 还没有写任何数据，提交这个只读事务即可释放写锁。这样不会为了正常拒绝
                // 额外制造一次回滚，也避免“回滚失败后又回滚一次”的错误路径。
                runtime.db.exec('COMMIT');
                return refuse(`submission_cross_task_attempted: 岗位「${crossTaskConflict.otherJobTitle ?? (crossTaskConflict.matchedBy === 'job_key' ? '同岗位' : '同岗位页面')}」` +
                    `已有任务 ${crossTaskConflict.otherTaskId} 的提交记录` +
                    `（${submissionOutcomeLabel(crossTaskConflict.outcome)}），本任务不能再点提交`, request.mode === 'review' ? 'ready_for_review' : 'ready_to_submit');
            }
            runtime.db
                .prepare(`INSERT INTO submission_attempts
             (id, run_id, task_id, idempotency_key, approval_source,
              approval_token_hash, started_at, outcome)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress')`)
                .run(attemptId, request.runId, request.taskId, request.prepared.idempotencyKey, request.mode === 'auto' ? 'auto_mode' : 'user_explicit', request.explicitApprovalToken === undefined
                ? null
                : hashSubmissionApprovalToken(request.explicitApprovalToken), now);
            runtime.db.exec('COMMIT');
        }
        catch (error) {
            // INSERT / COMMIT 失败统一只回滚一次。回滚成功后，同任务唯一冲突变成拒绝；
            // 其他错误原样抛出。回滚也失败时同时保留原错误和 rollbackError。
            rollbackOrThrow(runtime.db, error);
            if (isSubmissionAttemptConflict(error)) {
                return refuse('submission_already_attempted: 这条任务已有进行中或结果已确定的提交，不允许再点一次', 'submission_uncertain');
            }
            throw error;
        }
    }
    finally {
        runtime.close();
    }
    const transition = transitionRunState({
        paths: request.paths,
        runId: request.runId,
        to: 'submitting',
        reasonCode: 'submit_started',
        now,
    });
    if (!transition.allowed) {
        // blocked 没有进入可提交状态，保留审计记录，但不能占住下一次合法提交的幂等键。
        finalizeAttempt(request, attemptId, 'blocked', [], transition.reason, now);
        return refuse(`submission_run_not_ready: ${transition.reason ?? `${transition.from} 不能进入 submitting`}`, transition.from);
    }
    // 7. 点一次。就一次。
    const clickResult = await request.clickCommit().catch((error) => ({
        clicked: false,
        message: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
    }));
    const clickMessage = clickResult.message;
    // 8. 收集证据。点没点成功不算数，页面怎么说才算数。
    const evidence = await request.collectEvidence().catch(() => []);
    const confirmed = evidence.some((item) => item.confidence >= 0.85);
    const finalOutcome = confirmed ? 'confirmed' : 'uncertain';
    finalizeAttempt(request, attemptId, finalOutcome, evidence, clickMessage, now);
    const finalState = confirmed ? 'submitted_confirmed' : 'submission_uncertain';
    transitionRunState({
        paths: request.paths,
        runId: request.runId,
        to: finalState,
        reasonCode: confirmed ? 'submit_confirmed' : 'submit_uncertain',
        now,
    });
    const attempt = {
        id: attemptId,
        runId: request.runId,
        taskId: request.taskId,
        idempotencyKey: request.prepared.idempotencyKey,
        startedAt: now,
        finishedAt: now,
        outcome: finalOutcome,
        successEvidence: evidence,
        ...(clickMessage === undefined ? {} : { errorMessage: clickMessage }),
    };
    const requiresHuman = confirmed
        ? undefined
        : {
            runId: request.runId,
            reason: 'submission_uncertain',
            message: [
                '已经点过一次最终提交，但没有拿到强证据。',
                '系统不会再点第二次。请你到官网确认这次投递到底成没成。',
                clickMessage === undefined ? '' : `执行信息：${clickMessage}`,
            ]
                .filter((line) => line !== '')
                .join('\n'),
            resumeCondition: '你确认结果后，手动把任务状态改成成功或失败。',
            currentUrl: request.pageSchema.url,
        };
    return {
        attempt,
        finalState,
        evidence,
        ...(requiresHuman === undefined ? {} : { requiresHuman }),
    };
}
function isSubmissionAttemptConflict(error) {
    return (error instanceof Error &&
        error.message.includes('UNIQUE constraint failed: submission_attempts.'));
}
function rollback(db) {
    if (db.isTransaction) {
        db.exec('ROLLBACK');
    }
}
function rollbackOrThrow(db, error) {
    try {
        rollback(db);
    }
    catch (rollbackError) {
        throw Object.assign(new Error(`submission_transaction_rollback_failed: 原错误：${error instanceof Error ? error.message : String(error)}；回滚错误：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, { cause: error }), { rollbackError });
    }
}
function finalizeAttempt(request, attemptId, outcome, evidence, message, now) {
    const runtime = openRuntimeDatabase({ paths: request.paths });
    try {
        runtime.db
            .prepare(`UPDATE submission_attempts
         SET outcome = ?, finished_at = ?, success_evidence_json = ?, error_message_redacted = ?,
             idempotency_key = CASE
               WHEN ? = 'blocked' THEN idempotency_key || ':blocked:' || id
               ELSE idempotency_key
             END
         WHERE id = ?`)
            .run(outcome, now, JSON.stringify(evidence), message ?? null, outcome, attemptId);
    }
    finally {
        runtime.close();
    }
}
//# sourceMappingURL=submit-application.js.map