/**
 * `applyctl task submit`：**只做提交前检查，不执行真实提交。**
 *
 * 规则文档：`docs/10 §3-§5`、`docs/13 D16、D17`、修复清单 P0-3、P0-4
 *
 * ## 为什么 CLI 不再执行真实提交
 *
 * 每条 CLI 命令都是一个独立进程。进程结束，浏览器就没了。
 * 所以老版本的 `task submit --confirm` 只能**重新打开 `job_url`**
 * 再点提交——那等于回到第一页，在一个空表单上点「提交申请」。
 *
 * 这不是能靠加参数修好的问题：它是「一次性进程」和「必须保持同一个页面」
 * 之间的根本矛盾。所以按修复清单 P0-4 的要求，**停用 CLI 的真实提交**。
 *
 * 真实交互投递走 MCP：`apply.open_task` 开的会话一直活着，
 * `apply.submit` 就在那个已经填好的页面上点，不重开任何链接。
 *
 * CLI 保留的部分仍然有用：
 * - `applyctl task submit --run <id>`：跑一遍 `prepareSubmission()`，
 *   告诉你「现在能不能提交、还差什么」。这一步可以随便重试。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { prepareSubmission } from "../../submission/prepare-submission.js";
import { getRunStatus } from "../../application/get-run-status.js";
import { openRuntimeDatabase } from "../../storage/open-runtime-database.js";
import { failed, ok, readBoolean, readString, toJson, usageError } from "./shared.js";
/** 读出这次运行对应的任务。只是查表。 */
export function readRunTarget(paths, runId) {
    const runtime = openRuntimeDatabase({ paths });
    try {
        const row = runtime.db
            .prepare(`SELECT r.task_id AS taskId, t.job_url AS url, t.mode AS mode
           FROM application_runs r JOIN application_tasks t ON t.id = r.task_id
          WHERE r.id = ?`)
            .get(runId);
        if (row === undefined) {
            return undefined;
        }
        return { taskId: row.taskId, url: row.url, mode: row.mode === 'auto' ? 'auto' : 'review' };
    }
    finally {
        runtime.close();
    }
}
/**
 * 读出最近一次快照的页面结构。
 *
 * 提交前检查需要知道「最后停在哪一页、上面有没有提交按钮」。
 * 这份 schema 只用于**检查**，不用于点击——点击必须用活页面。
 */
export function readLastPageSchema(paths, runId) {
    const runtime = openRuntimeDatabase({ paths });
    try {
        const row = runtime.db
            .prepare(`SELECT page_schema_path FROM page_snapshots
          WHERE run_id = ? ORDER BY captured_at DESC, rowid DESC LIMIT 1`)
            .get(runId);
        if (row === undefined) {
            return undefined;
        }
        // 快照文件在 .local/runs/ 下，路径存的是仓库相对路径。
        const file = path.isAbsolute(row.page_schema_path)
            ? row.page_schema_path
            : row.page_schema_path.startsWith('.local/')
                ? path.join(paths.localRoot, row.page_schema_path.slice('.local/'.length))
                : path.join(paths.root, row.page_schema_path);
        if (!existsSync(file)) {
            return undefined;
        }
        // 快照文件是一个信封：{ schema, fingerprint, matchedSignals }。
        // 直接当成 PageSchema 用会拿到一个没有 actions 的对象，
        // 然后在 prepareSubmission() 里炸掉。
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        const schema = parsed.schema ?? parsed;
        return Array.isArray(schema.actions) ? schema : undefined;
    }
    catch {
        return undefined;
    }
    finally {
        runtime.close();
    }
}
const MCP_HINT = [
    '真实提交请走 MCP 活会话：',
    '  1. apply.open_task 打开任务（浏览器会一直开着）',
    '  2. 填写并 apply.validate_page 通过',
    '  3. apply.submit（先不带 confirm 看检查结果）',
    '  4. 你本人确认后再 apply.submit confirm=true',
    'CLI 每条命令都是独立进程，页面活不到下一条命令，所以它不执行真实提交。',
].join('\n');
export const submitCommands = [
    {
        name: 'task submit',
        summary: '只做提交前检查（dry-run）。真实提交必须走 MCP 活会话。',
        usage: 'applyctl task submit --run <runId> [--json]',
        requiredOptions: ['run'],
        handler(context) {
            const runId = readString(context.args.options, 'run') ?? context.args.positionals[0];
            if (runId === undefined) {
                return usageError('缺少 --run <runId>。');
            }
            // 明确拒绝 --confirm，并说清楚为什么，而不是假装支持。
            if (readBoolean(context.args.options, 'confirm')) {
                return failed('cli_command_failed', `CLI 不执行真实提交。\n${MCP_HINT}`, { hint: MCP_HINT });
            }
            const target = readRunTarget(context.paths, runId);
            if (target === undefined) {
                return failed('cli_command_failed', `找不到运行 ${runId}。`);
            }
            const pageSchema = readLastPageSchema(context.paths, runId);
            if (pageSchema === undefined) {
                return failed('cli_command_failed', `运行 ${runId} 还没有页面快照，无法做提交前检查。先用 MCP 打开任务并扫描一次。`);
            }
            const prepared = prepareSubmission({
                paths: context.paths,
                runId,
                taskId: target.taskId,
                mode: target.mode,
                // CLI 拿不到活页面，所以校验结果只能取最近一次的记录。
                validation: { valid: true, issues: [] },
                pageSchema,
                pageDigest: {
                    url: pageSchema.url,
                    controlCount: -1,
                    valueHash: 'cli_snapshot_without_live_page',
                },
                now: context.now,
            });
            const livePageBlocker = 'CLI 没有活页面，不能确认当前页面仍与快照一致';
            const dryRunPrepared = {
                ...prepared,
                ready: false,
                blockers: [...prepared.blockers, livePageBlocker],
                allowedNextAction: 'wait_for_user',
            };
            return ok({
                runId,
                taskId: target.taskId,
                dryRun: true,
                prepared: toJson(dryRunPrepared),
                status: toJson(getRunStatus({ paths: context.paths, runId })),
                hint: MCP_HINT,
            }, `静态检查完成，但还不能宣布可以提交：${dryRunPrepared.blockers.join('；')}。
${MCP_HINT}`);
        },
    },
];
//# sourceMappingURL=submit.js.map