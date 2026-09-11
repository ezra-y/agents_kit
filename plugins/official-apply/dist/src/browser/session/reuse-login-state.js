import { existsSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot } from "../../config/paths.js";
import { createBrowserContext } from "./create-browser-context.js";
import { connectBrowser } from "./connect-browser.js";
import { closeBrowserSession } from "./close-browser-session.js";
import { selectAttachTargetFromBrowser } from "./select-attach-target.js";
import { exportPersistentWebState, capturePersistentBrowserState, replacePersistentWebStateForDomains, replacePersistentWebStateOnContextForDomains, restoreExactPersistentBrowserState, prepareSessionStorageForNavigation, readPersistentWebState, savePersistentSessionStorageForDomains, writePersistentWebState, } from "./persist-session-storage.js";
import { exportLoginStateFromOpenCliBridge } from "./opencli-bridge-login-state.js";
import { readCurrentLoginEvidence } from "../login/current-login-evidence.js";
function assertHttpsUrl(rawUrl) {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:')
        throw new Error('login_state_target_url_must_be_https');
    return url;
}
async function bodyHasMarker(page, marker, timeoutMs) {
    const account = await readCurrentLoginEvidence(page);
    if (account.status !== 'logged_in')
        return false;
    if (marker === undefined)
        return true;
    const deadline = Date.now() + timeoutMs;
    do {
        if ((await page.locator('body').innerText().catch(() => '')).includes(marker))
            return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    return false;
}
async function disconnectAttached(session) {
    // connectOverCDP 的 close 断开 Playwright 连接；不关闭用户自己的 browser process。
    await session.browser?.close().catch(() => undefined);
    session.browser = undefined;
    session.context = undefined;
    session.closed = true;
}
export async function restoreAndVerifyTarget(input) {
    const targetProfileDir = path.join(input.paths.browserProfileDir, input.targetProfileName);
    if (!isInsideLocalRoot(input.paths, targetProfileDir)) {
        throw new Error('login_state_target_outside_local');
    }
    if (existsSync(path.join(targetProfileDir, 'SingletonLock'))) {
        throw new Error('login_state_target_in_use');
    }
    const previousState = readPersistentWebState(targetProfileDir);
    const targetState = replacePersistentWebStateForDomains(previousState, input.state, input.domains);
    let targetSession;
    let previousBrowserState;
    let verified = false;
    try {
        targetSession = await connectBrowser({
            paths: input.paths,
            mode: 'persistent',
            profileName: input.targetProfileName,
            channel: input.targetChannel,
            headless: true,
            timeoutMs: input.timeoutMs,
        });
        const targetContext = await createBrowserContext(targetSession);
        previousBrowserState = await capturePersistentBrowserState(targetContext);
        await replacePersistentWebStateOnContextForDomains(targetContext, input.state, input.domains);
        const targetPage = await targetContext.newPage();
        const removeSessionStorageScript = await prepareSessionStorageForNavigation(targetPage, targetState, new URL(input.targetUrl).origin);
        try {
            await targetPage.goto(input.targetUrl, {
                waitUntil: 'domcontentloaded',
                timeout: input.timeoutMs ?? 60_000,
            });
        }
        finally {
            await removeSessionStorageScript();
        }
        const targetLoginVerified = await bodyHasMarker(targetPage, input.loginMarker, input.timeoutMs ?? 60_000);
        if (!targetLoginVerified)
            throw new Error('login_state_target_login_unverified');
        const verifiedAt = new Date().toISOString();
        await savePersistentSessionStorageForDomains(targetContext, targetProfileDir, input.domains, {
            origin: new URL(targetPage.url()).origin,
            verifiedAt,
        });
        verified = true;
        return { targetProfileDir, targetLoginVerified, verifiedAt };
    }
    finally {
        if (!verified && targetSession?.context !== undefined && previousBrowserState !== undefined) {
            await restoreExactPersistentBrowserState(targetSession.context, previousBrowserState).catch(() => undefined);
        }
        if (targetSession !== undefined)
            await closeBrowserSession(targetSession).catch(() => undefined);
        if (!verified)
            writePersistentWebState(targetProfileDir, previousState);
    }
}
export async function reuseLoginStateFromAttachedBrowser(request) {
    if (request.cdpEndpoint === undefined || request.sourceChannel === undefined) {
        throw new Error('login_state_cdp_source_missing');
    }
    const target = assertHttpsUrl(request.targetUrl);
    const source = await connectBrowser({
        paths: request.paths,
        mode: 'attach_existing',
        cdpEndpoint: request.cdpEndpoint,
        channel: request.sourceChannel,
        headless: false,
        timeoutMs: request.timeoutMs,
    });
    let createdSourcePage;
    try {
        const sourceContext = source.context ?? await createBrowserContext(source);
        const selected = source.browser === undefined
            ? { result: { kind: 'none', reason: '未连接到活 browser' } }
            : await selectAttachTargetFromBrowser(source.browser, request.targetUrl, []);
        if (selected.result.kind === 'ambiguous') {
            throw new Error('login_state_source_tab_ambiguous');
        }
        const exactSourcePage = selected.page !== undefined && selected.result.kind === 'matched' &&
            selected.result.target.reasons.includes('就是这一页');
        const sourcePage = exactSourcePage && selected.page !== undefined
            ? selected.page
            : await sourceContext.newPage();
        if (!exactSourcePage) {
            createdSourcePage = sourcePage;
            await sourcePage.goto(target.href, {
                waitUntil: 'domcontentloaded',
                timeout: request.timeoutMs ?? 60_000,
            });
        }
        const sourceLoginVerified = await bodyHasMarker(sourcePage, request.loginMarker, request.timeoutMs ?? 60_000);
        if (!sourceLoginVerified) {
            throw new Error('login_state_source_login_unverified');
        }
        const state = await exportPersistentWebState(sourceContext, request.domains);
        const restored = await restoreAndVerifyTarget({
            paths: request.paths,
            targetProfileName: request.targetProfileName,
            targetUrl: target.href,
            state,
            domains: request.domains,
            loginMarker: request.loginMarker,
            targetChannel: request.targetChannel ?? request.sourceChannel,
            timeoutMs: request.timeoutMs,
        });
        return {
            targetProfileName: request.targetProfileName,
            targetProfileDir: restored.targetProfileDir,
            domains: request.domains,
            sourcePageReused: exactSourcePage,
            sourceLoginVerified,
            targetLoginVerified: restored.targetLoginVerified,
            originCount: Object.keys(state.origins).length,
            indexedDBOriginCount: Object.values(state.origins).filter((origin) => Array.isArray(origin.indexedDB) && origin.indexedDB.length > 0).length,
            sourceBackend: 'cdp',
            targetChannel: request.targetChannel ?? request.sourceChannel,
            verifiedAt: restored.verifiedAt,
        };
    }
    finally {
        await createdSourcePage?.close().catch(() => undefined);
        await disconnectAttached(source);
    }
}
export async function reuseLoginStateFromOpenCliBridge(request) {
    if (request.bridgeSession === undefined || request.bridgeContextId === undefined) {
        throw new Error('login_state_opencli_source_missing');
    }
    const target = assertHttpsUrl(request.targetUrl);
    const exported = await exportLoginStateFromOpenCliBridge({
        session: request.bridgeSession,
        contextId: request.bridgeContextId,
        targetUrl: target.href,
        domains: request.domains,
        loginMarker: request.loginMarker,
        timeoutMs: request.timeoutMs,
    });
    try {
        const targetChannel = request.targetChannel ?? 'msedge';
        const restored = await restoreAndVerifyTarget({
            paths: request.paths,
            targetProfileName: request.targetProfileName,
            targetUrl: target.href,
            state: exported.state,
            domains: request.domains,
            loginMarker: request.loginMarker,
            targetChannel,
            timeoutMs: request.timeoutMs,
        });
        return {
            targetProfileName: request.targetProfileName,
            targetProfileDir: restored.targetProfileDir,
            domains: request.domains,
            sourcePageReused: exported.sourcePageReused,
            sourceLoginVerified: exported.sourceLoginVerified,
            targetLoginVerified: restored.targetLoginVerified,
            originCount: Object.keys(exported.state.origins).length,
            indexedDBOriginCount: 0,
            sourceBackend: 'opencli_browser_bridge',
            targetChannel,
            verifiedAt: restored.verifiedAt,
        };
    }
    finally {
        await exported.cleanup();
    }
}
//# sourceMappingURL=reuse-login-state.js.map