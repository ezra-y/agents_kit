export async function selectNativeOption(locator, targetValue, options = {}) {
    const timeout = options.timeoutMs ?? 5_000;
    const before = await locator.inputValue().catch(() => '');
    if (before === targetValue) {
        return { changed: false, ok: true, selectedValue: before };
    }
    // 先读一遍官网真实选项，再决定按 value 还是按文字选。
    // 不先读就直接试，会白等一个完整超时（真实网站上就是十几秒）。
    const siteOptions = await locator
        .locator('option')
        .evaluateAll((nodes) => nodes.map((node) => ({
        value: node.getAttribute('value') ?? '',
        label: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })))
        .catch(() => []);
    const byValue = siteOptions.find((option) => option.value === targetValue);
    const byLabel = siteOptions.find((option) => option.label === targetValue);
    const match = byValue ?? byLabel;
    if (match === undefined) {
        return {
            changed: false,
            ok: false,
            reason: `官网下拉里没有「${targetValue}」，现有选项：${siteOptions
                .map((option) => option.label)
                .filter((label) => label !== '')
                .join(' / ')}`,
        };
    }
    let selected = [];
    try {
        selected = await locator.selectOption({ value: match.value }, { timeout });
    }
    catch (error) {
        return {
            changed: false,
            ok: false,
            reason: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
        };
    }
    const after = await locator.inputValue().catch(() => '');
    return {
        changed: after !== before,
        ok: selected.length > 0 && after !== before,
        selectedValue: after,
        ...(after === before ? { reason: '选择后下拉值没有变化' } : {}),
    };
}
//# sourceMappingURL=select-native-option.js.map