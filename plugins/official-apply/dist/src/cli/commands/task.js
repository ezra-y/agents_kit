/**
 * `applyctl task run` / `applyctl run`：跑一次投递流程。
 *
 * 规则文档：`docs/09 §5.1`、`docs/01`、`docs/12 阶段13`
 *
 * 这条命令是**编排**，不是业务：
 * 打开任务 → 连浏览器 → 打开页面 → 交给 `runApplication()` → 关会话。
 * 所有判断（能不能投、填什么、能不能提交）都在共享核心里。
 *
 * 默认 `review` 模式，所以正常结束时会停在最终提交之前。
 * 提交要另外走 `applyctl task submit`，这样「点下去」永远是一个独立动作。
 */
import { startRunSession } from "../../application/start-run-session.js";
import { runApplication } from "../../application/run-application.js";
import { getRunStatus } from "../../application/get-run-status.js";
import { closeBrowserSession } from "../../browser/session/close-browser-session.js";
import { openRuntimeDatabase } from "../../storage/open-runtime-database.js";
import { describeError, failed, ok, readBoolean, readString, toJson, usageError } from "./shared.js";
function readMode(context) {
    const raw = readString(context.args.options, 'mode');
    if (raw === undefined) {
        return undefined;
    }
    return raw === 'auto' || raw === 'review' ? raw : undefined;
}
async function handleTaskRun(context) {
    const taskId = readString(context.args.options, 'task') ?? context.args.positionals[0];
    if (taskId === undefined) {
        return usageError('缺少 --task <taskId>。');
    }
    const rawMode = readString(context.args.options, 'mode');
    const mode = readMode(context);
    if (rawMode !== undefined && mode === undefined) {
        return failed('cli_invalid_option', `--mode 只能是 review 或 auto，收到 ${rawMode}`);
    }
    const browserMode = (readString(context.args.options, 'browser') ?? 'persistent');
    const headless = readBoolean(context.args.options, 'headless');
    // 1. 打开任务并把页面准备好。这一串 CLI 和 MCP 共用同一个函数。
    let started;
    try {
        started = await startRunSession({
            paths: context.paths,
            taskId,
            browserMode,
            headless,
            now: context.now,
        });
    }
    catch (error) {
        return failed('cli_command_failed', describeError(error));
    }
    const { session } = started;
    const effectiveMode = mode ?? started.mode;
    try {
        if (started.requiresHuman !== undefined) {
            return failed('cli_command_failed', started.requiresHuman.message, {
                runId: started.runId,
                requiresHuman: toJson(started.requiresHuman),
            });
        }
        const result = await runApplication({
            session,
            page: started.page,
            siteHost: started.siteHost,
            materialRefs: started.materialRefs,
            profileRecordIds: started.profileRecordIds,
            ...(started.networkObserver === undefined
                ? {}
                : { networkObserver: started.networkObserver }),
            ...(started.companyKey === undefined ? {} : { companyKey: started.companyKey }),
            ...(started.companyName === undefined ? {} : { companyName: started.companyName }),
            ...(started.jobKey === undefined ? {} : { jobKey: started.jobKey }),
        }, {
            paths: context.paths,
            runId: started.runId,
            taskId,
            mode: effectiveMode,
            now: context.now,
        });
        return ok({
            runId: started.runId,
            taskId,
            mode: effectiveMode,
            pagesProcessed: result.pagesProcessed,
            stoppedBecause: result.stoppedBecause,
            pendingQuestions: toJson(result.pendingQuestions),
            status: toJson(result.status),
        }, result.stoppedBecause);
    }
    finally {
        await closeBrowserSession(session);
    }
}
export const taskCommands = [
    {
        name: 'task run',
        summary: '跑一次投递流程；默认 review 模式，停在最终提交之前。',
        usage: 'applyctl task run --task <taskId> [--mode review|auto] [--headless] [--json]',
        handler: handleTaskRun,
    },
    {
        // `docs/09 §5.1` 里写的是 `applyctl run --task task_001`，保留这个短形式。
        name: 'run',
        summary: 'task run 的短写法。',
        usage: 'applyctl run --task <taskId> [--mode review|auto] [--json]',
        handler: handleTaskRun,
    },
    {
        name: 'task list',
        summary: '列出所有任务和它们最近一次运行的状态。',
        usage: 'applyctl task list [--json]',
        handler(context) {
            const runtime = openRuntimeDatabase({ paths: context.paths });
            try {
                const rows = runtime.db
                    .prepare(`WITH ranked_runs AS (
               SELECT r.task_id, r.id, r.state, r.error_code, r.error_message_redacted,
                      ROW_NUMBER() OVER (
                        PARTITION BY r.task_id ORDER BY r.updated_at DESC, r.rowid DESC
                      ) AS rn
                 FROM application_runs r
             )
             SELECT t.id, t.company_name, t.job_title, t.execute,
                    t.status AS task_status, t.result_note AS task_result_note,
                    rr.id AS latest_run_id,
                    rr.state AS last_state,
                    rr.state AS latest_run_state,
                    rr.error_code AS latest_run_error_code,
                    rr.error_message_redacted AS latest_run_error_message_redacted
               FROM application_tasks t
               LEFT JOIN ranked_runs rr ON rr.task_id = t.id AND rr.rn = 1
              ORDER BY t.created_at`)
                    .all();
                const tasks = rows.map((row) => {
                    // 任务结论说「已完成」，最新 run 却显示失败 = 两层事实冲突。
                    const stateConflict = (row.task_status === 'completed' || row.task_status === 'submitted') &&
                        (row.latest_run_state === 'failed_recoverable' ||
                            row.latest_run_state === 'failed_terminal');
                    return {
                        id: row.id,
                        company_name: row.company_name,
                        job_title: row.job_title,
                        execute: row.execute,
                        // 兼容旧字段：最新一次 run 的状态。
                        last_state: row.latest_run_state,
                        // 两层状态：任务结论 + 最新运行事实。
                        taskStatus: row.task_status,
                        resultNote: row.task_result_note,
                        latestRunId: row.latest_run_id,
                        latestRunState: row.latest_run_state,
                        ...(row.latest_run_error_code !== null && row.latest_run_error_code !== ''
                            ? { latestRunErrorCode: row.latest_run_error_code }
                            : {}),
                        ...(row.latest_run_error_message_redacted !== null &&
                            row.latest_run_error_message_redacted !== ''
                            ? { latestRunErrorMessage: row.latest_run_error_message_redacted }
                            : {}),
                        stateConflict,
                    };
                });
                const conflictCount = tasks.filter((task) => task.stateConflict).length;
                return ok({ tasks: toJson(tasks) }, conflictCount === 0
                    ? `共 ${rows.length} 条任务。`
                    : `共 ${rows.length} 条任务，其中 ${conflictCount} 条任务状态与最新运行状态冲突。`);
            }
            finally {
                runtime.close();
            }
        },
    },
    {
        name: 'task status',
        summary: '按任务查最近一次运行的状态。',
        usage: 'applyctl task status --task <taskId> [--json]',
        handler(context) {
            const taskId = readString(context.args.options, 'task') ?? context.args.positionals[0];
            if (taskId === undefined) {
                return usageError('缺少 --task <taskId>。');
            }
            const runtime = openRuntimeDatabase({ paths: context.paths });
            let runId;
            try {
                const row = runtime.db
                    .prepare('SELECT id FROM application_runs WHERE task_id = ? ORDER BY updated_at DESC LIMIT 1')
                    .get(taskId);
                runId = row?.id;
            }
            finally {
                runtime.close();
            }
            if (runId === undefined) {
                return failed('cli_command_failed', `任务 ${taskId} 还没有运行记录。`);
            }
            const status = getRunStatus({ paths: context.paths, runId });
            return ok(status, status.resumeHint);
        },
    },
];
//# sourceMappingURL=task.js.map