/**
 * 列出已登记的材料。
 *
 * 规则文档：修复清单 P0-2
 *
 * 只返回摘要，不返回文件内容，也不返回本机绝对路径。
 * 用户要的是「我登记了哪几份、还在不在」，不是文件本身。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { openPrivateDatabase } from "../storage/open-private-database.js";
import { MATERIAL_PATH_PREFIX } from "./add-material.js";
/** 把可移植路径还原成本机路径。只在进程内用，不往外返回。 */
export function resolveStoredMaterialPath(paths, storedPath) {
    if (storedPath.startsWith(MATERIAL_PATH_PREFIX)) {
        return path.join(paths.materialsDir, storedPath.slice(MATERIAL_PATH_PREFIX.length));
    }
    if (storedPath.startsWith('<skill-root>/')) {
        return path.join(paths.root, storedPath.slice('<skill-root>/'.length));
    }
    return path.isAbsolute(storedPath) ? storedPath : path.join(paths.materialsDir, storedPath);
}
export function listMaterials(request) {
    const priv = openPrivateDatabase({ paths: request.paths });
    try {
        const conditions = [];
        const params = [];
        if (request.includeInactive !== true) {
            conditions.push('active = 1');
        }
        if (request.purpose !== undefined) {
            conditions.push('purpose = ?');
            params.push(request.purpose);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = priv.db
            .prepare(`SELECT id, purpose, display_name, local_path, size_bytes, active, created_at
           FROM material_files ${where} ORDER BY created_at, rowid`)
            .all(...params);
        return rows.map((row) => {
            const stored = String(row['local_path']);
            const absolute = resolveStoredMaterialPath(request.paths, stored);
            return {
                materialId: String(row['id']),
                purpose: String(row['purpose']),
                displayName: String(row['display_name']),
                sizeBytes: Number(row['size_bytes'] ?? 0),
                active: Number(row['active']) === 1,
                createdAt: String(row['created_at']),
                fileExists: absolute !== undefined && existsSync(absolute),
            };
        });
    }
    finally {
        priv.close();
    }
}
//# sourceMappingURL=list-materials.js.map