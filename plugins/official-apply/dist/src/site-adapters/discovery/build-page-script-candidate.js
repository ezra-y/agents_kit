import { createHash } from 'node:crypto';
import { buildLocatorCandidates } from "../../browser/locators/build-locator-candidates.js";
const SUPPORTED_CONTROLS = new Set([
    'text',
    'textarea',
    'email',
    'phone',
    'number',
    'date',
    'month',
    'year',
    'contenteditable',
    'native_select',
    'combobox',
    'cascading_select',
    'radio_group',
    'checkbox',
]);
function stableLocators(descriptors) {
    return descriptors
        .filter((descriptor) => [
        'region_role_name',
        'role_name',
        'label',
        'aria_label',
        'aria_labelledby',
        'autocomplete',
        'stable_attribute',
        'site_recipe',
        'family_recipe',
    ].includes(descriptor.strategy))
        .map((descriptor) => ({
        ...descriptor,
        ...(descriptor.target === undefined
            ? {}
            : {
                target: {
                    ...descriptor.target,
                    nth: undefined,
                    css: undefined,
                    xpath: undefined,
                },
            }),
    }));
}
function pageAnchors(schema) {
    const anchors = new Set();
    if (schema.stepLabel !== undefined && schema.stepLabel !== '') {
        anchors.add(schema.stepLabel);
    }
    for (const region of schema.regions) {
        if (region.textAnchor !== undefined && region.textAnchor.length <= 40) {
            anchors.add(region.textAnchor);
        }
    }
    for (const field of schema.fields.filter((item) => item.required)) {
        if (field.rawLabel !== '' && field.rawLabel.length <= 40) {
            anchors.add(field.rawLabel);
        }
    }
    for (const field of schema.fields) {
        if (anchors.size >= 6) {
            break;
        }
        if (field.rawLabel !== '' && field.rawLabel.length <= 40) {
            anchors.add(field.rawLabel);
        }
    }
    return [...anchors].slice(0, 6);
}
export function generalizePathPattern(pathname) {
    const segments = pathname.split('/');
    return segments
        .map((segment, index) => {
        if (segment === '') {
            return segment;
        }
        const isLast = index === segments.length - 1;
        if (/^\d{4,}$/.test(segment)) {
            return isLast ? ':jobId' : ':id';
        }
        if (/^[0-9a-f]{16,}$/i.test(segment) ||
            /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) {
            return isLast ? ':jobId' : ':id';
        }
        return segment;
    })
        .join('/');
}
export function pathMatchesPattern(pattern, pathname) {
    const wanted = pattern.split('/');
    const actual = pathname.split('/');
    return (wanted.length === actual.length &&
        wanted.every((segment, index) => segment.startsWith(':') ? actual[index] !== undefined && actual[index] !== '' : segment === actual[index]));
}
function candidateId(host, schema, anchors, pathPattern) {
    const hash = createHash('sha256')
        .update(`${host}|${pathPattern}|${anchors.join('|')}`)
        .digest('hex')
        .slice(0, 10);
    return `candidate.${host}.${schema.pageType}.${hash}`;
}
export function buildPageScriptCandidate(request) {
    const fieldByRef = new Map(request.pageSchema.fields.map((field) => [field.runtimeRef, field]));
    const fields = [];
    const skipped = [];
    const seenKeys = new Set();
    for (const mapping of request.mappings) {
        const field = fieldByRef.get(mapping.runtimeRef);
        if (field === undefined || mapping.canonicalKey === undefined || mapping.requiresReview) {
            skipped.push({ runtimeRef: mapping.runtimeRef, reason: '字段含义还没有确定' });
            continue;
        }
        if (field.repeatGroupKey !== undefined || mapping.canonicalKey.includes('[]')) {
            skipped.push({ runtimeRef: mapping.runtimeRef, reason: '重复经历由站点专用脚本处理' });
            continue;
        }
        if (!SUPPORTED_CONTROLS.has(field.controlKind)) {
            skipped.push({
                runtimeRef: mapping.runtimeRef,
                reason: `${field.controlKind} 暂无候选执行器`,
            });
            continue;
        }
        if (seenKeys.has(mapping.canonicalKey)) {
            skipped.push({ runtimeRef: mapping.runtimeRef, reason: '同一公共字段在页面上出现多次' });
            continue;
        }
        const locators = stableLocators(buildLocatorCandidates({ field }));
        if (locators.length === 0) {
            skipped.push({ runtimeRef: mapping.runtimeRef, reason: '没有稳定定位方式' });
            continue;
        }
        seenKeys.add(mapping.canonicalKey);
        fields.push({
            canonicalKey: mapping.canonicalKey,
            label: field.rawLabel,
            controlKind: field.controlKind,
            required: field.required,
            locatorCandidates: locators,
            ...(field.options.length === 0
                ? {}
                : {
                    options: field.options.map((option) => ({
                        label: option.rawLabel,
                        ...(option.rawValue === undefined ? {} : { value: option.rawValue }),
                    })),
                }),
        });
    }
    if (fields.length === 0) {
        return {
            skipped,
            skippedReason: 'page_script_candidate_empty: 没有已确定且可稳定操作的字段',
        };
    }
    const anchors = pageAnchors(request.pageSchema);
    const save = request.pageSchema.actions.find((action) => action.kind === 'save' && !action.commitAction);
    const endpoints = request.endpoints ?? [];
    const savePatterns = endpoints
        .filter((endpoint) => endpoint.role === 'save_draft')
        .map((endpoint) => endpoint.requestUrlPattern);
    const url = new URL(request.pageSchema.url);
    const pathPattern = generalizePathPattern(url.pathname);
    const spec = {
        schemaVersion: 1,
        id: candidateId(request.host, request.pageSchema, anchors, pathPattern),
        version: 1,
        host: request.host,
        pathPattern,
        pageKind: request.pageSchema.pageType,
        status: 'candidate',
        validationStatus: 'unverified',
        anchors,
        fields,
        endpoints,
        ...(save === undefined
            ? {}
            : {
                saveValidationStatus: 'unverified',
                saveAction: {
                    label: save.label,
                    locatorCandidates: stableLocators(save.locatorCandidates),
                    responseUrlPatterns: savePatterns,
                    successTexts: request.saveSuccessTexts ?? [],
                },
            }),
        ...(request.sourceRunId === undefined ? {} : { sourceRunId: request.sourceRunId }),
        capturedAt: request.now ?? new Date().toISOString(),
    };
    return { spec, skipped };
}
//# sourceMappingURL=build-page-script-candidate.js.map