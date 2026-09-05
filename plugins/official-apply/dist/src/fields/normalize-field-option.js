/** 是否类。覆盖中文常见写法和英文。 */
const BOOLEAN_TRUE = ['是', '有', '接受', '愿意', '同意', '已参加', '参加过', 'yes', 'y', 'true', '1'];
const BOOLEAN_FALSE = ['否', '无', '没有', '不接受', '不愿意', '不同意', '未参加', 'no', 'n', 'false', '0'];
/** 学历。只做语义归一，具体选项仍以官网为准。 */
const DEGREE_MAP = [
    ['doctorate', ['博士', '博士研究生', 'phd', 'doctor', 'doctorate']],
    ['master', ['硕士', '硕士研究生', '研究生', 'master', 'msc', 'ma']],
    ['bachelor', ['本科', '学士', 'bachelor', 'bsc', 'ba', 'undergraduate']],
    ['associate', ['专科', '大专', '高职', 'associate', 'diploma']],
    ['high_school', ['高中', '中专', 'high school']],
];
function normalizeText(text) {
    return text
        .replace(/[（）()【】\[\]]/g, '')
        .replace(/[*＊\s]/g, '')
        .toLowerCase()
        .trim();
}
function matchBoolean(text) {
    const normalized = normalizeText(text);
    if (normalized === '') {
        return undefined;
    }
    if (BOOLEAN_TRUE.includes(normalized))
        return true;
    if (BOOLEAN_FALSE.includes(normalized))
        return false;
    return undefined;
}
function matchDegree(text) {
    const normalized = normalizeText(text);
    for (const [key, patterns] of DEGREE_MAP) {
        if (patterns.some((pattern) => normalized.includes(normalizeText(pattern)))) {
            return key;
        }
    }
    return undefined;
}
/**
 * 用公共字段自带的归一化表。
 *
 * `field-catalog.yaml` 里可以写 `option_normalization: { true: [是, 接受], false: [否] }`。
 * 有表就用表，没有表才落到内置规则。
 */
function matchFromCatalog(text, optionNormalization) {
    if (optionNormalization === undefined) {
        return undefined;
    }
    const normalized = normalizeText(text);
    for (const [value, aliases] of Object.entries(optionNormalization)) {
        if (aliases.some((alias) => normalizeText(alias) === normalized)) {
            if (value === 'true')
                return true;
            if (value === 'false')
                return false;
            const asNumber = Number(value);
            return Number.isNaN(asNumber) ? value : asNumber;
        }
    }
    return undefined;
}
export function normalizeFieldOption(option, canonical) {
    const text = option.rawLabel !== '' ? option.rawLabel : (option.rawValue ?? '');
    const fromCatalog = matchFromCatalog(text, canonical?.optionNormalization);
    if (fromCatalog !== undefined) {
        return { ...option, normalizedValue: fromCatalog };
    }
    if (canonical?.valueType === 'boolean' || canonical === undefined) {
        const asBoolean = matchBoolean(text);
        if (asBoolean !== undefined) {
            return { ...option, normalizedValue: asBoolean };
        }
    }
    if (canonical?.valueType === 'enum' || canonical?.key.includes('degree') === true) {
        const degree = matchDegree(text);
        if (degree !== undefined) {
            return { ...option, normalizedValue: degree };
        }
    }
    // 认不出来就不写 normalizedValue。宁可留空，也不硬塞一个可能错的值。
    return { ...option };
}
export function normalizeFieldOptions(options, canonical) {
    return options.map((option) => normalizeFieldOption(option, canonical));
}
export { normalizeText as normalizeOptionText };
//# sourceMappingURL=normalize-field-option.js.map