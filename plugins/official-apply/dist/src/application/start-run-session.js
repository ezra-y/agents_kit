import { openApplicationTask } from "./open-application-task.js";
import { connectBrowser } from "../browser/session/connect-browser.js";
import { closeBrowserSession } from "../browser/session/close-browser-session.js";
import { createBrowserContext } from "../browser/session/create-browser-context.js";
import { selectAttachTargetFromBrowser } from "../browser/session/select-attach-target.js";
import { openApplicationPage } from "../browser/session/open-application-page.js";
import { syncHumanTakeover } from "./sync-human-takeover.js";
import { browserSessionIdForRun, prepareBrowserSession, setSessionPage, writeBrowserSessionStatus, } from "../browser/session/browser-session-lifecycle.js";
import { observeNetwork } from "../browser/network/observe-network.js";
import { migrateBrowserLoginState, } from "../browser/session/migrate-login-state.js";
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
import { invalidatePendingSubmissionApprovals } from "../submission/submission-approval.js";
import { readApprovedHosts } from "../tasks/host-approval.js";
import { transitionRunState } from "./run-state-machine.js";
/** 读取任务的作用域键。只是查表，不做任何判断。 */
export function readTaskScopeKeys(paths, taskId) {
    const runtime = openRuntimeDatabase({ paths });
    try {
        const row = runtime.db
            .prepare('SELECT company_key, company_name, job_key FROM application_tasks WHERE id = ?')
            .get(taskId);
        return {
            ...(row?.company_key ? { companyKey: row.company_key } : {}),
            ...(row?.company_name ? { companyName: row.company_name } : {}),
            ...(row?.job_key ? { jobKey: row.job_key } : {}),
        };
    }
    finally {
        runtime.close();
    }
}
function describeStartFailure(error) {
    const message = error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error);
    const matched = /^([a-z][a-z0-9_]*):\s*/.exec(message);
    return {
        code: matched?.[1] ?? 'run_start_failed',
        message,
    };
}
function recordStartFailure(paths, runId, error, now) {
    const failure = describeStartFailure(error);
    const at = now ?? new Date().toISOString();
    const transition = transitionRunState({
        paths,
        runId,
        to: 'failed_recoverable',
        reasonCode: failure.code,
        noteRedacted: failure.message,
        now: at,
    });
    if (!transition.allowed) {
        return;
    }
    const runtime = openRuntimeDatabase({ paths });
    try {
        runtime.db
            .prepare(`UPDATE application_runs
            SET error_code = ?, error_message_redacted = ?, updated_at = ?
          WHERE id = ?`)
            .run(failure.code, failure.message, at, runId);
    }
    finally {
        runtime.close();
    }
}
export async function startRunSession(request) {
    const browserMode = request.browserMode ?? 'persistent';
    if (browserMode === 'attach_existing' && request.cdpEndpoint === undefined) {
        throw new Error('browser_cdp_endpoint_missing: attach_existing 需要调用方提供完整动态 CDP 地址');
    }
    // 1. 能不能投由核心判断。不合格会直接抛错，浏览器根本不会启动。
    const opened = openApplicationTask({
        paths: request.paths,
        taskId: request.taskId,
        browserMode,
        ...(request.now === undefined ? {} : { now: request.now }),
    });
    invalidatePendingSubmissionApprovals({ paths: request.paths, runId: opened.runId });
    const scope = readTaskScopeKeys(request.paths, request.taskId);
    const sessionId = browserSessionIdForRun(request.paths, opened.runId);
    const startedAt = request.now ?? new Date().toISOString();
    prepareBrowserSession(request.paths, sessionId, browserMode, startedAt);
    let session;
    let networkObserver;
    let loginStateMigration;
    try {
        let channel = request.channel;
        let profileName = request.profileName;
        if (request.loginStateSource !== undefined) {
            if (browserMode !== 'persistent') {
                throw new Error('login_state_mode_invalid: 登录态迁移只能用于 persistent 浏览器模式');
            }
            if (request.loginStateDomains === undefined || request.loginStateDomains.length === 0) {
                throw new Error('login_state_domains_missing: 登录态迁移缺少域名');
            }
            profileName = request.profileName ?? `${request.loginStateSource}-import`;
            loginStateMigration = await migrateBrowserLoginState({
                paths: request.paths,
                sourceBrowser: request.loginStateSource,
                targetProfileName: profileName,
                domains: request.loginStateDomains,
                ...(request.loginStateSourceProfile === undefined
                    ? {}
                    : { sourceProfileName: request.loginStateSourceProfile }),
                now: request.now,
            });
            channel ??= loginStateMigration.recommendedChannel;
        }
        // 2. 连浏览器、开页面。
        session = await connectBrowser({
            paths: request.paths,
            mode: browserMode,
            sessionId,
            ...(channel === undefined ? {} : { channel }),
            ...(profileName === undefined ? {} : { profileName }),
            ...(request.cdpEndpoint === undefined ? {} : { cdpEndpoint: request.cdpEndpoint }),
            // 不写死默认值：交给 connectBrowser 按 mode 决定
            // （isolated_test 无头，其余有头）。在这里再写一遍 false，
            // 就等于把那条规则悄悄推翻。
            ...(request.headless === undefined ? {} : { headless: request.headless }),
        });
        const context = await createBrowserContext(session, {});
        // 接管已有浏览器时，**不能拿第一个标签页就用**。
        //
        // 用户的 Chrome 通常开着七八个标签：邮箱、文档、两三家公司的招聘页。
        // 第一个是什么完全是碰运气，而挑错的后果不是「没反应」，
        // 是在别的网页上填字、点按钮。
        //
        // 所以按 URL 和标题匹配；两个同样像的时候不猜，直接停下来让人指定。
        if (browserMode === 'attach_existing' && session.browser !== undefined) {
            const picked = await selectAttachTargetFromBrowser(session.browser, opened.url, [scope.companyName ?? ''].filter((hint) => hint !== ''));
            if (picked.result.kind === 'ambiguous') {
                throw new Error(`browser_attach_ambiguous: ${picked.result.reason}\n候选：\n` +
                    picked.result.candidates
                        .map((item) => `  - 窗口 ${item.contextIndex} 标签 ${item.pageIndex}：` +
                        `${item.title ?? '(无标题)'}｜${item.url}（${item.reasons.join('、')}）`)
                        .join('\n'));
            }
            if (picked.context !== undefined) {
                session.context = picked.context;
            }
            if (picked.page !== undefined) {
                setSessionPage(session, picked.page);
            }
        }
        const activeContext = session.context ?? context;
        // 先开一个空页面并挂上监听，再导航。
        // 导航之后才挂的话，首屏那些请求已经过去了。
        const blank = session.page !== undefined && !session.page.isClosed()
            ? session.page
            : await activeContext.newPage();
        setSessionPage(session, blank);
        networkObserver = observeNetwork(blank);
        // 这条任务放行过的域名。别的任务放行过的一律不算（修复清单 P2-7）。
        const allowedHosts = readApprovedHosts(request.paths, request.taskId);
        const page = await openApplicationPage(session, {
            runId: opened.runId,
            url: opened.url,
            ...(allowedHosts.length === 0 ? {} : { allowedHosts }),
        });
        const target = session.page;
        if (target === undefined) {
            throw new Error('browser_page_missing: 浏览器没有可用页面');
        }
        // 打开结果落库：卡点（如未登记域名跳转）必须成为可恢复的运行事实。
        // 本入口只会产生 site_blocked；无卡点时也只解除 site_blocked，
        // 不清掉登录/确认等其他流程的卡点。
        syncHumanTakeover({
            paths: request.paths,
            runId: opened.runId,
            ...(page.requiresHuman === undefined
                ? { resolveReasons: ['site_blocked'] }
                : { active: page.requiresHuman }),
            ...(request.now === undefined ? {} : { now: request.now }),
        });
        return {
            runId: opened.runId,
            taskId: request.taskId,
            session,
            page: target,
            siteHost: new URL(page.finalUrlRedacted).hostname,
            mode: opened.mode,
            materialRefs: opened.materialRefs,
            profileRecordIds: opened.profileRecordIds,
            networkObserver,
            ...(loginStateMigration === undefined ? {} : { loginStateMigration }),
            ...scope,
            ...(page.requiresHuman === undefined ? {} : { requiresHuman: page.requiresHuman }),
        };
    }
    catch (error) {
        networkObserver?.stop();
        recordStartFailure(request.paths, opened.runId, error, request.now);
        if (session !== undefined) {
            await closeBrowserSession(session, {
                status: 'failed',
                now: request.now,
                detail: describeStartFailure(error).message,
            }).catch(() => undefined);
        }
        else {
            writeBrowserSessionStatus(request.paths, sessionId, 'failed', request.now, describeStartFailure(error).message);
        }
        throw error;
    }
}
//# sourceMappingURL=start-run-session.js.map