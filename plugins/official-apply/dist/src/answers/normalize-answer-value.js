/**
 * 把答案库里的语义值转换成官网控件接受的格式。
 *
 * 规则文档：`docs/05_答案收集范围与复用规则.md §7`
 *
 * 两条硬规则：
 * 1. **不要为了适配某个官网，把答案库改成该官网的格式。** 转换只发生在写入网页时。
 * 2. **最终选项必须来自当前官网。** 匹配不上就 `matched=false`，交给用户，不猜。
 */
import { normalizeOptionText } from "../fields/normalize-field-option.js";
const OPTION_CONTROLS = new Set([
    'native_select',
    'combobox',
    'radio_group',
    'checkbox_group',
    'checkbox',
    'cascading_select',
]);
/** `2027-06-30` → 按控件类型给出网页要的写法。 */
export function formatDate(value, controlKind, inputType) {
    const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
    if (match === null) {
        return value;
    }
    const [, year = '', month = '', day] = match;
    if (inputType === 'month' || controlKind === 'month') {
        return `${year}-${month}`;
    }
    if (inputType === 'date' || controlKind === 'date') {
        return day === undefined ? `${year}-${month}-01` : value;
    }
    // 自定义日期框：给最常见的中文写法，具体网站可以在配方里覆盖。
    return day === undefined ? `${year}年${Number(month)}月` : `${year}年${Number(month)}月${Number(day)}日`;
}
/** 在官网选项里找对应项。找不到就是找不到，不返回近似值。 */
export function matchSiteOption(value, options) {
    if (options.length === 0) {
        return undefined;
    }
    // 1. 归一化值完全相等。
    const byNormalized = options.find((option) => option.normalizedValue !== undefined && option.normalizedValue === value);
    if (byNormalized !== undefined) {
        return byNormalized;
    }
    const text = normalizeOptionText(String(value));
    if (text === '') {
        return undefined;
    }
    // 2. 原始 value 或 label 完全一致。
    const exact = options.find((option) => normalizeOptionText(option.rawValue ?? '') === text ||
        normalizeOptionText(option.rawLabel) === text);
    if (exact !== undefined) {
        return exact;
    }
    // 3. label 包含关系。只在唯一命中时采用，避免「北京」同时命中多项。
    const partial = options.filter((option) => {
        const label = normalizeOptionText(option.rawLabel);
        return label !== '' && (label.includes(text) || text.includes(label));
    });
    return partial.length === 1 ? partial[0] : undefined;
}
export function normalizeAnswerValue(input) {
    const { value, controlKind, siteOptions, inputType } = input;
    if (OPTION_CONTROLS.has(controlKind)) {
        const option = matchSiteOption(value, siteOptions);
        if (option === undefined) {
            return {
                formattedValue: value,
                matched: false,
                reason: siteOptions.length === 0
                    ? '官网还没给出选项，需要先展开控件或询问用户'
                    : `官网选项里没有与「${String(value)}」对应的项`,
            };
        }
        // 写进网页时用官网自己的值，不用我们的标准值。
        return { formattedValue: option.rawValue ?? option.rawLabel, matched: true };
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(value)) {
        return { formattedValue: formatDate(value, controlKind, inputType), matched: true };
    }
    if (typeof value === 'boolean') {
        // 没有选项的布尔字段（例如开关）直接给布尔值。
        return { formattedValue: value, matched: true };
    }
    if (typeof value === 'number') {
        return { formattedValue: String(value), matched: true };
    }
    return { formattedValue: value, matched: true };
}
//# sourceMappingURL=normalize-answer-value.js.map