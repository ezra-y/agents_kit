import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { importProfile } from "../materials/import-profile.js";
import { openPrivateDatabase } from "../storage/open-private-database.js";
import { toRepoRelative } from "../config/paths.js";
import { renderProfileMarkdown } from "./render-profile-markdown.js";
import { readResumeParseMeta, resumeParseDir, writePrivateText, writeResumeParseMeta, } from "./resume-parse-storage.js";
import { validateResumeProfile } from "./validate-resume-profile.js";
function parseFinalFile(filePath) {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch (error) {
        throw new Error(`resume_final_json_invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed;
        if (record['profile'] !== undefined) {
            const warnings = Array.isArray(record['warnings'])
                ? record['warnings'].filter((item) => typeof item === 'string')
                : [];
            return { profile: record['profile'], warnings };
        }
    }
    return { profile: parsed, warnings: [] };
}
function recordIdsForProfile(paths, filePath) {
    const sourceRefs = JSON.stringify([`profile_import:${filePath}`]);
    const priv = openPrivateDatabase({ paths });
    try {
        return priv.db
            .prepare(`SELECT id FROM profile_records
           WHERE source_refs_json = ? AND active = 1
           ORDER BY created_at ASC, id ASC`)
            .all(sourceRefs).map((row) => row.id);
    }
    finally {
        priv.close();
    }
}
export function finalizeResumeProfile(request) {
    const now = request.now ?? new Date().toISOString();
    const meta = readResumeParseMeta(request.paths, request.parseId);
    const directory = resumeParseDir(request.paths, request.parseId);
    const sourceTextPath = path.join(directory, 'source.txt');
    if (!existsSync(sourceTextPath)) {
        throw new Error(`resume_source_missing: ${request.parseId}`);
    }
    const finalFile = parseFinalFile(request.finalProfileFilePath);
    const validation = validateResumeProfile(finalFile.profile);
    if (!validation.valid || validation.profile === undefined) {
        throw new Error(`resume_profile_invalid: ${JSON.stringify(validation.issues)}`);
    }
    const profileJsonPath = path.join(directory, 'profile.json');
    const profileMarkdownPath = path.join(directory, 'profile.md');
    writePrivateText(profileJsonPath, `${JSON.stringify(validation.profile, null, 2)}\n`);
    writePrivateText(profileMarkdownPath, renderProfileMarkdown(validation.profile));
    const imported = importProfile({
        paths: request.paths,
        filePath: profileJsonPath,
        now,
        idFactory: request.idFactory,
    });
    const importWarnings = imported.rejected.map((rejected) => `${rejected.pointer}: ${rejected.reason}`);
    const warnings = [...finalFile.warnings, ...importWarnings];
    writeResumeParseMeta(request.paths, request.parseId, {
        ...meta,
        firstPassCompleted: true,
        reviewPassCompleted: true,
        warnings,
    });
    return {
        parseId: request.parseId,
        profileJsonPath: toRepoRelative(request.paths, profileJsonPath),
        profileMarkdownPath: toRepoRelative(request.paths, profileMarkdownPath),
        materialId: meta.materialId,
        profileRecordIds: imported.profileRecordIds,
        warnings,
    };
}
export function showResumeParse(paths, parseId) {
    const meta = readResumeParseMeta(paths, parseId);
    const directory = resumeParseDir(paths, parseId);
    const sourceTextPath = path.join(directory, 'source.txt');
    const profileJsonPath = path.join(directory, 'profile.json');
    const profileMarkdownPath = path.join(directory, 'profile.md');
    return {
        parseId,
        status: meta.reviewPassCompleted ? 'finalized' : 'prepared',
        materialId: meta.materialId,
        sourceTextPath: toRepoRelative(paths, sourceTextPath),
        ...(existsSync(profileJsonPath)
            ? { profileJsonPath: toRepoRelative(paths, profileJsonPath) }
            : {}),
        ...(existsSync(profileMarkdownPath)
            ? { profileMarkdownPath: toRepoRelative(paths, profileMarkdownPath) }
            : {}),
        profileRecordIds: existsSync(profileJsonPath)
            ? recordIdsForProfile(paths, profileJsonPath)
            : [],
        warnings: meta.warnings,
    };
}
//# sourceMappingURL=finalize-resume-profile.js.map