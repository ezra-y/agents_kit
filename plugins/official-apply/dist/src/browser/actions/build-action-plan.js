/**
 * 把已解决的字段转成可批量执行、可验证的动作计划。
 *
 * 规则文档：`docs/06_函数接口与执行循环.md §3.8`、`docs/07 §3`
 *
 * 三条硬规则：
 * 1. **最终提交不进动作计划。** 提交是阶段 12 的独立动作（`docs/13 D16`）。
 * 2. **没解决的字段不生成动作**，只进 `unresolvedRuntimeRefs`。
 * 3. 每个动作都带**预期变化**，填完才有东西可校验。
 *
 * 这是纯函数：不碰网页，不碰数据库，便于单独测。
 */
import { randomUUID } from 'node:crypto';
import { buildLocatorCandidates } from "../locators/build-locator-candidates.js";
function defaultIdFactory(prefix) {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
/** 控件类型决定用哪个执行器（`docs/06 §3.8` 的内部调度表）。 */
export function actionKindFor(controlKind, value) {
    switch (controlKind) {
        case 'file_upload':
            return 'upload_file';
        case 'native_select':
        case 'combobox':
        case 'cascading_select':
        case 'radio_group':
            return 'select_option';
        case 'checkbox':
        case 'checkbox_group':
            return value === false ? 'uncheck' : 'check';
        case 'action_button':
            return 'click';
        default:
            return 'fill_text';
    }
}
/** 敏感字段要在计划里标出来，提交前人工复核时能一眼看到。 */
function isSensitive(canonicalKey) {
    if (canonicalKey === undefined) {
        return false;
    }
    return /id_number|identity\.id|credential|password|bank|salary|compensation/.test(canonicalKey);
}
function expectedChangesFor(kind, runtimeRef) {
    switch (kind) {
        case 'upload_file':
            return [{ kind: 'field_value_changed', target: runtimeRef }, { kind: 'network_response' }];
        case 'select_option':
        case 'check':
        case 'uncheck':
            return [{ kind: 'field_value_changed', target: runtimeRef }];
        default:
            return [{ kind: 'field_value_changed', target: runtimeRef }];
    }
}
export function buildActionPlan(request) {
    const newId = request.idFactory ?? defaultIdFactory;
    const now = request.now ?? new Date().toISOString();
    const fieldByRef = new Map(request.pageSchema.fields.map((field) => [field.runtimeRef, field]));
    const items = [];
    for (const answer of request.resolved) {
        const field = fieldByRef.get(answer.runtimeRef);
        if (field === undefined) {
            continue;
        }
        // 按钮不由填写计划驱动；最终提交更不属于这里。
        if (field.controlKind === 'action_button') {
            continue;
        }
        if (field.disabled || field.readonly) {
            continue;
        }
        const kind = actionKindFor(field.controlKind, answer.formattedValue);
        const materialId = request.materialAssignments?.[answer.runtimeRef];
        items.push({
            id: newId('action'),
            runtimeRef: answer.runtimeRef,
            canonicalKey: answer.canonicalKey,
            actionKind: kind,
            ...(kind === 'upload_file' ? {} : { value: answer.formattedValue }),
            ...(materialId === undefined ? {} : { materialId }),
            locatorCandidates: buildLocatorCandidates({ field }),
            expectedChanges: expectedChangesFor(kind, answer.runtimeRef),
            sensitive: isSensitive(answer.canonicalKey),
        });
    }
    return {
        id: newId('plan'),
        runId: request.runId,
        snapshotId: request.snapshotId,
        items,
        unresolvedRuntimeRefs: request.unresolvedRuntimeRefs ?? [],
        createdAt: now,
    };
}
//# sourceMappingURL=build-action-plan.js.map