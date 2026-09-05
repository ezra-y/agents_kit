import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync, writeFileSync, } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../../config/paths.js";
import { siteEvidenceDirectory } from "../inventory.js";
/**
 * 把散落在旧临时目录里的证据复制到站点私有目录。
 *
 * 原文件不移动、不删除。目标位于 `.local/evidence/sites/<host>/legacy/`，
 * 所以后续会跟随 evidence 区域一起备份。
 */
export function importLegacySiteEvidence(request) {
    const siteDir = siteEvidenceDirectory(request.paths, request.host);
    const legacyDir = path.join(siteDir, 'legacy');
    if (!isInsideLocalRoot(request.paths, legacyDir)) {
        throw new Error(`site_evidence_outside_local: ${legacyDir} 不在 .local 内`);
    }
    mkdirSync(legacyDir, { recursive: true, mode: 0o700 });
    const imported = [];
    const skipped = [];
    for (const sourcePath of request.sourcePaths) {
        if (!existsSync(sourcePath)) {
            skipped.push({ sourcePath, reason: '源文件不存在' });
            continue;
        }
        const stats = statSync(sourcePath);
        if (!stats.isFile()) {
            skipped.push({ sourcePath, reason: '源路径不是文件' });
            continue;
        }
        const targetPath = path.join(legacyDir, path.basename(sourcePath));
        if (existsSync(targetPath)) {
            skipped.push({ sourcePath, reason: '站点证据目录已有同名文件' });
            continue;
        }
        copyFileSync(sourcePath, targetPath);
        if (process.platform !== 'win32') {
            chmodSync(targetPath, 0o600);
        }
        imported.push({
            sourcePath,
            evidencePath: toRepoRelative(request.paths, targetPath),
            byteSize: stats.size,
        });
    }
    const manifestPath = path.join(legacyDir, 'import.json');
    writeFileSync(manifestPath, `${JSON.stringify({
        schemaVersion: 1,
        host: request.host,
        importedAt: request.importedAt ?? new Date().toISOString(),
        imported,
        skipped,
        originalsPreserved: true,
    }, null, 2)}\n`, { mode: 0o600 });
    return {
        host: request.host,
        imported,
        skipped,
        manifestPath,
    };
}
//# sourceMappingURL=import-legacy-site-evidence.js.map