/**
 * 只允许合法状态迁移，并写入审计记录。
 *
 * 规则文档：`docs/10_状态提交安全隐私与错误恢复.md §1-§2`
 *
 * 为什么必须有状态机（`docs/10 §1`）：
 * 没有它，Agent 容易重复打开任务、重复填写、忘记用户已经回答、
 * 超时后再次提交、重启后不知道进行到哪里。
 *
 * 最关键的一条：**`submitting` 只能从 `ready_to_submit` 进入**，
 * 而且 `submission_uncertain` 是**终态**——不确认结果之前不能自动回到提交流程。
 */
import { randomUUID } from 'node:crypto';
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
/**
 * 合法迁移表。
 *
 * 没列出来的迁移一律拒绝。宁可报错，也不允许状态悄悄跳过关键检查。
 */
export const ALLOWED_TRANSITIONS = {
    queued: ['opening', 'cancelled', 'failed_terminal'],
    opening: ['discovering', 'waiting_for_user', 'failed_recoverable', 'failed_terminal', 'cancelled'],
    discovering: [
        'collecting_answers',
        'filling',
        'waiting_for_user',
        'failed_recoverable',
        'failed_terminal',
        'cancelled',
    ],
    collecting_answers: [
        'waiting_for_user',
        'filling',
        'discovering',
        'failed_recoverable',
        'failed_terminal',
        'cancelled',
    ],
    waiting_for_user: [
        'collecting_answers',
        'filling',
        'discovering',
        'opening',
        'failed_terminal',
        'cancelled',
    ],
    filling: [
        'validating',
        'discovering',
        'waiting_for_user',
        'failed_recoverable',
        'failed_terminal',
        'cancelled',
    ],
    validating: [
        'filling',
        'discovering',
        'ready_for_review',
        'ready_to_submit',
        'waiting_for_user',
        'failed_recoverable',
        'failed_terminal',
        'cancelled',
    ],
    ready_for_review: [
        'ready_to_submit',
        'filling',
        'discovering',
        'waiting_for_user',
        'cancelled',
        'failed_terminal',
    ],
    // 提交只能从这里出发。
    ready_to_submit: ['submitting', 'filling', 'validating', 'waiting_for_user', 'cancelled'],
    // 进入提交后只有三条出路，没有「回去再点一次」。
    submitting: ['submitted_confirmed', 'submission_uncertain', 'failed_terminal'],
    submitted_confirmed: [],
    // 终态。结果不确认之前不得自动重来（`docs/13 D17`）。
    submission_uncertain: [],
    failed_recoverable: ['opening', 'discovering', 'filling', 'cancelled', 'failed_terminal'],
    failed_terminal: [],
    cancelled: [],
};
/** 这些状态说明这次运行已经结束，不该再自动往前推。 */
export const TERMINAL_STATES = new Set([
    'submitted_confirmed',
    'submission_uncertain',
    'failed_terminal',
    'cancelled',
]);
export function runStateAfterBrowserLoss(state) {
    if (TERMINAL_STATES.has(state))
        return state;
    if (state === 'submitting')
        return 'submission_uncertain';
    return 'failed_recoverable';
}
export function runBrowserLossUpdate(state, existingErrorCode, existingErrorMessageRedacted, kind, detail) {
    if (TERMINAL_STATES.has(state)) {
        return {
            nextState: undefined,
            errorCode: undefined,
            errorMessageRedacted: undefined,
        };
    }
    if (kind === 'closed') {
        if (state === 'submitting') {
            return {
                nextState: 'submission_uncertain',
                errorCode: undefined,
                errorMessageRedacted: undefined,
            };
        }
        return {
            nextState: undefined,
            errorCode: undefined,
            errorMessageRedacted: undefined,
        };
    }
    const nextState = state === 'submitting' ? 'submission_uncertain' : 'failed_recoverable';
    const reasonCode = kind === 'failed' ? 'browser_session_failed' : 'browser_disconnected';
    const hasRootCause = (existingErrorCode !== null && existingErrorCode !== '') ||
        (existingErrorMessageRedacted !== null && existingErrorMessageRedacted !== '');
    return {
        nextState,
        errorCode: hasRootCause ? undefined : reasonCode,
        errorMessageRedacted: hasRootCause ? undefined : detail,
    };
}
export function isTransitionAllowed(from, to) {
    if (from === to) {
        return true;
    }
    return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}
export function transitionRunState(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    const runtime = openRuntimeDatabase({ paths: request.paths });
    try {
        const row = runtime.db
            .prepare('SELECT state FROM application_runs WHERE id = ?')
            .get(request.runId);
        if (row === undefined) {
            return {
                from: 'queued',
                to: request.to,
                allowed: false,
                reason: `run_state_transition_not_allowed: 找不到运行 ${request.runId}`,
            };
        }
        const from = row.state;
        if (!isTransitionAllowed(from, request.to)) {
            return {
                from,
                to: request.to,
                allowed: false,
                reason: `run_state_transition_not_allowed: ${from} → ${request.to} 不是合法迁移`,
            };
        }
        runtime.db.exec('BEGIN');
        try {
            runtime.db
                .prepare('UPDATE application_runs SET state = ?, updated_at = ? WHERE id = ?')
                .run(request.to, now, request.runId);
            // 状态变化必须追加记录，不只覆盖当前状态（`schemas/runtime.sql`）。
            runtime.db
                .prepare(`INSERT INTO state_events(id, run_id, from_state, to_state, reason_code, note_redacted, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`)
                .run(newId('event'), request.runId, from, request.to, request.reasonCode ?? null, request.noteRedacted ?? null, now);
            runtime.db.exec('COMMIT');
        }
        catch (error) {
            runtime.db.exec('ROLLBACK');
            throw error;
        }
        return { from, to: request.to, allowed: true };
    }
    finally {
        runtime.close();
    }
}
//# sourceMappingURL=run-state-machine.js.map