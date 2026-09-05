import { randomUUID } from 'node:crypto';
import { runBrowserLossUpdate, TERMINAL_STATES, } from "../../application/run-state-machine.js";
import { openRuntimeDatabase } from "../../storage/open-runtime-database.js";
const lifecycleBindings = new WeakMap();
function bindingsFor(session) {
    let bindings = lifecycleBindings.get(session);
    if (bindings === undefined) {
        bindings = {
            browsers: new WeakSet(),
            contexts: new WeakSet(),
            pages: new WeakSet(),
        };
        lifecycleBindings.set(session, bindings);
    }
    return bindings;
}
function eventId() {
    return `event_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
function missingDatabase(error) {
    return error instanceof Error && error.message.startsWith('database_not_migrated');
}
export function browserSessionIdForRun(paths, runId) {
    const runtime = openRuntimeDatabase({ paths });
    try {
        const row = runtime.db
            .prepare('SELECT browser_session_id FROM application_runs WHERE id = ?')
            .get(runId);
        if (row === undefined) {
            throw new Error(`browser_session_not_found: 运行 ${runId} 没有关联浏览器会话`);
        }
        return row.browser_session_id;
    }
    finally {
        runtime.close();
    }
}
export function prepareBrowserSession(paths, sessionId, mode, now) {
    const runtime = openRuntimeDatabase({ paths });
    try {
        runtime.db
            .prepare(`UPDATE browser_sessions
            SET mode = ?, status = 'starting', active_page_id = NULL,
                owner_pid = ?, ended_at = NULL
          WHERE id = ?`)
            .run(mode, process.pid, sessionId);
        runtime.db
            .prepare(`UPDATE application_runs
            SET updated_at = ?, error_code = NULL, error_message_redacted = NULL
          WHERE browser_session_id = ?`)
            .run(now, sessionId);
    }
    finally {
        runtime.close();
    }
}
export function writeBrowserSessionStatus(paths, sessionId, status, now = new Date().toISOString(), detail) {
    let runtime;
    try {
        runtime = openRuntimeDatabase({ paths });
    }
    catch (error) {
        if (missingDatabase(error))
            return false;
        throw error;
    }
    try {
        const lossKind = status === 'closed' ? 'closed' : status === 'failed' ? 'failed' : 'disconnected';
        const reasonCode = status === 'closed'
            ? 'browser_session_closed'
            : status === 'failed'
                ? 'browser_session_failed'
                : 'browser_disconnected';
        const message = detail ?? reasonCode;
        runtime.db.exec('BEGIN IMMEDIATE');
        try {
            const runs = runtime.db
                .prepare(`SELECT id, state, error_code, error_message_redacted
             FROM application_runs WHERE browser_session_id = ?`)
                .all(sessionId);
            const changed = runtime.db
                .prepare(`UPDATE browser_sessions
              SET status = ?, active_page_id = NULL, owner_pid = NULL, ended_at = ?
            WHERE id = ?`)
                .run(status, now, sessionId).changes;
            for (const run of runs) {
                const update = runBrowserLossUpdate(run.state, run.error_code, run.error_message_redacted, lossKind, message);
                if (update.nextState === undefined)
                    continue;
                const finishedAt = TERMINAL_STATES.has(update.nextState) ? now : null;
                runtime.db
                    .prepare(`UPDATE application_runs
                SET state = ?, updated_at = ?, finished_at = COALESCE(finished_at, ?),
                    error_code = ?, error_message_redacted = ?
              WHERE id = ?`)
                    .run(update.nextState, now, finishedAt, update.errorCode ?? run.error_code, update.errorMessageRedacted ?? run.error_message_redacted, run.id);
                // 状态迁移和浏览器丢失事实都必须留痕（docs/10：状态变化不只覆盖当前值）。
                runtime.db
                    .prepare(`INSERT INTO state_events
               (id, run_id, from_state, to_state, reason_code, note_redacted, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`)
                    .run(eventId(), run.id, run.state, update.nextState, reasonCode, message, now);
            }
            // 会话结束 = 页面没了 = 旧的一次性提交批准不能再被消费，同事务失效。
            runtime.db
                .prepare(`UPDATE submission_approval_tokens
              SET status = 'invalidated'
            WHERE run_id IN (SELECT id FROM application_runs WHERE browser_session_id = ?)
              AND status = 'pending'`)
                .run(sessionId);
            runtime.db.exec('COMMIT');
            return changed > 0;
        }
        catch (error) {
            runtime.db.exec('ROLLBACK');
            throw error;
        }
    }
    finally {
        runtime.close();
    }
}
export function activateBrowserSession(session) {
    let runtime;
    try {
        runtime = openRuntimeDatabase({ paths: session.paths });
    }
    catch (error) {
        if (missingDatabase(error))
            return;
        throw error;
    }
    try {
        runtime.db
            .prepare(`UPDATE browser_sessions
            SET mode = ?, browser_name = ?, profile_name = ?, status = 'active',
                owner_pid = ?, ended_at = NULL
          WHERE id = ?`)
            .run(session.mode, session.ref.browserName, session.ref.profileName ?? null, process.pid, session.ref.sessionId);
        session.lifecycleStatus = 'active';
    }
    finally {
        runtime.close();
    }
}
function endSession(session, status, detail) {
    if (session.lifecycleStatus !== 'active' || session.closed)
        return;
    session.lifecycleStatus = status;
    session.closed = true;
    writeBrowserSessionStatus(session.paths, session.ref.sessionId, status, new Date().toISOString(), detail);
}
export function bindBrowserSessionLifecycle(session) {
    const browser = session.browser;
    const bindings = bindingsFor(session);
    if (browser !== undefined && !bindings.browsers.has(browser)) {
        bindings.browsers.add(browser);
        browser.once('disconnected', () => {
            endSession(session, 'disconnected', '浏览器连接意外断开');
        });
    }
    if (session.context !== undefined) {
        bindBrowserContextLifecycle(session, session.context);
    }
}
export function bindBrowserContextLifecycle(session, context) {
    const bindings = bindingsFor(session);
    if (bindings.contexts.has(context))
        return;
    bindings.contexts.add(context);
    context.once('close', () => {
        if (session.context === context) {
            endSession(session, 'disconnected', '浏览器上下文意外关闭');
        }
    });
}
export function setSessionPage(session, page, pageId = `page_${randomUUID().replaceAll('-', '').slice(0, 16)}`) {
    session.page = page;
    session.context = page.context();
    bindBrowserContextLifecycle(session, page.context());
    const bindings = bindingsFor(session);
    if (!bindings.pages.has(page)) {
        bindings.pages.add(page);
        page.once('close', () => {
            if (session.page === page)
                endSession(session, 'disconnected', '当前页面意外关闭');
        });
        page.once('crash', () => {
            if (session.page === page)
                endSession(session, 'failed', '当前页面崩溃');
        });
    }
    let runtime;
    try {
        runtime = openRuntimeDatabase({ paths: session.paths });
    }
    catch (error) {
        if (missingDatabase(error))
            return pageId;
        throw error;
    }
    try {
        runtime.db
            .prepare(`UPDATE browser_sessions
            SET active_page_id = ?, status = 'active', owner_pid = ?, ended_at = NULL
          WHERE id = ?`)
            .run(pageId, process.pid, session.ref.sessionId);
    }
    finally {
        runtime.close();
    }
    return pageId;
}
export function watchForOwnedPopup(page) {
    let settled = false;
    let resolvePopup = () => undefined;
    const finish = (popup) => {
        if (settled)
            return;
        settled = true;
        page.off('popup', onPopup);
        resolvePopup(popup);
    };
    // `popup` 事件只会从打开它的 Page 发出，已经天然绑定当前动作来源。
    const onPopup = (popup) => {
        if (popup.context() === page.context())
            finish(popup);
    };
    const promise = new Promise((resolve) => {
        resolvePopup = resolve;
    });
    page.on('popup', onPopup);
    return { promise, cancel: () => finish() };
}
function processExists(pid) {
    if (pid === null)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        const code = error.code;
        if (code === 'EPERM')
            return true;
        if (code === 'ESRCH')
            return false;
        throw error;
    }
}
export function findStaleBrowserSessions(paths) {
    let runtime;
    try {
        runtime = openRuntimeDatabase({ paths });
    }
    catch (error) {
        if (missingDatabase(error))
            return [];
        throw error;
    }
    const ids = (() => {
        try {
            return runtime.db
                .prepare(`SELECT id, owner_pid
             FROM browser_sessions
            WHERE status IN ('starting', 'active')`)
                .all();
        }
        finally {
            runtime.close();
        }
    })();
    // 一条会话可能关联多个 run。这里按会话返回一次；真正的 run 批量处理在
    // writeBrowserSessionStatus() 的单个事务里完成，避免重复迁移和重复事件。
    return ids
        .filter(({ owner_pid }) => !processExists(owner_pid))
        .map(({ id }) => ({ sessionId: id }));
}
//# sourceMappingURL=browser-session-lifecycle.js.map