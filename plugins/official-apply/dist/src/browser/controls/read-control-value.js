import { MOKA_SELECT } from "./moka-select.js";
import { MOKA_DATE } from "./moka-date.js";
import { MOKA_CHECKBOX } from "./moka-checkbox.js";
export function committedControlValue(source) {
    if (source.checkboxState !== undefined)
        return String(source.checkboxState);
    if (source.calendarDisplay !== undefined)
        return /^\d{4}-\d{2}/.exec(source.calendarDisplay)?.[0] ?? '';
    if (source.monthParts !== undefined) {
        if (source.ongoingMonth)
            return '至今';
        const [year, month] = source.monthParts;
        return /^\d{4}$/.test(year ?? '') && /^(?:[1-9]|1[0-2])$/.test(month ?? '')
            ? `${year}-${month.padStart(2, '0')}` : '';
    }
    if (source.customSelect)
        return source.displayedValue ?? '';
    if (source.selectedLabel !== undefined)
        return source.selectedLabel;
    if (source.ariaValueText !== undefined)
        return source.ariaValueText;
    if (source.dataValue !== undefined)
        return source.dataValue;
    if (source.nativeValue !== undefined)
        return source.nativeValue;
    if (source.displayedValue !== undefined && source.displayedValue !== '')
        return source.displayedValue;
    return source.nativeValue ?? '';
}
export async function readControlValue(locator, options = {}) {
    const sources = await locator.evaluate((element, { select: selectors, date, checkbox, combineMonthControls }) => {
        const clean = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
        const range = element.closest(date.monthRange);
        const isEnd = range !== null && element.matches('input[type=checkbox]');
        const monthItem = range === null ? null : isEnd ? range.querySelectorAll(date.monthPair)[1] ?? null : element.closest(date.monthItem)?.parentElement ?? null;
        const checked = element.closest(checkbox.control)?.querySelector(checkbox.checked) !== null && element.closest(checkbox.control) !== null;
        if (combineMonthControls && isEnd && checked)
            return { customSelect: false, monthParts: [], ongoingMonth: true };
        if (combineMonthControls && monthItem !== null)
            return { customSelect: false,
                monthParts: Array.from(monthItem.querySelectorAll(selectors.display)).map(node => clean(node.textContent)),
                ongoingMonth: false,
            };
        if (element.matches('input[type=checkbox]'))
            return { customSelect: false, checkboxState: element.closest(checkbox.control) === null ? element.checked : checked };
        if (element.matches(date.monthPickerInput))
            return { customSelect: false, calendarDisplay: element.value };
        const select = element.closest(selectors.control) ??
            (element.querySelectorAll(selectors.control).length === 1 ? element.querySelector(selectors.control) : null);
        const role = element.getAttribute('role');
        const combo = element.tagName !== 'SELECT' && (role === 'combobox' || role === 'listbox');
        let selectedLabel = combo
            ? element.querySelector('[role=option][aria-selected=true]')?.textContent?.replace(/\s+/g, ' ').trim() : undefined;
        const ids = `${element.getAttribute('aria-controls') ?? ''} ${element.getAttribute('aria-owns') ?? ''}`;
        for (const id of ids.split(/\s+/)) {
            const selected = document.getElementById(id)?.querySelector('[role=option][aria-selected=true]');
            if (selectedLabel === undefined && combo && selected !== null && selected !== undefined) {
                selectedLabel = clean(selected.textContent);
                break;
            }
        }
        let nativeValue;
        if (element instanceof HTMLInputElement && element.type === 'file') {
            nativeValue = Array.from(element.files ?? []).map((file) => file.name).join(', ');
        }
        else if ('value' in element)
            nativeValue = String(element.value ?? '');
        else if (element.getAttribute('contenteditable') === 'true')
            nativeValue = element.innerText;
        const copy = element.cloneNode(true);
        copy.querySelectorAll('[role=option],[role=listbox],[role=menu],option').forEach((option) => option.remove());
        return {
            customSelect: select !== null,
            ...(nativeValue === undefined ? {} : { nativeValue }),
            ...(selectedLabel === undefined ? {} : { selectedLabel }),
            displayedValue: select === null ? clean(copy.textContent) : clean(select.querySelector(selectors.display)?.textContent),
            ...(combo && element.hasAttribute('aria-valuetext') ? { ariaValueText: clean(element.getAttribute('aria-valuetext')) } : {}),
            ...(combo && element.hasAttribute('data-value') ? { dataValue: element.getAttribute('data-value') } : {}),
        };
    }, { select: MOKA_SELECT, date: MOKA_DATE, checkbox: MOKA_CHECKBOX, combineMonthControls: options.combineMonthControls ?? true });
    return committedControlValue(sources);
}
//# sourceMappingURL=read-control-value.js.map