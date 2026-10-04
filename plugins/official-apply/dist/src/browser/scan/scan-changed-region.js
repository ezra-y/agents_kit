import { CUSTOM_OPTION_SELECTOR, MOKA_SELECT } from "../controls/moka-select.js";
import { PHOENIX } from "../controls/phoenix-controls.js";
import { collectFrameNodes, scanControls } from "./scan-controls.js";
import { scanActions } from "./scan-actions.js";
import { scanRegions } from "./scan-regions.js";
/** 可能承载浮层的角色。点开下拉后新出现的通常是其中之一。 */
const OVERLAY_SELECTOR = `[role=listbox],[role=menu],[role=dialog],[role=tree],[role=grid],${MOKA_SELECT.overlay},${PHOENIX.overlay}`;
function scanError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
/**
 * 记录当前可见浮层的签名。
 *
 * 描述符只用 role、可访问名和一小段文字，不含用户输入，也不含坐标。
 */
export async function captureOverlaySignature(frame) {
    const descriptors = await frame.evaluate(({ selector, phoenix }) => {
        const visible = (element) => {
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden')
                return false;
            return element.getClientRects().length > 0;
        };
        return Array.from(document.querySelectorAll(selector))
            .filter(visible)
            .map((element) => {
            const role = element.getAttribute('role') ?? (element.matches(phoenix) ? 'phoenix_select' : 'moka_select');
            const label = (element.getAttribute('aria-label') ?? '').trim();
            const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
            return `${role}|${label}|${text}`;
        });
    }, { selector: OVERLAY_SELECTOR, phoenix: PHOENIX.overlay });
    return { descriptors };
}
/**
 * 找出点击之后新出现的浮层，并返回一个**短的、可解释的**选择器。
 *
 * 这是运行期用的定位方式，只服务当前动作，不写进长期配方（`docs/13 D09`）。
 */
export async function findNewOverlaySelector(frame, before) {
    const after = await captureOverlaySignature(frame);
    const beforeSet = new Set(before.descriptors);
    const fresh = after.descriptors.find((descriptor) => !beforeSet.has(descriptor));
    if (fresh === undefined) {
        return null;
    }
    const [role = '', label = ''] = fresh.split('|');
    if (role === 'moka_select')
        return MOKA_SELECT.overlay;
    if (role === 'phoenix_select')
        return PHOENIX.overlay;
    if (role === '') {
        return null;
    }
    return label === '' ? `[role="${role}"]` : `[role="${role}"][aria-label="${label}"]`;
}
export async function scanChangedRegion(frame, options, rootElement) {
    const framePath = options.framePath ?? [];
    const rootIndex = options.rootIndex ?? 0;
    const exists = rootElement === undefined ? await frame
        .locator(options.rootSelector)
        .nth(rootIndex)
        .isVisible()
        .catch(() => false) : await rootElement.isVisible();
    if (!exists) {
        throw scanError('changed_region_not_found', `找不到可见的 ${options.rootSelector}`);
    }
    const snapshot = await collectFrameNodes(frame, framePath, {
        rootSelector: options.rootSelector,
        rootIndex,
        ...(rootElement === undefined ? {} : { rootElement }),
    });
    const choices = await frame.evaluate(({ selector, index, optionSelector, element }) => {
        const root = element ?? document.querySelectorAll(selector)[index];
        if (root === undefined)
            return [];
        return Array.from(root.querySelectorAll(optionSelector))
            .map((element) => ({ rawLabel: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
            rawValue: element.getAttribute('data-value') ?? element.getAttribute('value') ?? (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
            disabled: element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled'),
            source: 'opened_overlay' }))
            .filter((option) => option.rawLabel !== '');
    }, { selector: options.rootSelector, index: rootIndex, optionSelector: CUSTOM_OPTION_SELECTOR, element: rootElement ?? null });
    return {
        snapshot,
        fields: scanControls(snapshot),
        actions: scanActions(snapshot),
        regions: scanRegions(snapshot),
        optionLabels: choices.map((option) => option.rawLabel),
        options: choices,
    };
}
//# sourceMappingURL=scan-changed-region.js.map