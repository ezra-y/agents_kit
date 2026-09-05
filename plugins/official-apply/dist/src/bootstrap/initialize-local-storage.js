/**
 * 在 Skill 内创建 `.local/` 及其子目录。
 *
 * 规则文档：
 * - `docs/02_系统架构与代码落点.md §3`
 * - `docs/10_状态提交安全隐私与错误恢复.md §12`
 * - `.local/README.md`
 *
 * 这一步只创建目录。三个 SQLite 文件由阶段 2 的 `migrateDatabases()` 创建。
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isInsideLocalRoot, toRepoRelative } from "../config/paths.js";
const LOCAL_DIR_MODE = 0o700;
const MATERIAL_SUBDIRS = ['resumes', 'portfolios', 'transcripts', 'photos', 'other'];
const LOCAL_README = `# \`.local/\`：Skill 内的本机私有区

这个目录由 \`initializeLocalStorage()\` 创建。

除本说明文件外，整个 \`.local/\` 都被根 \`.gitignore\` 忽略。

删除仓库、\`git clean -fdx\` 或 \`git clean -fdX\` 前，先运行 \`applyctl local backup\`。
`;
function bootstrapError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
/** `.local/` 下需要存在的全部目录，顺序即创建顺序。 */
export function localDirectories(paths) {
    return [
        paths.localRoot,
        paths.dbDir,
        paths.materialsDir,
        ...MATERIAL_SUBDIRS.map((name) => path.join(paths.materialsDir, name)),
        paths.profilesDir,
        paths.browserProfileDir,
        paths.runsDir,
        paths.learningDir,
        paths.evidenceDir,
        path.join(paths.evidenceDir, 'sites'),
        paths.rawFixturesDir,
        paths.backupsDir,
        paths.secretsDir,
        paths.tmpDir,
    ];
}
export function initializeLocalStorage(input) {
    const { paths } = input;
    const restrictPermissions = input.restrictPermissions ?? true;
    if (localDirectories(paths).some(dir => !isInsideLocalRoot(paths, dir))) {
        throw bootstrapError('local_root_outside_skill', '私有目录必须位于配置的数据目录内');
    }
    const created = [];
    const existing = [];
    for (const dir of localDirectories(paths)) {
        if (existsSync(dir)) {
            existing.push(toRepoRelative(paths, dir));
        }
        else {
            mkdirSync(dir, { recursive: true });
            created.push(toRepoRelative(paths, dir));
        }
    }
    const readmePath = path.join(paths.localRoot, 'README.md');
    const createdFiles = [];
    if (!existsSync(readmePath)) {
        writeFileSync(readmePath, LOCAL_README, 'utf8');
        createdFiles.push(toRepoRelative(paths, readmePath));
    }
    let permissionsApplied = false;
    if (restrictPermissions && process.platform !== 'win32') {
        for (const dir of localDirectories(paths)) {
            chmodSync(dir, LOCAL_DIR_MODE);
        }
        permissionsApplied = true;
    }
    return {
        localRoot: paths.localRoot,
        createdDirectories: created,
        existingDirectories: existing,
        createdFiles,
        permissionsApplied,
    };
}
//# sourceMappingURL=initialize-local-storage.js.map