/**
 * 读取一条投递任务，检查它是否允许执行，并创建本次 run。
 *
 * 规则文档：
 * - `docs/01_产品定义与完整运行流程.md §2、§3 阶段 A`
 * - `docs/06_函数接口与执行循环.md §3.1`
 * - `docs/10_状态提交安全隐私与错误恢复.md §4`
 *
 * 它只处理任务和状态。
 * 浏览器连接由阶段 3 的 `connectBrowser()` 和 `openApplicationPage()` 负责，
 * 不能偷偷塞进这个函数。
 *
 * 必须拒绝的四种情况：
 * 1. `execute !== true`
 * 2. 已有强成功证据
 * 3. 上一次提交结果仍为 uncertain
 * 4. URL 缺失或不是允许协议
 */
import { randomUUID } from 'node:crypto';
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
import { openPrivateDatabase } from "../storage/open-private-database.js";
import { readTaskSubmissionTruth } from "../submission/task-submission-truth.js";
import { assertStoredApplicationTaskRules } from "../tasks/validate-application-task-input.js";
/** 这些状态说明上一次运行已经结束，不能再续。 */
const TERMINAL_RUN_STATES = new Set([
    'submitted_confirmed',
    'submission_uncertain',
    'failed_terminal',
    'cancelled',
]);
function taskError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
function parseIdList(json) {
    if (typeof json !== 'string' || json.trim() === '') {
        return [];
    }
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    }
    catch {
        return [];
    }
}
export function openApplicationTask(request) {
    const { paths, taskId } = request;
    const browserMode = request.browserMode ?? 'persistent';
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    const runtime = openRuntimeDatabase({ paths });
    try {
        const task = runtime.db.prepare('SELECT * FROM application_tasks WHERE id = ?').get(taskId);
        if (task === undefined) {
            throw taskError('task_not_found', `runtime.sqlite 里没有任务 ${taskId}`);
        }
        // 1. execute 是第一道闸。不通过就完全不进入后续流程。
        if (Number(task['execute']) !== 1) {
            throw taskError('task_execute_disabled', `任务 ${taskId} 的 execute 不是 true，不打开链接`);
        }
        // 2. 任务类型、岗位来源、入口 URL 与模式。
        const url = assertStoredApplicationTaskRules({
            companyName: task['company_name'],
            taskKind: task['task_kind'],
            jobTitle: task['job_title'],
            jobUrl: task['job_url'],
            jobSelectionSource: task['job_selection_source'],
            jobSelectionEvidence: task['job_selection_evidence'],
        });
        const mode = (task['mode'] === 'auto' ? 'auto' : 'review');
        // 3. 已迁移的任务结果和提交历史。已提交和结果不确定都不允许再开。
        const submissionTruth = readTaskSubmissionTruth(runtime.db, taskId);
        if (submissionTruth === 'submitted' ||
            (submissionTruth === 'no_attempts' && task['status'] === 'submitted')) {
            throw taskError('task_already_submitted', `任务 ${taskId} 已记录为提交成功`);
        }
        if (submissionTruth === 'submission_uncertain' ||
            (submissionTruth === 'no_attempts' && task['status'] === 'submission_uncertain')) {
            throw taskError('task_submission_uncertain', `任务 ${taskId} 上一次提交结果不确定；确认之前不得自动重来`);
        }
        // 4. 材料引用必须能在 private 库里找到。
        const materialRefs = [
            ...(typeof task['resume_material_id'] === 'string' && task['resume_material_id'] !== ''
                ? [task['resume_material_id']]
                : []),
            ...parseIdList(task['additional_material_ids_json']),
        ];
        assertMaterialsExist(paths, materialRefs);
        const taskProfileRecordIds = parseIdList(task['profile_record_ids_json']);
        assertProfileRecordsExist(paths, taskProfileRecordIds);
        // 5. 能续就续，不能续才新建。
        const resumable = runtime.db
            .prepare(`SELECT id, state, profile_record_ids_json FROM application_runs
         WHERE task_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`)
            .get(taskId);
        if (resumable !== undefined && !TERMINAL_RUN_STATES.has(resumable.state)) {
            const profileRecordIds = parseIdList(resumable.profile_record_ids_json);
            assertProfileRecordsExist(paths, profileRecordIds);
            runtime.db
                .prepare('UPDATE application_runs SET updated_at = ? WHERE id = ?')
                .run(now, resumable.id);
            return {
                runId: resumable.id,
                taskId,
                ...optionalId('companyId', task['company_key']),
                ...optionalId('jobId', task['job_key']),
                url,
                mode,
                browserMode,
                materialRefs,
                profileRecordIds,
                resumeAllowed: true,
            };
        }
        // 6. 新建 run。会话只占位，不启动浏览器；阶段 3 再把它变成 active。
        const sessionId = newId('session');
        const runId = newId('run');
        const initialState = 'opening';
        runtime.db.exec('BEGIN');
        try {
            runtime.db
                .prepare(`INSERT INTO browser_sessions(id, mode, browser_name, status, owner_pid, started_at)
           VALUES (?, ?, 'chromium', 'starting', ?, ?)`)
                .run(sessionId, browserMode, process.pid, now);
            runtime.db
                .prepare(`INSERT INTO application_runs
             (id, task_id, browser_session_id, state, profile_record_ids_json, started_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`)
                .run(runId, taskId, sessionId, initialState, JSON.stringify(taskProfileRecordIds), now, now);
            runtime.db
                .prepare(`INSERT INTO state_events(id, run_id, from_state, to_state, reason_code, created_at)
           VALUES (?, ?, NULL, ?, 'task_opened', ?)`)
                .run(newId('event'), runId, initialState, now);
            runtime.db.exec('COMMIT');
        }
        catch (error) {
            runtime.db.exec('ROLLBACK');
            throw error;
        }
        return {
            runId,
            taskId,
            ...optionalId('companyId', task['company_key']),
            ...optionalId('jobId', task['job_key']),
            url,
            mode,
            browserMode,
            materialRefs,
            profileRecordIds: taskProfileRecordIds,
            resumeAllowed: false,
        };
    }
    finally {
        runtime.close();
    }
}
function optionalId(key, value) {
    return typeof value === 'string' && value !== '' ? { [key]: value } : {};
}
function assertProfileRecordsExist(paths, ids) {
    if (ids.length === 0) {
        return;
    }
    const priv = openPrivateDatabase({ paths });
    try {
        const statement = priv.db.prepare('SELECT id FROM profile_records WHERE id = ? AND active = 1');
        for (const id of ids) {
            if (statement.get(id) === undefined) {
                throw taskError('task_profile_record_missing', `private.sqlite 里找不到有效履历记录 ${id}`);
            }
        }
    }
    finally {
        priv.close();
    }
}
/**
 * 材料索引在 private 库里。
 *
 * 这里只检查「引用存在且仍然有效」，不读取文件内容，也不把真实路径带回运行库。
 */
function assertMaterialsExist(paths, ids) {
    if (ids.length === 0) {
        return;
    }
    const priv = openPrivateDatabase({ paths });
    try {
        const statement = priv.db.prepare('SELECT id FROM material_files WHERE id = ? AND active = 1');
        for (const id of ids) {
            if (statement.get(id) === undefined) {
                throw taskError('task_material_missing', `private.sqlite 里找不到有效材料 ${id}`);
            }
        }
    }
    finally {
        priv.close();
    }
}
//# sourceMappingURL=open-application-task.js.map