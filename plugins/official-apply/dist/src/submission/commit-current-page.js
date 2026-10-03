import { setTimeout as delay } from 'node:timers/promises';
import { findActionTarget } from "../browser/locators/find-action-target.js";
import { inspectPage } from "../browser/scan/inspect-page.js";
import { collectSubmissionEvidence } from "./collect-submission-evidence.js";
import { collectSubmissionNetworkEvidence } from "./collect-submission-network-evidence.js";
import { observeNetwork, toUrlPattern } from "../browser/network/observe-network.js";
import { genericCaptcha } from "../browser/login/recruitment-sms-providers.js";
const CLICK_TIMEOUT_MS = 15_000;
const SETTLE_TIMEOUT_MS = 15_000;
function describeError(error) {
    if (error instanceof Error) {
        return error.message.split('\n')[0] ?? error.message;
    }
    return String(error);
}
/**
 * 提交前的活会话检查。
 *
 * 返回拒绝原因，或 undefined 表示可以继续。
 * **必须在写 attempt 之前调用**——这正是 P0-5 要防的事。
 */
export function checkCommitPreconditions(input) {
    if (input.session === undefined || input.page === undefined) {
        return 'submission_session_lost: 这次运行的浏览器会话已经不在了。提交必须用当前填好的页面，不会重新打开链接猜恢复。';
    }
    if (input.session.closed) {
        return 'submission_session_lost: 浏览器会话已关闭，无法在原页面上提交。';
    }
    if (input.page.isClosed()) {
        return 'submission_session_lost: 原页面已经被关掉了，无法在上面提交。';
    }
    const commitActions = input.pageSchema.actions.filter((action) => action.commitAction);
    if (commitActions.length === 0) {
        return 'submission_no_commit_action: 当前页面上没有最终提交按钮。';
    }
    if (commitActions.length > 1) {
        return `submission_no_commit_action: 当前页面有 ${commitActions.length} 个疑似最终提交按钮，不敢点。`;
    }
    if (commitActions[0]?.disabled === true) {
        return 'submission_no_commit_action: 最终提交按钮当前不可用。';
    }
    return undefined;
}
/**
 * 用活页面造出一对提交执行器。
 *
 * 调用前请先过 `checkCommitPreconditions()`。
 */
