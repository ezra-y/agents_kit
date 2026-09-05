import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
import { buildSiteAdapterInventory, saveSiteAdapterInventory, siteEvidenceDirectory, } from "../site-adapters/inventory.js";
function safeSegment(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, '_');
}
export function writeSubmissionEvidence(input) {
    const dir = path.join(siteEvidenceDirectory(input.paths, input.host), 'application-submit', safeSegment(input.taskId), safeSegment(input.runId));
    if (!isInsideLocalRoot(input.paths, dir)) {
        throw new Error(`submission_evidence_outside_local: ${dir}`);
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const writePrivate = (file, content) => {
        writeFileSync(file, content, { mode: 0o600 });
        if (process.platform !== 'win32') {
            chmodSync(file, 0o600);
        }
    };
    if (input.beforeScreenshot !== undefined) {
        writePrivate(path.join(dir, 'before-submit.png'), input.beforeScreenshot);
    }
    if (input.afterScreenshot !== undefined) {
        writePrivate(path.join(dir, 'after-submit.png'), input.afterScreenshot);
    }
    const evidencePath = toRepoRelative(input.paths, dir);
    const resultFile = path.join(dir, 'result.json');
    writePrivate(resultFile, `${JSON.stringify({
        schemaVersion: 1,
        host: input.host,
        taskId: input.taskId,
        runId: input.runId,
        pageScriptId: input.pageScriptId ?? null,
        capturedAt: input.now ?? new Date().toISOString(),
        evidencePath,
        result: input.result,
    }, null, 2)}\n`);
    let inventoryIndexPath;
    try {
        const inventory = buildSiteAdapterInventory({
            paths: input.paths,
            now: input.now,
        });
        inventoryIndexPath = toRepoRelative(input.paths, saveSiteAdapterInventory({ paths: input.paths, inventory }).indexPath);
    }
    catch {
        inventoryIndexPath = undefined;
    }
    return {
        evidencePath,
        resultPath: toRepoRelative(input.paths, resultFile),
        ...(inventoryIndexPath === undefined ? {} : { inventoryIndexPath }),
    };
}
//# sourceMappingURL=write-submission-evidence.js.map