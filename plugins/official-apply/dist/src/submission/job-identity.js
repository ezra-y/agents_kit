export function normalizeJobUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl.trim());
    }
    catch {
        // 解析不了的 URL 不是可靠身份，不参与匹配。
        return undefined;
    }
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
        // 只认 http/https。ftp、file、javascript 等 scheme 不是可靠的网页身份。
        return undefined;
    }
    const host = parsed.hostname.toLowerCase();
    const defaultPort = protocol === 'https:' ? '443' : '80';
    const port = parsed.port === '' || parsed.port === defaultPort ? '' : `:${parsed.port}`;
    let path = parsed.pathname;
    while (path.length > 1 && path.endsWith('/')) {
        path = path.slice(0, -1);
    }
    if (path === '') {
        path = '/';
    }
    return `${protocol}//${host}${port}${path}`;
}
function companyScope(task) {
    return (task.company_key ?? task.company_name ?? '').trim().toLowerCase();
}
/**
 * 一条任务的岗位身份键集合。
 *
 * job_key 只在同一公司作用域内比较；job_url 是全站唯一的入口地址，
 * 不需要公司作用域。两条任务任一身份键相同即视为同一岗位。
 */
export function jobIdentityKeys(task) {
    if (task.task_kind !== 'job_application') {
        return [];
    }
    const keys = [];
    const jobKey = task.job_key?.trim();
    const scope = companyScope(task);
    if (jobKey !== undefined && jobKey !== '' && scope !== '') {
        keys.push({ kind: 'job_key', scope, key: jobKey });
    }
    const normalizedUrl = normalizeJobUrl(task.job_url);
    if (normalizedUrl !== undefined) {
        keys.push({ kind: 'job_url', scope: '', key: normalizedUrl });
    }
    return keys;
}
function matchedBy(mine, theirs) {
    const myJobKey = mine.find((item) => item.kind === 'job_key');
    const theirJobKey = theirs.find((item) => item.kind === 'job_key');
    // 双方都有可靠岗位键时，只认岗位键。很多招聘系统让多个岗位共用同一申请 URL，
    // 此时退回 URL 会把两个明确不同的岗位误判为重复。
    if (myJobKey !== undefined && theirJobKey !== undefined) {
        return myJobKey.scope === theirJobKey.scope && myJobKey.key === theirJobKey.key
            ? 'job_key'
            : undefined;
    }
    // 任一方缺少可靠岗位键，才用规范化 URL 兜底。
    const myUrl = mine.find((item) => item.kind === 'job_url');
    const theirUrl = theirs.find((item) => item.kind === 'job_url');
    return myUrl !== undefined && theirUrl !== undefined && myUrl.key === theirUrl.key
        ? 'job_url'
        : undefined;
}
/**
 * 查找「同一岗位的另一条任务」上活跃的提交事实。
 *
 * 调用方必须保证查询所在的数据库连接有正确的并发语义：
 * `prepareSubmission()` 用于预检；`submitApplication()` 在写事务内再次调用。
 */
export function findCrossTaskSubmissionConflict(db, currentTaskId) {
    // ponytail: 每次提交全表扫一遍「活跃提交事实」。真实库中活跃 attempt 数量很小
    // （每任务最多一条，idx_submission_task_active 保证）；若将来出现按岗位的
    // 高频并发提交，再换成 identity 索引或单独去重表。
    const current = db
        .prepare(`SELECT task_kind, company_key, company_name, job_key, job_url
         FROM application_tasks WHERE id = ?`)
        .get(currentTaskId);
    if (current === undefined) {
        return undefined;
    }
    const currentKeys = jobIdentityKeys(current);
    if (currentKeys.length === 0) {
        return undefined;
    }
    const others = db
        .prepare(`SELECT s.id AS attempt_id, s.task_id, s.outcome,
              t.task_kind, t.company_key, t.company_name, t.job_key, t.job_url, t.job_title
         FROM submission_attempts s
         JOIN application_tasks t ON t.id = s.task_id
        WHERE s.outcome IN ('in_progress', 'confirmed', 'uncertain')
          AND s.task_id != ?
          AND t.task_kind = 'job_application'
        ORDER BY s.task_id`)
        .all(currentTaskId);
    for (const other of others) {
        const match = matchedBy(currentKeys, jobIdentityKeys(other));
        if (match !== undefined) {
            return {
                otherTaskId: other.task_id,
                attemptId: other.attempt_id,
                outcome: other.outcome,
                otherJobTitle: other.job_title,
                matchedBy: match,
            };
        }
    }
    return undefined;
}
const OUTCOME_LABELS = {
    in_progress: '提交进行中',
    confirmed: '已确认成功',
    uncertain: '结果待确认',
    failed_before_commit: '提交前失败',
    blocked: '被阻断',
};
export function submissionOutcomeLabel(outcome) {
    return OUTCOME_LABELS[outcome];
}
//# sourceMappingURL=job-identity.js.map