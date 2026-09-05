function describeFailure(stage, error) {
    const message = error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error);
    const matched = /^([a-z][a-z0-9_]*):\s*/.exec(message);
    return {
        stage,
        code: matched?.[1] ?? `page_script_${stage}_failed`,
        message,
    };
}
function failedResult(request, startedAt, failure, partial) {
    return {
        scriptId: request.script.id,
        scriptVersion: request.script.version,
        pageKind: request.script.pageKind,
        outcome: 'failed',
        ...partial,
        failure,
        durationMs: Date.now() - startedAt,
    };
}
export async function runPageScript(request) {
    const startedAt = Date.now();
    let match;
    try {
        match = request.match ?? (await request.script.match(request.page));
    }
    catch (error) {
        return failedResult(request, startedAt, describeFailure('match', error), {});
    }
    if (!match.matched || !match.allowRun) {
        return {
            scriptId: request.script.id,
            scriptVersion: request.script.version,
            pageKind: request.script.pageKind,
            outcome: 'not_matched',
            match,
            durationMs: Date.now() - startedAt,
        };
    }
    let facts;
    try {
        facts = await request.script.inspect(request.page);
    }
    catch (error) {
        return failedResult(request, startedAt, describeFailure('inspect', error), { match });
    }
    let prepared;
    try {
        prepared = request.script.prepare(request.input, facts);
    }
    catch (error) {
        return failedResult(request, startedAt, describeFailure('prepare', error), {
            match,
            page: { url: facts.url, title: facts.title },
        });
    }
    const preparation = {
        resolvedKeys: Object.keys(prepared.resolved).sort(),
        missing: prepared.missing,
        conflicts: prepared.conflicts,
        skipped: prepared.skipped,
    };
    let fill;
    try {
        fill = await request.script.fill(request.page, prepared);
    }
    catch (error) {
        return failedResult(request, startedAt, describeFailure('fill', error), {
            match,
            page: { url: facts.url, title: facts.title },
            preparation,
        });
    }
    let validation;
    try {
        validation = await request.script.validate(request.page, prepared);
    }
    catch (error) {
        return failedResult(request, startedAt, describeFailure('validate', error), {
            match,
            page: { url: facts.url, title: facts.title },
            preparation,
            fill,
        });
    }
    let saveDraft;
    let postSaveValidation;
    if (request.saveDraft === true) {
        if (request.script.saveDraft === undefined) {
            return failedResult(request, startedAt, {
                stage: 'save_draft',
                code: 'page_script_save_unsupported',
                message: `${request.script.id} 没有保存草稿方法`,
            }, {
                match,
                page: { url: facts.url, title: facts.title },
                preparation,
                fill,
                validation,
            });
        }
        try {
            saveDraft = await request.script.saveDraft(request.page, prepared);
        }
        catch (error) {
            return failedResult(request, startedAt, describeFailure('save_draft', error), {
                match,
                page: { url: facts.url, title: facts.title },
                preparation,
                fill,
                validation,
            });
        }
        if (saveDraft.saved) {
            try {
                postSaveValidation = await request.script.validate(request.page, prepared);
            }
            catch (error) {
                return failedResult(request, startedAt, describeFailure('post_save_validate', error), {
                    match,
                    page: { url: facts.url, title: facts.title },
                    preparation,
                    fill,
                    validation,
                    saveDraft,
                });
            }
        }
    }
    const partial = preparation.missing.length > 0 ||
        preparation.conflicts.length > 0 ||
        fill.failed.length > 0 ||
        !validation.valid ||
        (saveDraft !== undefined && !saveDraft.saved) ||
        (postSaveValidation !== undefined && !postSaveValidation.valid);
    return {
        scriptId: request.script.id,
        scriptVersion: request.script.version,
        pageKind: request.script.pageKind,
        outcome: partial ? 'partial' : 'completed',
        match,
        page: { url: facts.url, title: facts.title },
        preparation,
        fill,
        validation,
        ...(saveDraft === undefined ? {} : { saveDraft }),
        ...(postSaveValidation === undefined ? {} : { postSaveValidation }),
        durationMs: Date.now() - startedAt,
    };
}
//# sourceMappingURL=runner.js.map