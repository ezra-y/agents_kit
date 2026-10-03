import { buildCanonicalApplicationPayload } from "./build-canonical-application-payload.js";
import { loadPageScriptCandidates } from "../site-adapters/discovery/save-page-script-candidate.js";
import { PageScriptRegistry, pageScriptRegistry } from "../site-adapters/registry.js";
import { runPageScript } from "../site-adapters/runner.js";
import { normaliseWriteScope } from "../site-adapters/write-scope.js";
function applyDraftAnswers(payload, draftAnswers) {
    if (draftAnswers === undefined || Object.keys(draftAnswers).length === 0) {
        return payload;
    }
    return {
        ...payload,
        basic: { ...payload.basic, ...draftAnswers },
    };
}
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
    if (context.prepared !== undefined) {
        return { built, facts: undefined, prepared: context.prepared };
    }
    const facts = await context.script.inspect(context.page);
    const prepared = context.script.prepare(applyDraftAnswers(built.payload, context.draftAnswers), facts, normaliseWriteScope(context.writeScope));
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
    const registered = await pageScriptRegistry.resolve(request.page, { mode: 'fill_missing' });
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
    const resolved = await localRegistry.resolve(request.page, { mode: 'fill_missing' });
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
    const result = {
        adapter: {
            id: context.script.id,
            version: context.script.version,
            status: context.script.status,
        },
        source: built,
        draftAnswers: context.draftAnswers ?? {},
        preparation: preparationSummary(prepared),
        writeScope: prepared.writePlan === undefined
            ? null
            : {
                mode: prepared.writePlan.scope.mode,
                fields: prepared.writePlan.availableFields,
                targetPaths: prepared.writePlan.targetPaths,
            },
        missingProfileRecordIds: built.missingProfileRecordIds,
        missingMaterialIds: built.missingMaterialIds,
    };
    return { ...result, prepared };
}
export async function fillWithPageScript(context) {
    const built = buildCanonicalApplicationPayload({
        paths: context.paths,
        profileRecordIds: context.profileRecordIds,
        materialIds: context.materialRefs,
        taskId: context.taskId,
    });
    const writeScope = normaliseWriteScope(context.writeScope);
    if (context.script.supportsWriteScope !== true) {
        return runPageScript({
            page: context.page,
            script: context.script,
            input: applyDraftAnswers(built.payload, context.draftAnswers),
            saveDraft: false,
            writeScope,
        });
    }
    const facts = await context.script.inspect(context.page);
    const prepared = context.prepared ?? context.script.prepare(applyDraftAnswers(built.payload, context.draftAnswers), facts, writeScope);
    const result = await runPageScript({
        page: context.page,
        script: context.script,
        input: applyDraftAnswers(built.payload, context.draftAnswers),
        saveDraft: false,
        writeScope,
        prepared,
    });
    return { ...result, prepared };
}
export async function validateWithPageScript(context) {
    const { prepared } = await prepareContext(context);
    const result = {
        preparation: preparationSummary(prepared),
        validation: await context.script.validate(context.page, prepared),
    };
    return { ...result, prepared };
}
export async function saveWithPageScript(context) {
    const { prepared } = await prepareContext(context);
    if (context.script.saveDraft === undefined) {
        const result = {
            preparation: preparationSummary(prepared),
            saveDraft: {
                attempted: false,
                saved: false,
                message: `${context.script.id} 没有保存草稿方法`,
                evidence: [],
                pageChanged: false,
            },
        };
        return { ...result, prepared };
    }
    const saveDraft = await context.script.saveDraft(context.page, prepared);
    const validation = saveDraft.saved
        ? await context.script.validate(context.page, prepared)
        : undefined;
    const result = {
        preparation: preparationSummary(prepared),
        saveDraft,
        ...(validation === undefined ? {} : { validation }),
    };
    return { ...result, prepared };
}
//# sourceMappingURL=page-script-flow.js.map