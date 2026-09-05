/** 可见性单独处理，所以签名里不含它，避免同一件事报两次。 */
function valueSignature(field) {
    return [
        field.controlKind,
        field.required ? 'req' : 'opt',
        field.disabled ? 'disabled' : 'enabled',
        field.options.map((option) => option.rawValue ?? option.rawLabel).join(','),
    ].join('|');
}
function errorKey(error) {
    return `${error.severity}|${error.text}|${error.fieldRuntimeRef ?? ''}`;
}
export function diffPage(before, after) {
    const beforeFields = new Map(before.fields.map((field) => [field.fieldFingerprint, field]));
    const afterFields = new Map(after.fields.map((field) => [field.fieldFingerprint, field]));
    const addedFieldRefs = [];
    const removedFieldRefs = [];
    const changedFieldRefs = [];
    // 条件字段常常一直在 DOM 里，只是从 hidden 变成可见。
    // 对填写逻辑来说那就是「新出现」，所以按可见性判断，而不是按是否在 DOM 里。
    for (const [fingerprint, field] of afterFields) {
        const previous = beforeFields.get(fingerprint);
        if (previous === undefined) {
            if (field.visible) {
                addedFieldRefs.push(field.runtimeRef);
            }
            continue;
        }
        if (!previous.visible && field.visible) {
            addedFieldRefs.push(field.runtimeRef);
            continue;
        }
        if (previous.visible && !field.visible) {
            removedFieldRefs.push(field.runtimeRef);
            continue;
        }
        if (valueSignature(previous) !== valueSignature(field)) {
            changedFieldRefs.push(field.runtimeRef);
        }
    }
    for (const [fingerprint, field] of beforeFields) {
        if (!afterFields.has(fingerprint) && field.visible) {
            removedFieldRefs.push(field.runtimeRef);
        }
    }
    const beforeRegions = new Set(before.regions.map((region) => region.sectionPath.join('>')));
    const afterRegions = new Set(after.regions.map((region) => region.sectionPath.join('>')));
    const addedRegionRefs = after.regions
        .filter((region) => !beforeRegions.has(region.sectionPath.join('>')))
        .map((region) => region.ref);
    const removedRegionRefs = before.regions
        .filter((region) => !afterRegions.has(region.sectionPath.join('>')))
        .map((region) => region.ref);
    const beforeErrors = new Set(before.errors.map(errorKey));
    const newErrors = after.errors.filter((error) => !beforeErrors.has(errorKey(error)));
    return {
        fromSnapshotId: before.snapshotId,
        toSnapshotId: after.snapshotId,
        addedFieldRefs,
        removedFieldRefs,
        changedFieldRefs,
        addedRegionRefs,
        removedRegionRefs,
        newErrors,
    };
}
/** 只有真的什么都没变时才是 true。用来判断「点了但页面没反应」。 */
export function isEmptyDiff(diff) {
    return (diff.addedFieldRefs.length === 0 &&
        diff.removedFieldRefs.length === 0 &&
        diff.changedFieldRefs.length === 0 &&
        diff.addedRegionRefs.length === 0 &&
        diff.removedRegionRefs.length === 0 &&
        diff.newErrors.length === 0);
}
//# sourceMappingURL=diff-page.js.map