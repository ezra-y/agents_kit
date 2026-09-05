import { buildCanonicalApplicationPayload } from "./build-canonical-application-payload.js";
import { loadPageScriptCandidates } from "../site-adapters/discovery/save-page-script-candidate.js";
import { PageScriptRegistry, pageScriptRegistry } from "../site-adapters/registry.js";
import { runPageScript } from "../site-adapters/runner.js";
function preparationSummary(prepared) {
    return {
        resolvedKeys: Object.keys(prepared.resolved).sort(),
        missing: prepared.missing,
        conflicts: prepared.conflicts,
        skipped: prepared.skipped,
    };
}
async function prepareContext(context) {
    const built = buildCanonicalApplicationPayload({
        paths: context.paths,
        profileRecordIds: context.profileRecordIds,
        materialIds: context.materialRefs,
        taskId: context.taskId,
    });
    const facts = await context.script.inspect(context.page);
    const prepared = context.script.prepare(built.payload, facts);
    return { built, facts, prepared };
}
export function asPageScript(value) {
    const candidate = value;
    return candidate !== null &&
        typeof candidate === 'object' &&
        typeof candidate.id === 'string' &&
        typeof candidate.match === 'function' &&
        typeof candidate.inspect === 'function' &&
        typeof candidate.fill === 'function' &&
        typeof candidate.validate === 'function'
        ? candidate
        : undefined;
}
export async function resolvePageScriptForPage(request) {
    const registered = await pageScriptRegistry.resolve(request.page);
    if (registered.selected !== undefined) {
        return {
            script: registered.selected,
            match: registered.match,
            source: 'registered',
            checkedScriptIds: registered.checked.map((item) => item.id),
            skipped: registered.errors.map((item) => ({
                scriptId: item.scriptId,
                reason: item.message,
            })),
        };
    }
    const local = loadPageScriptCandidates(request.paths, request.host);
    const localRegistry = new PageScriptRegistry(local.scripts);
    const resolved = await localRegistry.resolve(request.page);
    return {
        ...(resolved.selected === undefined
            ? {}
            : { script: resolved.selected, match: resolved.match }),
        source: resolved.selected === undefined ? 'none' : 'local_candidate',
        checkedScriptIds: [
            ...registered.checked.map((item) => item.id),
            ...resolved.checked.map((item) => item.id),
        ],
        skipped: [
            ...registered.errors.map((item) => ({
                scriptId: item.scriptId,
                reason: item.message,
            })),
            ...local.skipped,
            ...resolved.errors.map((item) => ({
                scriptId: item.scriptId,
                reason: item.message,
            })),
        ],
    };
}
export async function inspectWithPageScript(context) {
    const facts = await context.script.inspect(context.page);
    return {
        adapter: {
            id: context.script.id,
            version: context.script.version,
            status: context.script.status,
            pageKind: context.script.pageKind,
        },
        page: {
            url: facts.url,
            title: facts.title,
            pageKind: facts.pageKind,
            anchors: facts.anchors,
        },
    };
}
export async function resolveWithPageScript(context) {
    const { built, prepared } = await prepareContext(context);
    return {
        adapter: {
            id: context.script.id,
            version: context.script.version,
            status: context.script.status,
        },
        preparation: preparationSummary(prepared),
        missingProfileRecordIds: built.missingProfileRecordIds,
        missingMaterialIds: built.missingMaterialIds,
    };
}
export async function fillWithPageScript(context) {
    const built = buildCanonicalApplicationPayload({
        paths: context.paths,
        profileRecordIds: context.profileRecordIds,
        materialIds: context.materialRefs,
        taskId: context.taskId,
    });
    return runPageScript({
        page: context.page,
        script: context.script,
        input: built.payload,
        saveDraft: false,
    });
}
export async function validateWithPageScript(context) {
    const { prepared } = await prepareContext(context);
    return {
        preparation: preparationSummary(prepared),
        validation: await context.script.validate(context.page, prepared),
    };
}
export async function saveWithPageScript(context) {
    const { prepared } = await prepareContext(context);
    if (context.script.saveDraft === undefined) {
        return {
            preparation: preparationSummary(prepared),
            saveDraft: {
                attempted: false,
                saved: false,
                message: `${context.script.id} 没有保存草稿方法`,
                evidence: [],
                pageChanged: false,
            },
        };
    }
    const saveDraft = await context.script.saveDraft(context.page, prepared);
    const validation = saveDraft.saved
        ? await context.script.validate(context.page, prepared)
        : undefined;
    return {
        preparation: preparationSummary(prepared),
        saveDraft,
        ...(validation === undefined ? {} : { validation }),
    };
}
//# sourceMappingURL=page-script-flow.js.map