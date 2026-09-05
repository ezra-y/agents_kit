const SCORE = {
    exactUrl: 100,
    sameOrigin: 60,
    sameHost: 50,
    titleHint: 15,
    blank: 5,
};
/** 强到可以直接用的分数线。低于它只能当参考。 */
const CONFIDENT_SCORE = SCORE.sameHost;
/** 分差小于它就算「一样强」，不自己选。 */
const AMBIGUITY_GAP = SCORE.titleHint;
const BLANK_URLS = new Set(['about:blank', 'chrome://newtab/', 'edge://newtab/', '']);
function parse(rawUrl) {
    try {
        return new URL(rawUrl);
    }
    catch {
        return undefined;
    }
}
/** 去掉末尾斜杠和 query，避免同一页因为参数不同被当成两页。 */
function normalize(rawUrl) {
    const parsed = parse(rawUrl);
    if (parsed === undefined) {
        return rawUrl;
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
}
export function scoreAttachCandidate(candidate, input) {
    const reasons = [];
    let score = 0;
    const target = parse(input.targetUrl);
    const current = parse(candidate.url);
    if (normalize(candidate.url) === normalize(input.targetUrl) && current !== undefined) {
        score += SCORE.exactUrl;
        reasons.push('就是这一页');
    }
    else if (target !== undefined && current !== undefined) {
        if (current.origin === target.origin) {
            score += SCORE.sameOrigin;
            reasons.push(`同源 ${current.origin}`);
        }
        else if (current.hostname === target.hostname) {
            score += SCORE.sameHost;
            reasons.push(`同 host ${current.hostname}`);
        }
    }
    const title = candidate.title ?? '';
    for (const hint of input.titleHints ?? []) {
        if (hint !== '' && title.includes(hint)) {
            score += SCORE.titleHint;
            reasons.push(`标题里有「${hint}」`);
        }
    }
    if (BLANK_URLS.has(candidate.url)) {
        score += SCORE.blank;
        reasons.push('是空白页，可以拿来用');
    }
    return { ...candidate, score, reasons };
}
export function selectAttachTarget(input) {
    if (input.candidates.length === 0) {
        return { kind: 'none', reason: '接管的浏览器里一个标签页都没有' };
    }
    const scored = input.candidates
        .map((candidate) => scoreAttachCandidate(candidate, input))
        .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best === undefined || best.score === 0) {
        return {
            kind: 'none',
            reason: `${input.candidates.length} 个标签页都和 ${input.targetUrl} 对不上。` +
                '需要新开一个标签，或者由你指定用哪个。',
        };
    }
    // 够强的候选里有没有并列的。并列就不自己选。
    const strong = scored.filter((item) => item.score >= CONFIDENT_SCORE);
    if (strong.length > 1) {
        const second = strong[1];
        if (second !== undefined && best.score - second.score < AMBIGUITY_GAP) {
            return {
                kind: 'ambiguous',
                candidates: strong,
                reason: `有 ${strong.length} 个标签页都像是目标页（分数 ${strong
                    .map((item) => item.score)
                    .join(' / ')}）。挑错标签会在别的网页上填字点按钮，所以这里不猜，请你指定一个。`,
            };
        }
    }
    if (best.score >= CONFIDENT_SCORE) {
        return { kind: 'matched', target: best };
    }
    // 只剩空白页或标题弱匹配：能用，但要说清这不是「找到了目标页」。
    return { kind: 'blank', target: best };
}
/**
 * 从一个真的 Browser 里收集候选，然后挑。
 *
 * 分成两层是为了让上面的挑选逻辑能脱离浏览器测——
 * 「开着七八个标签时会不会挑错」这种事，靠真机测很难覆盖全。
 */
export async function selectAttachTargetFromBrowser(browser, targetUrl, titleHints = []) {
    const contexts = browser.contexts();
    const candidates = [];
    const pageAt = new Map();
    for (const [contextIndex, context] of contexts.entries()) {
        for (const [pageIndex, page] of context.pages().entries()) {
            // 标题读不到不影响挑选，只是少一条辅助证据。
            const title = await page.title().catch(() => undefined);
            candidates.push({
                contextIndex,
                pageIndex,
                url: page.url(),
                ...(title === undefined ? {} : { title }),
            });
            pageAt.set(`${contextIndex}:${pageIndex}`, page);
        }
    }
    const result = selectAttachTarget({ candidates, targetUrl, titleHints });
    if (result.kind === 'matched' || result.kind === 'blank') {
        const key = `${result.target.contextIndex}:${result.target.pageIndex}`;
        const context = contexts[result.target.contextIndex];
        return {
            result,
            ...(pageAt.get(key) === undefined ? {} : { page: pageAt.get(key) }),
            ...(context === undefined ? {} : { context }),
        };
    }
    return { result };
}
//# sourceMappingURL=select-attach-target.js.map