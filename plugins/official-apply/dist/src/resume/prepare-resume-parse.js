import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { addMaterial } from "../materials/add-material.js";
import { toRepoRelative } from "../config/paths.js";
import { extractResumeText } from "./extract-resume-text.js";
import { ensureResumeParseDir, readResumeParseMeta, writePrivateText, writeResumeParseMeta, } from "./resume-parse-storage.js";
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
function findExistingParse(request, sourceSha256) {
    if (!existsSync(request.paths.profilesDir)) {
        return undefined;
    }
    for (const entry of readdirSync(request.paths.profilesDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('resume_')) {
            continue;
        }
        try {
            const meta = readResumeParseMeta(request.paths, entry.name);
            const sourceTextPath = path.join(request.paths.profilesDir, entry.name, 'source.txt');
            if (meta.sourceSha256 === sourceSha256 &&
                meta.parserVersion === '1' &&
                existsSync(sourceTextPath) &&
                readFileSync(sourceTextPath, 'utf8').trim() !== '') {
                return { meta, sourceTextPath };
            }
        }
        catch {
            // 一个坏目录不应该挡住其他解析记录。
        }
    }
    return undefined;
}
export async function prepareResumeParse(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    // 先提取。没有文本层时不留下一个无法继续的材料记录。
    const extracted = await extractResumeText(request.filePath);
    const material = addMaterial({
        paths: request.paths,
        filePath: request.filePath,
        purpose: 'resume',
        now,
        idFactory: request.idFactory,
    });
    const existing = findExistingParse(request, material.sha256);
    if (existing !== undefined) {
        return {
            parseId: existing.meta.parseId,
            materialId: existing.meta.materialId,
            sourceTextPath: toRepoRelative(request.paths, existing.sourceTextPath),
            sourceSha256: existing.meta.sourceSha256,
            alreadyPrepared: true,
        };
    }
    const parseId = newId('resume');
    const directory = ensureResumeParseDir(request.paths, parseId);
    const sourceTextPath = path.join(directory, 'source.txt');
    writePrivateText(sourceTextPath, extracted.text);
    writeResumeParseMeta(request.paths, parseId, {
        parseId,
        materialId: material.materialId,
        sourceSha256: material.sha256,
        parserVersion: '1',
        firstPassCompleted: false,
        reviewPassCompleted: false,
        warnings: [],
        createdAt: now,
    });
    return {
        parseId,
        materialId: material.materialId,
        sourceTextPath: toRepoRelative(request.paths, sourceTextPath),
        sourceSha256: material.sha256,
        alreadyPrepared: false,
    };
}
//# sourceMappingURL=prepare-resume-parse.js.map