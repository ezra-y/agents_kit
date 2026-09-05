import { findActionTarget } from "../browser/locators/find-action-target.js";
import { inspectPage } from "../browser/scan/inspect-page.js";
import { collectSubmissionEvidence } from "./collect-submission-evidence.js";
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
            if (page.isClosed()) {
                return [];
            }
            // 单独调用 collectEvidence() 时采取保守处理：把当前状态当作基线，
            // 不把页面上原本就有的文字当成点击结果。
            beforeState ??= await readSubmissionPageState(page);
            await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);
            const after = await inspectPage(session, page, { runId, persist: false });
            const afterState = await readSubmissionPageState(page);
            return collectSubmissionEvidence({
                pageSchema: after.schema,
                bodyText: afterState.bodyText,
                semanticTexts: afterState.semanticTexts,
                previousBodyText: beforeState.bodyText,
                previousSemanticTexts: beforeState.semanticTexts,
                previousPageType: pageSchema.pageType,
                finalUrlRedacted: afterState.urlRedacted,
                previousUrlRedacted: beforeState.urlRedacted,
            }).evidence;
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