import { fillTextControl } from "./fill-text-control.js";
import { MOKA_DATE } from "../controls/moka-date.js";
import { MOKA_SELECT } from "../controls/moka-select.js";
import { readControlValue } from "../controls/read-control-value.js";
import { selectCustomOptionFromLocator } from "./select-custom-option.js";
import { setCheckbox } from "./set-checkbox.js";
import { PHOENIX } from "../controls/phoenix-controls.js";
import { formatDate } from "../../answers/normalize-answer-value.js";
async function chooseMokaMonth(locator, value, page, timeout) {
    const composite = await locator.evaluate((element, selector) => element.closest(selector) !== null, MOKA_DATE.monthRange);
    let endpoint = false;
    if (composite) {
        endpoint = await locator.evaluate((element, selectors) => {
            const range = element.closest(selectors.monthRange);
            const pair = element.closest(selectors.monthItem)?.parentElement;
            const pairs = Array.from(range.querySelectorAll(selectors.monthPair));
            return element.matches('input[type=checkbox]') || (pairs.length > 1 && pairs.at(-1) === pair);
        }, MOKA_DATE);
        const current = locator.locator('xpath=ancestor::*[contains(@class,"month-range-select")][1]').locator('input[type=checkbox]');
        if (endpoint && await current.count() === 1) {
            const checked = await setCheckbox(current, value === '至今', { timeoutMs: timeout });
            if (!checked.ok)
                throw new Error(checked.reason ?? '结束时间状态设置失败');
            if (value === '至今')
                return;
        }
    }
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (match === null || Number(match[2]) < 1 || Number(match[2]) > 12)
        throw new Error('日期需要使用 YYYY-MM 格式');
    const [, year = '', month = ''] = match;
    if (composite) {
        const inputs = locator.locator('xpath=ancestor::*[contains(@class,"month-range-select")][1]').locator(MOKA_DATE.monthPair).nth(endpoint ? 1 : 0).locator('input');
        for (const [index, label] of [year, String(Number(month))].entries()) {
            const selected = await selectCustomOptionFromLocator(page, { locator: inputs.nth(index), requestedLabel: label, timeoutMs: timeout });
            if (!selected.ok)
                throw new Error(selected.reason ?? '日期下拉选择失败');
        }
        return;
    }
    if (!await locator.evaluate((element, selector) => element.matches(selector), MOKA_DATE.monthPickerInput))
        throw new Error('当前日期控件需要通过页面日历选择');
    await locator.evaluate(node => node.scrollIntoView({ block: 'end', behavior: 'instant' }));
    await locator.click({ timeout });
    const popup = locator.locator('xpath=ancestor::*[contains(@class,"sd-Dropdown-container")][1]').locator(MOKA_SELECT.overlay);
    await popup.waitFor({ state: 'visible', timeout });
    await popup.locator(MOKA_DATE.yearHeading).click({ timeout });
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const heading = await popup.locator(MOKA_DATE.yearHeading).innerText();
        const start = /^(\d{4})\s*-/.exec(heading)?.[1];
        if (start === undefined)
            throw new Error('日历没有显示可识别的年份范围');
        if (Number(year) >= Number(start) && Number(year) <= Number(start) + 9)
            break;
        await popup.locator(Number(year) < Number(start) ? MOKA_DATE.previousYear : MOKA_DATE.nextYear).click({ timeout });
    }
    const wantedYear = popup.locator(MOKA_DATE.yearItem).filter({ hasText: new RegExp(`^${year}$`) });
    await wantedYear.click({ timeout });
    const monthLabels = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    await popup.locator(MOKA_DATE.yearItem).filter({ hasText: new RegExp(`^${monthLabels[Number(month) - 1]}$`) }).click({ timeout });
    await popup.waitFor({ state: 'hidden', timeout });
}
export async function fillDateControl(locator, value, options = {}) {
    const timeout = options.timeoutMs ?? 5_000;
    const phoenix = await locator.evaluate((element, selectors) => element.closest(selectors.select) !== null, PHOENIX);
    if (phoenix) {
        const before = await readControlValue(locator);
        if (before === value)
            return { changed: false, beforeValue: before, afterValue: before, ok: true };
        if (options.page === undefined)
            throw new Error('日期日历需要当前浏览器页面');
        const active = await locator.evaluate((element, selectors) => element.closest(selectors.select)?.matches(selectors.activeSelect) === true, PHOENIX);
        if (!active)
            await locator.click({ timeout });
        const popup = options.page.locator(PHOENIX.calendar).filter({ visible: true });
        await popup.first().waitFor({ state: 'visible', timeout });
        if (await popup.count() !== 1)
            throw new Error('当前日期日历无法唯一定位');
        const formatted = await popup.locator(PHOENIX.calendarDatePanel).isVisible() ? formatDate(value, 'date') : value;
        await popup.locator(PHOENIX.calendarInput).fill(formatted, { timeout });
        await popup.locator(PHOENIX.calendarInput).press('Enter', { timeout });
        const after = await readControlValue(locator);
        return { changed: after !== before, beforeValue: before, afterValue: after, ok: after === formatted,
            ...(after === formatted ? {} : { reason: `日历输入后显示的是「${after}」` }) };
    }
    const inputType = await locator.getAttribute('type').catch(() => null);
    const customMonth = await locator.evaluate((element, selectors) => element.matches(selectors.monthPickerInput) || element.closest(selectors.monthRange) !== null, MOKA_DATE);
    if (customMonth) {
        const before = await readControlValue(locator);
        if (before === value)
            return { changed: false, beforeValue: before, afterValue: before, ok: true };
        if (options.page === undefined)
            throw new Error('自定义日期控件需要当前浏览器页面');
        await chooseMokaMonth(locator, value, options.page, timeout);
        const after = await readControlValue(locator);
        return { changed: after !== before, beforeValue: before, afterValue: after, ok: after === value,
            ...(after === value ? {} : { reason: `日期选择后显示的是「${after}」` }) };
    }
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