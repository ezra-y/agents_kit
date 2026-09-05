/**
 * 解析投递队列文件：CSV / JSON / JSONL。
 *
 * 规则文档：`docs/01_产品定义与完整运行流程.md`
 *
 * 这一层只做「把文件变成一行行字典」，**不做任何业务判断**。
 * 值合不合法交给 `validateApplicationTaskInput()`。
 *
 * 每一行都带真实行号。用户拿到报错要能直接跳到那一行去改。
 */
import path from 'node:path';
/**
 * 列名归一。
 *
 * 用户的表格里列名五花八门，这里统一成内部名。
 * 归一只做「大小写、下划线、常见中文表头」，不做猜测式模糊匹配——
 * 猜错了会把一列数据填到另一列去。
 */
const COLUMN_ALIASES = {
    company: 'companyName',
    companyname: 'companyName',
    company_name: 'companyName',
    公司: 'companyName',
    公司名称: 'companyName',
    batchid: 'batchId',
    batch_id: 'batchId',
    批次: 'batchId',
    taskkind: 'taskKind',
    task_kind: 'taskKind',
    任务类型: 'taskKind',
    job: 'jobTitle',
    jobtitle: 'jobTitle',
    job_title: 'jobTitle',
    岗位: 'jobTitle',
    职位: 'jobTitle',
    岗位名称: 'jobTitle',
    joblocation: 'jobLocation',
    job_location: 'jobLocation',
    location: 'jobLocation',
    city: 'jobLocation',
    工作地点: 'jobLocation',
    城市: 'jobLocation',
    url: 'jobUrl',
    joburl: 'jobUrl',
    job_url: 'jobUrl',
    link: 'jobUrl',
    链接: 'jobUrl',
    投递链接: 'jobUrl',
    申请链接: 'jobUrl',
    jobselectionsource: 'jobSelectionSource',
    job_selection_source: 'jobSelectionSource',
    岗位来源: 'jobSelectionSource',
    jobselectionevidence: 'jobSelectionEvidence',
    job_selection_evidence: 'jobSelectionEvidence',
    岗位来源证据: 'jobSelectionEvidence',
    execute: 'execute',
    是否投递: 'execute',
    投递: 'execute',
    mode: 'mode',
    模式: 'mode',
    companykey: 'companyKey',
    company_key: 'companyKey',
    jobkey: 'jobKey',
    job_key: 'jobKey',
    externalrowid: 'externalRowId',
    external_row_id: 'externalRowId',
    行号: 'externalRowId',
    id: 'externalRowId',
    resume: 'resumeMaterialId',
    resumematerialid: 'resumeMaterialId',
    resume_material_id: 'resumeMaterialId',
    简历: 'resumeMaterialId',
    attachments: 'additionalMaterialIds',
    additional_material_ids: 'additionalMaterialIds',
    附件: 'additionalMaterialIds',
    profile: 'profileRecordIds',
    profilerecordids: 'profileRecordIds',
    profile_record_ids: 'profileRecordIds',
    履历记录: 'profileRecordIds',
    answersetid: 'answerSetId',
    answer_set_id: 'answerSetId',
};
export function normalizeColumnName(raw) {
    const trimmed = raw.trim().replace(/^\uFEFF/, '');
    const lowered = trimmed.toLowerCase().replace(/\s+/g, '');
    return COLUMN_ALIASES[lowered] ?? COLUMN_ALIASES[trimmed] ?? trimmed;
}
/**
 * 最小 CSV 解析器。
 *
 * 支持双引号包裹、字段内逗号、字段内换行和 `""` 转义。
 * 不引第三方依赖：这点语法自己写四十行就够，而且行号能控制得更准。
 */
