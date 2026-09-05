import { captureOverlaySignature, findNewOverlaySelector, scanChangedRegion, } from "../scan/scan-changed-region.js";
import { findActionTarget } from "../locators/find-action-target.js";
import { buildLocatorCandidates } from "../locators/build-locator-candidates.js";
const DEFAULT_TIMEOUT_MS = 8_000;
function failure(request, errorCode, errorMessage) {
    return {
        actionPlanItemId: `custom_${request.fieldRuntimeRef}`,
        runtimeRef: request.fieldRuntimeRef,
        kind: 'select_option',
        outcome: 'failed',
        locatorAttemptIds: [],
        pageChanged: false,
        errorCode,
        errorMessage,
    };
}
/** 从控件上读回当前显示的值。自定义下拉通常把选中项写成文本。 */
async function readControlText(page, locator) {
    void page;
    const value = await locator.inputValue().catch(() => undefined);
    if (value !== undefined && value !== '') {
        return value.trim();
    }
    return (await locator.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}
export async function selectCustomOptionFromLocator(page, input) {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const frame = page.mainFrame();
    const beforeValue = await readControlText(page, input.locator);
    if (beforeValue.includes(input.requestedLabel)) {
        return {
            ok: true,
            changed: false,
            availableOptions: [],
            verifiedSelectedValue: beforeValue,
        };
    }
    const before = await captureOverlaySignature(frame);
    try {
        await input.locator.click({ timeout: timeoutMs });
    }
    catch (error) {
        return {
            ok: false,
            changed: false,
            availableOptions: [],
            reason: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
        };
    }
    const overlaySelector = await findNewOverlaySelector(frame, before);
    if (overlaySelector === null) {
        return {
            ok: false,
            changed: false,
            availableOptions: [],
            reason: '点击后没有出现新的浮层',
        };
    }
    const region = await scanChangedRegion(frame, { rootSelector: overlaySelector });
    const availableOptions = region.optionLabels.map((label) => ({
        rawLabel: label,
        source: 'opened_overlay',
    }));
    const match = region.optionLabels.find((label) => label === input.requestedLabel);
    if (match === undefined) {
        await page.keyboard.press('Escape').catch(() => undefined);
        return {
            ok: false,
            changed: false,
            availableOptions,
            overlaySelector,
            reason: `官网选项里没有「${input.requestedLabel}」，现有：${region.optionLabels.join(' / ')}`,
        };
    }
    const optionLocator = frame
        .locator(overlaySelector)
        .locator('[role=option],option,li')
        .filter({ hasText: match })
        .first();
    try {
        await optionLocator.click({ timeout: timeoutMs });
    }
    catch (error) {
        return {
            ok: false,
            changed: false,
            availableOptions,
            overlaySelector,
            reason: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
        };
    }
    const verified = await readControlText(page, input.locator);
    const ok = verified.includes(input.requestedLabel);
    return {
        ok,
        changed: verified !== beforeValue,
        availableOptions,
        overlaySelector,
        ...(ok ? { verifiedSelectedValue: verified } : {}),
        ...(ok ? {} : { reason: `点击后控件显示的是「${verified}」，与预期不符` }),
    };
}
export async function selectCustomOption(page, request) {
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const frame = page.mainFrame();
    const field = request.pageSchema.fields.find((item) => item.runtimeRef === request.fieldRuntimeRef);
    if (field === undefined) {
        return {
            result: failure(request, 'custom_option_overlay_not_found', '当前快照里没有这个字段'),
            availableOptions: [],
        };
    }
    const found = await findActionTarget(frame, buildLocatorCandidates({ field }), {
        runId: request.runId,
        runtimeRef: request.fieldRuntimeRef,
        actionKind: 'click',
        timeoutMs,
    });
    if (found.target === undefined) {
        return {
            result: failure(request, 'custom_option_overlay_not_found', '找不到这个自定义下拉控件'),
            availableOptions: [],
        };
    }
    const selected = await selectCustomOptionFromLocator(page, {
        locator: found.target.locator,
        requestedLabel: request.requestedLabel,
        timeoutMs,
    });
    return {
        result: {
            actionPlanItemId: `custom_${request.fieldRuntimeRef}`,
            runtimeRef: request.fieldRuntimeRef,
            kind: 'select_option',
            outcome: selected.ok ? 'success' : 'failed',
            ...(selected.verifiedSelectedValue === undefined
                ? {}
                : { afterValue: selected.verifiedSelectedValue }),
            locatorAttemptIds: found.attempts.map((attempt) => attempt.id),
            pageChanged: selected.changed,
            ...(selected.ok
                ? {}
                : {
                    errorCode: 'custom_option_not_available',
                    errorMessage: selected.reason ?? '自定义下拉选择失败',
                }),
        },
        availableOptions: selected.availableOptions,
        ...(selected.verifiedSelectedValue === undefined
            ? {}
            : { verifiedSelectedValue: selected.verifiedSelectedValue }),
        ...(selected.overlaySelector === undefined
            ? {}
            : { overlaySelector: selected.overlaySelector }),
    };
}
//# sourceMappingURL=select-custom-option.js.map