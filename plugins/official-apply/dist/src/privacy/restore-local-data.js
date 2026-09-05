/**
 * 从 `.local/backups/` 恢复数据库、材料索引和必要配置。
 *
 * 规则文档：`docs/10_状态提交安全隐私与错误恢复.md §12.5`
 *
 * 恢复只写 `.local/`。默认不覆盖已有文件，避免把用户刚更新的答案盖回旧版本。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot } from "../config/paths.js";
import { areaDirectory } from "./backup-local-data.js";
function bootstrapError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
/** 按目录名倒序列出全部备份；目录名带时间戳，所以字典序即时间序。 */
export function listBackupIds(paths) {
    if (!existsSync(paths.backupsDir)) {
        return [];
    }
    return readdirSync(paths.backupsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('backup-'))
        .map((entry) => entry.name)
        .sort()
        .reverse();
}
function readManifest(backupDir) {
    const manifestPath = path.join(backupDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
        throw bootstrapError('restore_manifest_invalid', `${manifestPath} 不存在`);
    }
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    }
    catch {
        throw bootstrapError('restore_manifest_invalid', `${manifestPath} 不是合法 JSON`);
    }
    const manifest = parsed;
    if (manifest.version !== 1 || !Array.isArray(manifest.entries)) {
        throw bootstrapError('restore_manifest_invalid', `${manifestPath} 缺少 version=1 或 entries`);
    }
    return manifest;
}
function listRelativeFiles(dir) {
    const files = [];
    const walk = (current, prefix) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
            if (entry.isDirectory()) {
                walk(full, relative);
            }
            else if (entry.isFile()) {
                files.push(relative);
            }
        }
    };
    walk(dir, '');
    return files.sort();
}
export function restoreLocalData(input) {
    const { paths } = input;
    const conflictPolicy = input.conflictPolicy ?? 'skip';
    const available = listBackupIds(paths);
    if (available.length === 0) {
        throw bootstrapError('backup_not_found', `${paths.backupsDir} 里没有任何备份`);
    }
    const backupId = input.backupId ?? available[0];
    const backupDir = path.join(paths.backupsDir, backupId);
    if (!existsSync(backupDir) || !statSync(backupDir).isDirectory()) {
        throw bootstrapError('backup_not_found', `备份 ${backupId} 不存在`);
    }
    const manifest = readManifest(backupDir);
    const requested = input.areas;
    const areas = manifest.entries
        .map((entry) => entry.area)
        .filter((area) => requested === undefined || requested.includes(area));
    const restoredFiles = [];
    const skippedFiles = [];
    for (const area of areas) {
        const sourceDir = path.join(backupDir, area);
        if (!existsSync(sourceDir)) {
            continue;
        }
        const targetDir = areaDirectory(paths, area);
        if (!isInsideLocalRoot(paths, targetDir)) {
            throw bootstrapError('restore_target_outside_local', `${targetDir} 不在 ${paths.localRoot} 内`);
        }
        for (const relative of listRelativeFiles(sourceDir)) {
            const source = path.join(sourceDir, relative);
            const target = path.join(targetDir, relative);
            const label = `${area}/${relative}`;
            if (existsSync(target) && conflictPolicy === 'skip') {
                skippedFiles.push(label);
                continue;
            }
            mkdirSync(path.dirname(target), { recursive: true });
            copyFileSync(source, target);
            restoredFiles.push(label);
        }
    }
    return { backupId, backupDir, restoredFiles, skippedFiles };
}
//# sourceMappingURL=restore-local-data.js.map