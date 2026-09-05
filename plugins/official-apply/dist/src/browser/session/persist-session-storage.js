import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const FILE_NAME = '.official-apply-web-state.json';
function snapshotPath(profileDir) {
    return path.join(profileDir, FILE_NAME);
}
function readSnapshot(profileDir) {
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
            };
        }
    }
    catch {
        // 损坏的会话快照不参与恢复；浏览器仍可正常打开并重新登录。
    }
    return { version: 2, origins: {}, cookies: [] };
}
export async function restorePersistentSessionStorage(context, profileDir) {
    const snapshot = readSnapshot(profileDir);
    if (snapshot.cookies.length > 0) {
        await context.addCookies(snapshot.cookies);
    }
    await context.addInitScript((origins) => {
        const values = origins[window.location.origin];
        if (values === undefined)
            return;
        for (const [key, value] of Object.entries(values.localStorage)) {
            window.localStorage.setItem(key, value);
        }
        for (const [key, value] of Object.entries(values.sessionStorage)) {
            window.sessionStorage.setItem(key, value);
        }
    }, snapshot.origins);
}
export async function savePersistentSessionStorage(context, profileDir) {
    const snapshot = readSnapshot(profileDir);
    const activeHosts = new Set();
    for (const page of context.pages()) {
        let origin;
        try {
            const url = new URL(page.url());
            if (url.protocol !== 'https:' && url.protocol !== 'http:')
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
        if (values === undefined)
            continue;
        if (Object.keys(values.localStorage).length === 0 &&
            Object.keys(values.sessionStorage).length === 0) {
            delete snapshot.origins[origin];
        }
        else {
            snapshot.origins[origin] = values;
        }
    }
    const allCookies = await context.cookies();
    snapshot.cookies = allCookies.filter((cookie) => {
        const domain = cookie.domain.replace(/^\./, '');
        return [...activeHosts].some((host) => host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`));
    });
    writeFileSync(snapshotPath(profileDir), `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
//# sourceMappingURL=persist-session-storage.js.map