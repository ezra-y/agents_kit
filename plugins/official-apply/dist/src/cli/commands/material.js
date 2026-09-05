/**
 * `applyctl material add|list` 和 `applyctl profile import`。
 *
 * 规则文档：修复清单 P0-2
 *
 * 这是材料和履历唯一的正式入口。文件会被复制进 `.local/materials/`，
 * 原文件不动。
 */
import { addMaterial } from "../../materials/add-material.js";
import { listMaterials } from "../../materials/list-materials.js";
import { importProfile } from "../../materials/import-profile.js";
import { describeError, failed, ok, readBoolean, readString, toJson, usageError } from "./shared.js";
export const materialCommands = [
    {
        name: 'material add',
        summary: '登记一份材料（简历、作品集、成绩单、证件照等），文件会复制进 .local/materials/。',
        usage: 'applyctl material add --file <path> --purpose <resume|portfolio|transcript|photo|certificate|other> [--name <显示名>] [--json]',
        requiredOptions: ['file', 'purpose'],
        handler(context) {
            const file = readString(context.args.options, 'file');
            const purpose = readString(context.args.options, 'purpose');
            if (file === undefined || purpose === undefined) {
                return usageError('缺少 --file 或 --purpose。');
            }
            const displayName = readString(context.args.options, 'name');
            try {
                const result = addMaterial({
                    paths: context.paths,
                    filePath: file,
                    purpose: purpose,
                    now: context.now,
                    ...(displayName === undefined ? {} : { displayName }),
                });
                return ok(result, result.alreadyRegistered
                    ? `这份文件已经登记过了，沿用 ${result.materialId}。`
                    : `已登记 ${result.materialId}（${result.displayName}）。`);
            }
            catch (error) {
                return failed('cli_command_failed', describeError(error));
            }
        },
    },
    {
        name: 'material list',
        summary: '列出已登记的材料，并标出文件还在不在。',
        usage: 'applyctl material list [--purpose resume] [--all] [--json]',
        handler(context) {
            const purpose = readString(context.args.options, 'purpose');
            const materials = listMaterials({
                paths: context.paths,
                includeInactive: readBoolean(context.args.options, 'all'),
                ...(purpose === undefined ? {} : { purpose: purpose }),
            });
            const missing = materials.filter((item) => !item.fileExists);
            return ok({ materials: toJson(materials) }, missing.length === 0
                ? `共 ${materials.length} 份材料。`
                : `共 ${materials.length} 份材料，其中 ${missing.length} 份文件已经找不到了。`);
        },
    },
    {
        name: 'profile import',
        summary: '导入 profile.json：教育、实习、项目和基本资料。',
        usage: 'applyctl profile import --file <profile.json> [--json]',
        requiredOptions: ['file'],
        handler(context) {
            const file = readString(context.args.options, 'file');
            if (file === undefined) {
                return usageError('缺少 --file <profile.json>。');
            }
            try {
                const result = importProfile({
                    paths: context.paths,
                    filePath: file,
                    now: context.now,
                });
                const total = result.insertedRecordIds.length + result.updatedRecordIds.length;
                const summary = `导入 ${total} 条履历记录` +
                    `（新增 ${result.insertedRecordIds.length}，更新 ${result.updatedRecordIds.length}）` +
                    `，基本资料 ${result.savedAnswerKeys.length} 项。`;
                return result.rejected.length === 0
                    ? ok(result, summary)
                    : failed('cli_command_failed', `${summary} 有 ${result.rejected.length} 处没读懂。`, result);
            }
            catch (error) {
                return failed('cli_command_failed', describeError(error));
            }
        },
    },
];
//# sourceMappingURL=material.js.map