import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot } from "../config/paths.js";
const PRIVATE_FILE_MODE = 0o600;
export function resumeParseDir(paths, parseId) {
    if (!/^resume_[A-Za-z0-9_-]+$/.test(parseId)) {
        throw new Error(`resume_parse_id_invalid: ${parseId}`);
    }
    const directory = path.join(paths.profilesDir, parseId);
    if (!isInsideLocalRoot(paths, directory)) {
        throw new Error(`resume_parse_outside_local: ${directory}`);
    }
    return directory;
}
export function ensureResumeParseDir(paths, parseId) {
    const directory = resumeParseDir(paths, parseId);
    mkdirSync(directory, { recursive: true });
    return directory;
}
export function writePrivateText(filePath, content) {
    writeFileSync(filePath, content, 'utf8');
    if (process.platform !== 'win32') {
        chmodSync(filePath, PRIVATE_FILE_MODE);
    }
}
export function readResumeParseMeta(paths, parseId) {
    const filePath = path.join(resumeParseDir(paths, parseId), 'meta.json');
    if (!existsSync(filePath)) {
        throw new Error(`resume_parse_not_found: ${parseId}`);
    }
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch (error) {
        throw new Error(`resume_parse_meta_invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export function writeResumeParseMeta(paths, parseId, meta) {
    const filePath = path.join(ensureResumeParseDir(paths, parseId), 'meta.json');
    writePrivateText(filePath, `${JSON.stringify(meta, null, 2)}\n`);
}
//# sourceMappingURL=resume-parse-storage.js.map