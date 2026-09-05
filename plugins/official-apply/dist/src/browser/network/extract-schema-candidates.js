/** 招聘表单接口里常见的结构键。命中越多越像 schema。 */
const SCHEMA_KEYS = [
    'field',
    'fields',
    'question',
    'questions',
    'label',
    'required',
    'option',
    'options',
    'component',
    'componentType',
    'schema',
    'formItems',
    'items',
    'placeholder',
    'validation',
    'visibleWhen',
    'dependsOn',
];
/** 一看就不是表单 schema 的接口。避免把埋点和监控当成候选。 */
const NOISE_PATTERNS = ['/track', '/log', '/metrics', '/analytics', '/heartbeat', '/ping'];
function keyScore(detectedKeys) {
    const lower = new Set(detectedKeys.map((key) => key.toLowerCase()));
    const hits = SCHEMA_KEYS.filter((key) => lower.has(key.toLowerCase()));
    return { score: hits.length, hits };
}
/** 数一数响应结构里像「字段定义」的对象有多少个。 */
export function estimateFieldCount(sample) {
    if (sample === undefined) {
        return 0;
    }
    let count = 0;
    const walk = (value, depth) => {
        if (depth > 6)
            return;
        if (Array.isArray(value)) {
            for (const item of value)
                walk(item, depth + 1);
            return;
        }
        if (typeof value === 'object' && value !== null) {
            const keys = Object.keys(value).map((key) => key.toLowerCase());
            const looksLikeField = (keys.includes('label') || keys.includes('name') || keys.includes('title')) &&
                (keys.includes('type') || keys.includes('required') || keys.includes('options') ||
                    keys.includes('componenttype'));
            if (looksLikeField) {
                count += 1;
            }
            for (const child of Object.values(value))
                walk(child, depth + 1);
        }
    };
    walk(sample, 0);
    return count;
}
/** 响应里的键名和页面 label 的重合度。重合越高越可能就是这一页的 schema。 */
export function labelOverlap(detectedKeys, pageFieldLabels) {
    if (pageFieldLabels.length === 0 || detectedKeys.length === 0) {
        return 0;
    }
    const keys = detectedKeys.map((key) => key.toLowerCase());
    const hit = pageFieldLabels.filter((label) => {
        const normalized = label.toLowerCase().replace(/\s+/g, '');
        return normalized !== '' && keys.some((key) => key.includes(normalized) || normalized.includes(key));
    });
    return hit.length / pageFieldLabels.length;
}
export function extractSchemaCandidates(input) {
    const candidates = [];
    for (const observation of input.observations) {
        if (NOISE_PATTERNS.some((pattern) => observation.requestUrlPattern.includes(pattern))) {
            continue;
        }
        const { score, hits } = keyScore(observation.detectedKeys);
        if (score === 0) {
            continue;
        }
        const fieldCountEstimate = estimateFieldCount(observation.redactedSample);
        const overlap = labelOverlap(observation.detectedKeys, input.pageFieldLabels);
        // 结构键命中、像字段的对象数量、和页面 label 的重合度，三者一起决定置信度。
        const confidence = Math.min(0.95, Math.min(score / SCHEMA_KEYS.length, 0.5) + Math.min(fieldCountEstimate / 10, 0.3) + overlap * 0.2);
        candidates.push({
            requestUrlPattern: observation.requestUrlPattern,
            ...(observation.responseContentType === undefined
                ? {}
                : { responseContentType: observation.responseContentType }),
            detectedKeys: hits,
            ...(fieldCountEstimate === 0 ? {} : { fieldCountEstimate }),
            confidence: Number(confidence.toFixed(3)),
            ...(observation.redactedSample === undefined
                ? {}
                : { redactedSample: observation.redactedSample }),
        });
    }
    return candidates.sort((a, b) => b.confidence - a.confidence);
}
//# sourceMappingURL=extract-schema-candidates.js.map