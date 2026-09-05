/** 各类证据的权重。历史证据最重，因为它是真实验证过的。 */
const WEIGHTS = {
    site_history: 0.6,
    family_history: 0.35,
    html_semantics: 0.3,
    catalog_alias_exact: 0.35,
    catalog_alias_partial: 0.15,
    control_type: 0.12,
    section_context: 0.2,
    technical_name: 0.15,
    option_shape: 0.1,
};
/** 区域明显对不上时的扣分。够大才能压过文字相似。 */
const SECTION_CONFLICT_PENALTY = 0.5;
/**
 * 公共字段 key 的类别前缀 → 期望出现的区域关键词。
 *
 * 前缀取自 `knowledge/field-catalog.yaml` 的真实命名空间。
 * `person.family` 目前没有对应的公共字段，留在这里是为了**识别冲突**：
 * 出现在「家庭成员」区域里的「学校」不该被认成教育经历。
 */
const SECTION_HINTS = [
    ['profile.education', ['教育', '学历', 'education']],
    ['profile.experience', ['实习', '工作', '经历', 'experience', 'internship']],
    ['profile.project', ['项目', 'project']],
    ['person.family', ['家庭', '亲属', 'family']],
    ['person.contact', ['联系', '基本信息', '个人信息', 'contact']],
    ['person.identity', ['基本信息', '个人信息', 'identity', 'personal']],
    ['application.preference', ['意向', '志愿', '偏好', 'preference']],
    ['attachment.', ['附件', '材料', 'attachment']],
];
export function normalizeForMatch(text) {
    return text
        .replace(/[（）()【】\[\]，,。.:：*＊?？]/g, '')
        .replace(/\s+/g, '')
        .toLowerCase()
        .trim();
}
/** 把 `education[0].school` / `candidate_name` 拆成词。 */
export function tokenizeTechnicalName(name) {
    if (name === null || name === undefined) {
        return [];
    }
    return name
        .replace(/\[\d*\]/g, '.')
        .split(/[.\-_/\s]+/)
        .flatMap((part) => part.split(/(?=[A-Z])/))
        .map((part) => part.toLowerCase())
        .filter((part) => part.length > 1);
}
function sectionText(siteField) {
    return normalizeForMatch([...siteField.sectionPath, siteField.stepLabel ?? ''].join(' '));
}
/**
 * 区域上下文的加减分。
 *
 * 命中期望关键词加分；命中**别的类别**的关键词而没命中自己的，扣分。
 */
function scoreSectionContext(siteField, canonical) {
    const section = sectionText(siteField);
    if (section === '') {
        return undefined;
    }
    const own = SECTION_HINTS.find(([prefix]) => canonical.key.startsWith(prefix));
    if (own !== undefined && own[1].some((hint) => section.includes(normalizeForMatch(hint)))) {
        return { delta: WEIGHTS.section_context, detail: `区域「${siteField.sectionPath.join('>')}」与字段类别一致` };
    }
    if (own !== undefined) {
        const conflicting = SECTION_HINTS.find(([prefix, hints]) => prefix !== own[0] && hints.some((hint) => section.includes(normalizeForMatch(hint))));
        if (conflicting !== undefined) {
            return {
                delta: -SECTION_CONFLICT_PENALTY,
                detail: `区域「${siteField.sectionPath.join('>')}」属于 ${conflicting[0]}，与 ${own[0]} 冲突`,
            };
        }
    }
    return undefined;
}
/** `autocomplete=email` 这类 HTML 标准语义是最可靠的技术信号之一。 */
const AUTOCOMPLETE_HINTS = {
    email: 'person.contact.email',
    tel: 'person.contact.phone',
    'tel-national': 'person.contact.phone',
    name: 'person.identity.full_name',
    'given-name': 'person.identity.given_name',
    'family-name': 'person.identity.family_name',
    'street-address': 'person.contact.address',
    'postal-code': 'person.contact.postal_code',
};
export function scoreFieldMapping(input) {
    const { siteField, canonical } = input;
    const evidence = [];
    let score = 0;
    const add = (item) => {
        evidence.push(item);
        score += item.score;
    };
    // 1. 这个站点历史上已经确认过的映射，权重最高。
    if (input.siteHistoryCanonicalKey === canonical.key) {
        add({
            source: 'site_history',
            detail: '本站点历史上已确认过同一映射',
            score: WEIGHTS.site_history,
        });
    }
    if (input.familyHistoryCanonicalKey === canonical.key) {
        add({
            source: 'family_history',
            detail: '同一招聘 SaaS 家族历史上确认过同一映射',
            score: WEIGHTS.family_history,
        });
    }
    // 2. HTML 标准语义。
    const autocomplete = (siteField.autocomplete ?? '').toLowerCase();
    if (autocomplete !== '' && AUTOCOMPLETE_HINTS[autocomplete] === canonical.key) {
        add({
            source: 'html_semantics',
            detail: `autocomplete=${autocomplete}`,
            score: WEIGHTS.html_semantics,
        });
    }
    // 3. label 与公共别名。完全一致和部分包含分开算。
    const label = normalizeForMatch(siteField.rawLabel);
    const aliases = [canonical.name, ...canonical.aliases].map(normalizeForMatch);
    if (label !== '') {
        if (aliases.includes(label)) {
            add({
                source: 'catalog_alias',
                detail: `标签「${siteField.rawLabel}」与公共别名完全一致`,
                score: WEIGHTS.catalog_alias_exact,
            });
        }
        else if (aliases.some((alias) => alias !== '' && (alias.includes(label) || label.includes(alias)))) {
            add({
                source: 'visible_label',
                detail: `标签「${siteField.rawLabel}」与公共别名部分重合`,
                score: WEIGHTS.catalog_alias_partial,
            });
        }
    }
    // 4. 控件类型。
    if (canonical.commonControls.includes(siteField.controlKind)) {
        add({
            source: 'control_type',
            detail: `控件类型 ${siteField.controlKind} 属于该字段常见控件`,
            score: WEIGHTS.control_type,
        });
    }
    // 5. 区域上下文。既能加分也能扣分。
    const section = scoreSectionContext(siteField, canonical);
    if (section !== undefined) {
        add({ source: 'section_context', detail: section.detail, score: section.delta });
    }
    // 6. 技术属性词根。
    const tokens = new Set([
        ...tokenizeTechnicalName(siteField.htmlName),
        ...tokenizeTechnicalName(siteField.htmlId),
    ]);
    if (tokens.size > 0) {
        const keyTokens = canonical.key.split('.').flatMap((part) => part.split('_'));
        const aliasTokens = canonical.aliases
            .filter((alias) => /^[\x20-\x7e]+$/.test(alias))
            .flatMap((alias) => alias.toLowerCase().split(/\s+/));
        const hit = [...keyTokens, ...aliasTokens].find((token) => token.length > 2 && tokens.has(token.toLowerCase()));
        if (hit !== undefined) {
            add({
                source: 'technical_name',
                detail: `技术属性包含词根 ${hit}`,
                score: WEIGHTS.technical_name,
            });
        }
    }
    // 7. 选项形状。两个是否类选项 → 布尔字段。
    if (siteField.options.length === 2 && canonical.valueType === 'boolean') {
        add({
            source: 'control_type',
            detail: '两个选项，形状符合布尔字段',
            score: WEIGHTS.option_shape,
        });
    }
    return {
        canonicalKey: canonical.key,
        score: Math.max(0, Math.min(1, Number(score.toFixed(3)))),
        evidence,
    };
}
//# sourceMappingURL=score-field-mapping.js.map