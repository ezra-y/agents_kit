import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot } from "../config/paths.js";
import { siteEvidenceDirectory } from "../site-adapters/inventory.js";
import { captureResumeReviewPage } from "./capture-resume-review-page.js";
export async function captureResumeReviewEvidence(input) {
    const capture = await captureResumeReviewPage(input.page);
    const evidencePath = path.join(siteEvidenceDirectory(input.paths, new URL(input.page.url()).hostname), 'resume-review', `${input.runId}-${Date.now()}`);
    if (!isInsideLocalRoot(input.paths, evidencePath))
        throw new Error('review_evidence_outside_local');
    mkdirSync(evidencePath, { recursive: true, mode: 0o700 });
    const { screenshot, scrollScreenshots, ...page } = capture;
    const write = (name, value) => writeFileSync(path.join(evidencePath, name), value, { mode: 0o600 });
    if (screenshot !== undefined)
        write('page.png', screenshot);
    scrollScreenshots.forEach((image, index) => write(`scroll-${String(index + 1).padStart(2, '0')}.png`, image));
    write('review-page.json', `${JSON.stringify({
        schemaVersion: 1, taskId: input.taskId, runId: input.runId,
        scope: 'current_page', page,
    }, null, 2)}\n`);
    return {
        evidencePath, capturedAt: capture.capturedAt,
        fieldCount: capture.frames.reduce((total, frame) => total + frame.fields.length, 0),
        screenshotCount: (screenshot === undefined ? 0 : 1) + scrollScreenshots.length,
        errors: capture.errors,
    };
}
//# sourceMappingURL=capture-resume-review-evidence.js.map