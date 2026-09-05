import { findActionTarget } from "../locators/find-action-target.js";
import { fillTextControl } from "./fill-text-control.js";
import { chooseRadio } from "./choose-radio.js";
import { setCheckbox } from "./set-checkbox.js";
import { selectNativeOption } from "./select-native-option.js";
import { selectCustomOption } from "./select-custom-option.js";
import { fillDateControl } from "./fill-date-control.js";
export async function fillPage(context, request) {
    const fieldByRef = new Map(request.pageSchema.fields.map((field) => [field.runtimeRef, field]));
    const results = [];
    const requiresVisualFallback = [];
    let toolRoundTrips = 0;
    let requiresRescan = false;
    for (const item of request.plan.items) {
        const field = fieldByRef.get(item.runtimeRef);
        if (field === undefined) {
            results.push(failure(item, 'not_found', 'field_missing_in_schema', '当前页面快照里没有这个字段'));
            continue;
        }
        // 上传单独走 uploadFiles()，这里不碰文件。
        if (item.actionKind === 'upload_file') {
            continue;
        }
        if (request.dryRun === true) {
            results.push({
                actionPlanItemId: item.id,
                runtimeRef: item.runtimeRef,
                kind: item.actionKind,
                outcome: 'success',
                locatorAttemptIds: [],
                pageChanged: false,
            });
            continue;
        }
        const frame = frameFor(context.page, field);
        toolRoundTrips += 1;
        const found = await findActionTarget(frame, item.locatorCandidates, {
            runId: request.runId,
            runtimeRef: item.runtimeRef,
            actionKind: item.actionKind,
            ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
            ...(context.stats === undefined ? {} : { stats: context.stats }),
        });
        if (found.target === undefined) {
            // 找不到也要记：失败率同样是有用的信号。
            context.recordAttempts?.({
                attempts: found.attempts,
                actionKind: item.actionKind,
                runtimeRef: item.runtimeRef,
            });
            // 结构化方法够不到，交给阶段 11 的局部视觉兜底，不在这里硬猜。
            requiresVisualFallback.push(item.runtimeRef);
            results.push(failure(item, found.outcome, found.outcome === 'ambiguous' ? 'action_target_ambiguous' : 'action_target_not_found', summarizeAttempts(found.attempts), found.attempts));
            continue;
        }
        const { locator } = found.target;
        const attemptIds = found.attempts.map((attempt) => attempt.id);
        toolRoundTrips += 1;
        // 成功找到目标：把这一轮尝试记下来，下次排序用得上。
        context.recordAttempts?.({
            attempts: found.attempts,
            actionKind: item.actionKind,
            runtimeRef: item.runtimeRef,
        });
        const outcome = await executeFieldAction(item, field, locator, request.timeoutMs, {
            page: context.page,
            pageSchema: request.pageSchema,
            runId: request.runId,
        });
        results.push({
            actionPlanItemId: item.id,
            runtimeRef: item.runtimeRef,
            kind: item.actionKind,
            outcome: outcome.ok ? 'success' : 'failed',
            ...(outcome.beforeValue === undefined ? {} : { beforeValue: outcome.beforeValue }),
            ...(outcome.afterValue === undefined ? {} : { afterValue: outcome.afterValue }),
            locatorAttemptIds: attemptIds,
            pageChanged: outcome.changed,
            ...(outcome.ok ? {} : { errorCode: 'action_failed', errorMessage: outcome.reason ?? '' }),
        });
        if (outcome.changed && mayChangePageStructure(item)) {
            // 这类动作常常会插入或隐藏字段，本批次到此为止，交给上层重扫。
            requiresRescan = true;
            break;
        }
    }
    const succeeded = results.filter((result) => result.outcome === 'success');
    return {
        results,
        succeeded,
        failed: results.filter((result) => result.outcome !== 'success'),
        requiresRescan,
        requiresVisualFallback,
        toolRoundTrips,
    };
}
export async function executeFieldAction(item, field, locator, timeoutMs, custom) {
    const options = timeoutMs === undefined ? {} : { timeoutMs };
    const value = item.value;
    switch (item.actionKind) {
        case 'fill_text': {
            if (field.controlKind === 'date' || field.controlKind === 'month') {
                const result = await fillDateControl(locator, String(value ?? ''), options);
                return { ...result };
            }
            const result = await fillTextControl(locator, String(value ?? ''), options);
            return { ...result };
        }
        case 'select_option': {
            // 三种「选一项」的控件长得像，但操作方式完全不同，按扫描出来的类型分流。
            // 猜错的代价很大：对着 ARIA combobox 调 selectOption 会一直超时。
            if (field.controlKind === 'radio_group') {
                const result = await chooseRadio(locator, String(value ?? ''), options);
                return {
                    ok: result.ok,
                    changed: result.changed,
                    ...(result.selectedValue === undefined ? {} : { afterValue: result.selectedValue }),
                    ...(result.reason === undefined ? {} : { reason: result.reason }),
                };
            }
            if (field.controlKind === 'combobox' || field.controlKind === 'cascading_select') {
                // 自定义下拉：点开 → 找新出现的浮层 → 在浮层里选 → 读回控件显示值。
                // 整套逻辑在 selectCustomOption() 里，这里只转发。
                //
                // 一个必要的翻译：答案存的是官网的**内部值**（`normalizeAnswerValue()`
                // 的规矩），但浮层里的选项是按**显示文字**点的。
                // 不翻译就会拿着 `product` 去找一个写着「产品」的选项，
                // 然后报「官网选项里没有 product」——明明有。
                const wanted = String(value ?? '');
                const asLabel = field.options.find((option) => option.rawValue === wanted)?.rawLabel ?? wanted;
                const result = await selectCustomOption(custom.page, {
                    runId: custom.runId,
                    fieldRuntimeRef: item.runtimeRef,
                    requestedLabel: asLabel,
                    pageSchema: custom.pageSchema,
                    ...(timeoutMs === undefined ? {} : { timeoutMs }),
                });
                return {
                    ok: result.result.outcome === 'success',
                    changed: result.result.pageChanged,
                    ...(result.verifiedSelectedValue === undefined
                        ? {}
                        : { afterValue: result.verifiedSelectedValue }),
                    ...(result.result.errorMessage === undefined
                        ? {}
                        : { reason: result.result.errorMessage }),
                };
            }
            const result = await selectNativeOption(locator, String(value ?? ''), options);
            return {
                ok: result.ok,
                changed: result.changed,
                ...(result.selectedValue === undefined ? {} : { afterValue: result.selectedValue }),
                ...(result.reason === undefined ? {} : { reason: result.reason }),
            };
        }
        case 'check':
        case 'uncheck': {
            const desired = item.actionKind === 'check';
            const result = await setCheckbox(locator, desired, options);
            return {
                ok: result.ok,
                changed: result.changed,
                ...(result.finalState === undefined ? {} : { afterValue: String(result.finalState) }),
                ...(result.reason === undefined ? {} : { reason: result.reason }),
            };
        }
        default:
            return { ok: false, changed: false, reason: `fillPage 不处理 ${item.actionKind}` };
    }
}
/** 单选和下拉常常触发条件字段，本批次做完就该重扫。 */
function mayChangePageStructure(item) {
    return item.actionKind === 'select_option' || item.actionKind === 'check' || item.actionKind === 'uncheck';
}
function frameFor(page, field) {
    if (field.frame.path.length === 0) {
        return page.mainFrame();
    }
    const name = field.frame.path[field.frame.path.length - 1];
    return page.frames().find((frame) => frame.name() === name) ?? page.mainFrame();
}
function failure(item, outcome, errorCode, errorMessage, attempts = []) {
    return {
        actionPlanItemId: item.id,
        runtimeRef: item.runtimeRef,
        kind: item.actionKind,
        outcome,
        locatorAttemptIds: attempts.map((attempt) => attempt.id),
        pageChanged: false,
        errorCode,
        errorMessage,
    };
}
function summarizeAttempts(attempts) {
    if (attempts.length === 0) {
        return '没有可用的定位候选';
    }
    return attempts
        .map((attempt) => `${attempt.strategy}:${attempt.outcome}`)
        .slice(0, 5)
        .join('，');
}
//# sourceMappingURL=fill-page.js.map