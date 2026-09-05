/**
 * 打开任务 URL，限制跳转域名，等页面进入可观察状态。
 *
 * 规则文档：
 * - `docs/01_产品定义与完整运行流程.md` 阶段 B
 * - `docs/10_状态提交安全隐私与错误恢复.md §11`
 *
 * 域名策略：默认只允许任务 URL 自己的 host。
 * 跳到未知域名时**暂停**，交人工确认；不自动放行，也不悄悄继续填写。
 *
 * 记录策略：运行记录只写去掉 query 的 URL。
 * 招聘链接的 query 里经常带 token 和候选人标识。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { browserError } from "./connect-browser.js";
import { assertSessionOpen } from "./close-browser-session.js";
import { setSessionPage } from "./browser-session-lifecycle.js";
import { isInsideLocalRoot } from "../../config/paths.js";
import { prepareNavigationUrl } from "./prepare-navigation-url.js";
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
/** 去掉 query 和 hash，只留 origin + pathname。 */
export function redactUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'about:') {
            return `${parsed.protocol}${parsed.pathname}`;
        }
        return `${parsed.origin}${parsed.pathname}`;
    }
    catch {
        return '<无法解析的 URL>';
    }
}
function assertNavigableUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch {
        throw browserError('page_url_protocol_not_allowed', `无法解析的 URL：${rawUrl}`);
    }
    if (parsed.protocol === 'https:') {
        return parsed;
    }
    if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) {
        return parsed;
    }
    throw browserError('page_url_protocol_not_allowed', `只允许 https，或指向本机回环的 http；当前是 ${parsed.protocol}//${parsed.hostname}`);
}
function describeError(error) {
    if (error instanceof Error) {
        return error.message.split('\n')[0] ?? error.name;
    }
    return String(error);
}
export async function openApplicationPage(session, options) {
    assertSessionOpen(session);
    const requested = assertNavigableUrl(options.url);
    const prepared = prepareNavigationUrl(options.url);
    const allowedHosts = new Set([requested.hostname, ...(options.allowedHosts ?? [])]);
    const timeoutMs = options.timeoutMs ?? session.defaultTimeoutMs;
    const context = session.context;
    if (context === undefined) {
        throw browserError('page_open_failed', '还没有 context；先调用 createBrowserContext()');
    }
    const page = session.page !== undefined && !session.page.isClosed()
        ? session.page
        : await context.newPage();
    try {
        await page.goto(prepared.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await page.waitForLoadState('load', { timeout: timeoutMs }).catch(() => undefined);
    }
    catch (error) {
        throw browserError('page_open_failed', `打开 ${redactUrl(options.url)} 失败：${describeError(error)}`);
    }
    const finalUrl = new URL(page.url());
    const redirected = finalUrl.hostname !== requested.hostname;
    const title = await page.title().catch(() => '');
    if (finalUrl.href === 'about:blank') {
        writeRunRecord(session, options.runId, {
            requestedUrlRedacted: redactUrl(options.url),
            finalUrlRedacted: 'about:blank',
            title,
            redirected: true,
            blockedHost: null,
            errorCode: 'page_open_blank',
            navigationRule: prepared.rule ?? null,
        });
        throw browserError('page_open_blank', `打开 ${redactUrl(options.url)} 后页面变成 about:blank，无法扫描招聘页面`);
    }
    let requiresHuman;
    if (!allowedHosts.has(finalUrl.hostname)) {
        requiresHuman = {
            runId: options.runId,
            reason: 'site_blocked',
            message: `页面跳到了未登记的域名 ${finalUrl.hostname}，已暂停自动操作。`,
            resumeCondition: '确认该域名属于本次投递流程后，把它加入 allowedHosts 再重试。',
            currentUrl: `${finalUrl.origin}${finalUrl.pathname}`,
        };
    }
    writeRunRecord(session, options.runId, {
        requestedUrlRedacted: redactUrl(options.url),
        finalUrlRedacted: `${finalUrl.origin}${finalUrl.pathname}`,
        title,
        redirected,
        blockedHost: requiresHuman === undefined ? null : finalUrl.hostname,
        navigationRule: prepared.rule ?? null,
    });
    const pageId = `page_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    setSessionPage(session, page, pageId);
    return {
        pageId,
        finalUrlRedacted: `${finalUrl.origin}${finalUrl.pathname}`,
        title,
        redirected,
        ...(requiresHuman === undefined ? {} : { requiresHuman }),
    };
}
function writeRunRecord(session, runId, record) {
    const runDir = path.join(session.paths.runsDir, runId);
    if (!isInsideLocalRoot(session.paths, runDir)) {
        throw browserError('page_open_failed', `${runDir} 不在 ${session.paths.localRoot} 内`);
    }
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, 'page-open.json'), `${JSON.stringify(record, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    });
}
//# sourceMappingURL=open-application-page.js.map