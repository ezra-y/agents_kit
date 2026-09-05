/**
 * 填完之后**一次性**检查当前页。
 *
 * 规则文档：`docs/06_函数接口与执行循环.md §3.12`、`docs/10 §6`
 *
 * 为什么统一校验：每填一个字段就重扫一次，既慢又会把已填内容读乱。
 * 正确做法是「批量填 → 一次扫 → 只修失败项」。
 *
 * 检查项（`docs/06 §3.12`）：
 * 必填空值、`aria-invalid`、字段附近错误、全局提示、
 * 实际 value/checked/selected、文件状态、新条件字段、未映射字段。
 */
import { randomUUID } from 'node:crypto';
import { inspectPage } from "../scan/inspect-page.js";
import { diffPage } from "../scan/diff-page.js";
import { openRuntimeDatabase } from "../../storage/open-runtime-database.js";
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
function sameValue(actual, expected) {
    if (expected === undefined) {
        return true;
    }
    return String(actual ?? '') === String(expected);
}
export async function validatePage(session, page, request) {
    const now = request.now ?? new Date().toISOString();
    const newId = request.idFactory ?? defaultIdFactory;
    // 只重扫一次。所有检查都基于这一份快照。
    const inspection = await inspectPage(session, page, {
        runId: request.runId,
        persist: false,
        now,
    });
    const current = inspection.schema;
    const currentByRef = new Map(current.fields.map((field) => [field.runtimeRef, field]));
    const issues = [];
    // 0. 空页面不能算校验成功。扫描结果为空只说明扫描器没看到任何东西，
    //    不等于页面填完了。必须 fields/uploads/actions 三者全部为空才判定，
    //    只有上传控件或只有可点击动作的页面不受影响。
    if (current.fields.length === 0 && current.uploads.length === 0 && current.actions.length === 0) {
        issues.push({
            severity: 'error',
            code: 'page_scan_empty',
            message: '页面扫描结果为空：没有字段、上传控件或可点击动作。空页面不能视为校验成功',
            evidence: ['扫描器没有在这页上发现任何可操作内容，无法确认填写结果'],
        });
    }
    // 1. 期望字段：值是不是真的写进去了。
    for (const expected of request.expectedFields) {
        const actual = currentByRef.get(expected.runtimeRef);
        if (actual === undefined) {
            issues.push({
                severity: 'warning',
                code: 'unresolved_field',
                message: '填写后这个字段在页面上不见了，可能被页面重绘或条件规则隐藏',
                runtimeRef: expected.runtimeRef,
                ...(expected.canonicalKey === undefined ? {} : { canonicalKey: expected.canonicalKey }),
            });
            continue;
        }
        if (expected.controlKind === 'file_upload') {
            // 文件控件读不到 value，只能看页面有没有给出上传成功的迹象。
            if (expected.required && (actual.currentValue === undefined || actual.currentValue === '')) {
                issues.push({
                    severity: 'error',
                    code: 'upload_missing',
                    message: `必填附件「${actual.rawLabel}」还没有上传成功`,
                    runtimeRef: expected.runtimeRef,
                });
            }
            continue;
        }
        if (!sameValue(actual.currentValue, expected.expectedValue)) {
            issues.push({
                severity: 'error',
                code: 'value_mismatch',
                message: `「${actual.rawLabel}」写入后读回的值与预期不符`,
                runtimeRef: expected.runtimeRef,
                ...(expected.canonicalKey === undefined ? {} : { canonicalKey: expected.canonicalKey }),
                evidence: ['页面上的值与计划值不同；网页可能自动清空或改写了它'],
            });
        }
    }
    // 2. 页面上所有必填字段：不管在不在期望列表里，空着就是问题。
    for (const field of current.fields) {
        if (!field.required || !field.visible || field.disabled) {
            continue;
        }
        if (field.controlKind === 'action_button') {
            continue;
        }
        const empty = field.currentValue === undefined ||
            field.currentValue === '' ||
            (Array.isArray(field.currentValue) && field.currentValue.length === 0);
        if (empty) {
            issues.push({
                severity: 'error',
                code: 'required_missing',
                message: `必填项「${field.rawLabel || field.htmlName || field.runtimeRef}」还是空的`,
                runtimeRef: field.runtimeRef,
            });
        }
    }
    // 3. 网页自己报的错。
    for (const error of current.errors) {
        issues.push({
            severity: error.severity,
            code: 'site_error',
            message: error.text,
            ...(error.fieldRuntimeRef === undefined ? {} : { runtimeRef: error.fieldRuntimeRef }),
            evidence: [`来源：${error.source}`],
        });
    }
    // 4. 新出现的条件字段。它们没被填过，必须让上层知道。
    let newlyVisibleFields = [];
    if (request.previousSchema !== undefined) {
        const diff = diffPage(request.previousSchema, current);
        const addedRefs = new Set(diff.addedFieldRefs);
        newlyVisibleFields = current.fields.filter((field) => addedRefs.has(field.runtimeRef));
        for (const field of newlyVisibleFields) {
            issues.push({
                severity: field.required ? 'error' : 'info',
                code: 'unexpected_new_field',
                message: `新出现字段「${field.rawLabel || field.runtimeRef}」，需要重新解析答案`,
                runtimeRef: field.runtimeRef,
            });
        }
    }
    const blocking = issues.filter((issue) => issue.severity === 'error' || issue.severity === 'blocking');
    const valid = blocking.length === 0;
    const result = {
        id: newId('validation'),
        runId: request.runId,
        snapshotId: request.snapshotId,
        valid,
        // 有阻塞问题就不能进 review；新字段出现时也不能直接说准备好了。
        readyForReview: valid && newlyVisibleFields.length === 0,
        // 是否可提交由阶段 12 决定，这里只给出「校验层面没问题」。
        readyToSubmit: false,
        issues,
        checkedFieldCount: current.fields.length,
        createdAt: now,
        currentSchema: current,
        newlyVisibleFields,
    };
    if (request.paths !== undefined) {
        persistValidation(request.paths, request, result, now);
    }
    return result;
}
function persistValidation(paths, request, result, now) {
    let runtime;
    try {
        runtime = openRuntimeDatabase({ paths });
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith('database_not_migrated')) {
            return;
        }
        throw error;
    }
    try {
        const runExists = runtime.db
            .prepare('SELECT 1 FROM application_runs WHERE id = ?')
            .get(request.runId);
        const snapshotExists = runtime.db
            .prepare('SELECT 1 FROM page_snapshots WHERE id = ?')
            .get(request.snapshotId);
        if (runExists === undefined || snapshotExists === undefined) {
            return;
        }
        runtime.db
            .prepare(`INSERT INTO validation_results
           (id, run_id, page_snapshot_id, valid, ready_for_review, ready_to_submit,
            checked_field_count, issues_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(result.id, request.runId, request.snapshotId, result.valid ? 1 : 0, result.readyForReview ? 1 : 0, result.readyToSubmit ? 1 : 0, result.checkedFieldCount, JSON.stringify(result.issues), now);
    }
    finally {
        runtime.close();
    }
}
/** 从计划和已解析答案推出期望状态，供 `validatePage()` 使用。 */
export function expectedFieldStates(fields, values) {
    return fields
        .filter((field) => field.controlKind !== 'action_button')
        .map((field) => ({
        runtimeRef: field.runtimeRef,
        required: field.required,
        controlKind: field.controlKind,
        ...(values.has(field.runtimeRef) ? { expectedValue: values.get(field.runtimeRef) } : {}),
    }));
}
//# sourceMappingURL=validate-page.js.map