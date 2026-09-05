export async function readControlValue(locator) {
    const isEditable = await locator
        .evaluate((element) => element.getAttribute('contenteditable') === 'true')
        .catch(() => false);
    if (isEditable) {
        return (await locator.innerText().catch(() => '')).trim();
    }
    return (await locator.inputValue().catch(() => '')).trim();
}
export async function fillTextControl(locator, value, options = {}) {
    const timeout = options.timeoutMs ?? 5_000;
    const beforeValue = await readControlValue(locator);
    if (beforeValue === value) {
        // 已经是对的就不再写。少一次写入就少一次触发页面副作用的机会。
        return { changed: false, beforeValue, afterValue: beforeValue, ok: true };
    }
    const isEditable = await locator
        .evaluate((element) => element.getAttribute('contenteditable') === 'true')
        .catch(() => false);
    try {
        if (isEditable) {
            await locator.click({ timeout });
            await locator.evaluate((element) => {
                element.textContent = '';
            });
            await locator.pressSequentially(value, { timeout });
        }
        else {
            await locator.fill(value, { timeout });
        }
    }
    catch (error) {
        return {
            changed: false,
            beforeValue,
            afterValue: beforeValue,
            ok: false,
            reason: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
        };
    }
    const afterValue = await readControlValue(locator);
    return {
        changed: afterValue !== beforeValue,
        beforeValue,
        afterValue,
        ok: afterValue === value,
        ...(afterValue === value ? {} : { reason: `写入后读回的是「${afterValue}」` }),
    };
}
//# sourceMappingURL=fill-text-control.js.map