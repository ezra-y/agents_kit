import { fillTextControl } from "./fill-text-control.js";
export async function fillDateControl(locator, value, options = {}) {
    const timeout = options.timeoutMs ?? 5_000;
    const inputType = await locator.getAttribute('type').catch(() => null);
    if (inputType === 'date' || inputType === 'month') {
        const before = await locator.inputValue().catch(() => '');
        if (before === value) {
            return { changed: false, beforeValue: before, afterValue: before, ok: true };
        }
        try {
            await locator.fill(value, { timeout });
        }
        catch (error) {
            return {
                changed: false,
                beforeValue: before,
                afterValue: before,
                ok: false,
                reason: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
            };
        }
        const after = await locator.inputValue().catch(() => '');
        return {
            changed: after !== before,
            beforeValue: before,
            afterValue: after,
            ok: after === value,
            ...(after === value ? {} : { reason: `原生日期框读回的是「${after}」` }),
        };
    }
    // 普通文本日期框走同一套写入与读回逻辑。
    return fillTextControl(locator, value, options);
}
//# sourceMappingURL=fill-date-control.js.map