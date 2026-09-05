/** 读控件当前值。输入框读 value，其余读可见文字。 */
export async function readVisualTargetValue(locator) {
    const value = await locator.inputValue().catch(() => undefined);
    if (value !== undefined) {
        return value.trim();
    }
    return (await locator.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}
export async function verifyVisualFallback(input) {
    // 1. 浮层该关就得关。
    if (input.expectClosedSelector !== undefined && input.page !== undefined) {
        const stillOpen = await input.page
            .locator(input.expectClosedSelector)
            .first()
            .isVisible()
            .catch(() => false);
        if (stillOpen) {
            return { verified: false, reason: `浮层 ${input.expectClosedSelector} 仍然开着` };
        }
    }
    if (input.locator === undefined) {
        // 没有可读控件时，只能靠浮层状态判断。上面已经检查过了。
        return { verified: input.expectClosedSelector !== undefined };
    }
    const observedValue = await readVisualTargetValue(input.locator);
    if (input.expectedValue === undefined) {
        // 没给期望值时，只要读到非空内容就算有变化。
        return {
            verified: observedValue !== '',
            observedValue,
            ...(observedValue === '' ? { reason: '控件仍然是空的' } : {}),
        };
    }
    const expected = String(input.expectedValue);
    const verified = observedValue === expected || observedValue.includes(expected);
    return {
        verified,
        observedValue,
        ...(verified ? {} : { reason: `读回的是「${observedValue}」，期望「${expected}」` }),
    };
}
//# sourceMappingURL=verify-visual-fallback.js.map