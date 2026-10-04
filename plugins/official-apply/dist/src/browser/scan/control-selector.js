export const CONTROL_SELECTOR = [
    'input:not([type=hidden])',
    'textarea',
    'select',
    'button',
    '[contenteditable=true]',
    '[role=textbox]',
    '[role=combobox]',
    '[role=checkbox]',
    '[role=radio]',
    '[role=listbox]',
    '[role=button]',
    '[role=switch]',
    '[role=slider]',
    '[role=spinbutton]',
    PHOENIX.radioGroup,
    PHOENIX.button,
    PHOENIX.staticControl,
].join(',');
import { PHOENIX } from "../controls/phoenix-controls.js";
//# sourceMappingURL=control-selector.js.map