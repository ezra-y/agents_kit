/**
 * `applyctl task import` / `applyctl task add`：正式的任务导入入口。
 *
 * 规则文档：`docs/01_产品定义与完整运行流程.md`
 *
 * 这是**唯一**的正式入口。测试也必须走这里，
 * 不允许直接往 SQLite 插行来代替验收（修复清单 P0-1）。
 *
 * `execute=false` 的任务可以保存，但任何入口都不会打开它——
 * 这一条由 `openApplicationTask()` 守，不在这里重复判断。
 */
import { importApplicationTasks } from "../../tasks/import-application-tasks.js";
import { describeError, failed, ok, readBoolean, readString, toJson, usageError } from "./shared.js";
function runImport(context, filePath) {
    const rawSource = readString(context.args.options, 'source');
    const dryRun = readBoolean(context.args.options, 'dry-run');
    let result;
    try {
        result = importApplicationTasks({
            paths: context.paths,
            filePath,
            dryRun,
            now: context.now,
            ...(rawSource === undefined
                ? {}
                : { source: rawSource }),
        });
    }
    catch (error) {
        return failed('cli_command_failed', describeError(error));
    }
    const data = toJson(result);
    const summary = result.dryRun
        ? `试跑：共 ${result.totalRows} 行，${result.rejected.length} 行有问题。没有写库。`
        : `新增 ${result.inserted.length}，更新 ${result.updated.length}，` +
            `未变 ${result.unchanged.length}，拒绝 ${result.rejected.length}。`;
    // 有坏行就用非零退出码，脚本才发现得了。好行仍然已经导入。
    return result.rejected.length === 0
        ? ok(data, summary)
        : failed('cli_command_failed', `${summary} 请按行号修正后重新导入。`, data);
}
export const taskImportCommands = [
    {
        name: 'task import',
        summary: '从 CSV / JSON / JSONL 导入投递任务。重复导入不会产生重复任务。',
        usage: 'applyctl task import --file <queue.csv|json|jsonl> [--source user_table] [--dry-run] [--json]',
        requiredOptions: ['file'],
        handler(context) {
            const file = readString(context.args.options, 'file');
            if (file === undefined) {
                return usageError('缺少 --file <队列文件>。');
            }
            return runImport(context, file);
        },
    },
    {
        name: 'task add',
        summary: '导入单条或少量任务（JSON 文件）。走的是和 task import 同一条链路。',
        usage: 'applyctl task add --json <task.json>',
        requiredOptions: ['json'],
        // 在这条命令里 --json 是文件路径，不是输出开关。
        valueOptions: ['json'],
        handler(context) {
            const file = readString(context.args.options, 'json');
            if (file === undefined) {
                return usageError('缺少 --json <任务文件>。');
            }
            return runImport(context, file);
        },
    },
];
//# sourceMappingURL=task-import.js.map