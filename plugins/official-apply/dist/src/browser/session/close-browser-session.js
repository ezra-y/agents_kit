/**
 * 安全结束浏览器会话。
 *
 * 规则文档：`docs/09_Codex与ClaudeCode共用实现.md §7`
 *
 * 一条硬规则：关闭会话**不得删除**浏览器 profile。
 * profile 里是用户自己登录出来的状态，删掉等于每次投递都要重新登录一遍。
 *
 * 重复关闭是安全的：第二次只是什么都不做。
 */
import { browserError } from "./connect-browser.js";
import { savePersistentSessionStorage } from "./persist-session-storage.js";
import { writeBrowserSessionStatus, } from "./browser-session-lifecycle.js";
export async function closeBrowserSession(session, options = {}) {
    let closedContext = false;
    let closedBrowser = false;
    let storageError;
    let closeError;
    const rememberStorageError = (error) => {
        storageError ??= error;
    };
    const rememberCloseError = (error) => {
        closeError ??= error;
    };
    const requestedStatus = options.status ??
        (session.lifecycleStatus === 'failed' || session.lifecycleStatus === 'disconnected'
            ? session.lifecycleStatus
            : 'closed');
    // 正常 close 也会触发 Playwright 的 close/disconnected 事件。
    // 先标记，监听器才不会把正常关闭误记成异常断开。
    session.closed = true;
    if (session.context !== undefined) {
        if (session.mode === 'persistent' && session.profileDir !== undefined) {
            await savePersistentSessionStorage(session.context, session.profileDir).catch(rememberStorageError);
        }
        if (options.saveState === true && session.mode !== 'persistent') {
            // storage state 属于登录信息，只能落在 .local/ 内。
            await session.context
                .storageState({
                path: `${session.paths.browserProfileDir}/${session.ref.sessionId}-state.json`,
            })
                .catch(rememberStorageError);
        }
        try {
            await session.context.close();
            session.context = undefined;
            closedContext = true;
        }
        catch (error) {
            rememberCloseError(error);
        }
    }
    if (session.browser !== undefined) {
        try {
            await session.browser.close();
            session.browser = undefined;
            closedBrowser = true;
        }
        catch (error) {
            rememberCloseError(error);
        }
    }
    const status = closeError === undefined ? requestedStatus : 'failed';
    session.lifecycleStatus = status;
    writeBrowserSessionStatus(session.paths, session.ref.sessionId, status, options.now, closeError === undefined ? options.detail : describeError(closeError));
    if (closeError !== undefined) {
        throw closeError;
    }
    if (storageError !== undefined) {
        throw storageError;
    }
    return {
        sessionId: session.ref.sessionId,
        closedContext,
        closedBrowser,
        // profile 永远保留。这个字段是常量 false，用来把承诺写进类型里。
        profileRemoved: false,
    };
}
function describeError(error) {
    return error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error);
}
/** 会话已关闭时抛出统一错误，避免调用方拿到半死的 context。 */
export function assertSessionOpen(session) {
    if (session.closed) {
        throw browserError('browser_session_closed', `会话 ${session.ref.sessionId} 已关闭`);
    }
}
//# sourceMappingURL=close-browser-session.js.map