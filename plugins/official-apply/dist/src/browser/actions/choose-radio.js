/**
 * 把传进来的定位器还原成「这一组 radio」。
 *
 * 两种情况：
 * - 指向外层容器：直接用，在它的子元素里找。
 * - 指向组里某一个 input：读出它的 `name`，用同名的一组代替。
 */
async function resolveGroup(group) {
    const name = await group
        .first()
        .evaluate((element) => {
        const input = element;
        return input.tagName === 'INPUT' && input.type === 'radio' ? input.name : '';
    })
        .catch(() => '');
    if (name === '') {
        return group;
    }
    const escapedName = name.replace(/["\\]/g, '\\$&');
    // 回到页面级去找同名的一组。radio 的 name 在同一表单里就是分组依据。
    return group.page().locator(`input[type=radio][name="${escapedName}"]`);
}
export async function chooseRadio(group, targetValue, options = {}) {
    const timeout = options.timeoutMs ?? 5_000;
    const escaped = targetValue.replace(/["\\]/g, '\\$&');
    const scope = await resolveGroup(group);
    const isGroupItself = (await scope.count().catch(() => 0)) > 1;
    // 组里按 value 找具体那一项；找不到再按可见文字找。
    const byValue = isGroupItself
        ? scope.filter({ has: undefined }).and(scope.page().locator(`input[value="${escaped}"]`))
        : scope.locator(`input[type=radio][value="${escaped}"]`);
    let option = byValue;
    if ((await byValue.count().catch(() => 0)) === 0) {
        option = isGroupItself
            ? scope.and(scope.page().getByRole('radio', { name: targetValue, exact: false }))
            : scope.getByRole('radio', { name: targetValue, exact: false });
    }
    const count = await option.count().catch(() => 0);
    if (count === 0) {
        return { changed: false, ok: false, reason: `官网选项里没有「${targetValue}」` };
    }
    if (count > 1) {
        return { changed: false, ok: false, reason: `「${targetValue}」命中 ${count} 个选项，不动手` };
    }
    const already = await option.first().isChecked().catch(() => false);
    if (already) {
        return { changed: false, ok: true, selectedValue: targetValue };
    }
    try {
        await option.first().check({ timeout });
    }
    catch (error) {
        return {
            changed: false,
            ok: false,
            reason: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
        };
    }
    const checked = await option.first().isChecked().catch(() => false);
    return {
        changed: checked,
        ok: checked,
        ...(checked ? { selectedValue: targetValue } : { reason: '点击后仍未选中' }),
    };
}
//# sourceMappingURL=choose-radio.js.map