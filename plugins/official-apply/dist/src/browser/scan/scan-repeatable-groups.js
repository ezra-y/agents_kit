const RECORD_TYPE_PATTERNS = [
    ['education', ['教育', '学历', 'education']],
    ['experience', ['实习', '工作', '经历', 'experience', 'internship']],
    ['project', ['项目', 'project']],
    ['family_member', ['家庭', '亲属', 'family']],
    ['award', ['奖项', '荣誉', 'award', 'honor']],
];
function recordTypeOf(label) {
    const lower = label.toLowerCase();
    for (const [type, patterns] of RECORD_TYPE_PATTERNS) {
        if (patterns.some((pattern) => lower.includes(pattern))) {
            return type;
        }
    }
    return 'other';
}
export function scanRepeatableGroups(snapshot, fields, actions) {
    // 先按「重复容器签名 + 所在区域」把卡片分组。
    const buckets = new Map();
    for (const element of snapshot.elements) {
        if (element.repeatContainerSignature === null || element.repeatContainerIndex === null) {
            continue;
        }
        if (!element.isFormControl) {
            continue;
        }
        // 用区域路径把「教育经历里的学校」和「家庭成员里的学校」分开。
        const sectionPath = groupSectionPathOf(element);
        const sectionKey = sectionPath.join('>');
        const key = `${element.repeatContainerSignature}@${sectionKey}`;
        const bucket = buckets.get(key);
        if (bucket === undefined) {
            buckets.set(key, {
                signature: element.repeatContainerSignature,
                sectionPath,
                containers: new Map([[element.repeatContainerIndex, element]]),
            });
        }
        else {
            bucket.containers.set(element.repeatContainerIndex, element);
        }
    }
    const groups = [];
    const matchedAddActions = new Set();
    for (const [key, bucket] of buckets) {
        const label = bucket.sectionPath[bucket.sectionPath.length - 1] ?? bucket.signature;
        const addAction = findAddAction(snapshot, actions, label, bucket.sectionPath);
        if (bucket.containers.size < 2 && addAction === undefined) {
            continue;
        }
        if (addAction !== undefined) {
            matchedAddActions.add(addAction.runtimeRef);
        }
        const removeActions = findActionsInSection(snapshot, actions, 'remove_group', bucket.sectionPath);
        const containers = [...bucket.containers.entries()].sort((a, b) => a[0] - b[0]);
        groups.push({
            groupKey: key,
            label,
            sectionPath: bucket.sectionPath,
            currentCount: bucket.containers.size,
            ...(addAction === undefined ? {} : { addAction }),
            ...(removeActions.length === 0 ? {} : { removeActions }),
            instanceRegionRefs: containers.map(([index]) => `${snapshot.framePath.join('>') || 'main'}#${index}`),
            instanceLocatorCandidates: containers.map(([, element]) => instanceLocatorsOf(element, label)),
            canonicalRecordType: recordTypeOf(label),
        });
    }
    // 初始可以是 0 张卡片。此时没有控件可分桶，只能由明确的“新增经历”按钮建空组。
    for (const addAction of actions.filter((action) => action.kind === 'add_group')) {
        if (matchedAddActions.has(addAction.runtimeRef)) {
            continue;
        }
        const actionElement = elementForAction(snapshot, addAction);
        const sectionPath = actionElement?.sectionPath ?? [];
        const label = sectionPath[sectionPath.length - 1] ??
            stripAddWords(addAction.label);
        if (recordTypeOf(label) === 'other') {
            continue;
        }
        groups.push({
            groupKey: `empty@${sectionPath.join('>') || addAction.runtimeRef}`,
            label,
            sectionPath,
            currentCount: 0,
            addAction,
            instanceRegionRefs: [],
            instanceLocatorCandidates: [],
            canonicalRecordType: recordTypeOf(label),
        });
    }
    // 把字段标上「属于第几段经历」，后面填写时才知道硕士学校该写进哪张卡片。
    const framePrefix = snapshot.framePath.join('>') || 'main';
    const containerOfRuntimeRef = new Map();
    for (const element of snapshot.elements) {
        if (element.repeatContainerIndex !== null) {
            containerOfRuntimeRef.set(`${framePrefix}#${element.index}`, element.repeatContainerIndex);
        }
    }
    for (const group of groups) {
        const order = new Map(group.instanceRegionRefs.map((regionRef, index) => [regionRef, index]));
        for (const field of fields) {
            const containerIndex = containerOfRuntimeRef.get(field.runtimeRef);
            if (containerIndex === undefined) {
                continue;
            }
            const instanceIndex = order.get(`${framePrefix}#${containerIndex}`);
            if (instanceIndex === undefined) {
                continue;
            }
            field.repeatGroupKey = group.groupKey;
            field.repeatInstanceIndex = instanceIndex;
        }
    }
    return groups;
}
function groupSectionPathOf(element) {
    const containerLabel = element.repeatContainerAriaLabel;
    if (containerLabel !== null) {
        const containerPathIndex = element.sectionPath.findLastIndex((part) => stripCount(part) === stripCount(containerLabel));
        if (containerPathIndex >= 0) {
            return element.sectionPath.slice(0, containerPathIndex);
        }
    }
    return element.sectionPath;
}
function elementForAction(snapshot, action) {
    const indexText = action.runtimeRef.split('#').pop();
    const index = indexText === undefined ? Number.NaN : Number(indexText);
    return snapshot.elements.find((element) => element.index === index);
}
function findAddAction(snapshot, actions, label, sectionPath) {
    const wanted = stripCount(label).toLowerCase();
    return actions.find((action) => {
        if (action.kind !== 'add_group') {
            return false;
        }
        if (action.label.toLowerCase().includes(wanted)) {
            return true;
        }
        const actionPath = elementForAction(snapshot, action)?.sectionPath ?? [];
        return sectionPath.some((part) => actionPath.includes(part));
    });
}
function findActionsInSection(snapshot, actions, kind, sectionPath) {
    return actions.filter((action) => {
        if (action.kind !== kind) {
            return false;
        }
        const actionPath = elementForAction(snapshot, action)?.sectionPath ?? [];
        return sectionPath.length === 0 || sectionPath.some((part) => actionPath.includes(part));
    });
}
function instanceLocatorsOf(element, groupLabel) {
    const candidates = [];
    if (element.repeatContainerHtmlId !== null && element.repeatContainerHtmlId !== '') {
        candidates.push({
            strategy: 'stable_attribute',
            description: `按卡片 id=${element.repeatContainerHtmlId} 定位`,
            target: { stableAttributes: { id: element.repeatContainerHtmlId } },
            source: 'scanner',
            basePriority: 95,
            confidence: 0.9,
        });
    }
    if (element.repeatContainerTestId !== null && element.repeatContainerTestId !== '') {
        candidates.push({
            strategy: 'stable_attribute',
            description: `按卡片 data-testid=${element.repeatContainerTestId} 定位`,
            target: { stableAttributes: { 'data-testid': element.repeatContainerTestId } },
            source: 'scanner',
            basePriority: 90,
            confidence: 0.88,
        });
    }
    if (element.repeatContainerAriaLabel !== null && element.repeatContainerAriaLabel !== '') {
        candidates.push({
            strategy: 'aria_label',
            description: `按卡片名称「${element.repeatContainerAriaLabel}」定位`,
            target: { accessibleName: element.repeatContainerAriaLabel },
            source: 'scanner',
            basePriority: 85,
            confidence: 0.85,
        });
    }
    if (element.repeatContainerCss !== null &&
        element.repeatContainerCss !== '' &&
        element.repeatContainerLocatorIndex !== null &&
        element.repeatContainerLocatorIndex >= 0) {
        candidates.push({
            strategy: 'css_fallback',
            description: `在「${groupLabel}」卡片集合中定位第 ${element.repeatContainerLocatorIndex + 1} 张`,
            target: {
                css: element.repeatContainerCss,
                nth: element.repeatContainerLocatorIndex,
            },
            source: 'scanner',
            basePriority: 60,
            confidence: 0.7,
        });
    }
    return candidates;
}
/** 「教育经历 1」→「教育经历」，方便和「新增教育经历」按钮对上。 */
function stripCount(label) {
    return label.replace(/\s*\d+\s*$/, '').trim();
}
function stripAddWords(label) {
    return label
        .replace(/新增|添加|增加一段|add/gi, '')
        .trim();
}
//# sourceMappingURL=scan-repeatable-groups.js.map