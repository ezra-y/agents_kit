/**
 * `applyctl local backup|restore|list`：本机私有数据的备份与恢复。
 *
 * 规则文档：`docs/14 §5`、`docs/10 §11`
 *
 * 这几条命令只在 `.local/` 内部搬文件，不接受 Skill 之外的数据根。
 */
import { backupLocalData } from "../../privacy/backup-local-data.js";
import { restoreLocalData, listBackupIds } from "../../privacy/restore-local-data.js";
import { initializeLocalStorage } from "../../bootstrap/initialize-local-storage.js";
import { ok, readList, readString } from "./shared.js";
export const localCommands = [
    {
        name: 'local backup',
        summary: '把 .local/ 里的数据库、材料和学习产物打包成一次备份。',
        usage: 'applyctl local backup [--label <name>] [--areas db,materials,profiles] [--json]',
        handler(context) {
            initializeLocalStorage({ paths: context.paths });
            const areas = readList(context.args.options, 'areas');
            const label = readString(context.args.options, 'label');
            const result = backupLocalData({
                paths: context.paths,
                now: context.now,
                ...(areas === undefined ? {} : { areas }),
                ...(label === undefined ? {} : { label }),
            });
            return ok(result, `备份完成：${result.backupId}。备份仍在 Skill 内，请另外复制一份到你自己的安全位置。`);
        },
    },
    {
        name: 'local restore',
        summary: '从一次备份恢复 .local/ 数据；默认不覆盖已有文件。',
        usage: 'applyctl local restore [--backup <id>] [--areas db] [--overwrite] [--json]',
        handler(context) {
            const backupId = readString(context.args.options, 'backup');
            const areas = readList(context.args.options, 'areas');
            const overwrite = context.args.options['overwrite'] === true;
            const result = restoreLocalData({
                paths: context.paths,
                conflictPolicy: overwrite ? 'overwrite' : 'skip',
                ...(backupId === undefined ? {} : { backupId }),
                ...(areas === undefined ? {} : { areas }),
            });
            return ok(result, `已从 ${result.backupId} 恢复 ${result.restoredFiles.length} 个文件，跳过 ${result.skippedFiles.length} 个。`);
        },
    },
    {
        name: 'local list',
        summary: '列出所有可用备份。',
        usage: 'applyctl local list [--json]',
        handler(context) {
            const backupIds = listBackupIds(context.paths);
            return ok({ backupIds }, `共 ${backupIds.length} 份备份。`);
        },
    },
];
//# sourceMappingURL=local.js.map