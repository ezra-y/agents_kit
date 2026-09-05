/** 统一替换成这些占位值（`docs/11 §2.3`）。 */
export const PLACEHOLDERS = {
    name: 'TEST_USER',
    phone: '13000000000',
    email: 'test@example.invalid',
    applicationNo: 'APP_TEST_001',
    fileName: 'resume-test.pdf',
    token: 'TEST_TOKEN',
    generic: 'TEST_VALUE',
};
const CONTENT_RULES = [
    { name: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: PLACEHOLDERS.email },
    { name: 'mainland_mobile', pattern: /(?<![\d*])1[3-9]\d{9}(?![\d*])/g, replacement: PLACEHOLDERS.phone },
    { name: 'id_number', pattern: /(?<![\dXx])\d{17}[\dXx](?![\dXx])/g, replacement: '110000199001010000' },
    {
        name: 'authorization',
        pattern: /(authorization\s*[:=]\s*(?:bearer|basic|token)\s+)\S+/gi,
        replacement: `$1${PLACEHOLDERS.token}`,
    },
    {
        name: 'cookie',
        pattern: /((?:set-)?cookie\s*[:=]\s*)[^\s;"']+/gi,
        replacement: `$1${PLACEHOLDERS.token}`,
    },
    { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}/g, replacement: PLACEHOLDERS.token },
    { name: 'application_no', pattern: /\b[A-Z]{2,}-\d{4}-\d{4,}\b/g, replacement: PLACEHOLDERS.applicationNo },
    {
        name: 'machine_path',
        // 占位值故意不写成「用户主目录」那种形式：否则脱敏后的夹具本身
        // 又会被 checkGitBoundary() 的「本机绝对路径」规则拦下来。
        pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+\//g,
        replacement: '/redacted-home/',
    },
    {
        name: 'resume_filename',
        pattern: /\b[\p{Script=Han}A-Za-z0-9_-]{1,40}\.(?:pdf|docx?|zip)\b/gu,
        replacement: PLACEHOLDERS.fileName,
    },
];
/** 网络样本里按 key 清掉的敏感字段名。 */
const SENSITIVE_KEYS = [
    'token',
    'accesstoken',
    'refreshtoken',
    'cookie',
    'authorization',
    'csrf',
    'sessionid',
    'candidateid',
    'userid',
    'applicantid',
    'applicationno',
    'phone',
    'mobile',
    'email',
    'idcard',
    'idnumber',
    'name',
    'realname',
];
function isSensitiveKey(key) {
    const normalized = key.toLowerCase().replace(/[_-]/g, '');
    return SENSITIVE_KEYS.includes(normalized);
}
function applyContentRules(text, counters, extraSecrets) {
    let output = text;
    // 先清掉调用方点名的真实值，例如用户自己的姓名。
    for (const secret of extraSecrets) {
        if (secret.length < 2) {
            continue;
        }
        const before = output;
        output = output.split(secret).join(PLACEHOLDERS.generic);
        if (output !== before) {
            counters.set('extra_secret', (counters.get('extra_secret') ?? 0) + 1);
        }
    }
    for (const rule of CONTENT_RULES) {
        const matches = output.match(rule.pattern);
        if (matches !== null) {
            counters.set(rule.name, (counters.get(rule.name) ?? 0) + matches.length);
            output = output.replace(rule.pattern, rule.replacement);
        }
    }
    return output;
}
/** 清空 DOM 里的用户输入。只留结构，不留内容。 */
export function stripDomValues(html, counters) {
    let output = html;
    const rules = [
        ['dom_value', /(<input\b[^>]*?)\svalue="[^"]*"/gi, '$1 value=""'],
        ['dom_checked', /(<input\b[^>]*?)\schecked(?:="[^"]*")?/gi, '$1'],
        ['dom_selected', /(<option\b[^>]*?)\sselected(?:="[^"]*")?/gi, '$1'],
        ['dom_textarea', /(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi, '$1$2'],
    ];
    for (const [name, pattern, replacement] of rules) {
        const matches = output.match(pattern);
        if (matches !== null) {
            counters.set(name, (counters.get(name) ?? 0) + matches.length);
            output = output.replace(pattern, replacement);
        }
    }
    return output;
}
function sanitizeJson(value, counters, extraSecrets) {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeJson(item, counters, extraSecrets));
    }
    if (typeof value === 'object' && value !== null) {
        const output = {};
        for (const [key, child] of Object.entries(value)) {
            if (isSensitiveKey(key)) {
                counters.set('sensitive_key', (counters.get('sensitive_key') ?? 0) + 1);
                output[key] = PLACEHOLDERS.generic;
                continue;
            }
            output[key] = sanitizeJson(child, counters, extraSecrets);
        }
        return output;
    }
    if (typeof value === 'string') {
        return applyContentRules(value, counters, extraSecrets);
    }
    return value;
}
/** 清完再扫一遍。这一步是「不要只靠正则替换」的兜底。 */
export function findRemainingSuspicions(text) {
    const suspicions = [];
    for (const rule of CONTENT_RULES) {
        const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
        const matches = text.match(pattern) ?? [];
        // 替换后的占位值本身会命中规则，要排除掉。
        const real = matches.filter((match) => match !== rule.replacement &&
            !Object.values(PLACEHOLDERS).some((placeholder) => match.includes(placeholder)));
        if (real.length > 0) {
            suspicions.push(`${rule.name} 仍有 ${real.length} 处未清理`);
        }
    }
    return suspicions;
}
export function sanitizeFixture(input) {
    const counters = new Map();
    const extraSecrets = input.extraSecrets ?? [];
    const html = applyContentRules(stripDomValues(input.html, counters), counters, extraSecrets);
    const pageSchema = input.pageSchema === undefined
        ? undefined
        : sanitizeJson(JSON.parse(JSON.stringify(input.pageSchema)), counters, extraSecrets);
    const networkSamples = input.networkSamples === undefined
        ? undefined
        : input.networkSamples.map((sample) => sanitizeJson(sample, counters, extraSecrets));
    const combined = [
        html,
        pageSchema === undefined ? '' : JSON.stringify(pageSchema),
        networkSamples === undefined ? '' : JSON.stringify(networkSamples),
    ].join('\n');
    const suspicions = findRemainingSuspicions(combined);
    return {
        html,
        ...(pageSchema === undefined ? {} : { pageSchema }),
        ...(networkSamples === undefined ? {} : { networkSamples }),
        redactions: [...counters].map(([rule, count]) => ({ rule, count })),
        stillSuspicious: suspicions.length > 0,
        suspicions,
    };
}
//# sourceMappingURL=sanitize-fixture.js.map