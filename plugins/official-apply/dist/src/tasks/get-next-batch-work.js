import { getSkillPaths } from "../config/paths.js";
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
export function describeNextBatchWork(result, batchId) {
    switch (result.status) {
        case 'work':
            return `批次 ${batchId} 下一项是任务 ${result.taskId}。`;
        case 'waiting_for_user':
            return `批次 ${batchId} 的剩余任务都在等待用户。`;
        case 'done':
            switch (result.reason) {
                case 'batch_not_found':
                    return `找不到批次 ${batchId}。`;
                case 'batch_empty':
                    return `批次 ${batchId} 还没有任务。`;
                case 'batch_complete':
                    return `批次 ${batchId} 已完成。`;
            }
    }
}
function classifyRunState(state) {
    switch (state) {
        case 'cancelled':
        case 'submitted_confirmed':
            return 'finished';
        case 'waiting_for_user':
        case 'ready_for_review':
        case 'ready_to_submit':
        case 'submitting':
        case 'submission_uncertain':
        case 'failed_terminal':
            return 'blocked';
        case 'queued':
        case 'opening':
        case 'discovering':
        case 'collecting_answers':
        case 'filling':
        case 'validating':
        case 'failed_recoverable':
            return 'resumable';
    }
}
export function getNextBatchWork(batchId, paths = getSkillPaths()) {
    const runtime = openRuntimeDatabase({ paths });
    try {
        const batch = runtime.db.prepare('SELECT id FROM task_batches WHERE id = ?').get(batchId);
        if (batch === undefined) {
            return { status: 'done', reason: 'batch_not_found' };
        }
        const tasks = runtime.db
            .prepare(`SELECT t.id, t.execute, t.task_kind, t.status,
                latest.id AS run_id, latest.state AS run_state
           FROM application_tasks AS t
           LEFT JOIN application_runs AS latest
             ON latest.id = (
               SELECT run.id
                 FROM application_runs AS run
                WHERE run.task_id = t.id
                ORDER BY run.started_at DESC, run.rowid DESC
                LIMIT 1
             )
          WHERE t.batch_id = ?
          ORDER BY t.created_at, t.rowid`)
            .all(batchId);
        if (tasks.length === 0) {
            return { status: 'done', reason: 'batch_empty' };
        }
        let queued;
        let blocked = false;
        for (const task of tasks) {
            if (task.execute !== 1 ||
                task.status === 'completed' ||
                task.status === 'submitted' ||
                task.status === 'skipped') {
                continue;
            }
            if (task.status === 'submission_uncertain') {
                blocked = true;
                continue;
            }
            if (task.run_state !== null) {
                const disposition = classifyRunState(task.run_state);
                if (disposition === 'finished') {
                    continue;
                }
                if (disposition === 'blocked') {
                    blocked = true;
                    continue;
                }
                return {
                    status: 'work',
                    taskId: task.id,
                    taskKind: task.task_kind,
                    reason: 'resume_recoverable_run',
                    runId: task.run_id,
                };
            }
            if (task.status === 'queued' && queued === undefined) {
                queued = task;
            }
            else {
                blocked = true;
            }
        }
        if (queued !== undefined) {
            return {
                status: 'work',
                taskId: queued.id,
                taskKind: queued.task_kind,
                reason: 'next_queued_task',
            };
        }
        return blocked
            ? { status: 'waiting_for_user', reason: 'remaining_tasks_blocked' }
            : { status: 'done', reason: 'batch_complete' };
    }
    finally {
        runtime.close();
    }
}
//# sourceMappingURL=get-next-batch-work.js.map