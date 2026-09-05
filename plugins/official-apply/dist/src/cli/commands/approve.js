/**
 * `applyctl task approve` / `task revoke`：auto 模式的显式批准。
 *
 * 规则文档：`docs/10 §9`、修复清单 P1-11
 *
 * 在队列里写 `mode=auto` 只是一个字段。真正让系统自己点最终提交，
 * 必须在这里再批准一次——一次看得见、留痕、能撤销的动作。
 *
 * 批准之后仍然有一整排闸门挡着（`prepareSubmission()`）：
 * 校验没过、有未解决字段、遇到登录验证码、有高风险字段、已经提交过——
 * 任何一条不满足都会降级停下，不会硬做。
 */
import { approveAutoSubmit, readAutoSubmitApproval, revokeAutoSubmit, } from "../../tasks/auto-submit-approval.js";
import { describeError, failed, ok, readBoolean, readString, usageError } from "./shared.js";
export const approveCommands = [
    {
        name: 'task approve',
        summary: '批准这条 auto 任务自动提交。必须显式加 --confirm。',
        usage: 'applyctl task approve --task <taskId> --confirm [--note <备注>] [--json]',
        requiredOptions: ['task'],
        handler(context) {
            const taskId = readString(context.args.options, 'task');
            if (taskId === undefined) {
                return usageError('缺少 --task <taskId>。');
            }
            // 批准是不可逆动作的开关，不能靠一个参数顺手打开。
            if (!readBoolean(context.args.options, 'confirm')) {
                return failed('cli_command_failed', '批准之后系统会在这条任务上自己点最终提交。确认无误请加 --confirm。');
            }
            const note = readString(context.args.options, 'note');
            try {
                const approval = approveAutoSubmit({
                    paths: context.paths,
                    taskId,
                    approvedBy: 'cli_user',
                    now: context.now,
                    ...(note === undefined ? {} : { note }),
                });
                return ok(approval, `已批准任务 ${taskId} 自动提交。要撤销就跑 applyctl task revoke --task ${taskId}。`);
            }
            catch (error) {
                return failed('cli_command_failed', describeError(error));
            }
        },
    },
    {
        name: 'task revoke',
        summary: '撤销自动提交批准。撤销之后这条任务又会停在提交前。',
        usage: 'applyctl task revoke --task <taskId> [--json]',
        requiredOptions: ['task'],
        handler(context) {
            const taskId = readString(context.args.options, 'task');
            if (taskId === undefined) {
                return usageError('缺少 --task <taskId>。');
            }
            const removed = revokeAutoSubmit({ paths: context.paths, taskId });
            return ok({ taskId, revoked: removed }, removed
                ? `已撤销任务 ${taskId} 的自动提交批准，它现在会停在提交前。`
                : `任务 ${taskId} 本来就没有批准过。`);
        },
    },
    {
        name: 'task approvals',
        summary: '看某条任务批准过没有。',
        usage: 'applyctl task approvals --task <taskId> [--json]',
        requiredOptions: ['task'],
        handler(context) {
            const taskId = readString(context.args.options, 'task');
            if (taskId === undefined) {
                return usageError('缺少 --task <taskId>。');
            }
            const approval = readAutoSubmitApproval(context.paths, taskId);
            return ok({ taskId, approved: approval !== undefined, approval: approval ?? null }, approval === undefined
                ? `任务 ${taskId} 没有批准过自动提交，它会停在提交前。`
                : `任务 ${taskId} 已由 ${approval.approvedBy} 于 ${approval.approvedAt} 批准。`);
        },
    },
];
//# sourceMappingURL=approve.js.map