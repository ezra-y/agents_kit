/**
 * auto 模式的显式批准。
 *
 * 规则文档：`docs/10 §9`、修复清单 P1-11
 *
 * ## 为什么单独做一个批准动作
 *
 * 队列里写 `mode=auto` 只是一个字段——用户可能是从别人那儿抄来的表格，
 * 也可能根本没注意那一列是什么意思。**用它当作"可以自己点提交"的依据太轻了。**
 *
 * 真正的无人值守提交必须有一次单独的、看得见的、可撤销的批准：
 *
 * ```bash
 * applyctl task approve --task <id> --confirm
 * ```
 *
 * 没批准的 auto 任务照样会跑到最终确认页停下——但会**明确说出原因**，
 * 而不是假装自己是 review 模式。
 */
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
/** 记一次批准。同一条任务重复批准是幂等的。 */
export function approveAutoSubmit(input) {
    const now = input.now ?? new Date().toISOString();
    if (input.approvedBy.trim() === '') {
        throw new Error('auto_approval_requires_approver: 必须写明是谁批准的');
    }
    const runtime = openRuntimeDatabase({ paths: input.paths });
    try {
        const task = runtime.db
            .prepare('SELECT mode FROM application_tasks WHERE id = ?')
            .get(input.taskId);
        if (task === undefined) {
            throw new Error(`auto_approval_task_not_found: 找不到任务 ${input.taskId}`);
        }
        if (task.mode !== 'auto') {
            throw new Error(`auto_approval_mode_mismatch: 任务 ${input.taskId} 是 ${task.mode} 模式，不需要批准`);
        }
        runtime.db
            .prepare(`INSERT INTO auto_submit_approvals(task_id, approved_by, note, approved_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           approved_by = excluded.approved_by,
           note = excluded.note,
           approved_at = excluded.approved_at`)
            .run(input.taskId, input.approvedBy, input.note ?? null, now);
        return {
            taskId: input.taskId,
            approvedBy: input.approvedBy,
            ...(input.note === undefined ? {} : { note: input.note }),
            approvedAt: now,
        };
    }
    finally {
        runtime.close();
    }
}
/** 撤销批准。撤销之后这条任务又会停在提交前。 */
export function revokeAutoSubmit(input) {
    const runtime = openRuntimeDatabase({ paths: input.paths });
    try {
        const before = runtime.db
            .prepare('SELECT task_id FROM auto_submit_approvals WHERE task_id = ?')
            .get(input.taskId);
        runtime.db.prepare('DELETE FROM auto_submit_approvals WHERE task_id = ?').run(input.taskId);
        return before !== undefined;
    }
    finally {
        runtime.close();
    }
}
/** 这条任务批准过没有。没批准就返回 undefined。 */
export function readAutoSubmitApproval(paths, taskId) {
    const runtime = openRuntimeDatabase({ paths });
    try {
        const row = runtime.db
            .prepare('SELECT task_id, approved_by, note, approved_at FROM auto_submit_approvals WHERE task_id = ?')
            .get(taskId);
        if (row === undefined) {
            return undefined;
        }
        return {
            taskId: row.task_id,
            approvedBy: row.approved_by,
            ...(row.note === null ? {} : { note: row.note }),
            approvedAt: row.approved_at,
        };
    }
    finally {
        runtime.close();
    }
}
//# sourceMappingURL=auto-submit-approval.js.map