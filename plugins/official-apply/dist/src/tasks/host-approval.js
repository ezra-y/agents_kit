/**
 * 任务级域名放行。
 *
 * 规则文档：`docs/10 §11`、`docs/13 D15`、修复清单 P2-7
 *
 * ## 为什么需要它
 *
 * 投递过程里跳到别的域名是常态：登录走 `sso.example.com`，
 * 表单挂在招聘 SaaS 上，验证码图片在 CDN 上。
 *
 * 全拦住没法用；全放开等于没有边界——那样的话页面上一个恶意跳转就能
 * 把浏览器带到任何地方，而系统还会在那儿继续填字。
 *
 * ## 三条硬规则
 *
 * 1. **一条一条加，绑死在一个 task 上。**
 *    给 A 公司放行过的域名，到 B 公司不算数。
 * 2. **不支持通配符。** `*.example.com` 看着方便，但一个子域被人拿下
 *    就等于整片放开，而且事后查不出当初到底放了什么。
 * 3. **必须写明是谁批的、为什么批。** 半年后要能回答「当初为什么放这个域名」。
 *
 * ## 页面文字不能自己扩权
 *
 * 这一点靠架构保证，不靠自觉：放行只能通过 `approveHost()` 写进数据库，
 * 而调用它的唯一入口是 MCP 工具 `apply.approve_host`——也就是说
 * 必须由宿主（用户那一侧）发起。扫描到的页面内容永远只是数据，
 * 不会变成一次调用。
 */
import { randomUUID } from 'node:crypto';
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
/**
 * 域名要长得像域名。
 *
 * 这里挡的不只是笔误：`*.example.com`、`example.com/path`、
 * `http://example.com` 都会被拒。放行的是**一个主机名**，
 * 不是一个模式，也不是一个 URL。
 */
export function normalizeHostForApproval(raw) {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === '') {
        return undefined;
    }
    if (trimmed.includes('*') || trimmed.includes('/') || trimmed.includes(':')) {
        return undefined;
    }
    // 只允许字母数字、点和短横，且必须至少有一个点。
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}
export function approveHost(request) {
    const host = normalizeHostForApproval(request.host);
    if (host === undefined) {
        return {
            approved: false,
            rejected: `host_invalid: 「${request.host}」不是一个合法主机名。` +
                '放行的是一个具体域名，不是模式也不是 URL。' +
                '通配符一律不收——一个子域被人拿下就等于整片放开。',
        };
    }
    if (request.approvedBy.trim() === '' || request.reason.trim() === '') {
        return {
            approved: false,
            rejected: 'host_approval_needs_reason: 必须写明是谁批的、为什么批。' +
                '半年后要能回答「当初为什么放这个域名」。',
        };
    }
    const now = request.now ?? new Date().toISOString();
    const runtime = openRuntimeDatabase({ paths: request.paths });
    try {
        const exists = runtime.db
            .prepare('SELECT id FROM application_tasks WHERE id = ?')
            .get(request.taskId);
        if (exists === undefined) {
            return { approved: false, rejected: `task_not_found: 没有任务 ${request.taskId}` };
        }
        const id = `hostok_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
        runtime.db
            .prepare(`INSERT INTO host_approvals (id, task_id, run_id, host, approved_by, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id, host) DO UPDATE SET
           run_id = excluded.run_id,
           approved_by = excluded.approved_by,
           reason = excluded.reason,
           created_at = excluded.created_at`)
            .run(id, request.taskId, request.runId ?? null, host, request.approvedBy, request.reason, now);
        const row = runtime.db
            .prepare('SELECT * FROM host_approvals WHERE task_id = ? AND host = ?')
            .get(request.taskId, host);
        return {
            approved: true,
            approval: {
                id: String(row['id']),
                taskId: String(row['task_id']),
                ...(row['run_id'] === null ? {} : { runId: String(row['run_id']) }),
                host: String(row['host']),
                approvedBy: String(row['approved_by']),
                reason: String(row['reason']),
                createdAt: String(row['created_at']),
            },
        };
    }
    finally {
        runtime.close();
    }
}
/** 这条任务放行过哪些域名。别的任务放行过的一律不算。 */
export function readApprovedHosts(paths, taskId) {
    const runtime = openRuntimeDatabase({ paths });
    try {
        const rows = runtime.db
            .prepare('SELECT host FROM host_approvals WHERE task_id = ? ORDER BY host')
            .all(taskId);
        return rows.map((row) => row.host);
    }
    finally {
        runtime.close();
    }
}
export function listHostApprovals(paths, taskId) {
    const runtime = openRuntimeDatabase({ paths });
    try {
        const rows = runtime.db
            .prepare('SELECT * FROM host_approvals WHERE task_id = ? ORDER BY created_at')
            .all(taskId);
        return rows.map((row) => ({
            id: String(row['id']),
            taskId: String(row['task_id']),
            ...(row['run_id'] === null ? {} : { runId: String(row['run_id']) }),
            host: String(row['host']),
            approvedBy: String(row['approved_by']),
            reason: String(row['reason']),
            createdAt: String(row['created_at']),
        }));
    }
    finally {
        runtime.close();
    }
}
/** 撤销一条放行。 */
export function revokeHost(paths, taskId, host) {
    const normalized = normalizeHostForApproval(host);
    if (normalized === undefined) {
        return false;
    }
    const runtime = openRuntimeDatabase({ paths });
    try {
        const before = runtime.db
            .prepare('SELECT id FROM host_approvals WHERE task_id = ? AND host = ?')
            .get(taskId, normalized);
        runtime.db
            .prepare('DELETE FROM host_approvals WHERE task_id = ? AND host = ?')
            .run(taskId, normalized);
        return before !== undefined;
    }
    finally {
        runtime.close();
    }
}
//# sourceMappingURL=host-approval.js.map