export function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let index = 0;
    const pushField = () => {
        row.push(field);
        field = '';
    };
    const pushRow = () => {
        pushField();
        rows.push(row);
        row = [];
    };
    while (index < text.length) {
        const char = text[index] ?? '';
        if (inQuotes) {
            if (char === '"') {
                if (text[index + 1] === '"') {
                    field += '"';
                    index += 2;
                    continue;
                }
                inQuotes = false;
                index += 1;
                continue;
            }
            field += char;
            index += 1;
            continue;
        }
        if (char === '"') {
            inQuotes = true;
            index += 1;
            continue;
        }
        if (char === ',') {
            pushField();
            index += 1;
            continue;
        }
        if (char === '\r') {
            index += 1;
            continue;
        }
        if (char === '\n') {
            pushRow();
            index += 1;
            continue;
        }
        field += char;
        index += 1;
    }
    // 文件末尾没换行时，最后一行也要收进来。
    if (field !== '' || row.length > 0) {
        pushRow();
    }
    return rows;
}
function detectFormat(input) {
    if (input.format !== undefined) {
        return input.format;
    }
    const ext = path.extname(input.fileName ?? '').toLowerCase();
    if (ext === '.json') {
        return 'json';
    }
    if (ext === '.jsonl' || ext === '.ndjson') {
        return 'jsonl';
    }
    if (ext === '.csv') {
        return 'csv';
    }
    // 没有扩展名就看内容第一个非空字符。
    const head = input.text.trimStart()[0];
    return head === '[' || head === '{' ? 'json' : 'csv';
}
/** JSON 值转成字符串。数组用逗号连接，便于和 CSV 走同一条校验路径。 */
function stringifyValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (Array.isArray(value)) {
        return value.map((item) => String(item)).join(',');
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}
function objectToRow(raw, lineNumber) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: '这一行不是一个对象' };
    }
    const values = {};
    for (const [key, value] of Object.entries(raw)) {
        values[normalizeColumnName(key)] = stringifyValue(value);
    }
    return { lineNumber, values };
}
export function parseApplicationQueue(input) {
    const format = detectFormat(input);
    const rows = [];
    const errors = [];
    if (format === 'csv') {
        const table = parseCsv(input.text).filter((line) => !(line.length === 1 && (line[0] ?? '').trim() === ''));
        const header = table[0];
        if (header === undefined) {
            return { rows, errors, format };
        }
        const columns = header.map(normalizeColumnName);
        for (let index = 1; index < table.length; index += 1) {
            const line = table[index] ?? [];
            // 行号 = 表头占 1 行 + 当前是第几条数据。
            const lineNumber = index + 1;
            if (line.length > columns.length) {
                errors.push({
                    lineNumber,
                    reason: `这一行有 ${line.length} 列，表头只有 ${columns.length} 列`,
                });
                continue;
            }
            const values = {};
            for (let column = 0; column < columns.length; column += 1) {
                values[columns[column] ?? `col${column}`] = (line[column] ?? '').trim();
            }
            rows.push({ lineNumber, values });
        }
        return { rows, errors, format };
    }
    if (format === 'jsonl') {
        const lines = input.text.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            const text = (lines[index] ?? '').trim();
            if (text === '') {
                continue;
            }
            const lineNumber = index + 1;
            try {
                const parsed = objectToRow(JSON.parse(text), lineNumber);
                if ('error' in parsed) {
                    errors.push({ lineNumber, reason: parsed.error });
                }
                else {
                    rows.push(parsed);
                }
            }
            catch (error) {
                errors.push({
                    lineNumber,
                    reason: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }
        return { rows, errors, format };
    }
    // format === 'json'
    let parsed;
    try {
        parsed = JSON.parse(input.text);
    }
    catch (error) {
        errors.push({
            lineNumber: 1,
            reason: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
        });
        return { rows, errors, format };
    }
    // 支持裸数组，也支持 { "tasks": [...] }。
    const list = Array.isArray(parsed)
        ? parsed
        : parsed.tasks;
    if (!Array.isArray(list)) {
        errors.push({ lineNumber: 1, reason: '顶层要么是数组，要么是 { "tasks": [...] }' });
        return { rows, errors, format };
    }
    for (let index = 0; index < list.length; index += 1) {
        // JSON 数组没有真实行号，用「第几条」代替，报错里说得清就行。
        const lineNumber = index + 1;
        const row = objectToRow(list[index], lineNumber);
        if ('error' in row) {
            errors.push({ lineNumber, reason: row.error });
        }
        else {
            rows.push(row);
        }
    }
    return { rows, errors, format };
}
//# sourceMappingURL=parse-application-queue.js.map