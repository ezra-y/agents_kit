import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const FILE_NAME = '.official-apply-web-state.json';
function snapshotPath(profileDir) {
    return path.join(profileDir, FILE_NAME);
}
function originMatchesDomains(host, domains) {
    const normalized = host.replace(/^\./, '').toLowerCase();
    return domains.some((domain) => {
        const wanted = domain.replace(/^\./, '').toLowerCase();
        return normalized === wanted || normalized.endsWith(`.${wanted}`);
    });
}
function cookieDomainMatchesHosts(cookieDomain, hosts) {
    const domain = cookieDomain.replace(/^\./, '').toLowerCase();
    return hosts.some((host) => {
        const normalized = host.replace(/^\./, '').toLowerCase();
        return normalized === domain || normalized.endsWith(`.${domain}`);
    });
}
function originHost(origin) {
    try {
        return new URL(origin).hostname;
    }
    catch {
        return undefined;
    }
}
function snapshotToStorageState(snapshot) {
    return {
        cookies: snapshot.cookies,
        origins: Object.entries(snapshot.origins).map(([origin, values]) => ({
            origin,
            localStorage: Object.entries(values.localStorage).map(([name, value]) => ({ name, value })),
            ...(values.indexedDB === undefined ? {} : { indexedDB: values.indexedDB }),
        })),
    };
}
function mergeStorageState(base, overlay) {
    const cookies = new Map(base.cookies.map((cookie) => [`${cookie.name}\u0000${cookie.domain}\u0000${cookie.path}`, cookie]));
    for (const cookie of overlay.cookies) {
        cookies.set(`${cookie.name}\u0000${cookie.domain}\u0000${cookie.path}`, cookie);
    }
    const origins = new Map(base.origins.map((origin) => [origin.origin, origin]));
    for (const overlayOrigin of overlay.origins) {
        const current = origins.get(overlayOrigin.origin);
        if (current === undefined) {
            origins.set(overlayOrigin.origin, overlayOrigin);
            continue;
        }
        const localStorage = new Map(current.localStorage.map((item) => [item.name, item.value]));
        for (const item of overlayOrigin.localStorage)
            localStorage.set(item.name, item.value);
        origins.set(overlayOrigin.origin, {
            origin: overlayOrigin.origin,
            localStorage: [...localStorage].map(([name, value]) => ({ name, value })),
            ...(overlayOrigin.indexedDB === undefined
                ? current.indexedDB === undefined ? {} : { indexedDB: current.indexedDB }
                : { indexedDB: overlayOrigin.indexedDB }),
        });
    }
    return { cookies: [...cookies.values()], origins: [...origins.values()] };
}
export function mergePersistentWebState(base, overlay) {
    const merged = mergeStorageState(snapshotToStorageState(base), snapshotToStorageState(overlay));
    const origins = Object.fromEntries(merged.origins.map((origin) => {
        const baseValues = base.origins[origin.origin];
        const overlayValues = overlay.origins[origin.origin];
        const sessionStorage = { ...(baseValues?.sessionStorage ?? {}), ...(overlayValues?.sessionStorage ?? {}) };
        return [origin.origin, {
                localStorage: Object.fromEntries(origin.localStorage.map((item) => [item.name, item.value])),
                sessionStorage,
                ...(origin.indexedDB === undefined ? {} : { indexedDB: origin.indexedDB }),
            }];
    }));
    return {
        version: 2,
        origins,
        cookies: merged.cookies,
        ...(overlay.verifiedLogin === undefined
            ? base.verifiedLogin === undefined ? {} : { verifiedLogin: base.verifiedLogin }
            : { verifiedLogin: overlay.verifiedLogin }),
    };
}
export async function restorePersistentWebStateOnContext(context, snapshot) {
    const current = await context.storageState({ indexedDB: true });
    const merged = mergeStorageState(current, snapshotToStorageState(snapshot));
    const setStorageState = context.setStorageState;
    if (typeof setStorageState !== 'function')
        throw new Error('browser_storage_state_restore_unsupported');
    await setStorageState.call(context, merged);
}
export function replacePersistentWebStateForDomains(base, overlay, domains) {
    const targetHosts = domains.map((domain) => domain.replace(/^\./, '').toLowerCase());
    const retained = {
        version: 2,
        cookies: base.cookies.filter((cookie) => !cookieDomainMatchesHosts(cookie.domain, targetHosts)),
        origins: Object.fromEntries(Object.entries(base.origins).filter(([origin]) => {
            try {
                const host = new URL(origin).hostname.replace(/^\./, '').toLowerCase();
                return !targetHosts.some((target) => host === target || host.endsWith(`.${target}`) || target.endsWith(`.${host}`));
            }
            catch {
                return true;
            }
        })),
        ...(base.verifiedLogin === undefined ? {} : { verifiedLogin: base.verifiedLogin }),
    };
    return mergePersistentWebState(retained, overlay);
}
export async function replacePersistentWebStateOnContextForDomains(context, snapshot, domains) {
    const current = await context.storageState({ indexedDB: true });
    const targetHosts = domains.map((domain) => domain.replace(/^\./, '').toLowerCase());
    const retained = {
        cookies: current.cookies.filter((cookie) => !cookieDomainMatchesHosts(cookie.domain, targetHosts)),
        origins: current.origins.filter((origin) => {
            try {
                const host = new URL(origin.origin).hostname.replace(/^\./, '').toLowerCase();
                return !targetHosts.some((target) => host === target || host.endsWith(`.${target}`) || target.endsWith(`.${host}`));
            }
            catch {
                return true;
            }
        }),
    };
    const setStorageState = context.setStorageState;
    if (typeof setStorageState !== 'function')
        throw new Error('browser_storage_state_restore_unsupported');
    await setStorageState.call(context, mergeStorageState(retained, snapshotToStorageState(snapshot)));
}
export function readPersistentWebState(profileDir) {
    const file = snapshotPath(profileDir);
    if (!existsSync(file)) {
        return { version: 2, origins: {}, cookies: [] };
    }
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (parsed.version === 2 &&
            parsed.origins !== null &&
            typeof parsed.origins === 'object' &&
            !Array.isArray(parsed.origins) &&
            Array.isArray(parsed.cookies)) {
            return {
                version: 2,
                origins: parsed.origins,
                cookies: parsed.cookies,
                ...(parsed.verifiedLogin !== undefined ? { verifiedLogin: parsed.verifiedLogin } : {}),
            };
        }
    }
    catch {
        // 损坏的会话快照不参与恢复；浏览器仍可正常打开并重新登录。
    }
    return { version: 2, origins: {}, cookies: [] };
}
export async function restorePersistentSessionStorage(context, profileDir) {
    const snapshot = readPersistentWebState(profileDir);
    if (snapshot.cookies.length === 0 && Object.keys(snapshot.origins).length === 0)
        return;
    await restorePersistentWebStateOnContext(context, snapshot);
}
/** 在目标页导航前恢复 Cookie、Web Storage 和 IndexedDB。 */
export async function restorePersistentWebStateOnPage(page, snapshot) {
    await restorePersistentWebStateOnContext(page.context(), snapshot);
    await restoreSessionStorageOnPage(page, snapshot);
}
export async function restoreSessionStorageOnPage(page, snapshot) {
    const values = snapshot.origins[new URL(page.url()).origin];
    await page.evaluate((sessionStorageValues) => {
        window.sessionStorage.clear();
        for (const [key, value] of Object.entries(sessionStorageValues)) {
            window.sessionStorage.setItem(key, value);
        }
    }, values?.sessionStorage ?? {});
}
/** 在下一次文档创建前临时注入 sessionStorage；导航完成后调用返回的清理函数。 */
export async function prepareSessionStorageForNavigation(page, snapshot, targetOrigin) {
    const values = Object.fromEntries(Object.entries(snapshot.origins).map(([origin, state]) => [origin, state.sessionStorage]));
    if (targetOrigin !== undefined && values[targetOrigin] === undefined)
        values[targetOrigin] = {};
    if (Object.keys(values).length === 0)
        return async () => undefined;
    const client = await page.context().newCDPSession(page);
    await client.send('Page.enable');
    const source = `(() => {
    const values = ${JSON.stringify(values)}[window.location.origin];
    if (values === undefined) return;
    window.sessionStorage.clear();
    for (const [key, value] of Object.entries(values)) window.sessionStorage.setItem(key, value);
  })();`;
    const result = await client.send('Page.addScriptToEvaluateOnNewDocument', { source });
    return async () => {
        await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: result.identifier }).catch(() => undefined);
        await client.detach().catch(() => undefined);
    };
}
export async function capturePersistentBrowserState(context) {
    return context.storageState({ indexedDB: true });
}
export async function restoreExactPersistentBrowserState(context, state) {
    const setStorageState = context.setStorageState;
    if (typeof setStorageState !== 'function')
        throw new Error('browser_storage_state_restore_unsupported');
    await setStorageState.call(context, state);
}
export async function exportPersistentWebState(context, domains) {
    const allowed = domains?.map((domain) => domain.replace(/^\./, '').toLowerCase());
    const snapshot = { version: 2, origins: {}, cookies: [] };
    const activeHosts = new Set();
    for (const page of context.pages()) {
        let origin;
        try {
            const url = new URL(page.url());
            if (url.protocol !== 'https:' && url.protocol !== 'http:')
                continue;
            if (allowed !== undefined && !originMatchesDomains(url.hostname, allowed))
                continue;
            origin = url.origin;
            activeHosts.add(url.hostname);
        }
        catch {
            continue;
        }
        const values = await page
            .evaluate(() => ({
            localStorage: Object.fromEntries(Object.entries(window.localStorage)),
            sessionStorage: Object.fromEntries(Object.entries(window.sessionStorage)),
        }))
            .catch(() => undefined);
        if (values !== undefined)
            snapshot.origins[origin] = values;
    }
    const state = await context.storageState({ indexedDB: true });
    for (const originState of state.origins ?? []) {
        if (typeof originState.origin !== 'string')
            continue;
        const host = originHost(originState.origin);
        if (host === undefined || (allowed !== undefined ? !originMatchesDomains(host, allowed) : !activeHosts.has(host)))
            continue;
        const current = snapshot.origins[originState.origin] ?? { localStorage: {}, sessionStorage: {} };
        if (Array.isArray(originState.indexedDB) && originState.indexedDB.length > 0) {
            current.indexedDB = originState.indexedDB;
        }
        snapshot.origins[originState.origin] = current;
    }
    const cookieHosts = allowed === undefined ? [...activeHosts] : [...new Set([...activeHosts, ...allowed])];
    snapshot.cookies = (await context.cookies()).filter((cookie) => cookieDomainMatchesHosts(cookie.domain, cookieHosts));
    return snapshot;
}
export function writePersistentWebState(profileDir, snapshot, verifiedLogin) {
    const next = verifiedLogin === undefined ? snapshot : { ...snapshot, verifiedLogin };
    mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    writeFileSync(snapshotPath(profileDir), `${JSON.stringify(next, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    });
}
export async function savePersistentSessionStorage(context, profileDir, verifiedLogin) {
    const snapshot = readPersistentWebState(profileDir);
    const exported = await exportPersistentWebState(context);
    const mergedSnapshot = mergePersistentWebState(snapshot, exported);
    if (verifiedLogin !== undefined)
        mergedSnapshot.verifiedLogin = verifiedLogin;
    writePersistentWebState(profileDir, mergedSnapshot);
}
export async function savePersistentSessionStorageForDomains(context, profileDir, domains, verifiedLogin) {
    const previous = readPersistentWebState(profileDir);
    const exported = await exportPersistentWebState(context, domains);
    const snapshot = replacePersistentWebStateForDomains(previous, exported, domains);
    if (verifiedLogin !== undefined)
        snapshot.verifiedLogin = verifiedLogin;
    writePersistentWebState(profileDir, snapshot);
}
//# sourceMappingURL=persist-session-storage.js.map