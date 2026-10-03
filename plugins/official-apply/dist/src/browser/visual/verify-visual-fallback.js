import { readControlValue } from "../controls/read-control-value.js";
import { fieldValueMatches } from "../validation/validate-page.js";
/** 读控件当前值。输入框读 value，其余读可见文字。 */
export { readControlValue as readVisualTargetValue } from "../controls/read-control-value.js";
export async function verifyVisualFallback(input) {
    // 1. 浮层该关就得关。
    if (input.expectClosedSelector !== undefined && input.page !== undefined) {
        const stillOpen = await input.page
            .locator(input.expectClosedSelector)
            .filter({ visible: true })
            .count();
        if (stillOpen > 0) {
            return { verified: false, reason: `浮层 ${input.expectClosedSelector} 仍然开着` };
        }
    }
    if (input.locator === undefined) {
        // 没有可读控件时，只能靠浮层状态判断。上面已经检查过了。
        return { verified: input.expectClosedSelector !== undefined };
    }
    const observedValue = await readControlValue(input.locator);
    if (input.expectedValue === undefined) {
        // 没给期望值时，只要读到非空内容就算有变化。
        return {
            verified: observedValue !== '',
            observedValue,
            ...(observedValue === '' ? { reason: '控件仍然是空的' } : {}),
        };
    }
    const expected = String(input.expectedValue);
    const controlKind = input.field?.controlKind ?? 'text';
    const verified = fieldValueMatches({ currentValue: observedValue, options: input.field?.options ?? [], controlKind }, { runtimeRef: input.field?.runtimeRef ?? 'visual', expectedValue: input.expectedValue, required: false, controlKind,
        ...(input.canonicalKey === undefined ? {} : { canonicalKey: input.canonicalKey }) });
    return {
        verified,
        observedValue,
        ...(verified ? {} : { reason: `读回的是「${observedValue}」，期望「${expected}」` }),
    };
}
//# sourceMappingURL=verify-visual-fallback.js.map