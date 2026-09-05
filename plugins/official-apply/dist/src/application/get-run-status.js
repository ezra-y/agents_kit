/**
 * 返回当前状态、缺失问题、人工接管原因和提交结果。
 *
 * 规则文档：`docs/10_状态提交安全隐私与错误恢复.md §2、§7、§17`
 *
 * 核心状态在 SQLite，**不依赖聊天记忆**（`docs/10 §17`）。
 * 所以进程重启、Agent 中断之后，靠这个函数就能知道停在哪里、下一步做什么。
 */
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
/** 每个状态对应一句「接下来该干什么」。 */
const RESUME_HINTS = {
    queued: '还没开始。运行 applyctl task run 开始这次投递。',
    opening: '正在打开官网。如果卡住，检查浏览器会话是否还在。',
    discovering: '正在扫描页面字段。重启后重新扫描当前页即可。',
    collecting_answers: '正在找答案。重启后从当前页重新解析，不用重填已成功的字段。',
    waiting_for_user: '等你补充答案或处理登录、验证码。答完之后继续当前页。',
    filling: '正在填写。重启后先重新校验当前页，只修失败字段。',
    validating: '正在统一校验。重启后重新校验一次即可。',
    ready_for_review: '已填完，等你检查。确认无误后再决定是否提交。',
    ready_to_submit: '已准备好提交。review 模式下需要你明确批准。',
    submitting: '已经点过提交，正在等结果。**不要再点第二次。**',
    submitted_confirmed: '已确认投递成功。这条任务结束了。',
    submission_uncertain: '点过一次提交但结果不确定。请到官网人工确认；确认后用 apply.resolve_submission 写回结果。系统不会自动重试。',
    failed_recoverable: '程序可以从最近的安全检查点自动重试。',
    failed_terminal: '当前无法继续。需要人工处理后再决定。',
    cancelled: '这次运行已取消。',
};
/** 程序可从安全点继续的固定措辞，和 updateTaskFromRun 的备注同一句。 */
export const RESUMABLE_RETRY_HINT = '程序可以从最近的安全检查点自动重试。';
/**
 * 恢复提示：优先用具体卡点（带 message 和恢复条件），
 * 其次用具体错误，最后才是状态默认文案。
 */
export function resumeHintFor(state, takeover, errorMessageRedacted) {
    if (takeover !== undefined) {
        return `需要人工处理：${takeover.message}（恢复条件：${takeover.resumeCondition}）`;
    }
    if (state === 'failed_recoverable' && errorMessageRedacted !== null && errorMessageRedacted !== '') {
        return `上次停因：${errorMessageRedacted}；${RESUMABLE_RETRY_HINT}`;
    }
    return RESUME_HINTS[state];
}
export function getRunStatus(request) {
    const runtime = openRuntimeDatabase({ paths: request.paths });
    try {
        const run = runtime.db
            .prepare(`SELECT id, task_id, state, updated_at, error_code, error_message_redacted
           FROM application_runs WHERE id = ?`)
            .get(request.runId);
        if (run === undefined) {
            return {
                runId: request.runId,
                exists: false,
                state: 'queued',
                pendingQuestionCount: 0,
                humanTakeoverReasons: [],
                resumeHint: '找不到这次运行。可能数据库被清理过，或者 run id 写错了。',
            };
        }
        const state = String(run['state']);
        const pending = runtime.db
            .prepare("SELECT COUNT(*) AS n FROM missing_answer_requests WHERE run_id = ? AND status = 'pending'")
            .get(request.runId);
        const takeovers = runtime.db
            .prepare(`SELECT reason, message, resume_condition, current_url_redacted
           FROM human_takeover_requests
          WHERE run_id = ? AND status = 'pending'
          ORDER BY created_at DESC, rowid DESC`)
            .all(request.runId);
        const submission = runtime.db
            .prepare('SELECT outcome FROM submission_attempts WHERE run_id = ? ORDER BY started_at DESC LIMIT 1')
            .get(request.runId);
        const validation = runtime.db
            .prepare('SELECT valid FROM validation_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1')
            .get(request.runId);
        const errorCode = String(run['error_code'] ?? '');
        const errorMessageRedacted = String(run['error_message_redacted'] ?? '');
        const current = takeovers[0];
        return {
            runId: request.runId,
            ...(run['task_id'] === null ? {} : { taskId: String(run['task_id']) }),
            exists: true,
            state,
            ...(run['updated_at'] === null ? {} : { updatedAt: String(run['updated_at']) }),
            pendingQuestionCount: pending.n,
            humanTakeoverReasons: takeovers.map((row) => row.reason),
            ...(current === undefined
                ? {}
                : {
                    currentHumanTakeover: {
                        reason: current.reason,
                        message: current.message,
                        resumeCondition: current.resume_condition,
                        ...(current.current_url_redacted === null
                            ? {}
                            : { currentUrlRedacted: current.current_url_redacted }),
                    },
                }),
            ...(errorCode === '' ? {} : { errorCode }),
            ...(errorMessageRedacted === '' ? {} : { errorMessageRedacted }),
            ...(submission === undefined ? {} : { lastSubmissionOutcome: submission.outcome }),
            ...(validation === undefined ? {} : { lastValidationValid: validation.valid === 1 }),
            resumeHint: resumeHintFor(state, current === undefined ? undefined : { message: current.message, resumeCondition: current.resume_condition }, errorMessageRedacted === '' ? null : errorMessageRedacted),
        };
    }
    finally {
        runtime.close();
    }
}
export { RESUME_HINTS };
//# sourceMappingURL=get-run-status.js.map