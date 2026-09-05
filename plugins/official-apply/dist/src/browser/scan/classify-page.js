import { findSubmissionSuccessText } from "../../submission/submission-success-text.js";
function anyIncludes(haystack, needles) {
    const hits = [];
    for (const needle of needles) {
        for (const text of haystack) {
            if (text.toLowerCase().includes(needle.toLowerCase())) {
                hits.push(`命中「${needle}」`);
                break;
            }
        }
    }
    return hits;
}
/** URL 路径拆成小写段。只作证据之一，不单独定论。 */
function urlPathSegments(url) {
    try {
        return new URL(url)
            .pathname.split('/')
            .map((segment) => segment.toLowerCase())
            .filter((segment) => segment !== '');
    }
    catch {
        return [];
    }
}
/** 路径里有独立的 `/login` 段才算登录 URL。`login-guide` 那种整段不算。 */
function isLoginPath(url) {
    const segments = urlPathSegments(url);
    return segments.some((segment) => segment === 'login' || segment === 'signin');
}
/**
 * 路径像「单个岗位详情」才算。职位列表（没有数字 id 的 `/positions`）不算。
 *
 * 命中模式（真实站点量出来的）：
 * - Feishu：`.../position/<id>/detail`
 * - Bilibili：`.../campus/positions/<id>`
 * - PDD：`.../campus/grad/detail`
 */
function isJobDetailPath(url) {
    const segments = urlPathSegments(url);
    if (segments.length === 0)
        return false;
    const JOB_MARKERS = ['position', 'positions', 'job', 'jobs'];
    if (segments.includes('detail')) {
        return (segments.includes('grad') ||
            JOB_MARKERS.some((marker) => segments.includes(marker)));
    }
    const numeric = (value) => value !== undefined && /^\d+$/.test(value);
    const markerIndexes = [];
    for (const marker of JOB_MARKERS) {
        let index = segments.indexOf(marker);
        while (index >= 0) {
            markerIndexes.push(index);
            index = segments.indexOf(marker, index + 1);
        }
    }
    if (markerIndexes.length === 0)
        return false;
    return numeric(segments.at(-1)) || markerIndexes.some((index) => numeric(segments[index + 1]));
}
/** 简历编辑路径。字段还没加载时用来兜底判成申请表。 */
function isResumeEditPath(url) {
    return urlPathSegments(url).some((segment) => segment.startsWith('resume-full-edit') ||
        segment === 'shownewresume' ||
        segment.startsWith('resume-edit'));
}
const RULES = [
    {
        pageType: 'captcha',
        priority: 100,
        match: (evidence) => evidence.hasCaptchaSignal
            ? ['出现验证码控件']
            : anyIncludes([evidence.bodyTextSample, ...evidence.headings], ['验证码', 'captcha', '人机验证']),
    },
    {
        pageType: 'login',
        priority: 90,
        /**
         * 判成登录页要很谨慎。
         *
         * **几乎每个真实招聘网站的导航栏里都有一个「Sign In」。**
         * 只要按钮文字命中就判登录，会让 Workday 的职位搜索页、
         * Greenhouse 的申请页统统被判成「需要登录」，主流程一上来就停死。
         * 2026-08-20 在真实 Workday 站点上实测撞到。
         *
         * 所以只认两种证据：
         * 1. 页面上真的有密码输入框——这个几乎不会错。
         * 2. 标题或大标题明说是登录，**而且**页面上没几个字段（登录表就两三个框）。
         *
         * 动作按钮文字不再作为证据：那是导航栏，不是这一页在干什么。
         */
        match: (evidence) => {
            if (evidence.hasPasswordField) {
                return ['出现密码输入框'];
            }
            // 字段一多就不是登录页，是带登录入口的业务页面。
            const LOGIN_FORM_MAX_FIELDS = 4;
            if (evidence.fieldCount > LOGIN_FORM_MAX_FIELDS) {
                return [];
            }
            // URL 只作证据之一。路径里独立的 `/login` 段常在字段没加载出来时就明示这是登录页。
            const signals = [];
            if (isLoginPath(evidence.url)) {
                signals.push('URL 路径含独立 /login 段');
            }
            return [...signals, ...anyIncludes([evidence.title, ...evidence.headings], [
                    '登录',
                    '登陆',
                    'sign in',
                    'log in',
                ])];
        },
    },
    {
        pageType: 'submission_success',
        priority: 85,
        match: (evidence) => {
            const match = findSubmissionSuccessText([evidence.title, ...evidence.headings]);
            return match === undefined ? [] : [`命中「${match}」`];
        },
    },
    {
        pageType: 'submission_confirmation',
        // 只看「有没有提交按钮」会误判：很多单页申请表最后一屏就带最终提交按钮。
        // 真正的确认页要么几乎没有可编辑字段，要么标题里明说是确认或预览。
        priority: 80,
        match: (evidence) => {
            const commitHits = anyIncludes(evidence.actionLabels, [
                '确认提交',
                '确认投递',
                '提交申请',
                '确认并提交',
            ]);
            if (commitHits.length === 0) {
                return [];
            }
            const reviewHits = anyIncludes([evidence.title, ...evidence.headings], [
                '确认信息',
                '信息确认',
                '预览',
                '请确认',
            ]);
            if (reviewHits.length > 0) {
                return [...commitHits, ...reviewHits];
            }
            return evidence.fieldCount <= 2 ? [...commitHits, '页面几乎没有可编辑字段'] : [];
        },
    },
    {
        pageType: 'application_list',
        priority: 70,
        match: (evidence) => anyIncludes([evidence.title, ...evidence.headings], ['我的申请', '投递记录', '申请列表']),
    },
    {
        pageType: 'error',
        priority: 65,
        match: (evidence) => anyIncludes([evidence.title, ...evidence.headings], ['出错', '错误', '404', '页面不存在']),
    },
    {
        pageType: 'application_form',
        priority: 50,
        match: (evidence) => {
            if (evidence.fieldCount >= 2) {
                return [`表单字段 ${evidence.fieldCount} 个`];
            }
            // 简历编辑路径在字段还没加载出来时兜底判成申请表。
            if (isResumeEditPath(evidence.url)) {
                return ['URL 命中简历编辑路径'];
            }
            return [];
        },
    },
    {
        pageType: 'job_detail',
        priority: 40,
        match: (evidence) => {
            const pathHits = isJobDetailPath(evidence.url) ? ['URL 命中岗位详情路径'] : [];
            const textHits = anyIncludes([evidence.title, ...evidence.headings], [
                '岗位详情',
                '职位详情',
                '招聘详情',
                '职位信息',
                '岗位信息',
                '职位要求',
                'job detail',
                'position detail',
            ]);
            return [...pathHits, ...textHits];
        },
    },
];
export function classifyPage(evidence) {
    const ordered = [...RULES].sort((a, b) => b.priority - a.priority);
    for (const rule of ordered) {
        const signals = rule.match(evidence);
        if (signals.length > 0) {
            // 证据越多越有把握，但不给满分：页面类型永远可能被网站改版打脸。
            const confidence = Math.min(0.95, 0.5 + signals.length * 0.15);
            return { pageType: rule.pageType, confidence, matchedSignals: signals };
        }
    }
    return { pageType: 'unknown', confidence: 0.2, matchedSignals: [] };
}
//# sourceMappingURL=classify-page.js.map