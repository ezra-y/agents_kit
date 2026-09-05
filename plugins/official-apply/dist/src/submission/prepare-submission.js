/**
 * 提交前重新核对公司、岗位、材料、缺失项和历史提交。
 *
 * 规则文档：`docs/10_状态提交安全隐私与错误恢复.md §3-§4、§9`
 *
 * Prepare 和 Commit 必须分开（`docs/13 D16`）：
 * Prepare 可以安全重试，Commit 不能盲目重试。
 *
 * auto 模式**不是**「无条件无人值守」。
 * 只有下面全部满足才允许提交（`docs/10 §9`）：
 *
 * - 模式是 auto
 * - 字段和答案完整
 * - 校验通过
 * - 没有高风险确认
 * - 没有登录、验证码和平台强制确认
 * - 没有已有提交 attempt
 *
 * 任何一条不满足就降级，不硬做。
 */
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
import { computeSubmissionIdempotencyKey } from "./compute-submission-idempotency-key.js";
import { checkSubmissionAuthority } from "./submission-authority.js";
import { readTaskSubmissionTruth } from "./task-submission-truth.js";
import { findCrossTaskSubmissionConflict, submissionOutcomeLabel, } from "./job-identity.js";
/** 高风险字段：即使一切正常，也要人确认一次。 */
const HIGH_RISK_KEY_PATTERN = /id_number|identity\.id|compliance|declaration|agreement|salary|compensation/;
export function prepareSubmission(request) {
    const blockers = [];
    let requiresHuman;
    // 1. 最终提交只接受有明确岗位事实和来源的岗位申请。
    const authority = checkSubmissionAuthority({
        paths: request.paths,
        runId: request.runId,
        taskId: request.taskId,
        mode: request.mode,
    });
    blockers.push(...authority.blockers);
    // 2. 校验必须通过。
    if (!request.validation.valid) {
        const errors = request.validation.issues.filter((issue) => issue.severity === 'error' || issue.severity === 'blocking');
        blockers.push(`页面校验未通过，还有 ${errors.length} 个阻塞问题`);
    }
    // 3. 不能有未解决字段。
    const unresolved = request.unresolvedRuntimeRefs ?? [];
    if (unresolved.length > 0) {
        blockers.push(`还有 ${unresolved.length} 个字段没有确定答案`);
    }
    // 4. 页面上必须真的有最终提交按钮。
    const commitActions = request.pageSchema.actions.filter((action) => action.commitAction);
    if (commitActions.length === 0) {
        blockers.push('当前页面没有找到最终提交按钮');
    }
    if (commitActions.length > 1) {
        blockers.push(`当前页面有 ${commitActions.length} 个疑似最终提交按钮，无法确定点哪个`);
    }
    if (commitActions[0]?.disabled === true) {
        blockers.push('最终提交按钮当前不可用');
    }
    // 5. 登录、验证码这类必须人工处理。
    if (request.pageSchema.pageType === 'login' || request.pageSchema.pageType === 'captcha') {
        blockers.push('当前页面需要登录或验证码');
        requiresHuman = {
            runId: request.runId,
            reason: request.pageSchema.pageType === 'captcha' ? 'captcha' : 'login',
            message: '提交前遇到登录或验证码，需要你本人处理。',
            resumeCondition: '处理完成后重新校验当前页面。',
            currentUrl: request.pageSchema.url,
        };
    }
    // 6. 高风险字段要人确认。
    const highRisk = request.pageSchema.fields.filter((field) => field.required && HIGH_RISK_KEY_PATTERN.test(`${field.rawLabel}${field.htmlName ?? ''}`));
    if (highRisk.length > 0 && request.mode === 'auto') {
        blockers.push(`存在 ${highRisk.length} 个高风险确认字段，auto 模式下也要你本人确认`);
        requiresHuman ??= {
            runId: request.runId,
            reason: 'sensitive_confirmation',
            message: '这一页有身份证号、合规声明或薪资一类的高风险字段，需要你确认后再提交。',
            resumeCondition: '确认无误后手动允许提交。',
            currentUrl: request.pageSchema.url,
        };
    }
    // 7. 历史提交。已确认成功或结果不确定，一律不许再提交。
    const idempotencyKey = computeSubmissionIdempotencyKey({
        taskId: request.taskId,
        runId: request.runId,
        pageSchema: request.pageSchema,
        commitAction: commitActions[0],
    });
    const submissionTruth = readSubmissionTruth(request);
    if (submissionTruth === 'submitted') {
        blockers.push('这条任务已经有确认成功的提交记录');
    }
    if (submissionTruth === 'submission_uncertain') {
        blockers.push('上一次提交结果仍然不确定，确认之前不得再次提交');
    }
    // 8. 同一岗位的另一条任务已经有过提交事实时，必须由人来裁决。
    const crossTaskConflict = readCrossTaskConflict(request);
    if (crossTaskConflict !== undefined) {
        blockers.push(`跨任务重复提交：岗位「${crossTaskConflict.otherJobTitle ?? (crossTaskConflict.matchedBy === 'job_key' ? '同岗位' : '同岗位页面')}」` +
            `已有任务 ${crossTaskConflict.otherTaskId} 的提交记录（${submissionOutcomeLabel(crossTaskConflict.outcome)}）。` +
            `请先确认那一条任务，这条任务在确认前不能再提交。`);
    }
    // 9. review 是默认模式，本来就停在提交前。
    if (request.mode === 'review') {
        return {
            ready: blockers.length === 0,
            blockers,
            idempotencyKey,
            pageDigest: request.pageDigest,
            allowedNextAction: 'wait_for_user',
            ...(requiresHuman === undefined ? {} : { requiresHuman }),
        };
    }
    return {
        ready: blockers.length === 0,
        blockers,
        idempotencyKey,
        pageDigest: request.pageDigest,
        allowedNextAction: blockers.length === 0
            ? 'submit'
            : !authority.allowed || requiresHuman !== undefined || crossTaskConflict !== undefined
                ? 'wait_for_user'
                : 'fix_errors',
        ...(requiresHuman === undefined ? {} : { requiresHuman }),
    };
}
function readCrossTaskConflict(request) {
    const runtime = openRuntimeDatabase({ paths: request.paths });
    try {
        return findCrossTaskSubmissionConflict(runtime.db, request.taskId);
    }
    finally {
        runtime.close();
    }
}
function readSubmissionTruth(request) {
    const runtime = openRuntimeDatabase({ paths: request.paths });
    try {
        return readTaskSubmissionTruth(runtime.db, request.taskId);
    }
    finally {
        runtime.close();
    }
}
//# sourceMappingURL=prepare-submission.js.map