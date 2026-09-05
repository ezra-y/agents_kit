/**
 * 任务导入总入口：读文件 → 解析 → 逐行校验 → 幂等写入。
 *
 * 规则文档：`docs/01_产品定义与完整运行流程.md`
 *
 * 坏行不阻断好行：能导的先导进去，坏的连行号带原因一起报出来。
 * 一整份表格因为第 7 行少写一个链接就全部导不进去，是最讨厌的体验。
 */
import { readFileSync } from 'node:fs';
import { parseApplicationQueue } from "./parse-application-queue.js";
import { validateApplicationTaskInput } from "./validate-application-task-input.js";
import { upsertApplicationTasks } from "./upsert-application-tasks.js";
function importError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
export function importApplicationTasks(request) {
    let text;
    try {
        text = readFileSync(request.filePath, 'utf8');
    }
    catch (error) {
        throw importError('task_import_file_unreadable', `${request.filePath}：${error instanceof Error ? error.message : String(error)}`);
    }
    const parsed = parseApplicationQueue({ text, fileName: request.filePath });
    const rejected = parsed.errors.map((error) => ({
        lineNumber: error.lineNumber,
        reasons: [error.reason],
    }));
    const valid = [];
    for (const row of parsed.rows) {
        const result = validateApplicationTaskInput(row, {
            ...(request.source === undefined ? {} : { source: request.source }),
        });
        if (result.ok && result.input !== undefined) {
            valid.push(result.input);
        }
        else {
            rejected.push({ lineNumber: row.lineNumber, reasons: result.errors });
        }
    }
    const totalRows = parsed.rows.length + parsed.errors.length;
    if (totalRows === 0) {
        throw importError('task_import_empty', `${request.filePath} 里没有任何数据行`);
    }
    // dry-run：只报会发生什么，不写库。
    if (request.dryRun === true) {
        return {
            filePath: request.filePath,
            format: parsed.format,
            totalRows,
            inserted: [],
            updated: [],
            unchanged: [],
            rejected,
            dryRun: true,
        };
    }
    const written = upsertApplicationTasks({
        paths: request.paths,
        tasks: valid,
        ...(request.now === undefined ? {} : { now: request.now }),
        ...(request.idFactory === undefined ? {} : { idFactory: request.idFactory }),
    });
    return {
        filePath: request.filePath,
        format: parsed.format,
        totalRows,
        ...written,
        rejected,
        dryRun: false,
    };
}
//# sourceMappingURL=import-application-tasks.js.map