export function buildCommitExecutors(input) {
    const { session, page, pageSchema, runId } = input;
    let beforeState;
    let observer;
    const pendingRequests = new Set();
    const diagnostics = [];
    const consoleErrors = [];
    let lastActivity = Date.now();
    const onRequest = (request) => {
        if (['xhr', 'fetch', 'document', 'script'].includes(request.resourceType())) {
            pendingRequests.add(request);
            lastActivity = Date.now();
        }
    };
    const onFinished = (request) => {
        if (pendingRequests.delete(request))
            lastActivity = Date.now();
    };
    const onFailed = (request) => {
        if (!pendingRequests.has(request))
            return;
        onFinished(request);
        diagnostics.push({ kind: 'other', valueRedacted: `请求失败：${request.method()} ${toUrlPattern(request.url())}；${request.failure()?.errorText ?? '浏览器未提供原因'}`, confidence: 0 });
    };
    const onPageError = (error) => {
        lastActivity = Date.now();
        // 异常正文可能包含表单内容，只保存异常类别。
        diagnostics.push({ kind: 'other', valueRedacted: `提交后页面 JavaScript 异常：${error.name}`, confidence: 0 });
    };
    const onConsole = (message) => {
        if (message.type() !== 'error')
            return;
        const location = message.location();
        const source = location.url ? `${toUrlPattern(location.url)}:${location.lineNumber + 1}` : '浏览器未提供代码位置';
        // SDK 捕获的异常不会触发 pageerror，日志正文可能包含个人资料。
        consoleErrors.push({ kind: 'other', valueRedacted: `提交后控制台错误：${source}`, confidence: 0 });
    };
    const onResponse = (response) => {
        if (response.request().resourceType() === 'script' && response.status() >= 400) {
            diagnostics.push({ kind: 'other', valueRedacted: `脚本加载失败：HTTP ${response.status()} ${toUrlPattern(response.url())}`, confidence: 0 });
        }
    };
    const stop = () => {
        observer?.stop();
        page.off('request', onRequest);
        page.off('requestfinished', onFinished);
        page.off('requestfailed', onFailed);
        page.off('pageerror', onPageError);
        page.off('console', onConsole);
        page.off('response', onResponse);
    };
    return {
        async clickCommit() {
            beforeState = await readSubmissionPageState(page);
            // 再确认一次唯一性。从检查到点击之间页面可能变了。
            const commit = pageSchema.actions.filter((action) => action.commitAction);
            if (commit.length !== 1) {
                return { clicked: false, message: `页面上有 ${commit.length} 个最终提交按钮，不敢点` };
            }
            if (page.isClosed()) {
                return { clicked: false, message: '页面在点击前被关掉了' };
            }
            const found = await findActionTarget(page.mainFrame(), commit[0]?.locatorCandidates ?? [], {
                runId,
                actionKind: 'click',
            });
            if (found.target === undefined) {
                return { clicked: false, message: '找不到最终提交按钮' };
            }
            observer = observeNetwork(page, { jsonOnly: false });
            page.on('request', onRequest);
            page.on('requestfinished', onFinished);
            page.on('requestfailed', onFailed);
            page.on('pageerror', onPageError);
            page.on('console', onConsole);
            page.on('response', onResponse);
            try {
                await found.target.locator.click({ timeout: CLICK_TIMEOUT_MS });
                return { clicked: true };
            }
            catch (error) {
                // 超时**不代表没点到**。所以只如实报告，绝不再点第二次。
                return { clicked: false, message: describeError(error) };
            }
        },
        async collectEvidence() {
            // 单独调用 collectEvidence() 时采取保守处理：把当前状态当作基线，
            // 不把页面上原本就有的文字当成点击结果。
            try {
                if (page.isClosed())
                    return [...diagnostics, { kind: 'other', valueRedacted: '提交后原页面已关闭，无法读回结果', confidence: 0 }];
                beforeState ??= await readSubmissionPageState(page);
                const deadline = Date.now() + SETTLE_TIMEOUT_MS;
                let state = await readSubmissionPageState(page);
                const evidenceFor = (schema) => [
                    ...collectSubmissionEvidence({
                        pageSchema: schema, bodyText: state.bodyText, semanticTexts: state.semanticTexts,
                        previousBodyText: beforeState.bodyText, previousSemanticTexts: beforeState.semanticTexts,
                        previousPageType: pageSchema.pageType, finalUrlRedacted: state.urlRedacted,
                        previousUrlRedacted: beforeState.urlRedacted,
                    }).evidence,
                    ...collectSubmissionNetworkEvidence(observer?.observations() ?? []),
                    ...diagnostics,
                    ...consoleErrors,
                ];
                while (Date.now() < deadline && !page.isClosed()) {
                    state = await readSubmissionPageState(page);
                    const current = evidenceFor(pageSchema);
                    if (current.some((item) => item.confidence >= 0.85))
                        break;
                    if (await genericCaptcha(page)) {
                        diagnostics.push({ kind: 'captcha_required', valueRedacted: '提交后出现验证码，需要在当前页面完成验证并核对结果', confidence: 0 });
                        break;
                    }
                    if (pendingRequests.size === 0 && Date.now() - lastActivity >= 750 &&
                        (diagnostics.length > 0 || current.some((item) => item.kind === 'network_response')))
                        break;
                    await delay(250);
                }
                if (page.isClosed())
                    return [...diagnostics, { kind: 'other', valueRedacted: '提交后原页面已关闭，无法读回结果', confidence: 0 }];
                const after = await inspectPage(session, page, { runId, persist: false, waitForContentMs: 0 });
                if (observer !== undefined)
                    await Promise.race([observer.settle(), delay(250)]);
                state = await readSubmissionPageState(page);
                const evidence = evidenceFor(after.schema);
                if (!evidence.some((item) => item.confidence >= 0.85))
                    evidence.push({
                        kind: 'other', valueRedacted: pendingRequests.size > 0
                            ? `提交结果等待结束，仍有 ${pendingRequests.size} 个请求没有完成`
                            : '提交结果等待结束，未获得确认成功的证据', confidence: 0,
                    });
                return evidence;
            }
            finally {
                stop();
            }
        },
    };
}
async function readSubmissionPageState(page) {
    const state = await page.evaluate(() => {
        const visible = (element) => {
            const style = window.getComputedStyle(element);
            return (style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                element.getClientRects().length > 0);
        };
        const semanticTexts = [
            document.title,
            ...Array.from(document.querySelectorAll('h1,h2,h3,[role=status],[role=alert],[aria-live=polite],[aria-live=assertive]'))
                .filter(visible)
                .map((element) => element.textContent ?? ''),
        ]
            .map((text) => text.replace(/\s+/g, ' ').trim())
            .filter((text) => text !== '');
        return {
            bodyText: document.body?.innerText ?? '',
            semanticTexts,
        };
    });
    const url = new URL(page.url());
    return {
        ...state,
        urlRedacted: `${url.origin}${url.pathname}`,
    };
}
//# sourceMappingURL=commit-current-page.js.map