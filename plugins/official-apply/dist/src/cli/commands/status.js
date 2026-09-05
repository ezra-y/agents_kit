/**
 * `applyctl status`：读出一次运行停在哪里、下一步该做什么。
 *
 * 规则文档：`docs/09 §5.1`、`docs/10 §2`
 *
 * 状态存在 SQLite 里，所以换终端、换进程、重启之后跑这条命令都能接上。
 */
import { getRunStatus } from "../../application/get-run-status.js";
import { failed, ok, readString, usageError } from "./shared.js";
export const statusCommands = [
    {
        name: 'status',
        summary: '查看一次运行的当前状态、待回答问题和恢复提示。',
        usage: 'applyctl status --run <runId> [--json]',
        handler(context) {
            const runId = readString(context.args.options, 'run') ?? context.args.positionals[0];
            if (runId === undefined) {
                return usageError('缺少 --run <runId>。');
            }
            const status = getRunStatus({ paths: context.paths, runId });
            // 查不到就是失败。退出码 0 会让脚本以为一切正常。
            return status.exists
                ? ok(status, status.resumeHint)
                : failed('cli_command_failed', status.resumeHint, status);
        },
    },
];
//# sourceMappingURL=status.js.map