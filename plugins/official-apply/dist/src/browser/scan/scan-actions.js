/**
 * 动作文案 → 动作类型。
 *
 * 顺序有意义：先判 commit，再判 next。
 * 「确认提交申请」同时包含「提交」和「确认」，必须落到 commit。
 */
const COMMIT_PATTERNS = [
    '确认提交',
    '确认投递',
    '提交申请',
    '确认并提交',
    '提交简历',
    'submit application',
];
const START_APPLICATION_PATTERNS = [
    '立即投递',
    '立即申请',
    '申请职位',
    '投递简历',
    'apply now',
    'start application',
];
const NEXT_PATTERNS = ['下一步', '保存并继续', '继续', 'next', 'continue'];
const SAVE_PATTERNS = ['保存', '暂存', 'save'];
const PREVIOUS_PATTERNS = ['上一步', '返回', 'previous', 'back'];
const ADD_PATTERNS = ['新增', '添加', '增加一段', 'add'];
const REMOVE_PATTERNS = ['删除', '移除', 'remove', 'delete'];
const REVIEW_PATTERNS = ['预览', '确认信息', 'review'];
function includesAny(text, patterns) {
    const lower = text.toLowerCase();
    return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}
function classifyAction(label) {
    if (includesAny(label, COMMIT_PATTERNS)) {
        return { kind: 'commit', commit: true };
    }
    if (includesAny(label, START_APPLICATION_PATTERNS)) {
        return { kind: 'start_application', commit: false };
    }
    if (includesAny(label, ADD_PATTERNS)) {
        return { kind: 'add_group', commit: false };
    }
    if (includesAny(label, REMOVE_PATTERNS)) {
        return { kind: 'remove_group', commit: false };
    }
    if (includesAny(label, NEXT_PATTERNS)) {
        return { kind: 'next', commit: false };
    }
    if (includesAny(label, SAVE_PATTERNS)) {
        return { kind: 'save', commit: false };
    }
    if (includesAny(label, PREVIOUS_PATTERNS)) {
        return { kind: 'previous', commit: false };
    }
    if (includesAny(label, REVIEW_PATTERNS)) {
        return { kind: 'review', commit: false };
    }
    return { kind: 'other', commit: false };
}
function expectedChangesOf(kind) {
    switch (kind) {
        case 'next':
        case 'previous':
        case 'start_application':
            return [{ kind: 'step_changed' }, { kind: 'url_changed' }];
        case 'add_group':
            return [{ kind: 'field_count_changed' }, { kind: 'region_appeared' }];
        case 'remove_group':
            return [{ kind: 'field_count_changed' }, { kind: 'region_disappeared' }];
        case 'commit':
            return [{ kind: 'success_marker_appeared' }, { kind: 'network_response' }];
        case 'save':
            return [{ kind: 'network_response' }];
        default:
            return [];
    }
}
function locatorsOf(element, label, sameLabelIndex) {
    const candidates = [];
    const anchor = element.sectionPath[element.sectionPath.length - 1];
    if (anchor !== undefined) {
        candidates.push({
            strategy: 'region_role_name',
            description: `在「${anchor}」区域内找名为「${label}」的按钮`,
            regionAnchor: { sectionPath: element.sectionPath, text: anchor },
            target: { role: 'button', accessibleName: label },
            source: 'scanner',
            basePriority: 100,
            confidence: 0.9,
        });
    }
    candidates.push({
        strategy: 'role_name',
        description: `按 role=button 且名称为「${label}」定位`,
        target: { role: 'button', accessibleName: label },
        source: 'scanner',
        basePriority: 85,
        confidence: 0.8,
    });
    if (element.htmlId !== null && element.htmlId !== '') {
        candidates.push({
            strategy: 'stable_attribute',
            description: `按 id=${element.htmlId} 定位`,
            target: { stableAttributes: { id: element.htmlId } },
            source: 'scanner',
            basePriority: 55,
            confidence: 0.6,
        });
    }
    /**
     * 同名按钮的序号兜底。
     *
     * 招聘页上「立即投递」「保存」「下一步」重复出现是常态。
     * 不带序号的候选会命中多个而被判歧义（`find-action-target.ts`），
     * 结果是明明扫到了按钮却点不了。
     *
     * 扫描时已经知道这是第几个同名按钮，所以补一条带 nth 的候选。
     * 优先级压到最低：只有在前面所有候选都歧义或落空时才会用到，
     * 不会削弱「能唯一定位就唯一定位」的默认行为。
     */
    if (sameLabelIndex !== undefined) {
        candidates.push({
            strategy: 'role_name',
            description: `按 role=button 且名称为「${label}」定位，取第 ${sameLabelIndex + 1} 个`,
            target: { role: 'button', accessibleName: label, nth: sameLabelIndex },
            source: 'scanner',
            basePriority: 20,
            confidence: 0.4,
        });
    }
    return candidates;
}
function labelOf(element) {
    return element.text || element.labelEvidence[0]?.text || element.htmlId || '';
}
export function scanActions(snapshot) {
    const actions = [];
    // 先数一遍同名按钮，才知道哪些标签需要序号兜底。
    const labelTotals = new Map();
    for (const element of snapshot.elements) {
        if (!element.isButtonLike || !element.visible) {
            continue;
        }
        const label = labelOf(element);
        if (label === '') {
            continue;
        }
        labelTotals.set(label, (labelTotals.get(label) ?? 0) + 1);
    }
    const labelSeen = new Map();
    for (const element of snapshot.elements) {
        if (!element.isButtonLike || !element.visible) {
            continue;
        }
        const label = labelOf(element);
        if (label === '') {
            continue;
        }
        // DOM 顺序里的第几个同名按钮。与 Playwright nth 的计数口径一致。
        const seenBefore = labelSeen.get(label) ?? 0;
        labelSeen.set(label, seenBefore + 1);
        const sameLabelIndex = (labelTotals.get(label) ?? 0) > 1 ? seenBefore : undefined;
        const { kind, commit } = classifyAction(label);
        actions.push({
            runtimeRef: `${snapshot.framePath.join('>') || 'main'}#${element.index}`,
            kind,
            label,
            commitAction: commit,
            disabled: element.disabled,
            locatorCandidates: locatorsOf(element, label, sameLabelIndex),
            expectedChanges: expectedChangesOf(kind),
        });
    }
    return actions;
}
//# sourceMappingURL=scan-actions.js.map