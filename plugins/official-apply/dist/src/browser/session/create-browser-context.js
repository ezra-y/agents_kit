import { browserError } from "./connect-browser.js";
import { bindBrowserContextLifecycle } from "./browser-session-lifecycle.js";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_LOCALE = 'zh-CN';
export async function createBrowserContext(session, options = {}) {
    if (session.closed) {
        throw browserError('browser_session_closed', `会话 ${session.ref.sessionId} 已关闭`);
    }
    const defaultTimeoutMs = options.defaultTimeoutMs ?? session.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const locale = options.locale ?? DEFAULT_LOCALE;
    const acceptDownloads = options.acceptDownloads ?? true;
    let context = session.context;
    if (context === undefined) {
        if (session.browser === undefined) {
            throw browserError('browser_launch_failed', '会话里既没有 context 也没有 browser');
        }
        context = await session.browser.newContext({ locale, acceptDownloads });
        session.context = context;
        bindBrowserContextLifecycle(session, context);
    }
    // 默认不授予任何权限。需要时由具体动作显式申请。
    await context.grantPermissions([]);
    context.setDefaultTimeout(defaultTimeoutMs);
    context.setDefaultNavigationTimeout(defaultTimeoutMs);
    session.defaultTimeoutMs = defaultTimeoutMs;
    return context;
}
//# sourceMappingURL=create-browser-context.js.map