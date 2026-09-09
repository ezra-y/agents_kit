import { chmodSync, mkdirSync, readFileSync, writeFileSync, } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
import { redactResumeValue } from "../site-adapters/write-scope.js";
function planPath(paths, runId) {
    return path.join(paths.runsDir, runId, 'write-plan.json');
}
function checkedPath(paths, reference) {
    const resolved = path.isAbsolute(reference)
        ? path.resolve(reference)
        : path.resolve(paths.root, reference);
    if (!isInsideLocalRoot(paths, resolved)) {
        throw new Error(`page_script_write_plan_outside_local: ${reference}`);
    }
    return resolved;
}
export function persistPageScriptWritePlan(input) {
    if (input.prepared.writePlan === undefined) {
        throw new Error('page_script_write_plan_missing: PageScript 没有生成写入计划');
    }
    const file = planPath(input.paths, input.runId);
    if (!isInsideLocalRoot(input.paths, file)) {
        throw new Error(`page_script_write_plan_outside_local: ${file}`);
    }
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const resolved = Object.fromEntries(Object.entries(input.prepared.resolved)
        .flatMap(([key, value]) => {
        const sanitized = redactResumeValue(value);
        return sanitized === undefined ? [] : [[key, sanitized]];
    }));
    const stored = {
        schemaVersion: 1,
        sourceRunId: input.runId,
        taskId: input.taskId,
        siteHost: input.siteHost,
        pageScriptId: input.pageScriptId,
        capturedAt: input.now,
        prepared: {
            resolved,
            missing: input.prepared.missing,
            conflicts: input.prepared.conflicts,
            skipped: input.prepared.skipped,
            writePlan: input.prepared.writePlan,
        },
    };
    writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== 'win32')
        chmodSync(file, 0o600);
    return toRepoRelative(input.paths, file);
}
export function loadPageScriptWritePlan(input) {
    const file = checkedPath(input.paths, input.reference);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (raw.schemaVersion !== 1 || raw.taskId !== input.taskId ||
        raw.siteHost !== input.siteHost ||
        raw.pageScriptId !== input.pageScriptId || raw.prepared === undefined ||
        raw.prepared.writePlan === undefined) {
        throw new Error('page_script_write_plan_mismatch: 写入计划与当前 run 或 PageScript 不匹配');
    }
    return raw.prepared;
}
//# sourceMappingURL=page-script-write-plan.js.map