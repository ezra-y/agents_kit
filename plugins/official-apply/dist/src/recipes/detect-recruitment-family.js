/**
 * 已知家族表。
 *
 * 第一版只放公开可查、特征明确的几个。
 * 真实投递中确认新家族后，先进 `.local/learning/`，人工审核后才加到这里。
 */
const FAMILY_RULES = [
    {
        familyKey: 'moka',
        displayName: 'Moka',
        hostPatterns: ['mokahr.com', 'moka.hr'],
        scriptHostPatterns: ['mokahr.com'],
        apiPathPatterns: ['/api/apply', '/hr/api'],
        // `moka-version` 是 2026-08-20 在 app.mokahr.com 的真实页面上量到的隐藏字段。
        // 它比域名更有价值：用自己域名部署这套系统的公司拿不到域名信号，这个标记还在。
        domMarkers: ['data-moka', 'moka-version'],
    },
    {
        familyKey: 'beisen',
        displayName: '北森',
        hostPatterns: ['beisen.com', 'italent.cn'],
        scriptHostPatterns: ['beisen.com', 'italent.cn'],
        apiPathPatterns: ['/recruitment/api'],
        domMarkers: ['data-beisen'],
    },
    {
        familyKey: 'workday',
        displayName: 'Workday',
        hostPatterns: ['myworkdayjobs.com', 'workday.com'],
        scriptHostPatterns: ['workday.com'],
        apiPathPatterns: ['/wday/'],
        domMarkers: ['data-automation-id'],
    },
    {
        familyKey: 'greenhouse',
        displayName: 'Greenhouse',
        hostPatterns: ['greenhouse.io'],
        scriptHostPatterns: ['greenhouse.io'],
        apiPathPatterns: ['/embed/job_app'],
    },
    {
        familyKey: 'lever',
        displayName: 'Lever',
        hostPatterns: ['lever.co'],
        scriptHostPatterns: ['lever.co'],
        apiPathPatterns: ['/postings/'],
    },
];
const WEIGHTS = {
    domain: 0.5,
    script_url: 0.25,
    api_path: 0.2,
    dom: 0.2,
    metadata: 0.15,
};
function hostOf(rawUrl) {
    try {
        return new URL(rawUrl).host.toLowerCase();
    }
    catch {
        return '';
    }
}
function matchesHost(host, patterns) {
    return patterns?.find((pattern) => host.includes(pattern));
}
export function detectRecruitmentFamily(input) {
    const pageHost = hostOf(input.pageUrl);
    const scriptHosts = (input.scriptUrls ?? []).map(hostOf).filter((host) => host !== '');
    const apiPatterns = input.apiUrlPatterns ?? [];
    const domMarkers = (input.domMarkers ?? []).map((marker) => marker.toLowerCase());
    const meta = (input.metaGenerator ?? '').toLowerCase();
    let best;
    for (const rule of FAMILY_RULES) {
        const signals = [];
        const hostHit = matchesHost(pageHost, rule.hostPatterns);
        if (hostHit !== undefined) {
            signals.push({ kind: 'domain', value: `页面域名命中 ${hostHit}`, weight: WEIGHTS.domain });
        }
        for (const scriptHost of scriptHosts) {
            const scriptHit = matchesHost(scriptHost, rule.scriptHostPatterns);
            if (scriptHit !== undefined) {
                signals.push({
                    kind: 'script_url',
                    value: `脚本域名命中 ${scriptHit}`,
                    weight: WEIGHTS.script_url,
                });
                break;
            }
        }
        const apiHit = rule.apiPathPatterns?.find((pattern) => apiPatterns.some((candidate) => candidate.includes(pattern)));
        if (apiHit !== undefined) {
            signals.push({ kind: 'api_path', value: `接口路径命中 ${apiHit}`, weight: WEIGHTS.api_path });
        }
        const domHit = rule.domMarkers?.find((marker) => domMarkers.some((candidate) => candidate.includes(marker.toLowerCase())));
        if (domHit !== undefined) {
            signals.push({ kind: 'dom', value: `DOM 标记命中 ${domHit}`, weight: WEIGHTS.dom });
        }
        const metaHit = rule.metaPatterns?.find((pattern) => meta.includes(pattern.toLowerCase()));
        if (metaHit !== undefined) {
            signals.push({ kind: 'metadata', value: `页面元信息命中 ${metaHit}`, weight: WEIGHTS.metadata });
        }
        const score = signals.reduce((sum, signal) => sum + signal.weight, 0);
        if (score > 0 && (best === undefined || score > best.score)) {
            best = { rule, signals, score };
        }
    }
    // 只有一条弱证据时不算数：宁可返回 unknown，也不硬猜。
    if (best === undefined || best.score < WEIGHTS.api_path) {
        return { familyKey: 'unknown', confidence: 0, signals: best?.signals ?? [] };
    }
    return {
        familyKey: best.rule.familyKey,
        confidence: Number(Math.min(0.95, best.score).toFixed(2)),
        signals: best.signals,
    };
}
/** 已知家族的 key 列表，供 knowledge.sqlite 初始化和测试使用。 */
export function knownFamilyKeys() {
    return FAMILY_RULES.map((rule) => rule.familyKey);
}
//# sourceMappingURL=detect-recruitment-family.js.map