import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
import { pageScriptRegistry } from "./registry.js";
function parsePublicUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return undefined;
        }
        return { host: url.hostname, pathname: url.pathname };
    }
    catch {
        return undefined;
    }
}
function updateLastObserved(entry, observedAt) {
    if (observedAt === undefined) {
        return;
    }
    if (entry.lastObservedAt === undefined || observedAt > entry.lastObservedAt) {
        entry.lastObservedAt = observedAt;
    }
}
function entryFor(entries, host) {
    const existing = entries.get(host);
    if (existing !== undefined) {
        return existing;
    }
    const created = {
        host,
        statuses: new Set(),
        paths: new Set(),
        pageKinds: new Set(),
        pageScriptIds: new Set(),
        blockers: new Set(),
        evidence: [],
    };
    entries.set(host, created);
    return created;
}
function addUrlEvidence(entries, rawUrl, evidence, status) {
    const parsed = parsePublicUrl(rawUrl);
    if (parsed === undefined) {
        return;
    }
    const entry = entryFor(entries, parsed.host);
    entry.paths.add(parsed.pathname);
    entry.statuses.add(status);
    entry.evidence.push(evidence);
    if (evidence.errorCode !== undefined) {
        entry.blockers.add(evidence.errorCode);
    }
    updateLastObserved(entry, evidence.observedAt);
}
function collectTasksAndRuns(paths, entries) {
    const runtime = openRuntimeDatabase({ paths });
    try {
        const tasks = runtime.db
            .prepare(`SELECT id, job_url, status, updated_at
           FROM application_tasks
          ORDER BY updated_at, id`)
            .all();
        for (const task of tasks) {
            addUrlEvidence(entries, task.job_url, {
                kind: 'task',
                reference: task.id,
                status: task.status,
                observedAt: task.updated_at,
            }, 'observed');
        }
        const runs = runtime.db
            .prepare(`SELECT r.id, t.job_url, r.state, r.error_code, r.updated_at
           FROM application_runs r
           JOIN application_tasks t ON t.id = r.task_id
          ORDER BY r.updated_at, r.id`)
            .all();
        for (const run of runs) {
            addUrlEvidence(entries, run.job_url, {
                kind: 'run',
                reference: toRepoRelative(paths, path.join(paths.runsDir, run.id)),
                status: run.state,
                ...(run.error_code === null ? {} : { errorCode: run.error_code }),
                observedAt: run.updated_at,
            }, run.state === 'failed_recoverable' || run.state === 'failed_terminal'
                ? 'blocked'
                : 'observed');
        }
    }
    finally {
        runtime.close();
    }
}
function urlsInScript(source) {
    const urls = new Set();
    for (const match of source.matchAll(/https?:\/\/[^\s"'`<>]+/g)) {
        const raw = match[0].replace(/[),;\]}]+$/, '');
        if (parsePublicUrl(raw) !== undefined) {
            urls.add(raw);
        }
    }
    return [...urls];
}
function collectTemporaryScripts(paths, entries) {
    if (!existsSync(paths.tmpDir)) {
        return;
    }
    for (const name of readdirSync(paths.tmpDir).sort()) {
        if (!name.endsWith('.mjs') && !name.endsWith('.ts')) {
            continue;
        }
        const fullPath = path.join(paths.tmpDir, name);
        let source;
        try {
            source = readFileSync(fullPath, 'utf8');
        }
        catch {
            continue;
        }
        for (const rawUrl of urlsInScript(source)) {
            addUrlEvidence(entries, rawUrl, {
                kind: 'playwright_script',
                reference: toRepoRelative(paths, fullPath),
                status: 'legacy_evidence',
            }, 'candidate');
        }
    }
}
function collectRegisteredScripts(registry, entries) {
    for (const script of registry.list()) {
        const entry = entryFor(entries, script.host);
        entry.statuses.add(script.status);
        entry.pageKinds.add(script.pageKind);
        entry.pageScriptIds.add(script.id);
        entry.evidence.push({
            kind: 'page_script',
            reference: script.id,
            status: script.status,
            ...(script.lastVerifiedAt === undefined ? {} : { observedAt: script.lastVerifiedAt }),
        });
        updateLastObserved(entry, script.lastVerifiedAt);
    }
}
function finalStatus(statuses) {
    for (const status of ['stable', 'verified', 'candidate', 'blocked', 'observed']) {
        if (statuses.has(status)) {
            return status;
        }
    }
    return 'deprecated';
}
function isLocalHost(host) {
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function finalize(entry) {
    return {
        host: entry.host,
        status: finalStatus(entry.statuses),
        paths: [...entry.paths].sort(),
        pageKinds: [...entry.pageKinds].sort(),
        pageScriptIds: [...entry.pageScriptIds].sort(),
        blockers: [...entry.blockers].sort(),
        evidence: entry.evidence.sort((left, right) => {
            const byKind = left.kind.localeCompare(right.kind);
            return byKind === 0 ? left.reference.localeCompare(right.reference) : byKind;
        }),
        ...(entry.lastObservedAt === undefined ? {} : { lastObservedAt: entry.lastObservedAt }),
    };
}
export function buildSiteAdapterInventory(request) {
    const entries = new Map();
    collectTasksAndRuns(request.paths, entries);
    collectTemporaryScripts(request.paths, entries);
    collectRegisteredScripts(request.registry ?? pageScriptRegistry, entries);
    return {
        schemaVersion: 1,
        generatedAt: request.now ?? new Date().toISOString(),
        entries: [...entries.values()]
            .filter((entry) => request.includeLocalHosts === true || !isLocalHost(entry.host))
            .map(finalize)
            .sort((left, right) => left.host.localeCompare(right.host)),
    };
}
function siteDirectoryName(host) {
    return host.toLowerCase().replace(/[^a-z0-9.-]/g, '_');
}
export function siteEvidenceDirectory(paths, host) {
    return path.join(paths.evidenceDir, 'sites', siteDirectoryName(host));
}
export function saveSiteAdapterInventory(request) {
    const sitesRoot = path.join(request.paths.evidenceDir, 'sites');
    if (!isInsideLocalRoot(request.paths, sitesRoot)) {
        throw new Error(`adapter_inventory_outside_local: ${sitesRoot} 不在 .local 内`);
    }
    mkdirSync(sitesRoot, { recursive: true, mode: 0o700 });
    const sitePaths = [];
    for (const entry of request.inventory.entries) {
        const siteDir = siteEvidenceDirectory(request.paths, entry.host);
        if (!isInsideLocalRoot(request.paths, siteDir)) {
            throw new Error(`adapter_inventory_outside_local: ${siteDir} 不在 .local 内`);
        }
        mkdirSync(siteDir, { recursive: true, mode: 0o700 });
        const sitePath = path.join(siteDir, 'index.json');
        writeFileSync(sitePath, `${JSON.stringify({
            schemaVersion: request.inventory.schemaVersion,
            generatedAt: request.inventory.generatedAt,
            ...entry,
        }, null, 2)}\n`, { mode: 0o600 });
        sitePaths.push(sitePath);
    }
    const indexPath = path.join(sitesRoot, 'index.json');
    writeFileSync(indexPath, `${JSON.stringify({
        schemaVersion: request.inventory.schemaVersion,
        generatedAt: request.inventory.generatedAt,
        sites: request.inventory.entries.map((entry) => ({
            host: entry.host,
            status: entry.status,
            indexPath: toRepoRelative(request.paths, path.join(siteEvidenceDirectory(request.paths, entry.host), 'index.json')),
        })),
    }, null, 2)}\n`, { mode: 0o600 });
    return { indexPath, sitePaths };
}
//# sourceMappingURL=inventory.js.map