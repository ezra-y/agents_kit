import { backup, DatabaseSync } from 'node:sqlite';
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync, } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInsideLocalRoot } from "../../config/paths.js";
function migrationError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function defaultUserDataDir(browser) {
    if (process.platform !== 'darwin') {
        throw migrationError('login_state_platform_unsupported', `当前只实现 macOS，实际平台是 ${process.platform}`);
    }
    const appDir = browser === 'msedge' ? 'Microsoft Edge' : 'Google/Chrome';
    return path.join(os.homedir(), 'Library', 'Application Support', appDir);
}
function normalizeDomain(raw) {
    const value = raw.trim().toLowerCase().replace(/^\.+/, '');
    if (value === '' ||
        value.includes('/') ||
        value.includes('*') ||
        !/^[a-z0-9.-]+$/.test(value) ||
        !value.includes('.')) {
        throw migrationError('login_state_domain_invalid', `域名不合法：${raw}`);
    }
    return value;
}
function recommendedChannel(browser) {
    return browser === 'msedge' ? 'msedge' : 'chrome';
}
/**
 * 只迁移指定域名的 Cookie。
 *
 * 不复制历史、密码、书签、缓存、Local Storage 或 IndexedDB。Cookie 值保持浏览器
 * 自己的加密形式，代码不解密、不回显。
 */
export async function migrateBrowserLoginState(request) {
    const sourceProfileName = request.sourceProfileName ?? 'Default';
    const domains = [...new Set(request.domains.map(normalizeDomain))].sort();
    if (domains.length === 0) {
        throw migrationError('login_state_domains_missing', '至少提供一个 Cookie 域名');
    }
    const sourceRoot = request.sourceUserDataDir ?? defaultUserDataDir(request.sourceBrowser);
    const sourceCookies = path.join(sourceRoot, sourceProfileName, 'Cookies');
    if (!existsSync(sourceCookies)) {
        throw migrationError('login_state_source_missing', `${sourceProfileName}/Cookies 不存在`);
    }
    const targetProfileDir = path.join(request.paths.browserProfileDir, request.targetProfileName);
    if (!isInsideLocalRoot(request.paths, targetProfileDir)) {
        throw migrationError('login_state_target_outside_local', `${targetProfileDir} 不在 ${request.paths.localRoot} 内`);
    }
    if (existsSync(path.join(targetProfileDir, 'SingletonLock'))) {
        throw migrationError('login_state_target_in_use', `目标 profile ${request.targetProfileName} 正在使用`);
    }
    const targetDefaultDir = path.join(targetProfileDir, 'Default');
    const targetCookies = path.join(targetDefaultDir, 'Cookies');
    const migratingCookies = path.join(targetDefaultDir, 'Cookies.migrating');
    const previousCookies = path.join(targetDefaultDir, 'Cookies.previous');
    mkdirSync(targetDefaultDir, { recursive: true, mode: 0o700 });
    rmSync(migratingCookies, { force: true });
    const sourceDb = new DatabaseSync(sourceCookies, { readOnly: true });
    try {
        await backup(sourceDb, migratingCookies);
    }
    finally {
        sourceDb.close();
    }
    const migratedDb = new DatabaseSync(migratingCookies);
    let cookieCount = 0;
    let cookieHosts = [];
    try {
        const clauses = domains.map(() => '(host_key = ? OR host_key = ?)').join(' OR ');
        const params = domains.flatMap((domain) => [domain, `.${domain}`]);
        migratedDb.prepare(`DELETE FROM cookies WHERE NOT (${clauses})`).run(...params);
        cookieCount = Number(migratedDb.prepare('SELECT COUNT(*) AS count FROM cookies').get().count);
        cookieHosts = migratedDb
            .prepare('SELECT DISTINCT host_key FROM cookies ORDER BY host_key')
            .all().map((row) => row.host_key);
    }
    finally {
        migratedDb.close();
    }
    let previousCookiesPreserved = false;
    if (existsSync(targetCookies)) {
        copyFileSync(targetCookies, previousCookies);
        previousCookiesPreserved = true;
    }
    renameSync(migratingCookies, targetCookies);
    if (process.platform !== 'win32') {
        chmodSync(targetProfileDir, 0o700);
        chmodSync(targetDefaultDir, 0o700);
        chmodSync(targetCookies, 0o600);
        if (previousCookiesPreserved) {
            chmodSync(previousCookies, 0o600);
        }
    }
    const migratedAt = request.now ?? new Date().toISOString();
    writeFileSync(path.join(targetProfileDir, '.official-apply-login-state.json'), `${JSON.stringify({
        version: 1,
        sourceBrowser: request.sourceBrowser,
        sourceProfileName,
        targetProfileName: request.targetProfileName,
        domains,
        cookieCount,
        cookieHosts,
        previousCookiesPreserved,
        migratedAt,
    }, null, 2)}\n`, { mode: 0o600 });
    return {
        sourceBrowser: request.sourceBrowser,
        sourceProfileName,
        targetProfileName: request.targetProfileName,
        targetProfileDir,
        domains,
        cookieCount,
        cookieHosts,
        previousCookiesPreserved,
        recommendedChannel: recommendedChannel(request.sourceBrowser),
        migratedAt,
    };
}
//# sourceMappingURL=migrate-login-state.js.map