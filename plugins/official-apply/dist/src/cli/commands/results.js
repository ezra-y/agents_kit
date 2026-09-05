/**
 * `applyctl task results`：把投递结果导出成一份表格。
 *
 * 规则文档：修复清单 P1-12
 *
 * 用户从一份 CSV 来，结果也要能回到一份 CSV 去。
 * **不原地改他的源文件**——写一份 `<原文件名>.results.csv` 放旁边。
 */
import { deliverTaskUpdateOutbox } from "../../tasks/deliver-task-update-outbox.js";
import { updateTaskFromRun } from "../../tasks/update-task-from-run.js";
import { resolveSubmissionOutcome } from "../../submission/resolve-submission-outcome.js";
import { describeError, failed, ok, readString, toJson, usageError } from "./shared.js";
export const resultsCommands = [
    {
        name: 'task results',
        summary: '导出投递结果表格。源文件不会被改动，结果写到 <源文件>.results.csv。',
        usage: 'applyctl task results --source <queue.csv> [--json]',
        requiredOptions: ['source'],
        handler(context) {
            const source = readString(context.args.options, 'source');
            if (source === undefined || source.trim() === '') {
                return usageError('缺少 --source <queue.csv>。没有源文件就不写结果文件，队列保持待导出。');
            }
            try {
                const result = deliverTaskUpdateOutbox({
                    paths: context.paths,
                    now: context.now,
                    sourceFilePath: source,
                });
                if (result.rowCount === 0) {
                    return ok(result, '没有待导出的结果。');
                }
                return ok(result, `已写入 ${result.rowCount} 行到 ${result.resultFilePath}（源文件未改动）。`);
            }
            catch (error) {
                return failed('cli_command_failed', describeError(error));
            }
        },
    },
    {
        name: 'task resolve-submission',
        summary: '人工核对一次结果不确定的提交。只改本地记录，不会再次点击官网。',
        usage: 'applyctl task resolve-submission --run <runId> ' +
            '--result submitted|not-submitted --by <确认人> [--note <备注>] [--json]',
        requiredOptions: ['run', 'result', 'by'],
        handler(context) {
            const runId = readString(context.args.options, 'run');
            const rawResult = readString(context.args.options, 'result');
            const confirmedBy = readString(context.args.options, 'by');
            const note = readString(context.args.options, 'note');
            if (runId === undefined || rawResult === undefined || confirmedBy === undefined) {
                return usageError('缺少 --run / --result / --by。');
            }
            const result = rawResult === 'submitted'
                ? 'submitted'
                : rawResult === 'not-submitted' || rawResult === 'not_submitted'
                    ? 'not_submitted'
                    : undefined;
            if (result === undefined) {
                return failed('cli_invalid_option', `--result 只能是 submitted 或 not-submitted，收到 ${rawResult}`);
            }
            try {
                const resolved = resolveSubmissionOutcome({
                    paths: context.paths,
                    runId,
                    result,
                    confirmedBy,
                    ...(note === undefined ? {} : { note }),
                    now: context.now,
                });
                return ok(resolved, result === 'submitted'
                    ? `运行 ${runId} 已按人工核对标为提交成功。`
                    : `运行 ${runId} 已确认没有提交，任务已恢复为可重试。`);
            }
            catch (error) {
                return failed('cli_command_failed', describeError(error));
            }
        },
    },
    {
        name: 'task sync',
        summary: '把一次运行的结果回写到任务上，并排进导出队列。',
        usage: 'applyctl task sync --run <runId> [--json]',
        requiredOptions: ['run'],
        handler(context) {
            const runId = readString(context.args.options, 'run');
            if (runId === undefined) {
                return usageError('缺少 --run <runId>。');
            }
            try {
                const result = updateTaskFromRun({
                    paths: context.paths,
                    runId,
                    now: context.now,
                });
                return ok(toJson(result), `任务 ${result.taskId} 已标为 ${result.status}。${result.nextAction}`);
            }
            catch (error) {
                return failed('cli_command_failed', describeError(error));
            }
        },
    },
];
//# sourceMappingURL=results.js.map