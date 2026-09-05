/**
 * 把待投递的任务结果写成一份结果文件。
 *
 * 规则文档：`docs/01`、修复清单 P1-12
 *
 * **绝不原地改用户的源文件。**
 *
 * 用户那份 CSV 是他自己维护的：可能还有别的列、别的批注、别的用途。
 * 我们在旁边写一份 `<原文件名>.results.csv`，他自己决定要不要合并。
 *
 * 原地改的话，一旦写坏就找不回来了——而这份文件是他整个秋招的入口。
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openRuntimeDatabase } from "../storage/open-runtime-database.js";
function outboxError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
/** 结果文件的列。顺序固定，方便用户直接看和 diff。 */
const RESULT_COLUMNS = [
    'companyName',
    'jobTitle',
    'jobLocation',
    'jobUrl',
    'status',
    'resultNote',
    'applicationId',
    'nextAction',
    'updatedAt',
];
/** CSV 转义：带逗号、引号或换行的字段要用双引号包起来。 */
export function toCsvCell(value) {
    if (/[",\n\r]/.test(value)) {
        return `"${value.replaceAll('"', '""')}"`;
    }
    return value;
}
export function toCsv(rows) {
    const header = RESULT_COLUMNS.join(',');
    const body = rows.map((row) => RESULT_COLUMNS.map((column) => toCsvCell(row[column] ?? '')).join(','));
    // 带 BOM：Excel 打开中文才不会乱码。
    return `﻿${[header, ...body].join('\n')}\n`;
}
/** 结果文件放在源文件旁边，名字加 `.results.csv`。 */
export function resultFilePathFor(sourceFilePath) {
    const dir = path.dirname(sourceFilePath);
    const base = path.basename(sourceFilePath, path.extname(sourceFilePath));
    return path.join(dir, `${base}.results.csv`);
}
export function deliverTaskUpdateOutbox(request) {
    const now = request.now ?? new Date().toISOString();
    const deliveredIds = [];
    const failed = [];
    // 交付必须有源文件：没有源文件就不写结果文件，队列只能保持 pending。
    // 类型必填之外，运行时也要拒绝 undefined 和空白——不能只靠类型保证。
    if (typeof request.sourceFilePath !== 'string' ||
        request.sourceFilePath.trim() === '') {
        throw outboxError('task_outbox_source_required', '缺少源文件路径；没有源文件不写结果文件，队列保持 pending。');
    }
    const sourceFilePath = request.sourceFilePath;
    if (!existsSync(sourceFilePath)) {
        throw outboxError('task_outbox_source_missing', sourceFilePath);
    }
    const runtime = openRuntimeDatabase({ paths: request.paths });
    let rows;
    try {
        // 每条任务只取最新的一条待投递记录。同一条任务反复回写时，
        // 结果文件里不该出现同一行的多份旧版本。
        rows = runtime.db
            .prepare(`SELECT o.id, o.task_id, o.target_status, o.result_note_redacted, o.payload_json,
                t.company_name, t.job_title, t.job_location, t.job_url, o.updated_at
           FROM task_update_outbox o
           JOIN application_tasks t ON t.id = o.task_id
          WHERE o.delivery_status = 'pending'
          ORDER BY o.created_at, o.rowid`)
            .all();
    }
    finally {
        runtime.close();
    }
    if (rows.length === 0) {
        return { deliveredIds, failed, rowCount: 0 };
    }
    // 同一条任务保留最后一条。
    const latestByTask = new Map();
    for (const row of rows) {
        latestByTask.set(row.task_id, row);
    }
    const csvRows = [...latestByTask.values()].map((row) => {
        let payload = {};
        try {
            payload = JSON.parse(row.payload_json);
        }
        catch {
            payload = {};
        }
        return {
            companyName: row.company_name,
            jobTitle: row.job_title ?? '',
            jobLocation: row.job_location ?? '',
            jobUrl: row.job_url,
            status: row.target_status,
            resultNote: row.result_note_redacted ?? '',
            applicationId: String(payload['applicationIdRedacted'] ?? ''),
            nextAction: String(payload['nextAction'] ?? ''),
            updatedAt: row.updated_at,
        };
    });
    const resultFilePath = resultFilePathFor(sourceFilePath);
    try {
        writeFileSync(resultFilePath, toCsv(csvRows), { encoding: 'utf8', mode: 0o600 });
    }
    catch (error) {
        throw outboxError('task_outbox_write_failed', `${resultFilePath}：${error instanceof Error ? error.message : String(error)}`);
    }
    // 写成功之后才标已投递。写失败时上面已经抛错，这里不会执行到。
    const runtimeWrite = openRuntimeDatabase({ paths: request.paths });
    try {
        const mark = runtimeWrite.db.prepare(`UPDATE task_update_outbox
          SET delivery_status = 'delivered', attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ?`);
        for (const row of rows) {
            mark.run(now, row.id);
            deliveredIds.push(row.id);
        }
    }
    finally {
        runtimeWrite.close();
    }
    return {
        resultFilePath,
        deliveredIds,
        failed,
        rowCount: csvRows.length,
    };
}
//# sourceMappingURL=deliver-task-update-outbox.js.map