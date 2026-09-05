/**
 * `applyctl init`：创建 `.local/` 并迁移三个 SQLite。
 *
 * 规则文档：`docs/12 阶段13`、`docs/02 §4`
 *
 * 只转发给共享核心，自己不建目录、不写 SQL。
 */
import { initializeLocalStorage } from "../../bootstrap/initialize-local-storage.js";
import { migrateDatabases } from "../../storage/migrate-databases.js";
import { ok } from "./shared.js";
export const initCommands = [
    {
        name: 'init',
        summary: '初始化本机存储：创建 .local/ 目录并迁移三个数据库。',
        usage: 'applyctl init [--json]',
        handler(context) {
            const local = initializeLocalStorage({ paths: context.paths });
            const migrated = migrateDatabases({ paths: context.paths });
            return ok({
                skillRoot: context.paths.root,
                localRoot: context.paths.localRoot,
                createdDirectories: local.createdDirectories,
                databases: migrated.results.map((result) => ({
                    name: result.name,
                    filePath: result.filePath,
                    schemaVersion: result.schemaVersion,
                    tableCount: result.tableCount,
                    createdFile: result.createdFile,
                })),
            }, '存储初始化完成。真实数据只会写进 .local/。');
        },
    },
];
//# sourceMappingURL=init.js.map