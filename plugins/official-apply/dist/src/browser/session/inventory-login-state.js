import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inventoryOpenCliBridge } from "./opencli-bridge-login-state.js";
import { readPersistentWebState } from "./persist-session-storage.js";
const STATE_FILES = [
    'Cookies',
    'Local Storage',
    'IndexedDB',
    'Session Storage',
    'Service Worker',
    'Login Data',
    'Web Data',
    'Preferences',
    'Local State',
    '.official-apply-web-state.json',
];
const RECRUITMENT_WORDS = [
    'apply',
    'campus',
    'career',
    'hire',
    'job',
    'moka',
    'recruit',
    'talent',
    'wecruit',
    'workday',
    'zhiye',
    'zhaopin',
];
function isRecruitmentDomain(host) {
    const value = host.replace(/^\./, '').toLowerCase();
    return RECRUITMENT_WORDS.some((word) => value.includes(word));
}
function domainMatches(host, requested) {
    const value = host.replace(/^\./, '').toLowerCase();
    return requested.some((domain) => {
        const wanted = domain.replace(/^\./, '').toLowerCase();
        return value === wanted || value.endsWith(`.${wanted}`) || wanted.endsWith(`.${value}`);
    });
}
function existingDirectories(root) {
    if (!existsSync(root))
        return [];
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => path.join(root, entry.name));
}
function profileDirectories(root) {
    const profiles = new Map(existingDirectories(root)
        .filter((dir) => path.basename(dir) === 'Default' || /^Profile \d+$/.test(path.basename(dir)))
        .map((dir) => [path.basename(dir), dir]));
    const localState = path.join(root, 'Local State');
    if (existsSync(localState)) {
        try {
            const parsed = JSON.parse(readFileSync(localState, 'utf8'));
            for (const name of Object.keys(parsed.profile?.info_cache ?? {})) {
                const dir = path.join(root, name);
                if (existsSync(dir) && path.basename(dir) === name)
                    profiles.set(name, dir);
            }
        }
        catch {
            // Local State is metadata only; an unreadable file leaves directory discovery intact.
        }
    }
    return [...profiles].map(([name, dir]) => ({ name, dir }));
}
function browserStateFiles(profileDir) {
    return STATE_FILES.filter((name) => existsSync(path.join(profileDir, name)));
}
function cookieHosts(cookiePath, table = 'cookies', column = 'host_key') {
    if (!existsSync(cookiePath))
        return { hosts: [], failed: false };
    try {
        const db = new DatabaseSync(cookiePath, { readOnly: true });
        const rows = db.prepare(`SELECT DISTINCT ${column} AS host FROM ${table}`).all();
        db.close();
        return {
            hosts: rows
                .map((row) => (typeof row.host === 'string' ? row.host.replace(/^\./, '') : ''))
                .filter(Boolean),
            failed: false,
        };
    }
    catch {
        return { hosts: [], failed: true };
    }
}
function snapshotMetadata(profileDir, requestedDomains = []) {
    const stateFiles = browserStateFiles(profileDir);
    const cookiePath = path.join(profileDir, 'Cookies');
    const cookieResult = cookieHosts(cookiePath);
    const domains = new Set(cookieResult.hosts);
    const statePath = path.join(profileDir, '.official-apply-web-state.json');
    let latestVerification;
    if (existsSync(statePath)) {
        try {
            const state = readPersistentWebState(profileDir);
            for (const origin of Object.keys(state.origins)) {
                try {
                    domains.add(new URL(origin).hostname);
                }
                catch {
                    // Ignore malformed origins in a local snapshot.
                }
            }
            latestVerification = state.verifiedLogin?.verifiedAt;
        }
        catch {
            // A broken snapshot remains an unverified profile.
        }
    }
    const recruitmentDomains = [...domains].filter(isRecruitmentDomain).sort();
    const otherDomainCount = [...domains].length - recruitmentDomains.length;
    const status = latestVerification !== undefined
        ? 'verified_metadata'
        : stateFiles.length > 0 || domains.size > 0
            ? 'unverified_state_present'
            : 'no_state';
    return {
        stateFiles,
        recruitmentDomains,
        otherDomainCount,
        matchingDomains: requestedDomains.length === 0 ? [] : [...domains].filter((domain) => domainMatches(domain, requestedDomains)).sort(),
        domainEnumeration: cookieResult.failed ? 'failed' : 'complete',
        status,
        ...(latestVerification === undefined ? {} : { latestVerification }),
    };
}
function systemProfileRoots() {
    const home = os.homedir();
    const support = path.join(home, 'Library', 'Application Support');
    return [
        { browser: 'chrome', root: path.join(support, 'Google', 'Chrome') },
        { browser: 'chrome_for_testing', root: path.join(support, 'Google', 'Chrome for Testing') },
        { browser: 'chrome_for_testing', root: path.join(support, 'Google', 'ChromeForTesting') },
        { browser: 'chrome_headless', root: path.join(support, 'Google', 'Chrome-headless') },
        { browser: 'msedge', root: path.join(support, 'Microsoft Edge') },
        { browser: 'chromium', root: path.join(support, 'Chromium') },
        { browser: 'brave', root: path.join(support, 'BraveSoftware', 'Brave-Browser') },
        { browser: 'vivaldi', root: path.join(support, 'Vivaldi') },
        { browser: 'opera', root: path.join(support, 'com.operasoftware.Opera') },
        { browser: 'ego', root: path.join(support, 'Citro Labs', 'ego lite') },
        { browser: 'codex', root: path.join(support, 'Codex', 'codex-browser-app') },
    ];
}
function firefoxProfiles() {
    const root = path.join(os.homedir(), 'Library', 'Application Support', 'Firefox', 'Profiles');
    const ini = path.join(os.homedir(), 'Library', 'Application Support', 'Firefox', 'profiles.ini');
    if (existsSync(ini)) {
        try {
            const profiles = [];
            let current = {};
            const flush = () => {
                if (current.path === undefined)
                    return;
                const dir = current.relative === '0'
                    ? path.resolve(current.path)
                    : path.resolve(path.dirname(ini), current.path);
                if (existsSync(dir))
                    profiles.push({ name: current.name ?? path.basename(dir), dir });
            };
            for (const line of readFileSync(ini, 'utf8').split(/\r?\n/)) {
                if (line.startsWith('[')) {
                    flush();
                    current = {};
                }
                else if (line.startsWith('Name='))
                    current.name = line.slice(5);
                else if (line.startsWith('Path='))
                    current.path = line.slice(5);
                else if (line.startsWith('IsRelative='))
                    current.relative = line.slice(11);
            }
            flush();
            if (profiles.length > 0)
                return profiles;
        }
        catch {
            // Fall back to the profile directories when Firefox's index is unavailable.
        }
    }
    return existingDirectories(root).map((dir) => ({ name: path.basename(dir), dir }));
}
function firefoxMetadata(profileDir, requestedDomains = []) {
    const stateFiles = ['cookies.sqlite', 'webappsstore.sqlite', 'storage', 'key4.db', 'prefs.js']
        .filter((name) => existsSync(path.join(profileDir, name)));
    const cookieResult = cookieHosts(path.join(profileDir, 'cookies.sqlite'), 'moz_cookies', 'host');
    const domains = cookieResult.hosts;
    const recruitmentDomains = domains.filter(isRecruitmentDomain).sort();
    return {
        stateFiles,
        recruitmentDomains,
        otherDomainCount: domains.length - recruitmentDomains.length,
        matchingDomains: requestedDomains.length === 0 ? [] : domains.filter((domain) => domainMatches(domain, requestedDomains)).sort(),
        domainEnumeration: cookieResult.failed ? 'failed' : 'complete',
        status: stateFiles.length > 0 ? 'unsupported' : 'no_state',
    };
}
export function inventoryLoginState(paths, requestedDomains = []) {
    const entries = [];
    for (const { browser, root } of systemProfileRoots()) {
        const profiles = profileDirectories(root);
        for (const profile of profiles) {
            const metadata = snapshotMetadata(profile.dir, requestedDomains);
            entries.push({ browser, source: 'system_profile', profileName: profile.name, profileDir: profile.dir, ...metadata });
        }
        if (existsSync(root) && profiles.length === 0) {
            const rootStateFiles = browserStateFiles(root);
            if (rootStateFiles.length > 0) {
                const metadata = snapshotMetadata(root);
                entries.push({ browser, source: 'system_profile', profileName: 'default', profileDir: root, ...metadata });
                continue;
            }
            entries.push({
                browser,
                source: 'system_profile',
                profileName: '(no recognized profile)',
                profileDir: root,
                stateFiles: browserStateFiles(root),
                recruitmentDomains: [],
                matchingDomains: [],
                otherDomainCount: 0,
                domainEnumeration: 'unsupported',
                status: 'no_state',
            });
        }
    }
    for (const profile of firefoxProfiles()) {
        const metadata = firefoxMetadata(profile.dir, requestedDomains);
        entries.push({ browser: 'firefox', source: 'system_profile', profileName: profile.name, profileDir: profile.dir, ...metadata });
    }
    const safariRoot = path.join(os.homedir(), 'Library', 'Safari');
    const safariContainerProfiles = path.join(os.homedir(), 'Library', 'Containers', 'com.apple.Safari', 'Data', 'Library', 'Safari', 'Profiles');
    const safariProfiles = existingDirectories(safariContainerProfiles);
    const safariCookies = path.join(os.homedir(), 'Library', 'Containers', 'com.apple.Safari', 'Data', 'Library', 'Cookies', 'Cookies.binarycookies');
    const safariStateFiles = (dir) => [
        ...['LocalStorage', 'Databases', 'Bookmarks.plist'].filter((name) => existsSync(path.join(dir, name))),
        ...(existsSync(safariCookies) ? ['Cookies.binarycookies'] : []),
    ];
    if (existsSync(safariRoot)) {
        const stateFiles = safariStateFiles(safariRoot);
        entries.push({ browser: 'safari', source: 'system_profile', profileName: 'default', profileDir: safariRoot, stateFiles, recruitmentDomains: [], matchingDomains: [], otherDomainCount: 0, domainEnumeration: 'unsupported', status: stateFiles.length > 0 ? 'unsupported' : 'no_state' });
    }
    for (const profileDir of safariProfiles) {
        const stateFiles = safariStateFiles(profileDir);
        entries.push({ browser: 'safari', source: 'system_profile', profileName: path.basename(profileDir), profileDir, stateFiles, recruitmentDomains: [], matchingDomains: [], otherDomainCount: 0, domainEnumeration: 'unsupported', status: stateFiles.length > 0 ? 'unsupported' : 'no_state' });
    }
    for (const dir of existingDirectories(paths.browserProfileDir)) {
        const metadata = snapshotMetadata(dir, requestedDomains);
        entries.push({ browser: 'chromium', source: 'project_profile', profileName: path.basename(dir), profileDir: dir, ...metadata });
    }
    return entries.sort((left, right) => `${left.browser}/${left.source}/${left.profileName}`.localeCompare(`${right.browser}/${right.source}/${right.profileName}`));
}
export async function inventoryLoginStateAsync(paths, requestedDomains = []) {
    const entries = inventoryLoginState(paths, requestedDomains);
    const bridge = await inventoryOpenCliBridge();
    entries.push(...bridge.map((profile) => ({
        browser: 'opencli_bridge',
        source: 'bridge_profile',
        profileName: profile.contextId,
        profileDir: '',
        stateFiles: [],
        recruitmentDomains: [],
        matchingDomains: [],
        otherDomainCount: 0,
        domainEnumeration: 'unsupported',
        status: 'unverified_state_present',
    })));
    return entries.sort((left, right) => `${left.browser}/${left.source}/${left.profileName}`.localeCompare(`${right.browser}/${right.source}/${right.profileName}`));
}
//# sourceMappingURL=inventory-login-state.js.map