import { CONTROL_SELECTOR } from "./control-selector.js";
/**
 * 算一次页面摘要。
 *
 * 只读每个 frame 的控件状态，不建定位候选、不算字段指纹。
 */
export async function computePageDigest(page) {
    const frames = await Promise.all(page.frames().map(readFrameDigest));
    if (frames.some((frame) => frame.controlCount < 0)) {
        return { url: page.url(), controlCount: -1, valueHash: 'unreadable' };
    }
    return {
        url: page.url(),
        controlCount: frames.reduce((sum, frame) => sum + frame.controlCount, 0),
        valueHash: hashText(JSON.stringify(frames)),
    };
}
async function readFrameDigest(frame) {
    const frameKey = `${frame.name()}:${frame.url()}`;
    const digest = await frame
        .evaluate((controlSelector) => {
        const nodes = Array.from(document.querySelectorAll(`${controlSelector},option,[role=option],[aria-current],[role=alert],[aria-live=assertive],[aria-live=polite]`));
        const markers = nodes.map((node) => {
            const element = node;
            const html = node;
            const value = element instanceof HTMLSelectElement && element.multiple
                ? Array.from(element.selectedOptions, (option) => option.value)
                : ('value' in element
                    ? String(element.value ?? '')
                    : (html.getAttribute('data-value') ??
                        html.getAttribute('aria-valuetext') ??
                        (node.textContent ?? '').trim()));
            const disabled = ('disabled' in element && Boolean(element.disabled)) ||
                html.getAttribute('aria-disabled') === 'true';
            const style = window.getComputedStyle(html);
            const visible = !html.hidden &&
                html.getAttribute('aria-hidden') !== 'true' &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0' &&
                html.getClientRects().length > 0;
            return JSON.stringify([
                node.tagName,
                node.id,
                html.getAttribute('name') ?? '',
                html.getAttribute('type') ?? '',
                html.getAttribute('role') ?? '',
                value,
                (node.textContent ?? '').trim(),
                visible ? 'v' : 'h',
                disabled ? 'd' : 'e',
                'checked' in element ? Boolean(element.checked) : null,
                'indeterminate' in element ? Boolean(element.indeterminate) : null,
                element instanceof HTMLOptionElement ? element.selected : null,
                'required' in element ? Boolean(element.required) : null,
                'readOnly' in element ? Boolean(element.readOnly) : null,
                'multiple' in element ? Boolean(element.multiple) : null,
                html.getAttribute('aria-checked'),
                html.getAttribute('aria-selected'),
                html.getAttribute('aria-current'),
                html.getAttribute('aria-activedescendant'),
                html.getAttribute('aria-expanded'),
                html.getAttribute('aria-invalid'),
                html.getAttribute('aria-readonly'),
                html.getAttribute('aria-required'),
                html.getAttribute('aria-valuenow'),
                html.getAttribute('aria-valuemin'),
                html.getAttribute('aria-valuemax'),
                html.getAttribute('aria-valuetext'),
                html.getAttribute('accept'),
                html.getAttribute('contenteditable'),
            ]);
        });
        return {
            controlCount: nodes.filter((node) => node.matches(controlSelector)).length,
            valueHash: markers.join('\n'),
        };
    }, CONTROL_SELECTOR)
        .catch(() => undefined);
    return digest === undefined
        ? { frameKey, controlCount: -1, valueHash: 'unreadable' }
        : { frameKey, controlCount: digest.controlCount, valueHash: hashText(digest.valueHash) };
}
function hashText(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0;
    }
    return String(hash);
}
export function createPageSchemaCache() {
    let cached;
    let generation = 0;
    let fullScans = 0;
    let dirty = true;
    let lastReason;
    return {
        async get(page, observationCount) {
            if (dirty || cached === undefined) {
                return undefined;
            }
            // 有新的网络观察就得重扫，否则后到的接口 schema 融合不进来。
            if (observationCount !== undefined && observationCount > cached.observationCount) {
                return undefined;
            }
            const digest = await computePageDigest(page);
            const same = digest.controlCount >= 0 &&
                cached.digest.controlCount >= 0 &&
                digest.url === cached.digest.url &&
                digest.controlCount === cached.digest.controlCount &&
                digest.valueHash === cached.digest.valueHash;
            return same ? cached : undefined;
        },
        set(schema, digest, now, observationCount) {
            cached = {
                schema,
                digest,
                generation,
                capturedAt: now,
                observationCount: observationCount ?? 0,
            };
            dirty = false;
            return cached;
        },
        invalidate(reason) {
            dirty = true;
            generation += 1;
            lastReason = reason;
        },
        generation: () => generation,
        fullScanCount: () => fullScans,
        countFullScan: () => {
            fullScans += 1;
        },
        lastInvalidation: () => lastReason,
    };
}
//# sourceMappingURL=page-schema-cache.js.map