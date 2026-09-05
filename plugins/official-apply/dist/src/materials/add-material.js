/**
 * 登记一份材料文件。
 *
 * 规则文档：`docs/03_字段答案与保存模型.md`、修复清单 P0-2
 *
 * 两条硬规则：
 *
 * 1. **文件一定要复制进 `.local/materials/`。** 不能只存一个外部路径——
 *    用户挪一下文件，投递就断了；而且外部路径可能指向 Skill 之外，
 *    上传时会被 `uploadFiles()` 的边界检查挡下来。
 * 2. **同一份文件在同一个用途下只登记一次。** 靠「内容 SHA-256 + 用途」判断，
 *    不看文件名。表格里同一份简历写了三遍，不该变成三条记录；
 *    但同一个 PDF 既当简历又当作品集是合理的，那是两条。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { openPrivateDatabase } from "../storage/open-private-database.js";
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
/** 单份材料上限。真实简历和作品集不会超过这个数。 */
const MAX_MATERIAL_BYTES = 50 * 1024 * 1024;
const VALID_PURPOSES = [
    'resume',
    'portfolio',
    'transcript',
    'photo',
    'certificate',
    'other',
];
/** 每类材料放在自己的子目录下，人翻 `.local/` 的时候看得懂。 */
const PURPOSE_DIRECTORIES = {
    resume: 'resumes',
    portfolio: 'portfolios',
    transcript: 'transcripts',
    photo: 'photos',
    certificate: 'certificates',
    other: 'others',
};
function materialError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
/** 数据库里存的是可移植路径，不是本机绝对路径。 */
export const MATERIAL_PATH_PREFIX = '<skill-root>/.local/materials/';
export function addMaterial(request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    if (!VALID_PURPOSES.includes(request.purpose)) {
        throw materialError('material_purpose_invalid', `purpose 只能是 ${VALID_PURPOSES.join(' / ')}，收到 ${request.purpose}`);
    }
    const source = path.resolve(request.filePath);
    if (!existsSync(source) || !statSync(source).isFile()) {
        throw materialError('material_file_not_found', source);
    }
    const sizeBytes = statSync(source).size;
    if (sizeBytes > MAX_MATERIAL_BYTES) {
        throw materialError('material_file_too_large', `${sizeBytes} 字节超过上限 ${MAX_MATERIAL_BYTES}`);
    }
    const sha256 = createHash('sha256').update(readFileSync(source)).digest('hex');
    const displayName = request.displayName ?? path.basename(source);
    const targetDir = path.join(request.paths.materialsDir, PURPOSE_DIRECTORIES[request.purpose]);
    if (!isInsideLocalRoot(request.paths, targetDir)) {
        throw materialError('material_copy_failed', `${targetDir} 不在 ${request.paths.localRoot} 内`);
    }
    mkdirSync(targetDir, { recursive: true });
    // 文件名带上内容哈希前缀，避免两份同名文件互相覆盖。
    const storedName = `${sha256.slice(0, 12)}-${path.basename(source)}`;
    const storedAbsolute = path.join(targetDir, storedName);
    const storedPortable = `${MATERIAL_PATH_PREFIX}${PURPOSE_DIRECTORIES[request.purpose]}/${storedName}`;
    const priv = openPrivateDatabase({ paths: request.paths });
    try {
        const existing = priv.db
            .prepare('SELECT id, display_name FROM material_files WHERE sha256 = ? AND purpose = ? AND active = 1')
            .get(sha256, request.purpose);
        if (existing !== undefined) {
            // 同一份文件已经登记过。不重复建记录，也不重复复制。
            return {
                materialId: existing.id,
                purpose: request.purpose,
                displayName: existing.display_name,
                storedPathRedacted: toRepoRelative(request.paths, storedAbsolute),
                sizeBytes,
                sha256,
                alreadyRegistered: true,
            };
        }
        if (!existsSync(storedAbsolute)) {
            try {
                copyFileSync(source, storedAbsolute);
            }
            catch (error) {
                throw materialError('material_copy_failed', error instanceof Error ? error.message : String(error));
            }
        }
        const materialId = newId('material');
        priv.db
            .prepare(`INSERT INTO material_files
           (id, purpose, local_path, display_name, mime_type, size_bytes, sha256,
            scope_type, scope_key, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 1, ?, ?)`)
            .run(materialId, request.purpose, storedPortable, displayName, sizeBytes, sha256, request.scope?.type ?? null, request.scope?.key ?? null, now, now);
        return {
            materialId,
            purpose: request.purpose,
            displayName,
            storedPathRedacted: toRepoRelative(request.paths, storedAbsolute),
            sizeBytes,
            sha256,
            alreadyRegistered: false,
        };
    }
    finally {
        priv.close();
    }
}
//# sourceMappingURL=add-material.js.map