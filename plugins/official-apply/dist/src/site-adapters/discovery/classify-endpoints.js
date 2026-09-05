const NOISE_PATHS = ['/track', '/log', '/metrics', '/analytics', '/heartbeat', '/ping'];
function normalizedTokens(observation) {
    const source = [
        observation.requestUrlPattern,
        ...observation.detectedKeys,
        ...(observation.requestDetectedKeys ?? []),
    ]
        .join(' ')
        .toLowerCase();
    return new Set(source.split(/[^a-z0-9\u4e00-\u9fff]+/).filter((token) => token !== ''));
}
function hasAny(tokens, words) {
    return words.some((word) => tokens.has(word));
}
function includesAny(value, words) {
    const lower = value.toLowerCase();
    return words.some((word) => lower.includes(word));
}
function classifyRole(observation) {
    const method = observation.method.toUpperCase();
    const write = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    const tokens = normalizedTokens(observation);
    const url = observation.requestUrlPattern.toLowerCase();
    const reasons = [];
    if (write &&
        includesAny(url, [
            '/submit',
            '/apply-job',
            '/application/commit',
            '/applications',
            '/final-confirm',
        ]) &&
        !includesAny(url, ['/save', '/draft'])) {
        return {
            role: 'final_submit',
            confidence: 0.98,
            reasons: ['写请求 URL 命中最终提交特征'],
        };
    }
    if (includesAny(url, ['/upload', '/attachment', '/file']) ||
        hasAny(tokens, ['file', 'filename', 'attachment', 'upload'])) {
        return {
            role: 'upload',
            confidence: write ? 0.9 : 0.65,
            reasons: ['URL 或字段名命中文件上传特征'],
        };
    }
    if (write &&
        (includesAny(url, ['/save', '/draft', '/resume/update', '/profile/update']) ||
            hasAny(tokens, ['savedraft', 'draft', 'save']))) {
        return {
            role: 'save_draft',
            confidence: 0.9,
            reasons: ['写请求命中保存或草稿特征'],
        };
    }
    if (write &&
        (includesAny(url, ['/experience/add', '/experience/delete', '/section/add', '/section/delete']) ||
            (hasAny(tokens, ['education', 'experience', 'project']) &&
                hasAny(tokens, ['add', 'delete', 'remove'])))) {
        return {
            role: 'mutate_repeatable',
            confidence: 0.82,
            reasons: ['写请求命中重复经历增删特征'],
        };
    }
    if (!write &&
        (includesAny(url, ['/schema', '/form', '/question']) ||
            hasAny(tokens, ['fields', 'questions', 'formitems', 'componenttype', 'schema']))) {
        return {
            role: 'read_schema',
            confidence: 0.88,
            reasons: ['只读请求命中表单结构特征'],
        };
    }
    if (!write &&
        (includesAny(url, ['/options', '/dictionary', '/dict']) ||
            hasAny(tokens, ['options', 'dictionary', 'enum']))) {
        return {
            role: 'read_options',
            confidence: 0.78,
            reasons: ['只读请求命中选项字典特征'],
        };
    }
    if (!write &&
        (includesAny(url, ['/resume', '/profile', '/candidate']) ||
            hasAny(tokens, ['resume', 'profile', 'candidate', 'education', 'experience', 'projects']))) {
        return {
            role: 'read_resume',
            confidence: 0.82,
            reasons: ['只读请求命中简历或候选人数据特征'],
        };
    }
    reasons.push(write ? '未识别的写请求' : '未识别的只读请求');
    return { role: 'unknown', confidence: 0.2, reasons };
}
function automaticUse(role) {
    if (role === 'read_resume' || role === 'read_schema' || role === 'read_options') {
        return 'read_only';
    }
    if (role === 'final_submit') {
        return 'forbidden';
    }
    return 'observe_only';
}
export function classifyEndpointCandidates(observations) {
    const candidates = new Map();
    for (const observation of observations) {
        if (NOISE_PATHS.some((part) => observation.requestUrlPattern.includes(part))) {
            continue;
        }
        const classified = classifyRole(observation);
        const candidate = {
            role: classified.role,
            requestUrlPattern: observation.requestUrlPattern,
            method: observation.method.toUpperCase(),
            confidence: classified.confidence,
            automaticUse: automaticUse(classified.role),
            requestKeys: [...(observation.requestDetectedKeys ?? [])].sort(),
            responseKeys: [...observation.detectedKeys].sort(),
            reasons: classified.reasons,
        };
        const key = `${candidate.method} ${candidate.requestUrlPattern}`;
        const existing = candidates.get(key);
        if (existing === undefined || candidate.confidence > existing.confidence) {
            candidates.set(key, candidate);
        }
    }
    return [...candidates.values()].sort((left, right) => {
        const confidence = right.confidence - left.confidence;
        return confidence === 0
            ? left.requestUrlPattern.localeCompare(right.requestUrlPattern)
            : confidence;
    });
}
//# sourceMappingURL=classify-endpoints.js.map