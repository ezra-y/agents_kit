/**
 * 直接给 `input[type=file]` 设置本地文件。
 *
 * 规则文档：`docs/06_函数接口与执行循环.md §3.11`、`docs/07 §11`
 *
 * 硬规则：**不打开系统文件选择框。**
 * Playwright 的 `setInputFiles()` 直接把文件交给 input，
 * 既快又不需要操作系统级点击。
 *
 * 只允许上传 `.local/materials/` 里的文件。
 * 网页说要什么文件是一回事，能读哪些文件是另一回事。
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot } from "../../config/paths.js";
import { findActionTarget } from "../locators/find-action-target.js";
import { buildLocatorCandidates } from "../locators/build-locator-candidates.js";
const DEFAULT_TIMEOUT_MS = 15_000;
export async function uploadFiles(page, request) {
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const results = [];
    const rejected = [];
    const fieldByRef = new Map(request.pageSchema.fields.map((field) => [field.runtimeRef, field]));
    const uploadByRef = new Map(request.pageSchema.uploads.map((upload) => [upload.fieldRuntimeRef, upload]));
    for (const assignment of request.assignments) {
        const reject = (reason, message) => {
            rejected.push({ runtimeRef: assignment.runtimeRef, reason, message });
        };
        // 1. 路径必须在 .local/materials 内。
        if (!isInsideLocalRoot(request.paths, assignment.localPath)) {
            reject('FILE_OUTSIDE_LOCAL', `${assignment.localPath} 不在 ${request.paths.localRoot} 内`);
            continue;
        }
        if (!existsSync(assignment.localPath)) {
            reject('FILE_NOT_FOUND', `找不到文件 ${path.basename(assignment.localPath)}`);
            continue;
        }
        const field = fieldByRef.get(assignment.runtimeRef);
        if (field === undefined) {
            reject('UPLOAD_CONTROL_NOT_FOUND', '当前页面快照里没有这个上传控件');
            continue;
        }
        // 2. 扩展名和大小按官网要求校验。官网怎么写就怎么算。
        const requirement = uploadByRef.get(assignment.runtimeRef);
        const extension = path.extname(assignment.localPath).toLowerCase();
        if (requirement !== undefined &&
            requirement.acceptedExtensions.length > 0 &&
            !requirement.acceptedExtensions.includes(extension)) {
            reject('FILE_TYPE_REJECTED', `官网只接受 ${requirement.acceptedExtensions.join('、')}，当前是 ${extension}`);
            continue;
        }
        const size = statSync(assignment.localPath).size;
        if (requirement?.maxBytes !== undefined && size > requirement.maxBytes) {
            reject('FILE_TOO_LARGE', `文件 ${size} 字节，超过官网上限 ${requirement.maxBytes} 字节`);
            continue;
        }
        // 3. 找到真正的 file input。只有拖拽区域时也要找它背后的 input。
        const found = await findActionTarget(page.mainFrame(), buildLocatorCandidates({ field }), { runId: request.runId, runtimeRef: assignment.runtimeRef, actionKind: 'upload_file', timeoutMs });
        if (found.target === undefined) {
            reject('UPLOAD_CONTROL_NOT_FOUND', '页面上找不到对应的上传控件');
            continue;
        }
        try {
            await found.target.locator.setInputFiles(assignment.localPath, { timeout: timeoutMs });
        }
        catch (error) {
            reject('UPLOAD_NOT_CONFIRMED', error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error));
            continue;
        }
        // 4. 验证：读回 input 里的文件名，不只看有没有报错。
        const uploadedName = await found.target.locator
            .evaluate((element) => element instanceof HTMLInputElement ? (element.files?.[0]?.name ?? '') : '')
            .catch(() => '');
        const expectedName = path.basename(assignment.localPath);
        if (uploadedName !== expectedName) {
            reject('UPLOAD_NOT_CONFIRMED', `读回的文件名是「${uploadedName}」，与预期不符`);
            continue;
        }
        results.push({
            actionPlanItemId: `upload_${assignment.runtimeRef}`,
            runtimeRef: assignment.runtimeRef,
            kind: 'upload_file',
            outcome: 'success',
            afterValue: expectedName,
            locatorAttemptIds: found.attempts.map((attempt) => attempt.id),
            pageChanged: true,
        });
    }
    return { results, rejected };
}
//# sourceMappingURL=upload-files.js.map