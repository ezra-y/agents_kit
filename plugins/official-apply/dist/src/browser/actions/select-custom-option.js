import { readControlValue } from "../controls/read-control-value.js";
import { CUSTOM_OPTION_SELECTOR, MOKA_SELECT } from "../controls/moka-select.js";
import { fieldValueMatches } from "../validation/validate-page.js";
import { normalizeAnswerValue } from "../../answers/normalize-answer-value.js";
import { PHOENIX } from "../controls/phoenix-controls.js";
import { captureOverlaySignature, findNewOverlaySelector, scanChangedRegion, } from "../scan/scan-changed-region.js";
import { findActionTarget } from "../locators/find-action-target.js";
const DEFAULT_TIMEOUT_MS = 8_000;
async function ownedPopup(locator) {
    const handle = await locator.evaluateHandle((element, { selectors, phoenix }) => {
        const visible = (node) => {
            const style = window.getComputedStyle(node);
            return style.display !== 'none' && style.visibility !== 'hidden' && !node.classList.contains('sugar-popup-move-leave') && node.getClientRects().length > 0;
        };
        const ids = `${element.getAttribute('aria-controls') ?? ''} ${element.getAttribute('aria-owns') ?? ''}`;
        if (element.getAttribute('aria-expanded') === 'false')
            return null;
        for (const id of ids.split(/\s+/)) {
            const popup = document.getElementById(id);
            if (popup !== null && visible(popup))
                return popup;
        }
        const popup = element.closest(selectors.container)?.querySelector(selectors.overlay);
        if (popup !== null && popup !== undefined && visible(popup))
            return popup;
        if (element.closest(phoenix.select)?.matches(phoenix.activeSelect)) {
            const popups = Array.from(document.querySelectorAll(phoenix.overlay)).filter(visible);
            if (popups.length === 1)
                return popups[0];
        }
        return null;
    }, { selectors: MOKA_SELECT, phoenix: PHOENIX });
    const popup = handle.asElement();
    if (popup !== null)
        return popup;
    await handle.dispose();
    return undefined;
}
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
export async function selectCustomOptionFromLocator(page, input) {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const frame = page.mainFrame();
    const beforeValue = await readControlValue(input.locator, { combineMonthControls: false });
    let popup = await ownedPopup(input.locator);
    if (beforeValue === input.requestedLabel && popup === undefined) {
        return {
            ok: true,
            changed: false,
            availableOptions: [],
            verifiedSelectedValue: beforeValue,
        };
    }
    let overlaySelector;
    if (popup === undefined) {
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
        popup = await ownedPopup(input.locator);
        if (popup === undefined) {
            const fresh = await findNewOverlaySelector(frame, before);
            if (fresh !== null) {
                overlaySelector = fresh;
                const overlays = frame.locator(fresh).filter({ visible: true });
                if (await overlays.count() === 1)
                    popup = (await overlays.elementHandle());
            }
        }
    }
    if (popup === undefined) {
        return {
            ok: false,
            changed: false,
            availableOptions: [],
            reason: '点击后没有出现新的浮层',
        };
    }
    overlaySelector ??= await popup.evaluate((element, selectors) => {
        const role = element.getAttribute('role');
        return role ? `[role="${role}"]` : element.matches(selectors.phoenix) ? selectors.phoenix : selectors.moka;
    }, { phoenix: PHOENIX.overlay, moka: MOKA_SELECT.overlay });
    try {
        const region = await scanChangedRegion(frame, { rootSelector: overlaySelector }, popup);
        const availableOptions = region.options;
        const normalized = normalizeAnswerValue({ value: input.requestedLabel, canonicalKey: input.canonicalField?.key,
            canonicalField: input.canonicalField, controlKind: 'combobox', siteOptions: availableOptions });
        const match = normalized.matched ? availableOptions.find((option) => (option.rawValue ?? option.rawLabel) === String(normalized.formattedValue))?.rawLabel : undefined;
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
        const options = await popup.$$(CUSTOM_OPTION_SELECTOR);
        let optionLocator;
        for (const option of options) {
            if ((await option.textContent())?.replace(/\s+/g, ' ').trim() === match) {
                optionLocator = option;
                break;
            }
        }
        if (optionLocator === undefined)
            throw new Error('custom_option_disappeared: 官网选项已变化，需要重新检查');
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
        const verified = await readControlValue(input.locator, { combineMonthControls: false });
        const ok = fieldValueMatches({ currentValue: verified, options: availableOptions, controlKind: 'combobox' }, { runtimeRef: 'selection', expectedValue: match, required: false, controlKind: 'combobox' });
        return {
            ok,
            changed: verified !== beforeValue,
            availableOptions,
            overlaySelector,
            ...(ok ? { verifiedSelectedValue: availableOptions.find((option) => option.rawLabel === match).rawLabel } : {}),
            ...(ok ? {} : { reason: `点击后控件显示的是「${verified}」，与预期不符` }),
        };
    }
    finally {
        await popup.dispose();
    }
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
    const found = await findActionTarget(frame, field.locatorCandidates, {
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
        canonicalField: request.canonicalField,
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