import { chmodSync, mkdirSync, writeFileSync, } from 'node:fs';
import path from 'node:path';
import { openResumePage } from "./open-resume-page.js";
import { resolvePageScriptForPage, saveWithPageScript, validateWithPageScript, } from "./page-script-flow.js";
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
import { siteEvidenceDirectory } from "../site-adapters/inventory.js";
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
function markCompanyResumeCompleted(paths, taskId, now = new Date().toISOString()) {
    const runtime = openRuntimeDatabase({ paths });
    try {
        runtime.db
            .prepare(`UPDATE application_tasks
            SET status = 'completed',
                result_note = '公司简历已保存并通过服务器读回',
                updated_at = ?
          WHERE id = ?
            AND task_kind = 'company_resume'
            AND status NOT IN ('submitted', 'submission_uncertain', 'skipped')`)
            .run(now, taskId);
    }
    finally {
        runtime.close();
    }
}
function messageOf(error) {
    return error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error);
}
async function attachEvidencePath(request, result, beforeScreenshot) {
    if (!result.saveDraft.attempted)
        return result;
    const host = new URL(request.page.url()).hostname;
    const evidenceDir = path.join(siteEvidenceDirectory(request.paths, host), 'resume-save', `run-${Date.now()}`);
    if (!isInsideLocalRoot(request.paths, evidenceDir)) {
        throw new Error(`site_evidence_outside_local: ${evidenceDir} 不在 .local 内`);
    }
    mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
    const writePrivate = (filePath, content) => {
        writeFileSync(filePath, content, { mode: 0o600 });
        if (process.platform !== 'win32')
            chmodSync(filePath, 0o600);
    };
    if (beforeScreenshot !== undefined) {
        writePrivate(path.join(evidenceDir, 'before-save.png'), beforeScreenshot);
    }
    const afterScreenshot = await request.page
        .screenshot({ fullPage: true })
        .catch(() => undefined);
    if (afterScreenshot !== undefined) {
        writePrivate(path.join(evidenceDir, 'server-readback.png'), afterScreenshot);
    }
    const evidencePath = toRepoRelative(request.paths, evidenceDir);
    writePrivate(path.join(evidenceDir, 'result.json'), `${JSON.stringify({
        schemaVersion: 1,
        host,
        runId: request.runId,
        pageScriptId: request.script.id,
        capturedAt: new Date().toISOString(),
        evidencePath,
        result,
    }, null, 2)}\n`);
    return { ...result, evidencePath };
}
export async function savePageScriptWithReadback(request) {
    const beforeScreenshot = await request.page
        .screenshot({ fullPage: true })
        .catch(() => undefined);
    const saved = await saveWithPageScript({
        paths: request.paths,
        page: request.page,
        script: request.script,
        taskId: request.taskId,
        profileRecordIds: request.profileRecordIds,
        materialRefs: request.materialRefs,
    });
    if (!saved.saveDraft.attempted) {
        return saved;
    }
    if (!saved.saveDraft.saved) {
        return attachEvidencePath(request, saved, beforeScreenshot);
    }
    try {
        const reopened = await openResumePage({
            session: request.session,
            page: request.page,
            runId: request.runId,
        });
        const resolution = await resolvePageScriptForPage({
            paths: request.paths,
            page: request.page,
            host: new URL(request.page.url()).hostname,
        });
        if (resolution.script === undefined) {
            throw new Error('save_readback_page_script_missing: 服务器简历没有匹配的 PageScript');
        }
        if (resolution.script.id !== request.script.id) {
            throw new Error(`save_readback_page_script_changed: 保存前是 ${request.script.id}，读回时是 ${resolution.script.id}`);
        }
        const readback = await validateWithPageScript({
            paths: request.paths,
            page: request.page,
            script: resolution.script,
            taskId: request.taskId,
            profileRecordIds: request.profileRecordIds,
            materialRefs: request.materialRefs,
        });
        const confirmed = readback.validation.valid;
        const result = await attachEvidencePath(request, {
            preparation: saved.preparation,
            saveDraft: {
                ...saved.saveDraft,
                saved: confirmed,
                message: confirmed
                    ? '保存后重新打开服务器简历，字段读回一致'
                    : `保存后服务器读回有 ${readback.validation.issues.length} 个问题`,
                evidence: [
                    ...saved.saveDraft.evidence,
                    ...(confirmed
                        ? [{
                                kind: 'reload_readback',
                                strength: 'strong',
                                description: '重新打开服务器简历并完成字段读回校验',
                            }]
                        : []),
                ],
            },
            validation: readback.validation,
            serverReadback: {
                resumeUrl: reopened.resumeUrl,
                pageScriptId: resolution.script.id,
                valid: confirmed,
                issueCount: readback.validation.issues.length,
            },
        }, beforeScreenshot);
        if (confirmed)
            markCompanyResumeCompleted(request.paths, request.taskId);
        return result;
    }
    catch (error) {
        const readbackError = messageOf(error);
        return attachEvidencePath(request, {
            preparation: saved.preparation,
            saveDraft: {
                ...saved.saveDraft,
                saved: false,
                message: `保存后的服务器读回失败：${readbackError}`,
            },
            readbackError,
        }, beforeScreenshot);
    }
}
//# sourceMappingURL=save-page-script-with-readback.js.map