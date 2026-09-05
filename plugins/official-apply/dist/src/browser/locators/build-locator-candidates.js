/** 基础可靠度。语义越强分越高。 */
export const BASE_PRIORITY = {
    site_recipe: 130,
    family_recipe: 120,
    region_role_name: 100,
    role_name: 90,
    label: 80,
    aria_label: 75,
    autocomplete: 70,
    stable_attribute: 60,
    nearby_text: 45,
    css_fallback: 30,
};
/** 一看就脆的属性名，不拿来做定位。 */
const UNSTABLE_ATTRIBUTE_PATTERN = /^(?:.*-)?(?:\d+|[0-9a-f]{8,}|react|ng|vue|css|sc|jsx)[-_]?/i;
export function isStableAttributeValue(value) {
    if (value === '' || value.length > 64) {
        return false;
    }
    // 纯数字、长哈希、框架生成的随机类名都不算稳定。
    if (/^\d+$/.test(value) || /^[0-9a-f]{8,}$/i.test(value)) {
        return false;
    }
    return !UNSTABLE_ATTRIBUTE_PATTERN.test(value);
}
function regionAnchorOf(field) {
    return field.sectionPath.length > 0 ? field.sectionPath[field.sectionPath.length - 1] : undefined;
}
export function buildLocatorCandidates(input) {
    const { field } = input;
    const candidates = [];
    const label = field.rawLabel.trim();
    const anchor = regionAnchorOf(field);
    // 配方候选最优先。它们是真实验证过的。
    for (const recipe of input.recipeCandidates ?? []) {
        candidates.push(recipe);
    }
    if (label !== '' && anchor !== undefined) {
        candidates.push({
            strategy: 'region_role_name',
            description: `在「${anchor}」区域内找名称为「${label}」的控件`,
            regionAnchor: { sectionPath: field.sectionPath, text: anchor },
            target: {
                ...(field.role === null || field.role === undefined ? {} : { role: field.role }),
                accessibleName: label,
            },
            source: 'scanner',
            basePriority: BASE_PRIORITY.region_role_name,
            confidence: 0.9,
        });
    }
    if (label !== '' && field.role !== null && field.role !== undefined) {
        candidates.push({
            strategy: 'role_name',
            description: `按 role=${field.role} 且名称为「${label}」定位`,
            target: { role: field.role, accessibleName: label },
            source: 'scanner',
            basePriority: BASE_PRIORITY.role_name,
            confidence: 0.8,
        });
    }
    if (label !== '') {
        candidates.push({
            strategy: 'label',
            description: `按标签「${label}」定位`,
            target: { label },
            source: 'scanner',
            basePriority: BASE_PRIORITY.label,
            confidence: 0.75,
        });
    }
    const ariaLabel = field.accessibleName;
    if (typeof ariaLabel === 'string' && ariaLabel !== '' && ariaLabel !== label) {
        candidates.push({
            strategy: 'aria_label',
            description: `按无障碍名称「${ariaLabel}」定位`,
            target: { accessibleName: ariaLabel },
            source: 'scanner',
            basePriority: BASE_PRIORITY.aria_label,
            confidence: 0.7,
        });
    }
    if (field.autocomplete !== null && field.autocomplete !== undefined && field.autocomplete !== '') {
        candidates.push({
            strategy: 'autocomplete',
            description: `按 autocomplete=${field.autocomplete} 定位`,
            target: { autocomplete: field.autocomplete },
            source: 'scanner',
            basePriority: BASE_PRIORITY.autocomplete,
            confidence: 0.7,
        });
    }
    if (field.htmlName !== null &&
        field.htmlName !== undefined &&
        isStableAttributeValue(field.htmlName)) {
        candidates.push({
            strategy: 'stable_attribute',
            description: `按 name=${field.htmlName} 定位`,
            target: { stableAttributes: { name: field.htmlName } },
            source: 'scanner',
            basePriority: BASE_PRIORITY.stable_attribute,
            confidence: 0.65,
        });
    }
    if (field.htmlId !== null && field.htmlId !== undefined && isStableAttributeValue(field.htmlId)) {
        candidates.push({
            strategy: 'stable_attribute',
            description: `按 id=${field.htmlId} 定位`,
            target: { stableAttributes: { id: field.htmlId } },
            source: 'scanner',
            basePriority: BASE_PRIORITY.stable_attribute - 5,
            confidence: 0.6,
        });
    }
    return candidates;
}
//# sourceMappingURL=build-locator-candidates.js.map