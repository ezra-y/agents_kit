var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactUrl } from "./open-application-page.js";
function commandPath() {
    try {
        const command = process.platform === 'win32' ? 'where' : 'which';
        const output = execFileSync(command, ['opencli'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        return first === undefined ? undefined : realpathSync(first);
    }
    catch {
        return undefined;
    }
}
function resolvePackageRoot(entry) {
    let current = path.dirname(entry);
    for (;;) {
        const packageFile = path.join(current, 'package.json');
        if (existsSync(packageFile)) {
            try {
                const packageJson = JSON.parse(readFileSync(packageFile, 'utf8'));
                if (packageJson.name === '@jackwener/opencli')
                    return current;
            }
            catch {
                // A broken package metadata file simply makes the optional backend unavailable.
            }
        }
        const parent = path.dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
}
async function resolveBridge() {
    const entry = commandPath();
    const root = entry === undefined ? undefined : resolvePackageRoot(entry);
    if (root === undefined)
        throw new Error('opencli_browser_bridge_unavailable');
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const modulePath = path.join(root, 'dist', 'src', 'browser', 'index.js');
    const profilePath = path.join(root, 'dist', 'src', 'browser', 'profile.js');
    const loaded = await import(__rewriteRelativeImportExtension(pathToFileURL(modulePath).href));
    const profile = await import(__rewriteRelativeImportExtension(pathToFileURL(profilePath).href));
    if (typeof loaded.BrowserBridge !== 'function' || typeof loaded.getDaemonHealth !== 'function') {
        throw new Error('opencli_browser_bridge_api_unavailable');
    }
    if (typeof profile.resolveProfileContextId !== 'function') {
        throw new Error('opencli_browser_profile_api_unavailable');
    }
    return {
        module: loaded,
        resolveProfileContextId: profile.resolveProfileContextId,
        ...(typeof profile.loadProfileConfig === 'function' ? { loadProfileConfig: profile.loadProfileConfig } : {}),
        ...(typeof profile.aliasForContextId === 'function' ? { aliasForContextId: profile.aliasForContextId } : {}),
        ...(typeof packageJson.version === 'string' ? { packageVersion: packageJson.version } : {}),
    };
}
export async function inventoryOpenCliBridge(options) {
    try {
        const resolved = await resolveBridge();
        const selectedContextId = options?.contextId !== undefined
            ? resolved.resolveProfileContextId(options.contextId)
            : options?.selection === 'default'
                ? resolved.resolveProfileContextId()
                : undefined;
        const profileConfig = resolved.loadProfileConfig?.();
        const sourceIdFor = (contextId) => {
            if (options?.contextId !== undefined)
                return `bridge:${options.contextId}`;
            const alias = profileConfig === undefined || resolved.aliasForContextId === undefined
                ? undefined
                : resolved.aliasForContextId(profileConfig, contextId);
            return `bridge:${alias ?? contextId}`;
        };
        const health = await resolved.module.getDaemonHealth({
            timeout: 2_000,
            ...(selectedContextId === undefined ? {} : { contextId: selectedContextId }),
        });
        const profiles = health.status?.profiles ?? [];
        if (profiles.length > 0) {
            return profiles
                .filter((profile) => selectedContextId === undefined || profile.contextId === selectedContextId)
                .flatMap((profile) => typeof profile.contextId === 'string'
                ? [{
                        contextId: profile.contextId,
                        sourceId: sourceIdFor(profile.contextId),
                        extensionConnected: profile.extensionConnected === true,
                        ...(typeof profile.extensionVersion === 'string' ? { extensionVersion: profile.extensionVersion } : {}),
                        ...(typeof health.status?.daemonVersion === 'string' ? { daemonVersion: health.status.daemonVersion } : {}),
                    }]
                : []);
        }
        const contextId = health.status?.contextId;
        return typeof contextId === 'string' &&
            (selectedContextId === undefined || contextId === selectedContextId)
            ? [{
                    contextId,
                    sourceId: sourceIdFor(contextId),
                    extensionConnected: health.state === 'ready',
                    ...(typeof health.status?.daemonVersion === 'string' ? { daemonVersion: health.status.daemonVersion } : {}),
                }]
            : [];
    }
    catch {
        return [];
    }
}
function normalizeUrl(raw) {
    try {
        const url = new URL(raw);
        return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`;
    }
    catch {
        return undefined;
    }
}
function tabTarget(raw) {
    if (raw === null || typeof raw !== 'object')
        return undefined;
    const value = raw;
    return typeof value.page === 'string' && typeof value.url === 'string'
        ? { page: value.page, url: value.url }
        : undefined;
}
function cookieToPlaywright(cookie) {
    if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string' || typeof cookie.domain !== 'string') {
        return undefined;
    }
    const expires = typeof cookie.expirationDate === 'number' && Number.isFinite(cookie.expirationDate)
        ? Math.floor(cookie.expirationDate)
        : undefined;
    const converted = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: typeof cookie.path === 'string' && cookie.path !== '' ? cookie.path : '/',
        ...(typeof cookie.secure === 'boolean' ? { secure: cookie.secure } : {}),
        ...(typeof cookie.httpOnly === 'boolean' ? { httpOnly: cookie.httpOnly } : {}),
        ...(expires === undefined ? {} : { expires }),
    };
    return converted;
}
function dedupeCookies(cookies) {
    const seen = new Set();
    return cookies.filter((cookie) => {
        const key = `${cookie.name}\u0000${cookie.domain}\u0000${cookie.path}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
export function redactBridgeError(error) {
    const raw = error instanceof Error ? error.message : String(error);
    return raw
        .split('\n')
        .map((line) => line
        .replace(/https?:\/\/[^\s)]+/gi, (url) => redactUrl(url))
        .replace(/\bBearer\s+[^\r\n]+/gi, 'Bearer <REDACTED>')
        .replace(/((?:"?cookie"?|"?token"?|"?authorization"?|"?password"?|"?secret"?)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\r\n,;}]+)/gi, '$1<REDACTED>'))
        .join('\n');
}
function bridgeError(stage, error) {
    const detail = redactBridgeError(error);
    if (/timeout|timed out|deadline/i.test(detail)) {
        return new Error(`${stage}_timeout:${detail}`);
    }
    return new Error(`${stage}:${detail}`);
}
async function bridgeBodyHasMarker(page, marker, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    do {
        const found = await page.evaluate((value) => document.body?.innerText.includes(String(value)) ?? false, marker);
        if (found)
            return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    return false;
}
async function readBridgeSourceState(page, expectedOrigin, timeoutMs) {
    const deadline = Date.now() + Math.min(timeoutMs, 3_000);
    for (;;) {
        try {
            const state = await page.evaluate(() => {
                const storage = (name) => {
                    try {
                        return { values: Object.fromEntries(Object.entries(window[name])) };
                    }
                    catch (error) {
                        return { values: {}, error: error instanceof Error ? error.message : String(error) };
                    }
                };
                const localStorage = storage('localStorage');
                const sessionStorage = storage('sessionStorage');
                const storageErrors = [localStorage.error, sessionStorage.error].filter((error) => error !== undefined);
                return {
                    href: window.location.href,
                    origin: window.location.origin,
                    localStorage: localStorage.values,
                    sessionStorage: sessionStorage.values,
                    ...(storageErrors.length === 0 ? {} : { storageError: storageErrors.join('; ') }),
                };
            });
            if (state.origin === expectedOrigin) {
                if (state.storageError !== undefined) {
                    throw bridgeError('opencli_bridge_source_storage_unavailable', new Error(state.storageError));
                }
                return state;
            }
            if (state.origin !== 'null' && state.href !== 'about:blank') {
                throw new Error(`opencli_bridge_source_origin_mismatch:${redactUrl(state.href)}`);
            }
        }
        catch (error) {
            if (error instanceof Error &&
                (error.message.startsWith('opencli_bridge_source_origin_mismatch:') ||
                    error.message.startsWith('opencli_bridge_source_storage_unavailable:'))) {
                throw error;
            }
            throw bridgeError('opencli_bridge_source_document_read', error);
        }
        if (Date.now() >= deadline) {
            throw new Error('opencli_bridge_source_not_ready');
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
async function connectExistingBridge(request) {
    let resolved;
    try {
        resolved = await resolveBridge();
    }
    catch (error) {
        throw bridgeError('opencli_bridge_resolve', error);
    }
    let health;
    try {
        health = await resolved.module.getDaemonHealth({
            contextId: request.contextId,
            timeout: Math.min(request.timeoutMs, 3_000),
        });
    }
    catch (error) {
        throw bridgeError('opencli_bridge_health', error);
    }
    if (health.state !== 'ready')
        throw new Error(`opencli_bridge_unavailable:${health.state}`);
    if (resolved.packageVersion !== undefined && health.status?.daemonVersion !== resolved.packageVersion) {
        throw new Error('opencli_browser_bridge_version_mismatch');
    }
    const bridge = new resolved.module.BrowserBridge();
    let page;
    try {
        page = await bridge.connect({
            timeout: Math.max(1, Math.ceil(request.timeoutMs / 1_000)),
            session: request.session,
            contextId: request.contextId,
            windowMode: 'background',
            surface: 'browser',
            siteSession: 'persistent',
        });
    }
    catch (error) {
        await bridge.close().catch(() => undefined);
        throw bridgeError('opencli_bridge_connect', error);
    }
    return { bridge, page };
}
function cookieUrls(targetUrl, domains) {
    const target = new URL(targetUrl);
    const urls = new Set([targetUrl]);
    for (const domain of domains) {
        const host = domain.replace(/^\.+/, '');
        if (host !== '')
            urls.add(`${target.protocol}//${host}${target.pathname}`);
    }
    return [...urls];
}
export async function exportCookiesFromOpenCliBridge(request) {
    const timeoutMs = request.timeoutMs ?? 60_000;
    const { bridge, page } = await connectExistingBridge({ ...request, timeoutMs });
    try {
        let cookieResults;
        try {
            cookieResults = await Promise.all([
                ...cookieUrls(request.targetUrl, request.domains).map((url) => page.getCookies({ url })),
                ...request.domains.map((domain) => page.getCookies({ domain })),
            ]);
        }
        catch (error) {
            throw bridgeError('opencli_bridge_cookie_read', error);
        }
        const cookies = dedupeCookies(cookieResults.flat().map(cookieToPlaywright).filter((cookie) => cookie !== undefined));
        return { version: 2, origins: {}, cookies };
    }
    finally {
        await bridge.close().catch(() => undefined);
    }
}
export async function exportLoginStateFromOpenCliBridge(request) {
    const timeoutMs = request.timeoutMs ?? 60_000;
    const { bridge, page } = await connectExistingBridge({
        session: request.session,
        contextId: request.contextId,
        timeoutMs,
    });
    let createdPage;
    try {
        const target = normalizeUrl(request.targetUrl);
        let tabs;
        try {
            tabs = await page.tabs();
        }
        catch (error) {
            throw bridgeError('opencli_bridge_tab_list', error);
        }
        const matching = target === undefined ? undefined : tabs.map(tabTarget).find((tab) => tab !== undefined && normalizeUrl(tab.url) === target);
        if (matching !== undefined) {
            if (page.selectTab === undefined)
                throw new Error('opencli_browser_bridge_tab_bind_unsupported');
            try {
                await page.selectTab(matching.page);
            }
            catch (error) {
                throw bridgeError('opencli_bridge_tab_bind', error);
            }
        }
        else {
            if (page.newTab === undefined)
                throw new Error('opencli_browser_bridge_new_tab_unsupported');
            try {
                createdPage = await page.newTab(request.targetUrl);
            }
            catch (error) {
                throw bridgeError('opencli_bridge_tab_create', error);
            }
            if (createdPage === undefined)
                throw new Error('opencli_browser_bridge_new_tab_failed');
            if (page.selectTab === undefined)
                throw new Error('opencli_browser_bridge_tab_bind_unsupported');
            try {
                await page.selectTab(createdPage);
            }
            catch (error) {
                throw bridgeError('opencli_bridge_tab_bind', error);
            }
        }
        const expectedOrigin = new URL(request.targetUrl).origin;
        let sourceLoginVerified = false;
        if (request.loginMarker !== undefined) {
            try {
                sourceLoginVerified = await bridgeBodyHasMarker(page, request.loginMarker, timeoutMs);
            }
            catch (error) {
                throw bridgeError('opencli_bridge_source_marker_read', error);
            }
        }
        if (request.loginMarker !== undefined && !sourceLoginVerified) {
            throw new Error('login_state_source_login_unverified');
        }
        const values = await readBridgeSourceState(page, expectedOrigin, timeoutMs);
        let cookieResults;
        try {
            cookieResults = await Promise.all([
                ...cookieUrls(request.targetUrl, request.domains).map((url) => page.getCookies({ url })),
                ...request.domains.map((domain) => page.getCookies({ domain })),
            ]);
        }
        catch (error) {
            throw bridgeError('opencli_bridge_cookie_read', error);
        }
        const cookies = dedupeCookies(cookieResults.flat().map(cookieToPlaywright).filter((cookie) => cookie !== undefined));
        return {
            state: {
                version: 2,
                origins: {
                    [values.origin]: {
                        localStorage: values.localStorage,
                        sessionStorage: values.sessionStorage,
                    },
                },
                cookies,
            },
            sourcePageReused: matching !== undefined,
            sourceLoginVerified,
            cleanup: async () => {
                if (createdPage !== undefined && page.closeTab !== undefined)
                    await page.closeTab(createdPage).catch(() => undefined);
                await bridge.close();
            },
        };
    }
    catch (error) {
        if (createdPage !== undefined && page.closeTab !== undefined)
            await page.closeTab(createdPage).catch(() => undefined);
        await bridge.close().catch(() => undefined);
        throw error;
    }
}
//# sourceMappingURL=opencli-bridge-login-state.js.map