import { readdirSync } from 'node:fs';
import path from 'node:path';
import { inventoryOpenCliBridge, } from "./opencli-bridge-login-state.js";
import { readPersistentWebState, } from "./persist-session-storage.js";
export const DEFAULT_BRIDGE_SESSION = 'official-apply-login-reuse';
function normalizeHost(host) {
    return host.replace(/^\./, '').toLowerCase();
}
function cookieDomainApplies(cookieDomain, rawUrl) {
    try {
        const url = new URL(rawUrl);
        const cookie = normalizeHost(cookieDomain);
        const host = normalizeHost(url.hostname);
        return host === cookie || host.endsWith(`.${cookie}`);
    }
    catch {
        return false;
    }
}
function candidateSnapshot(snapshot, targetUrl, domains) {
    const directHosts = new Set(hostList(targetUrl, domains));
    const origins = Object.fromEntries(Object.entries(snapshot.origins).filter(([origin]) => {
        try {
            return directHosts.has(normalizeHost(new URL(origin).hostname));
        }
        catch {
            return false;
        }
    }));
    const cookieHosts = [targetUrl, ...domains.map((domain) => `https://${normalizeHost(domain)}`)];
    return {
        version: 2,
        origins,
        cookies: snapshot.cookies.filter((cookie) => cookieHosts.some((url) => cookieDomainApplies(cookie.domain, url))),
        ...(snapshot.verifiedLogin === undefined ? {} : { verifiedLogin: snapshot.verifiedLogin }),
    };
}
function hostList(targetUrl, domains) {
    return [...new Set([new URL(targetUrl).hostname, ...domains])].map(normalizeHost);
}
function originHosts(snapshot) {
    return Object.keys(snapshot.origins).flatMap((origin) => {
        try {
            return [normalizeHost(new URL(origin).hostname)];
        }
        catch {
            return [];
        }
    });
}
function cookieHosts(snapshot) {
    return snapshot.cookies.map((cookie) => normalizeHost(cookie.domain));
}
function candidateLayer(snapshot, targetUrl, domains) {
    const targets = hostList(targetUrl, domains);
    const direct = (host) => targets.includes(host);
    const parent = (host) => targets.some((target) => target !== host && target.endsWith(`.${host}`));
    if (snapshot.verifiedLogin !== undefined) {
        try {
            const verifiedHost = normalizeHost(new URL(snapshot.verifiedLogin.origin).hostname);
            if (direct(verifiedHost))
                return 'direct';
        }
        catch { /* metadata remains an unverified candidate */ }
    }
    if (originHosts(snapshot).some(direct) || cookieHosts(snapshot).some(direct))
        return 'direct';
    if (originHosts(snapshot).some(parent) || cookieHosts(snapshot).some(parent))
        return 'parent';
    return undefined;
}
function projectCandidates(request, domains) {
    let profiles = [];
    try {
        profiles = readdirSync(request.paths.browserProfileDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(request.paths.browserProfileDir, entry.name));
    }
    catch {
        return [];
    }
    return profiles
        .filter((profileDir) => profileDir !== request.currentProfileDir)
        .map((profileDir) => ({ profileDir, snapshot: readPersistentWebState(profileDir) }))
        .map(({ profileDir, snapshot }) => ({ profileDir, snapshot, layer: candidateLayer(snapshot, request.targetUrl, domains) }))
        .filter(({ layer }) => layer === (request.scope ?? 'direct'))
        .map(({ profileDir, snapshot }) => ({
        source: 'project_profile',
        sourceId: path.basename(profileDir),
        profileDir,
        snapshot: candidateSnapshot(snapshot, request.targetUrl, domains),
        ...(snapshot.verifiedLogin?.accountId === undefined ||
            candidateLayer(snapshot, request.targetUrl, domains) !== 'direct'
            ? {} : { accountId: snapshot.verifiedLogin.accountId }),
        ...(snapshot.verifiedLogin?.verifiedAt === undefined ||
            candidateLayer(snapshot, request.targetUrl, domains) !== 'direct'
            ? {} : { verifiedAt: snapshot.verifiedLogin.verifiedAt }),
    }))
        .filter((candidate) => candidate.snapshot?.cookies.length !== 0 || Object.keys(candidate.snapshot?.origins ?? {}).length !== 0)
        .sort((left, right) => {
        const verifiedRank = Number(right.verifiedAt !== undefined) - Number(left.verifiedAt !== undefined);
        return verifiedRank || String(right.verifiedAt).localeCompare(String(left.verifiedAt));
    });
}
function bridgeCandidates(profiles) {
    return profiles
        .filter((profile) => profile.extensionConnected)
        .map((profile) => ({
        source: 'opencli_bridge',
        sourceId: profile.sourceId ?? `bridge:${profile.contextId}`,
        bridgeSession: DEFAULT_BRIDGE_SESSION,
        bridgeContextId: profile.contextId,
    }));
}
export async function discoverLoginStateCandidates(request) {
    const target = new URL(request.targetUrl);
    const domains = [...new Set([target.hostname, ...(request.domains ?? [])])];
    const project = projectCandidates(request, domains);
    if (request.includeBridge !== true)
        return project;
    const explicitContextId = request.sourceId?.startsWith('bridge:')
        ? request.sourceId.slice('bridge:'.length)
        : undefined;
    const bridge = bridgeCandidates(await inventoryOpenCliBridge(explicitContextId === undefined
        ? { selection: 'default' }
        : { contextId: explicitContextId }));
    return [...project, ...bridge];
}
//# sourceMappingURL=discover-login-state.js.map