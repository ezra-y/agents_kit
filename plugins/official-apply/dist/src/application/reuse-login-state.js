import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
import { capturePersistentBrowserState, exportPersistentWebState, restoreExactPersistentBrowserState, replacePersistentWebStateOnContextForDomains, prepareSessionStorageForNavigation, savePersistentSessionStorageForDomains, } from "../browser/session/persist-session-storage.js";
import { exportCookiesFromOpenCliBridge, exportLoginStateFromOpenCliBridge, redactBridgeError, } from "../browser/session/opencli-bridge-login-state.js";
import { discoverLoginStateCandidates, } from "../browser/session/discover-login-state.js";
const REUSABLE_RUN_STATES = ['queued', 'opening', 'discovering', 'failed_recoverable'];
function runState(paths, runId) {
    const runtime = openRuntimeDatabase({ paths });
    try {
        const row = runtime.db.prepare('SELECT state FROM application_runs WHERE id = ?').get(runId);
        return typeof row?.state === 'string' ? row.state : undefined;
    }
    finally {
        runtime.close();
    }
}
function ambiguous(candidates) {
    const project = candidates.filter((candidate) => candidate.source === 'project_profile');
    const bridge = candidates.filter((candidate) => candidate.source === 'opencli_bridge');
    if (bridge.length > 1)
        return bridge.map((candidate) => candidate.sourceId);
    const identities = new Set(project.map((candidate) => candidate.accountId).filter(Boolean));
    if (project.length > 1 && (project.some((candidate) => candidate.accountId === undefined) || identities.size !== 1)) {
        return project.map((candidate) => candidate.sourceId);
    }
    return undefined;
}
async function candidateSnapshot(candidate, context, domains) {
    if (candidate.snapshot !== undefined)
        return candidate.snapshot;
    if (candidate.source !== 'opencli_bridge' || candidate.bridgeSession === undefined || candidate.bridgeContextId === undefined) {
        return undefined;
    }
    return exportCookiesFromOpenCliBridge({
        session: `${candidate.bridgeSession}-${context.runId}`,
        contextId: candidate.bridgeContextId,
        targetUrl: context.targetUrl,
        domains,
    });
}
async function restoreOriginal(context, originalUrl, originalBrowserState, originalSnapshot) {
    await restoreExactPersistentBrowserState(context.session.context, originalBrowserState).catch(() => undefined);
    const removeSessionStorageScript = await prepareSessionStorageForNavigation(context.page, originalSnapshot, new URL(originalUrl).origin).catch(() => async () => undefined);
    try {
        await context.page.goto(originalUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    }
    finally {
        await removeSessionStorageScript();
    }
}
export async function reuseLoginStateOnCurrentPage(input) {
    const state = runState(input.session.paths, input.runId);
    if (state === undefined || !REUSABLE_RUN_STATES.includes(state))
        return { status: 'none', reason: 'run_not_reusable' };
    if (input.session.context === undefined || input.session.profileDir === undefined) {
        return { status: 'none', reason: 'persistent_profile_required' };
    }
    const target = new URL(input.targetUrl);
    const domains = [...new Set([target.hostname, ...(input.domains ?? [])])];
    const discovery = {
        paths: input.session.paths,
        targetUrl: input.targetUrl,
        domains,
        currentProfileDir: input.session.profileDir,
        includeBridge: false,
        sourceId: input.sourceId,
    };
    const originalUrl = input.page.url();
    const originalBrowserState = await capturePersistentBrowserState(input.session.context);
    const originalSnapshot = await exportPersistentWebState(input.session.context, domains);
    async function tryCandidates(candidates) {
        const selected = input.sourceId === undefined
            ? candidates
            : candidates.filter((candidate) => candidate.sourceId === input.sourceId);
        if (input.sourceId !== undefined && selected.length === 0) {
            return { status: 'none', reason: `source_not_found:${input.sourceId}` };
        }
        const sourceIds = ambiguous(selected);
        if (sourceIds !== undefined)
            return { status: 'ambiguous', sourceIds };
        let lastFailure;
        for (const candidate of selected) {
            try {
                let snapshot = await candidateSnapshot(candidate, input, domains);
                let fullExported = false;
                if (snapshot === undefined) {
                    lastFailure = `${candidate.sourceId}:empty_state`;
                    continue;
                }
                if (candidate.source === 'opencli_bridge' &&
                    snapshot.cookies.length === 0 &&
                    Object.keys(snapshot.origins).length === 0 &&
                    candidate.bridgeSession !== undefined &&
                    candidate.bridgeContextId !== undefined) {
                    const full = await exportLoginStateFromOpenCliBridge({
                        session: `${candidate.bridgeSession}-${input.runId}`,
                        contextId: candidate.bridgeContextId,
                        targetUrl: input.targetUrl,
                        domains,
                    });
                    try {
                        snapshot = full.state;
                        fullExported = true;
                    }
                    finally {
                        await full.cleanup();
                    }
                }
                if (snapshot.cookies.length === 0 && Object.keys(snapshot.origins).length === 0) {
                    lastFailure = `${candidate.sourceId}:empty_state`;
                    continue;
                }
                const verifyCandidate = async () => {
                    await replacePersistentWebStateOnContextForDomains(input.session.context, snapshot, domains);
                    const removeSessionStorageScript = await prepareSessionStorageForNavigation(input.page, snapshot, new URL(input.targetUrl).origin);
                    try {
                        await input.page.goto(input.targetUrl, { waitUntil: 'domcontentloaded' });
                        return input.verifyLogin(input.page);
                    }
                    finally {
                        await removeSessionStorageScript();
                    }
                };
                let loginCheck = await verifyCandidate();
                if (loginCheck.status === 'unconfirmed') {
                    lastFailure = `${candidate.sourceId}:login_unconfirmed`;
                    await savePersistentSessionStorageForDomains(input.session.context, input.session.profileDir, domains, null);
                    return {
                        status: 'unconfirmed',
                        sourceId: candidate.sourceId,
                        evidence: loginCheck.evidence,
                        reason: lastFailure,
                    };
                }
                if (loginCheck.status === 'logged_out' && !fullExported && candidate.source === 'opencli_bridge' && candidate.bridgeSession !== undefined && candidate.bridgeContextId !== undefined) {
                    const full = await exportLoginStateFromOpenCliBridge({
                        session: `${candidate.bridgeSession}-${input.runId}`,
                        contextId: candidate.bridgeContextId,
                        targetUrl: input.targetUrl,
                        domains,
                    });
                    try {
                        snapshot = full.state;
                        loginCheck = await verifyCandidate();
                        if (loginCheck.status === 'unconfirmed') {
                            lastFailure = `${candidate.sourceId}:login_unconfirmed`;
                            await savePersistentSessionStorageForDomains(input.session.context, input.session.profileDir, domains, null);
                            return {
                                status: 'unconfirmed',
                                sourceId: candidate.sourceId,
                                evidence: loginCheck.evidence,
                                reason: lastFailure,
                            };
                        }
                    }
                    finally {
                        await full.cleanup();
                    }
                }
                if (loginCheck.status === 'logged_out') {
                    lastFailure = `${candidate.sourceId}:login_unverified:${loginCheck.evidence.join('；')}`;
                    await restoreOriginal(input, originalUrl, originalBrowserState, originalSnapshot);
                    continue;
                }
                await savePersistentSessionStorageForDomains(input.session.context, input.session.profileDir, domains, {
                    origin: new URL(input.page.url()).origin,
                    sourceId: candidate.sourceId,
                    ...(candidate.accountId === undefined ? {} : { accountId: candidate.accountId }),
                    verifiedAt: new Date().toISOString(),
                });
                return {
                    status: 'reused',
                    sourceId: candidate.sourceId,
                    loginCheck,
                };
            }
            catch (error) {
                lastFailure = `${candidate.sourceId}:${redactBridgeError(error)}`;
                await restoreOriginal(input, originalUrl, originalBrowserState, originalSnapshot);
                continue;
            }
        }
        return { status: 'none', ...(lastFailure === undefined ? {} : { reason: lastFailure }) };
    }
    const project = await discoverLoginStateCandidates(discovery);
    const projectResult = await tryCandidates(project);
    if (projectResult.status !== 'none')
        return projectResult;
    if (input.sourceId !== undefined && !input.sourceId.startsWith('bridge:') &&
        project.some((candidate) => candidate.sourceId === input.sourceId))
        return projectResult;
    if (input.sourceId?.startsWith('bridge:') === true) {
        // Continue to the Bridge layer below.
    }
    const bridge = await discoverLoginStateCandidates({ ...discovery, includeBridge: true });
    const bridgeResult = await tryCandidates(bridge.filter((candidate) => candidate.source === 'opencli_bridge'));
    if (bridgeResult.status !== 'none' || input.sourceId?.startsWith('bridge:') === true)
        return bridgeResult;
    const parent = await discoverLoginStateCandidates({ ...discovery, scope: 'parent' });
    const parentResult = await tryCandidates(parent);
    if (parentResult.status !== 'none' || input.sourceId !== undefined)
        return parentResult;
    const reasons = [projectResult.reason, parentResult.reason, bridgeResult.reason].filter(Boolean);
    return { status: 'none', ...(reasons.length === 0 ? {} : { reason: reasons.join(';') }) };
}
//# sourceMappingURL=reuse-login-state.js.map