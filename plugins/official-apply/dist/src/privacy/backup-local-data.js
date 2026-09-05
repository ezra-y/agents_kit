/**
 * 把 `.local/` 中的重要数据备份到 `.local/backups/`。
 *
 * 规则文档：
 * - `docs/10_状态提交安全隐私与错误恢复.md §12.5`
 * - `docs/14_个人使用到开源的渐进成长流程.md §2`
 *
 * 因为 `.local/` 就在 Skill 内，`rm -rf`、`git clean -fdx` 和重新 clone 都会一起删掉它。
 * 备份目标仍然只能落在 `.local/` 内；把私有数据写到公开目录本身就是越界。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot } from "../config/paths.js";
export const DEFAULT_BACKUP_AREAS = [
    'db',
    'materials',
    'profiles',
    'learning',
    'evidence',
    'secrets',
];
function bootstrapError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
/** 区域名到 `.local/` 子目录的唯一映射。业务代码不得自己拼这些路径。 */
export function areaDirectory(paths, area) {
    switch (area) {
        case 'db':
            return paths.dbDir;
        case 'materials':
            return paths.materialsDir;
        case 'profiles':
            return paths.profilesDir;
        case 'learning':
            return paths.learningDir;
        case 'evidence':
            return paths.evidenceDir;
        case 'runs':
            return paths.runsDir;
        case 'fixtures-raw':
            return paths.rawFixturesDir;
        case 'secrets':
            return paths.secretsDir;
        case 'browser-profile':
            return paths.browserProfileDir;
    }
}
/** 递归统计目录里的文件数和总字节数。 */
export function measureDirectory(dir) {
    let fileCount = 0;
    let byteSize = 0;
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            }
            else if (entry.isFile()) {
                fileCount += 1;
                byteSize += statSync(full).size;
            }
        }
    };
    walk(dir);
    return { fileCount, byteSize };
}
function compactTimestamp(iso) {
    return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}
function allocateBackupDir(backupsDir, createdAt) {
    const base = `backup-${compactTimestamp(createdAt)}`;
    let attempt = 1;
    while (true) {
        const backupId = attempt === 1 ? base : `${base}-${attempt}`;
        const backupDir = path.join(backupsDir, backupId);
        if (!existsSync(backupDir)) {
            return { backupId, backupDir };
        }
        attempt += 1;
    }
}
export function backupLocalData(input) {
    const { paths } = input;
    const areas = input.areas ?? DEFAULT_BACKUP_AREAS;
    const createdAt = input.now ?? new Date().toISOString();
    if (!existsSync(paths.localRoot)) {
        throw bootstrapError('backup_source_missing', `${paths.localRoot} 不存在；先运行 initializeLocalStorage()`);
    }
    mkdirSync(paths.backupsDir, { recursive: true });
    const { backupId, backupDir } = allocateBackupDir(paths.backupsDir, createdAt);
    if (!isInsideLocalRoot(paths, backupDir)) {
        throw bootstrapError('backup_target_outside_local', `${backupDir} 不在 ${paths.localRoot} 内`);
    }
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const entries = [];
    const skippedAreas = [];
    for (const area of areas) {
        const source = areaDirectory(paths, area);
        if (!existsSync(source)) {
            skippedAreas.push(area);
            continue;
        }
        const target = path.join(backupDir, area);
        cpSync(source, target, { recursive: true });
        entries.push({ area, ...measureDirectory(source) });
    }
    const manifest = {
        version: 1,
        createdAt,
        ...(input.label === undefined ? {} : { label: input.label }),
        skillRoot: paths.root,
        entries,
    };
    writeFileSync(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    });
    return { backupId, backupDir, manifest, skippedAreas };
}
//# sourceMappingURL=backup-local-data.js.map