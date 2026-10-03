export const MOKA_CHECKBOX = {
    control: '[class*=sd-Checkbox-container]',
    checked: '[class*=sd-Checkbox-active]',
};
export async function readCheckboxState(locator) {
    const displayed = await locator.evaluate((element, selectors) => {
        const control = element.closest(selectors.control);
        return control === null ? null : control.querySelector(selectors.checked) !== null;
    }, MOKA_CHECKBOX);
    return displayed ?? await locator.isChecked();
}
//# sourceMappingURL=moka-checkbox.js.map