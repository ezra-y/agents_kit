import { openApplicationPage } from "../browser/session/open-application-page.js";
import { isMokaRecruitmentPath } from "../site-adapters/moka/routes.js";
function isFeishuJobsHost(hostname) {
    return hostname.endsWith('.jobs.feishu.cn');
}
async function isFeishuJobsPage(page) {
    return (isFeishuJobsHost(new URL(page.url()).hostname) ||
        (await page.locator('#js-websiteInfo').count()) > 0);
}
function isMokaRecruitmentHost(hostname) {
    return hostname === 'app.mokahr.com' || hostname === 'envision-career.com';
}
function isMokaRecruitmentPage(url) {
    return (isMokaRecruitmentHost(url.hostname) ||
        isMokaRecruitmentPath(url.pathname));
}
function feishuPortalPrefix(url) {
    const [first = 'campus'] = url.pathname.split('/').filter(Boolean);
    return first === 'resume' ? '' : first;
}
function isResumeEditor(url, feishuJobsPage = false) {
    if (url.hostname === 'jobs.bilibili.com') {
        return url.pathname === '/campus/resume';
    }
    if (url.hostname === 'campus.jobs.netease.com') {
        return url.pathname === '/app/personal/resume';
    }
    if (url.hostname === 'talent.baidu.com') {
        return url.pathname === '/jobs/resume/edit' || url.pathname === '/jobs/resume/create';
    }
    if (url.hostname === 'zhaopin.kuaishou.cn') {
        return url.hash.startsWith('#/official/resume-preview/');
    }
    if (url.hostname === 'campus.didiglobal.com') {
        return (url.hash.startsWith('#/candidateHome/resume') ||
            url.hash.startsWith('#/personal-center/resumeInfo'));
    }
    if (isMokaRecruitmentPage(url)) {
        return (isMokaRecruitmentPath(url.pathname) &&
            url.hash.startsWith('#/candidateHome/resume'));
    }
    if (url.hostname === 'careers.pddglobalhr.com') {
        return url.pathname === '/campus/resume-apply';
    }
    if (url.hostname === 'hr.4399om.com') {
        return (/^\/uc\/resume-step-edit\/\d+\/?$/.test(url.pathname) ||
            /^\/uc\/person-center\/resume-full-edit\/\d+\/?$/.test(url.pathname));
    }
    if (url.hostname === 'jobs.mihoyo.com') {
        return url.hash.startsWith('#/campus/resume/edit');
    }
    if (url.hostname === 'xiaomi.jobs.f.mioffice.cn') {
        return url.pathname === '/campus/resume/edit';
    }
    if (isFeishuJobsHost(url.hostname) || feishuJobsPage) {
        return /\/(?:[^/]+\/)?resume\/(?:edit|view)\/?$/.test(url.pathname);
    }
    return /(?:^|\/)(?:resume|cv)(?:\/|$)/i.test(url.pathname);
}
function knownResumeRoute(url, feishuJobsPage = false) {
    if (url.hostname === 'jobs.bilibili.com') {
        return `${url.origin}/campus/resume`;
    }
    if (url.hostname === 'campus.jobs.netease.com') {
        return `${url.origin}/app/personal/resume`;
    }
    if (url.hostname === 'talent.baidu.com') {
        return `${url.origin}/jobs/center?dev=0`;
    }
    if (url.hostname === 'zhaopin.kuaishou.cn') {
        return `${url.origin}/#/official/resume-preview/`;
    }
    if (url.hostname === 'campus.didiglobal.com') {
        return `${url.origin}${url.pathname}#/candidateHome/resume`;
    }
    if (isMokaRecruitmentPage(url) &&
        isMokaRecruitmentPath(url.pathname)) {
        return `${url.origin}${url.pathname}#/candidateHome/resume`;
    }
    if (url.hostname === 'careers.pddglobalhr.com') {
        return `${url.origin}/campus/resume-apply`;
    }
    if (url.hostname === 'hr.4399om.com') {
        return `${url.origin}/uc/person-center/resume-full-edit/1`;
    }
    if (url.hostname === 'campus.jd.com') {
        return `${url.origin}/web/`;
    }
    if (url.hostname === 'jobs.mihoyo.com') {
        return `${url.origin}/#/campus/resume/edit`;
    }
    if (url.hostname === 'xiaomi.jobs.f.mioffice.cn') {
        return `${url.origin}/campus/resume/edit`;
    }
    if (url.hostname === 'career.anker.com.cn') {
        return 'https://anker-in.jobs.feishu.cn/campushirecn/resume/edit';
    }
    if (isFeishuJobsHost(url.hostname) || feishuJobsPage) {
        const prefix = feishuPortalPrefix(url);
        return `${url.origin}/${prefix === '' ? '' : `${prefix}/`}resume/edit`;
    }
    return undefined;
}
function scoreResumeLink(candidate) {
    let score = 0;
    if (/\/resume\/(?:edit|create)(?:[/?#]|$)/i.test(candidate.href)) {
        score += 100;
    }
    else if (/\/(?:resume|cv)(?:[/?#]|$)/i.test(candidate.href)) {
        score += 50;
    }
    if (/编辑简历|修改简历|完善简历|更新简历/.test(candidate.text)) {
        score += 40;
    }
    else if (/我的简历|在线简历|个人简历|简历/.test(candidate.text)) {
        score += 20;
    }
    return score;
}
async function findResumeLink(page) {
    const current = new URL(page.url());
    const links = await page.locator('a[href]').evaluateAll((elements) => elements.map((element) => ({
        href: element.href,
        text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })));
    return links
        .filter((candidate) => {
        try {
            return new URL(candidate.href).hostname === current.hostname;
        }
        catch {
            return false;
        }
    })
        .map((candidate) => ({ candidate, score: scoreResumeLink(candidate) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)[0]?.candidate.href;
}
async function hasVisibleLoginEntry(page) {
    const login = page.getByText('登录', { exact: true }).first();
    return (await login.count()) > 0 && login.isVisible().catch(() => false);
}
async function waitForKnownSession(page, feishuJobsPage = false) {
    const url = new URL(page.url());
    if (url.hostname === 'talent.baidu.com') {
        const account = page.getByText(/你好[，,]/).first();
        await account.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
        if (!(await account.isVisible().catch(() => false))) {
            throw new Error('resume_login_required: 当前账号需要先登录百度招聘');
        }
        if (url.pathname === '/jobs/resume/edit' && url.searchParams.has('id')) {
            await page
                .waitForFunction(() => {
                const input = document.querySelector('input[name="name"]');
                return input !== null && input.value.trim() !== '';
            }, undefined, { timeout: 20_000 })
                .catch(() => undefined);
            const name = await page.locator('input[name="name"]').inputValue().catch(() => '');
            if (name.trim() === '') {
                throw new Error('resume_server_data_not_loaded: 百度已有简历页面未加载服务器姓名字段');
            }
        }
        return;
    }
    if (url.hostname === 'hr.4399om.com') {
        await page
            .getByText(/基本信息|教育经历|工作经历|项目经历/)
            .first()
            .waitFor({ state: 'visible', timeout: 20_000 })
            .catch(() => undefined);
        if (await visiblePhoneLogin(page)) {
            throw new Error('resume_login_required: 当前账号需要先登录招聘站');
        }
        return;
    }
    if (url.hostname === 'zhaopin.kuaishou.cn') {
        const account = page.getByText(/156\*+7172/).first();
        await account.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
        if (!(await account.isVisible().catch(() => false))) {
            throw new Error('resume_login_required: 当前账号需要先登录快手招聘');
        }
        await page.getByText('我的简历', { exact: true }).first()
            .waitFor({ state: 'visible', timeout: 15_000 });
        return;
    }
    if (url.hostname === 'campus.didiglobal.com') {
        await page
            .getByText('我的简历', { exact: true })
            .first()
            .waitFor({ state: 'visible', timeout: 15_000 })
            .catch(() => undefined);
        if (await hasVisibleLoginEntry(page)) {
            throw new Error('resume_login_required: 当前账号需要先登录滴滴招聘');
        }
        return;
    }
    if (isMokaRecruitmentPage(url)) {
        await page
            .getByText('我的简历', { exact: true })
            .first()
            .waitFor({ state: 'visible', timeout: 15_000 })
            .catch(() => undefined);
        if (await hasVisibleLoginEntry(page)) {
            throw new Error('resume_login_required: 当前账号需要先登录 Moka 招聘');
        }
        return;
    }
    if (url.hostname === 'jobs.mihoyo.com') {
        await page
            .getByText('个人信息', { exact: true })
            .first()
            .waitFor({ state: 'visible', timeout: 20_000 })
            .catch(() => undefined);
        const token = await page
            .evaluate(() => window.localStorage.getItem('Jobs-Token') ?? '')
            .catch(() => '');
        if (token === '' ||
            (await page.locator('iframe[src*="login-platform"]').count()) > 0) {
            throw new Error('resume_login_required: 当前账号需要先登录米哈游招聘');
        }
        return;
    }
    if (url.hostname === 'xiaomi.jobs.f.mioffice.cn') {
        await page
            .getByText(/创建简历|编辑简历/, { exact: true })
            .first()
            .waitFor({ state: 'visible', timeout: 20_000 })
            .catch(() => undefined);
        if ((await page.getByText(/1568\*+172/).count()) === 0 ||
            (await hasVisibleLoginEntry(page))) {
            throw new Error('resume_login_required: 当前账号需要先登录小米招聘');
        }
        return;
    }
    if (isFeishuJobsHost(url.hostname) || feishuJobsPage) {
        await page
            .getByText(/创建简历|编辑简历/)
            .first()
            .waitFor({ state: 'visible', timeout: 20_000 })
            .catch(() => undefined);
        if (await hasVisibleLoginEntry(page)) {
            throw new Error('resume_login_required: 当前账号需要先登录飞书招聘站');
        }
        return;
    }
    if (await hasVisibleLoginEntry(page)) {
        throw new Error('resume_login_required: 当前账号需要先登录招聘站');
    }
}
async function visiblePhoneLogin(page) {
    const phone = page.getByPlaceholder('请输入手机号').first();
    return (await phone.count()) > 0 && phone.isVisible().catch(() => false);
}
async function navigate(request, url) {
    await openApplicationPage(request.session, {
        runId: request.runId,
        url,
    });
    return {
        url: request.page.url(),
        title: await request.page.title().catch(() => ''),
    };
}
export async function openResumePage(request) {
    const current = new URL(request.page.url());
    const feishuJobsPage = await isFeishuJobsPage(request.page);
    if (isResumeEditor(current, feishuJobsPage)) {
        const opened = await navigate(request, current.toString());
        await waitForKnownSession(request.page, feishuJobsPage);
        return { resumeUrl: opened.url, title: opened.title, source: 'already_open' };
    }
    const knownRoute = knownResumeRoute(current, feishuJobsPage);
    if (knownRoute !== undefined) {
        const opened = await navigate(request, knownRoute);
        const openedFeishuJobsPage = await isFeishuJobsPage(request.page);
        await waitForKnownSession(request.page, openedFeishuJobsPage);
        const openedUrl = new URL(opened.url);
        if (isResumeEditor(openedUrl, openedFeishuJobsPage)) {
            return { resumeUrl: opened.url, title: opened.title, source: 'known_route' };
        }
        const campusResume = request.page
            .getByText('切换校招简历', { exact: true })
            .first();
        if ((await campusResume.count()) > 0 &&
            await campusResume.isVisible().catch(() => false)) {
            await campusResume.click();
            await request.page
                .getByText('切换社招简历', { exact: true })
                .first()
                .waitFor({ state: 'visible', timeout: 20_000 })
                .catch(() => undefined);
        }
        const edit = request.page
            .locator('button:visible, a:visible, [role=button]:visible, .btn-edit:visible')
            .filter({ hasText: /^\s*(?:编辑简历|完善简历)\s*$/ })
            .first();
        if ((await edit.count()) > 0 && await edit.isVisible().catch(() => false)) {
            await Promise.all([
                request.page
                    .waitForURL((url) => isResumeEditor(url, openedFeishuJobsPage), {
                    timeout: 20_000,
                })
                    .catch(() => undefined),
                edit.click(),
            ]);
            const editedUrl = new URL(request.page.url());
            if (isResumeEditor(editedUrl, openedFeishuJobsPage)) {
                return {
                    resumeUrl: editedUrl.toString(),
                    title: await request.page.title().catch(() => opened.title),
                    source: 'known_route',
                };
            }
        }
    }
    await request.page
        .locator('a[href*="resume"], a:has-text("简历")')
        .first()
        .waitFor({ state: 'attached', timeout: 8_000 })
        .catch(() => undefined);
    const discovered = await findResumeLink(request.page);
    if (discovered === undefined) {
        throw new Error(`resume_entry_not_found: 当前页面 ${request.page.url()} 没有找到可用的站内简历入口`);
    }
    const opened = await navigate(request, discovered);
    const openedFeishuJobsPage = await isFeishuJobsPage(request.page);
    await waitForKnownSession(request.page, openedFeishuJobsPage);
    if (!isResumeEditor(new URL(opened.url), openedFeishuJobsPage)) {
        throw new Error(`resume_editor_not_reached: 简历链接最终打开了 ${opened.url}`);
    }
    return { resumeUrl: opened.url, title: opened.title, source: 'page_link' };
}
//# sourceMappingURL=open-resume-page.js.map