import { collectFrameNodes, scanControls } from "./scan-controls.js";
import { scanActions } from "./scan-actions.js";
import { scanRegions } from "./scan-regions.js";
/** 可能承载浮层的角色。点开下拉后新出现的通常是其中之一。 */
const OVERLAY_SELECTOR = '[role=listbox],[role=menu],[role=dialog],[role=tree],[role=grid]';
function scanError(code, detail) {
    return new Error(`${code}: ${detail}`);
}
/**
 * 记录当前可见浮层的签名。
 *
 * 描述符只用 role、可访问名和一小段文字，不含用户输入，也不含坐标。
 */
export async function captureOverlaySignature(frame) {
    const descriptors = await frame.evaluate((selector) => {
        const visible = (element) => {
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden')
                return false;
            return element.getClientRects().length > 0;
        };
        return Array.from(document.querySelectorAll(selector))
            .filter(visible)
            .map((element) => {
            const role = element.getAttribute('role') ?? '';
            const label = (element.getAttribute('aria-label') ?? '').trim();
            const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
            return `${role}|${label}|${text}`;
        });
    }, OVERLAY_SELECTOR);
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
    if (role === '') {
        return null;
    }
    return label === '' ? `[role="${role}"]` : `[role="${role}"][aria-label="${label}"]`;
}
export async function scanChangedRegion(frame, options) {
    const framePath = options.framePath ?? [];
    const rootIndex = options.rootIndex ?? 0;
    const exists = await frame
        .locator(options.rootSelector)
        .nth(rootIndex)
        .isVisible()
        .catch(() => false);
    if (!exists) {
        throw scanError('changed_region_not_found', `找不到可见的 ${options.rootSelector}`);
    }
    const snapshot = await collectFrameNodes(frame, framePath, {
        rootSelector: options.rootSelector,
        rootIndex,
    });
    const optionLabels = await frame.evaluate(({ selector, index }) => {
        const root = document.querySelectorAll(selector)[index];
        if (root === undefined)
            return [];
        return Array.from(root.querySelectorAll('[role=option],option,li'))
            .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim())
            .filter((text) => text !== '');
    }, { selector: options.rootSelector, index: rootIndex });
    return {
        snapshot,
        fields: scanControls(snapshot),
        actions: scanActions(snapshot),
        regions: scanRegions(snapshot),
        optionLabels,
    };
}
//# sourceMappingURL=scan-changed-region.js.map