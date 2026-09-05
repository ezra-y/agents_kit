/**
 * 归约一条任务的全部提交尝试。确认成功永久优先；不确定或中断的提交禁止自动重试。
 */
export function reduceTaskSubmissionTruth(outcomes) {
    if (outcomes.includes('confirmed')) {
        return 'submitted';
    }
    if (outcomes.some((outcome) => outcome === 'uncertain' || outcome === 'in_progress')) {
        return 'submission_uncertain';
    }
    return outcomes.length === 0 ? 'no_attempts' : 'retryable';
}
export function readTaskSubmissionTruth(db, taskId) {
    const attempts = db
        .prepare('SELECT outcome FROM submission_attempts WHERE task_id = ?')
        .all(taskId);
    return reduceTaskSubmissionTruth(attempts.map((attempt) => attempt.outcome));
}
//# sourceMappingURL=task-submission-truth.js.map