export const MOKA_SELECT = {
    control: '[class*=sd-Select-container]',
    display: '[class*=sd-Input-display-value]',
    expanded: '[class*=sd-Select-arrow-open]',
    overlay: '[class*=sd-Dropdown-dropdown]',
    container: '[class*=sd-Dropdown-container]',
    option: '[class*=sd-Select-common-item],[class*=sd-Menu-container]:has([data-key="sugar.select.label"])',
    field: '[class*=apply-field-]',
    label: '[class*=title-]',
};
export const CUSTOM_OPTION_SELECTOR = `[role=option],option,li,${MOKA_SELECT.option},${PHOENIX.option}`;
import { PHOENIX } from "./phoenix-controls.js";
//# sourceMappingURL=moka-select.js.map