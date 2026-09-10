import { readdirSync } from 'node:fs';
import path from 'node:path';
import { readPersistentWebState, savePersistentSessionStorage } from "../browser/session/persist-session-storage.js";
import { mokaSharedLogin } from "../browser/login/recruitment-sms-providers.js";
import { readMokaAccountFromDom } from "../browser/login/moka-login-evidence.js";
import { buildCanonicalApplicationPayload } from "./build-canonical-application-payload.js";
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
function expectedContact({ session, runId }) {
    const runtime = openRuntimeDatabase({ paths: session.paths });
    try {
        const run = runtime.db.prepare('SELECT task_id, profile_record_ids_json, state FROM application_runs WHERE id = ?')
            .get(runId);
        if (run === undefined || typeof run.task_id !== 'string' || typeof run.profile_record_ids_json !== 'string')
            return undefined;
        const ids = JSON.parse(run.profile_record_ids_json);
        if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string'))
            return undefined;
        const { payload } = buildCanonicalApplicationPayload({ paths: session.paths, taskId: run.task_id,
            profileRecordIds: ids, materialIds: [] });
        return { phone: payload.basic['person.contact.phone'], email: payload.basic['person.contact.email'], state: run.state };
    }
    finally {
        runtime.close();
    }
}
function matchesAccount(account, expected) {
    return expected !== undefined && ((typeof expected.phone === 'string' && expected.phone !== '' && account.phone === expected.phone) ||
        (typeof expected.email === 'string' && expected.email !== '' && account.email?.toLowerCase() === expected.email.toLowerCase()));
}
function supported(input) {
    return input.session.mode === 'persistent' && input.session.profileDir !== undefined &&
        input.session.context !== undefined && new URL(input.page.url()).hostname === 'app.mokahr.com';
}
export async function rememberMokaLogin(input) {
    if (!supported(input))
        return;
    const account = await input.page.evaluate(readMokaAccountFromDom).catch(() => undefined);
    if (account === undefined || !matchesAccount(account, expectedContact(input)))
        return;
    const { context, profileDir } = input.session;
    if (context === undefined || profileDir === undefined)
        return;
    await savePersistentSessionStorage(context, profileDir, {
        ...account, origin: new URL(input.page.url()).origin, verifiedAt: new Date().toISOString(),
    });
}
export async function reuseMokaLogin(input) {
    if (!supported(input))
        return undefined;
    const { session, page } = input;
    const { context, profileDir } = session;
    if (context === undefined || profileDir === undefined)
        return undefined;
    const activeContext = context;
    const expected = expectedContact(input);
    // 复用需要刷新页面；填写阶段保留尚未保存的内容。
    const states = ['queued', 'opening', 'discovering', 'failed_recoverable'];
    if (expected === undefined || !states.some(state => state === expected.state))
        return undefined;
    const url = page.url(), origin = new URL(url).origin, host = new URL(url).hostname;
    const original = (await context.cookies(url)).filter(cookie => cookie.name === 'connect.sid' && cookie.path === '/');
    const seen = new Set(original.map(cookie => cookie.value));
    const candidates = readdirSync(session.paths.browserProfileDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && path.join(session.paths.browserProfileDir, entry.name) !== profileDir)
        .map(entry => ({ name: entry.name, state: readPersistentWebState(path.join(session.paths.browserProfileDir, entry.name)) }))
        .filter(candidate => candidate.state.verifiedLogin?.origin === origin &&
        typeof candidate.state.verifiedLogin.accountId === 'string' &&
        typeof candidate.state.verifiedLogin.verifiedAt === 'string' &&
        matchesAccount(candidate.state.verifiedLogin, expected))
        .sort((a, b) => String(b.state.verifiedLogin?.verifiedAt).localeCompare(String(a.state.verifiedLogin?.verifiedAt)));
    async function replace(cookies) {
        await activeContext.clearCookies({ name: 'connect.sid', domain: host, path: '/' });
        await activeContext.clearCookies({ name: 'connect.sid', domain: `.${host}`, path: '/' });
        if (cookies.length > 0)
            await activeContext.addCookies(cookies);
    }
    async function reload() {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.reload({ waitUntil: 'domcontentloaded' });
    }
    for (const candidate of candidates) {
        const cookie = candidate.state.cookies.find(item => item.name === 'connect.sid' && item.path === '/' &&
            item.domain.replace(/^\./, '') === host && (item.expires <= 0 || item.expires > Date.now() / 1000));
        if (cookie === undefined || seen.has(cookie.value))
            continue;
        seen.add(cookie.value);
        let accepted = false;
        try {
            await replace([cookie]);
            await reload();
            const login = new URL(page.url()).origin === origin ? await mokaSharedLogin.inspect(page) : undefined;
            const account = login?.stage === 'logged_in'
                ? await page.evaluate(readMokaAccountFromDom).catch(() => undefined)
                : undefined;
            if (account !== undefined && account.accountId === candidate.state.verifiedLogin?.accountId && matchesAccount(account, expected)) {
                await rememberMokaLogin(input);
                accepted = true;
                return candidate.name;
            }
        }
        finally {
            if (!accepted) {
                await replace(original);
                await reload();
            }
        }
    }
    return undefined;
}
//# sourceMappingURL=reuse-moka-login.js.map