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
    const loaded = await import(__rewriteRelativeImportExtension(pathToFileURL(modulePath).href));
    if (typeof loaded.BrowserBridge !== 'function' || typeof loaded.getDaemonHealth !== 'function') {
        throw new Error('opencli_browser_bridge_api_unavailable');
    }
    return {
        module: loaded,
        ...(typeof packageJson.version === 'string' ? { packageVersion: packageJson.version } : {}),
    };
}
export async function inventoryOpenCliBridge() {
    try {
        const resolved = await resolveBridge();
        const health = await resolved.module.getDaemonHealth({ timeout: 2_000 });
        const profiles = health.status?.profiles ?? [];
        if (profiles.length > 0) {
            return profiles.flatMap((profile) => typeof profile.contextId === 'string'
                ? [{
                        contextId: profile.contextId,
                        extensionConnected: profile.extensionConnected === true,
                        ...(typeof profile.extensionVersion === 'string' ? { extensionVersion: profile.extensionVersion } : {}),
                        ...(typeof health.status?.daemonVersion === 'string' ? { daemonVersion: health.status.daemonVersion } : {}),
                    }]
                : []);
        }
        const contextId = health.status?.contextId;
        return typeof contextId === 'string'
            ? [{
                    contextId,
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
export async function exportLoginStateFromOpenCliBridge(request) {
    const resolved = await resolveBridge();
    const timeoutMs = request.timeoutMs ?? 60_000;
    const health = await resolved.module.getDaemonHealth({
        contextId: request.contextId,
        timeout: Math.min(timeoutMs, 3_000),
    });
    if (health.state !== 'ready')
        throw new Error(`opencli_browser_bridge_unavailable:${health.state}`);
    if (resolved.packageVersion !== undefined && health.status?.daemonVersion !== resolved.packageVersion) {
        throw new Error('opencli_browser_bridge_version_mismatch');
    }
    const bridge = new resolved.module.BrowserBridge();
    const page = await bridge.connect({
        timeout: Math.max(1, Math.ceil(timeoutMs / 1_000)),
        session: request.session,
        contextId: request.contextId,
        windowMode: 'background',
        surface: 'browser',
        siteSession: 'persistent',
    });
    let createdPage;
    try {
        const target = normalizeUrl(request.targetUrl);
        const tabs = await page.tabs();
        const matching = target === undefined ? undefined : tabs.map(tabTarget).find((tab) => tab !== undefined && normalizeUrl(tab.url) === target);
        if (matching !== undefined && page.selectTab !== undefined) {
            await page.selectTab(matching.page);
        }
        else {
            if (page.newTab === undefined)
                throw new Error('opencli_browser_bridge_new_tab_unsupported');
            createdPage = await page.newTab(request.targetUrl);
            if (createdPage === undefined)
                throw new Error('opencli_browser_bridge_new_tab_failed');
        }
        const sourceLoginVerified = await bridgeBodyHasMarker(page, request.loginMarker, timeoutMs);
        if (!sourceLoginVerified)
            throw new Error('login_state_source_login_unverified');
        const values = await page.evaluate(() => ({
            origin: window.location.origin,
            localStorage: Object.fromEntries(Object.entries(window.localStorage)),
            sessionStorage: Object.fromEntries(Object.entries(window.sessionStorage)),
        }));
        const targetUrl = new URL(request.targetUrl);
        const cookieUrls = new Set([request.targetUrl]);
        for (const domain of request.domains) {
            const host = domain.replace(/^\.+/, '');
            if (host !== '')
                cookieUrls.add(`${targetUrl.protocol}//${host}${targetUrl.pathname}`);
        }
        const cookieResults = await Promise.all([...cookieUrls].map((url) => page.getCookies({ url })));
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