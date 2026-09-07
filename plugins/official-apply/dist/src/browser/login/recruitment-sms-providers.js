import { createSmsLoginProvider, } from "./create-sms-login-provider.js";
async function visible(locator) {
    return (await locator.count()) > 0 && locator.isVisible().catch(() => false);
}
async function bodyError(page, pattern) {
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const match = text.match(pattern);
    return match?.[0];
}
async function genericCaptcha(page) {
    const controls = page.locator([
        'iframe[src*="captcha"]:visible',
        'iframe[src*="verify"]:visible',
        '.geetest_panel:visible',
        '.yidun_panel:visible',
        '.captcha-container:visible',
        '#captcha_dom:visible',
        '.captcha_drop:visible',
        '.drag-box:visible',
        '[class*="captcha-slider"]:visible',
        '[class*="verify-dialog"]:visible',
    ].join(', '));
    if ((await controls.count()) > 0)
        return true;
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    return /安全验证|请完成验证|拖动滑块|图片验证码|图形验证码/.test(text);
}
async function clickLoginEntry(page) {
    const entry = page.getByText('登录', { exact: true }).first();
    if (await visible(entry))
        await entry.click();
}
async function prepareAtsxSmsForm(page) {
    await page.waitForTimeout(250);
    const phonePrefix = page.locator('[data-cy="phonePrefix"]:visible').first();
    if ((await phonePrefix.count()) > 0 &&
        !/\+86/.test(await phonePrefix.innerText().catch(() => ''))) {
        await phonePrefix.click();
        const mainlandChina = page.getByText('中国大陆', { exact: true }).last();
        await mainlandChina.waitFor({ state: 'visible', timeout: 5_000 });
        await mainlandChina.click();
        if (!/\+86/.test(await phonePrefix.innerText().catch(() => ''))) {
            throw new Error('飞书招聘手机号区号没有切换到 +86');
        }
    }
    const checkbox = page.locator('input[type=checkbox]:visible').first();
    if ((await checkbox.count()) > 0 &&
        !(await checkbox.isChecked().catch(() => false))) {
        await checkbox.check({ force: true });
    }
    const button = page.locator('.loginForm-validCode button:visible').first();
    await page.waitForFunction((element) => element instanceof HTMLButtonElement &&
        !element.disabled &&
        element.getAttribute('aria-disabled') !== 'true', await button.elementHandle(), { timeout: 5_000 });
}
export function classifyPddSmsSendResponse(value) {
    const body = value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const accepted = body['success'] === true;
    const rawCode = body['errorCode'];
    const rawMessage = body['errorMsg'];
    const errorCode = typeof rawCode === 'string' || typeof rawCode === 'number'
        ? String(rawCode)
        : undefined;
    const message = typeof rawMessage === 'string' && rawMessage.trim() !== ''
        ? rawMessage.trim().slice(0, 200)
        : errorCode === undefined
            ? undefined
            : `拼多多短信接口拒绝请求（业务码 ${errorCode}）`;
    return {
        accepted,
        ...(accepted || errorCode === undefined ? {} : { errorCode }),
        ...(accepted || message === undefined ? {} : { message }),
        evidence: [
            accepted
                ? '拼多多短信发送接口明确返回成功'
                : `拼多多短信发送接口明确返回失败${errorCode === undefined ? '' : `，业务码 ${errorCode}`}`,
        ],
    };
}
export const meituanLogin = createSmsLoginProvider({
    id: 'meituan.campus.sms',
    hosts: ['zhaopin.meituan.com'],
    async prepare(page) {
        if (!new URL(page.url()).pathname.includes('/web/login')) {
            await clickLoginEntry(page);
            await page.waitForURL(/\/web\/login/, { timeout: 20_000 });
        }
    },
    async isLoggedIn(page) {
        const path = new URL(page.url()).pathname;
        return !path.includes('/web/login') && !(await visible(page.getByText('登录', { exact: true }).first()));
    },
    phoneInput: (page) => page.getByPlaceholder('请输入11位手机号码').first(),
    codeInput: (page) => page.getByPlaceholder('验证码').first(),
    sendButton: (page) => page.getByText('获取验证码', { exact: true }).first(),
    submitButton: (page) => page.getByText('立即登录', { exact: true }).first(),
    agreement: (page) => page.locator('input[type=checkbox]:visible').first(),
    hasCaptcha: genericCaptcha,
    visibleError: (page) => bodyError(page, /请求异常|拒绝操作|发送失败|操作频繁/),
});
export const didiLogin = createSmsLoginProvider({
    id: 'didi.campus.sms',
    hosts: ['campus.didiglobal.com'],
    async prepare(page) {
        await clickLoginEntry(page);
    },
    async isLoggedIn(page) {
        return (!(await visible(page.getByPlaceholder('请输入手机号').first())) &&
            !(await visible(page.getByText('登录', { exact: true }).first())));
    },
    phoneInput: (page) => page.getByPlaceholder('请输入手机号').first(),
    codeInput: (page) => page.getByPlaceholder('请输入验证码').first(),
    sendButton: (page) => page.getByText('获取验证码', { exact: true }).first(),
    submitButton: (page) => page.getByRole('button', { name: '登录', exact: true }).last(),
    agreement: (page) => page.locator('input[type=checkbox]:visible').first(),
    async hasCaptcha(page) {
        if ((await page.locator('[class*="yidun"]:visible').count()) > 0)
            return true;
        return genericCaptcha(page);
    },
    visibleError: (page) => bodyError(page, /请求异常|发送失败|操作频繁|验证码错误/),
});
export const neteaseGamesLogin = createSmsLoginProvider({
    id: 'netease.games.sms',
    hosts: ['campus.game.163.com'],
    async prepare(page) {
        if (await visible(page.getByPlaceholder('请输入验证码').first()))
            return;
        await clickLoginEntry(page);
        await page
            .getByPlaceholder('请输入验证码')
            .first()
            .waitFor({ state: 'visible', timeout: 15_000 });
    },
    async isLoggedIn(page) {
        return ((await visible(page.getByText('1. 个人信息（必填）', { exact: true }).first())) &&
            !(await visible(page.getByPlaceholder('请输入验证码').first())));
    },
    phoneInput: (page) => page.getByPlaceholder('请填写手机号码').first(),
    codeInput: (page) => page.getByPlaceholder('请输入验证码').first(),
    sendButton: (page) => page.getByText('获取验证码', { exact: true }).first(),
    submitButton: (page) => page.locator('button:visible').filter({ hasText: /登\s*录/ }).last(),
    async beforeSend(page) {
        const certificate = page.getByPlaceholder('请填写证件信息').first();
        if (!(await visible(certificate)) ||
            (await certificate.inputValue()).trim() === '') {
            throw new Error('网易登录缺少证件号码');
        }
    },
    hasCaptcha: genericCaptcha,
    visibleError: (page) => bodyError(page, /请求异常|发送失败|操作频繁|验证码错误|证件信息错误/),
});
export const mokaSharedLogin = createSmsLoginProvider({
    id: 'moka.shared.sms',
    hosts: ['app.mokahr.com', 'envision-career.com'],
    pathPrefixes: ['/campus-recruitment/'],
    async prepare(page) {
        if (await visible(page.getByPlaceholder('请输入手机号').first()))
            return;
        const entry = page
            .getByText(/^(?:登录|Sign in)$/i, { exact: true })
            .first();
        if (await visible(entry))
            await entry.click();
        const emailOnly = page.getByPlaceholder('Enter email').first();
        await emailOnly
            .waitFor({ state: 'visible', timeout: 3_000 })
            .catch(() => undefined);
        if (await visible(emailOnly)) {
            throw new Error('Moka 当前站点只提供邮箱验证码登录，短信登录不适用');
        }
        const phoneTab = page.getByText('手机号登录', { exact: true }).last();
        await phoneTab
            .waitFor({ state: 'visible', timeout: 15_000 })
            .catch(() => undefined);
        if (await visible(phoneTab))
            await phoneTab.click();
        await page
            .getByPlaceholder('请输入手机号')
            .first()
            .waitFor({ state: 'visible', timeout: 15_000 });
    },
    async isLoggedIn(page) {
        await page
            .waitForFunction(() => {
            const data = window.TurboApply?.data;
            const account = data?.candidateAccount;
            const candidateId = account?.['id'] ?? account?.['candidateAccountId'];
            return (typeof data?.csrfToken === 'string' &&
                data.csrfToken !== '' &&
                account !== undefined &&
                ((typeof candidateId === 'string' && candidateId !== '') ||
                    (typeof candidateId === 'number' && Number.isFinite(candidateId))));
        }, undefined, { timeout: 10_000 })
            .catch(() => undefined);
        return page
            .evaluate(() => {
            const data = window.TurboApply?.data;
            const account = data?.candidateAccount;
            const candidateId = account?.['id'] ?? account?.['candidateAccountId'];
            return (typeof data?.csrfToken === 'string' &&
                data.csrfToken !== '' &&
                account !== undefined &&
                ((typeof candidateId === 'string' && candidateId !== '') ||
                    (typeof candidateId === 'number' && Number.isFinite(candidateId))));
        })
            .catch(() => false);
    },
    phoneInput: (page) => page.getByPlaceholder('请输入手机号').first(),
    codeInput: (page) => page.getByPlaceholder('请输入验证码').first(),
    sendButton: (page) => page.getByText('获取验证码', { exact: true }).last(),
    sentIndicator: (page) => page
        .locator('button:visible, span:visible')
        .filter({ hasText: /重新获取[（(]\d+[）)]/ })
        .last(),
    submitButton: (page) => page.locator('button:visible').filter({ hasText: /^\s*登录\s*$/ }).last(),
    agreement: (page) => page.locator('input[type=checkbox]:visible').last(),
    async beforeSend(page) {
        const agreements = page.locator('input[type=checkbox]:visible');
        for (let index = 0; index < (await agreements.count()); index += 1) {
            const agreement = agreements.nth(index);
            if (await agreement.isChecked().catch(() => false))
                continue;
            const label = agreement.locator('xpath=ancestor::label[1]');
            if ((await label.count()) > 0) {
                await label.click({ force: true });
            }
            const accept = page
                .locator('.sd-Modal-container-3cgHh:visible button:visible')
                .filter({ hasText: /^我已阅读并同意$/ })
                .last();
            await accept
                .waitFor({ state: 'visible', timeout: 3_000 })
                .catch(() => undefined);
            if ((await accept.count()) > 0 && await accept.isVisible().catch(() => false)) {
                await accept.click({ force: true });
            }
            if (!(await agreement.isChecked().catch(() => false))) {
                throw new Error(`Moka 第 ${index + 1} 个隐私条款没有成功勾选`);
            }
        }
    },
    async hasCaptcha(page) {
        if ((await page.locator('[class*="yidun"]:visible').count()) > 0)
            return true;
        return genericCaptcha(page);
    },
    visibleError: (page) => bodyError(page, /请求异常|发送失败|操作频繁|验证码错误|账号异常/),
});
export const oppoCampusLogin = createSmsLoginProvider({
    id: 'oppo.campus.sms',
    hosts: ['careers.oppo.com'],
    async prepare(page) {
        if (new URL(page.url()).pathname !== '/university/oppo/login') {
            await page
                .evaluate(() => window.localStorage.removeItem('enter-page'))
                .catch(() => undefined);
            await page.goto(`${new URL(page.url()).origin}/university/oppo/login`, {
                waitUntil: 'domcontentloaded',
                timeout: 120_000,
            });
        }
        const consent = page.getByRole('button', { name: '同意', exact: true });
        if (await visible(consent))
            await consent.click();
    },
    async isLoggedIn(page) {
        const path = new URL(page.url()).pathname;
        if (path === '/university/oppo/login' ||
            path === '/university/oppo/campus') {
            return false;
        }
        return !(await visible(page.getByPlaceholder('请输入你的账号').first()));
    },
    phoneInput: (page) => page.getByPlaceholder('请输入你的账号').first(),
    codeInput: (page) => page.getByPlaceholder('请输入你的验证码').first(),
    sendButton: (page) => page.getByText('获取验证码', { exact: true }).last(),
    submitButton: (page) => page.getByRole('button', { name: '登录', exact: true }).last(),
    agreement: (page) => page.locator('input[type=checkbox]').last(),
    async beforeSend(page) {
        const agreement = page.locator('input[type=checkbox]').last();
        if ((await agreement.count()) > 0 &&
            !(await agreement.isChecked().catch(() => false))) {
            await agreement.locator('xpath=ancestor::label[1]').click();
        }
    },
    hasCaptcha: genericCaptcha,
    visibleError: (page) => bodyError(page, /请求异常|发送失败|操作频繁|验证码错误|账号异常/),
});
export const bytedanceLogin = createSmsLoginProvider({
    id: 'bytedance.campus.sms',
    hosts: ['jobs.bytedance.com'],
    async prepare(page) {
        if (!new URL(page.url()).pathname.includes('/campus/login')) {
            await page.goto(`${new URL(page.url()).origin}/campus/login`, {
                waitUntil: 'domcontentloaded',
                timeout: 120_000,
            });
        }
        const later = page.getByText('稍后再说', { exact: true });
        if (await visible(later))
            await later.click();
    },
    async isLoggedIn(page) {
        const path = new URL(page.url()).pathname;
        return !path.includes('/login') && !(await visible(page.getByText('登录', { exact: true }).first()));
    },
    phoneInput: (page) => page.getByPlaceholder('手机号码').first(),
    codeInput: (page) => page.getByPlaceholder('验证码').first(),
    sendButton: (page) => page.locator('button:visible').filter({ hasText: /^获取验证码$/ }).first(),
    submitButton: (page) => page.locator('button:visible').filter({ hasText: /^登录$/ }).first(),
    agreement: (page) => page.locator('input[type=checkbox]:visible').first(),
    async beforeSend(page) {
        const later = page.getByText('稍后再说', { exact: true });
        await later.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined);
        if (await visible(later))
            await later.click({ force: true });
        const agreement = page.locator('input[type=checkbox]:visible').first();
        if ((await agreement.count()) > 0 &&
            !(await agreement.isChecked().catch(() => false))) {
            await agreement.evaluate((element) => element.click());
            if (!(await agreement.isChecked().catch(() => false))) {
                throw new Error('字节跳动登录隐私条款没有成功勾选');
            }
        }
    },
    async beforeSubmit(page) {
        const later = page.getByText('稍后再说', { exact: true });
        if (await visible(later))
            await later.click();
    },
    hasCaptcha: genericCaptcha,
    visibleError: (page) => bodyError(page, /当前账号暂时无法登录|请求过于频繁|发送失败|操作频繁/),
});
export const feishuJobsLogin = createSmsLoginProvider({
    id: 'feishu.jobs.sms',
    hostSuffixes: ['.jobs.feishu.cn'],
    async matches(page) {
        return ((await page.locator('#js-websiteInfo').count()) > 0 &&
            ((await page.locator('a[href*="hire.feishu.cn"]').count()) > 0 ||
                (await page.locator('a[href$="/login"]').count()) > 0 ||
                (await page.getByPlaceholder('手机号码').count()) > 0));
    },
    async prepare(page) {
        if (await visible(page.getByPlaceholder('手机号码').first()))
            return;
        await clickLoginEntry(page);
        if (await visible(page.getByPlaceholder('手机号码').first()))
            return;
        const current = new URL(page.url());
        const prefix = current.pathname.split('/').filter(Boolean)[0] ?? 'campus';
        await page.goto(`${current.origin}/${prefix}/login`, {
            waitUntil: 'domcontentloaded',
            timeout: 120_000,
        });
    },
    async isLoggedIn(page) {
        return (!new URL(page.url()).pathname.endsWith('/login') &&
            !(await visible(page.getByText('登录', { exact: true }).first())));
    },
    phoneInput: (page) => page.getByPlaceholder('手机号码').first(),
    codeInput: (page) => page.getByPlaceholder('验证码').first(),
    sendButton: (page) => page.locator('.loginForm-validCode button:visible').first(),
    submitButton: (page) => page.getByRole('button', { name: '登录', exact: true }).first(),
    agreement: (page) => page.locator('input[type=checkbox]:visible').first(),
    beforeSend: prepareAtsxSmsForm,
    async hasCaptcha(page) {
        if (page.frames().some((frame) => frame.url().includes('verifycenter')))
            return true;
        return genericCaptcha(page);
    },
    visibleError: (page) => bodyError(page, /请求异常|发送失败|操作频繁|验证码错误/),
});
export const pddCampusLogin = createSmsLoginProvider({
    id: 'pdd.campus.sms',
    hosts: ['careers.pddglobalhr.com'],
    async prepare(page) {
        if (new URL(page.url()).pathname !== '/campus/resume-apply') {
            await page.goto(`${new URL(page.url()).origin}/campus/resume-apply`, {
                waitUntil: 'domcontentloaded',
                timeout: 120_000,
            });
        }
    },
    async isLoggedIn(page) {
        return (!(await visible(page.locator('#phone'))) &&
            !(await visible(page.getByText('登录/注册', { exact: false }).first())));
    },
    phoneInput: (page) => page.locator('#phone'),
    codeInput: (page) => page.locator('#smsCode'),
    sendButton: (page) => page.getByRole('button', { name: '获取验证码', exact: true }).first(),
    submitButton: (page) => page.locator('button:visible').filter({ hasText: /登\s*录\s*\/\s*注\s*册/ }).first(),
    async beforeSend(page) {
        const checkbox = page.locator('input[type=checkbox]').last();
        if ((await checkbox.count()) > 0 && !(await checkbox.isChecked().catch(() => false))) {
            await checkbox.evaluate((element) => {
                const input = element;
                if (!input.checked)
                    input.click();
            });
            if (!(await checkbox.isChecked().catch(() => false))) {
                throw new Error('拼多多隐私条款没有成功勾选');
            }
        }
    },
    async waitForSendDecision(page) {
        const response = await page
            .waitForResponse((candidate) => {
            const url = new URL(candidate.url());
            return (candidate.request().method() === 'POST' &&
                url.hostname === 'careers.pddglobalhr.com' &&
                url.pathname.endsWith('/api/careers/account/login/sms/send'));
        }, { timeout: 12_000 })
            .catch(() => undefined);
        if (response === undefined)
            return undefined;
        const body = await response.json().catch(() => undefined);
        return classifyPddSmsSendResponse(body);
    },
    hasCaptcha: genericCaptcha,
    sendTimeoutMs: 45_000,
    visibleError: (page) => bodyError(page, /请求异常|发送失败|操作频繁|验证码错误|验证码获取失败/),
});
export const unionsyRecruitmentLogin = createSmsLoginProvider({
    id: 'unionsy.recruitment.sms',
    hosts: ['hr.4399om.com'],
    async prepare(page) {
        if (await visible(page.getByPlaceholder('请输入手机号').first()))
            return;
        await page.goto(`${new URL(page.url()).origin}/uc/login`, {
            waitUntil: 'domcontentloaded',
            timeout: 120_000,
        });
    },
    async isLoggedIn(page) {
        return (new URL(page.url()).pathname.startsWith('/uc/person-center/') &&
            !(await visible(page.getByPlaceholder('请输入手机号').first())));
    },
    phoneInput: (page) => page.getByPlaceholder('请输入手机号').first(),
    codeInput: (page) => page.getByPlaceholder('请输入验证码').first(),
    sendButton: (page) => page.getByText('获取验证码', { exact: true }).first(),
    sentIndicator: (page) => page.locator('.count-down:visible').first(),
    submitButton: (page) => page.getByRole('button', { name: '登录', exact: true }).first(),
    async beforeSend(page) {
        const agreement = page.locator('input[type=checkbox]').first();
        if ((await agreement.count()) > 0 &&
            !(await agreement.isChecked().catch(() => false))) {
            await page.locator('label.private-check').click();
        }
    },
    async hasCaptcha(page) {
        if ((await page.locator('.slide_puzzle_img_bg:visible').count()) > 0) {
            return true;
        }
        return genericCaptcha(page);
    },
    visibleError: (page) => bodyError(page, /发送失败|操作频繁|验证码错误|验证码获取失败|验证码不正确|已达验证码获取次数上限/),
});
export const lenovoTalentLogin = createSmsLoginProvider({
    id: 'lenovo.talent.sms',
    hosts: ['talent.lenovo.com.cn', 'passport.lenovo.com'],
    async prepare(page) {
        if (await visible(page.locator('#loginInput1:visible, #loginClass2Input2:visible').first())) {
            return;
        }
        await page.goto('https://talent.lenovo.com.cn/account/resume', {
            waitUntil: 'domcontentloaded',
            timeout: 120_000,
        });
        await page
            .locator('#loginInput1:visible, #loginClass2Input2:visible')
            .first()
            .waitFor({ state: 'visible', timeout: 20_000 });
    },
    async isLoggedIn(page) {
        const url = new URL(page.url());
        return (url.hostname === 'talent.lenovo.com.cn' &&
            url.pathname.startsWith('/account/resume') &&
            !(await visible(page.locator('#loginInput1:visible').first())));
    },
    phoneInput: (page) => page.locator('#loginInput1:visible, #loginClass2Input2:visible').first(),
    codeInput: (page) => page.locator('#loginClass2Input2:visible').first(),
    sendButton: (page) => page.getByRole('button', { name: '获取验证码', exact: true }).first(),
    sentIndicator: (page) => page.locator('.recapture:visible').filter({ hasText: /\d+/ }).first(),
    submitButton: (page) => page.locator('input[type=button][value="登录"]:visible').first(),
    async beforeSend(page) {
        const phone = page.locator('#loginInput1:visible').first();
        if (await visible(phone)) {
            const agreement = page.locator('#securityLoginState');
            if ((await agreement.count()) > 0 &&
                !(await agreement.isChecked().catch(() => false))) {
                await agreement.check({ force: true });
            }
            await page.locator('#phoneSign1').click();
            await page
                .locator('#loginClass2Input2:visible')
                .waitFor({ state: 'visible', timeout: 20_000 });
        }
    },
    async hasCaptcha(page) {
        if ((await page
            .locator('#canvas:visible, #block:visible, .verSliderBlock:visible')
            .count()) > 0) {
            return true;
        }
        return genericCaptcha(page);
    },
    visibleError: (page) => bodyError(page, /验证码错误|验证码不正确|发送失败|操作频繁|请求异常/),
});
export const jdCampusLogin = createSmsLoginProvider({
    id: 'jd.campus.sms',
    hosts: ['campus.jd.com'],
    async prepare(page) {
        if (!new URL(page.url()).pathname.startsWith('/passport/')) {
            await page.goto(`${new URL(page.url()).origin}/web/`, {
                waitUntil: 'domcontentloaded',
                timeout: 120_000,
            });
        }
    },
    async isLoggedIn(page) {
        return (!new URL(page.url()).pathname.startsWith('/passport/') &&
            !(await visible(page.getByPlaceholder('请输入手机号'))) &&
            !(await visible(page.getByText('登录', { exact: true }).first())));
    },
    phoneInput: (page) => page.getByPlaceholder('请输入手机号'),
    codeInput: (page) => page.getByPlaceholder('请输入验证码'),
    sendButton: (page) => page.getByRole('button', { name: '获取验证码', exact: true }),
    submitButton: (page) => page.getByRole('button', { name: '登录', exact: true }),
    hasCaptcha: genericCaptcha,
    visibleError: (page) => bodyError(page, /请求异常|发送失败|操作频繁|验证码错误|验证码获取失败/),
});
export const xiaomiMiofficeLogin = createSmsLoginProvider({
    id: 'xiaomi.mioffice.sms',
    hosts: ['xiaomi.jobs.f.mioffice.cn'],
    async prepare(page) {
        if (!new URL(page.url()).pathname.endsWith('/campus/login')) {
            await page.goto(`${new URL(page.url()).origin}/campus/login`, {
                waitUntil: 'domcontentloaded',
                timeout: 120_000,
            });
        }
    },
    async isLoggedIn(page) {
        if (new URL(page.url()).pathname.endsWith('/campus/login'))
            return false;
        const loginEntry = page
            .locator('a:visible, button:visible')
            .filter({ hasText: /^\s*登录\s*$/ })
            .first();
        await loginEntry
            .waitFor({ state: 'visible', timeout: 5_000 })
            .catch(() => undefined);
        return (!(await visible(loginEntry)));
    },
    phoneInput: (page) => page.getByPlaceholder('手机号码').first(),
    codeInput: (page) => page.getByPlaceholder('验证码').first(),
    sendButton: (page) => page.locator('.loginForm-validCode button:visible').first(),
    submitButton: (page) => page.getByRole('button', { name: '登录', exact: true }).last(),
    agreement: (page) => page.locator('input[type=checkbox]:visible').first(),
    beforeSend: prepareAtsxSmsForm,
    hasCaptcha: genericCaptcha,
    visibleError: (page) => bodyError(page, /请求异常|发送失败|操作频繁|验证码错误|验证码获取失败/),
});
function mihoyoLoginFrame(page) {
    return page.frameLocator('iframe[name="mihoyo-login-platform-iframe"], iframe[src*="login-platform"]');
}
export const mihoyoCampusLogin = createSmsLoginProvider({
    id: 'mihoyo.campus.sms',
    hosts: ['jobs.mihoyo.com'],
    async prepare(page) {
        if ((await page.locator('iframe[src*="login-platform"]').count()) === 0) {
            await page.goto(`${new URL(page.url()).origin}/#/campus/resume/edit`, {
                waitUntil: 'domcontentloaded',
                timeout: 120_000,
            });
        }
    },
    async isLoggedIn(page) {
        const token = await page
            .evaluate(() => window.localStorage.getItem('Jobs-Token') ?? '')
            .catch(() => '');
        return ((await page.locator('iframe[src*="login-platform"]').count()) === 0 &&
            token !== '');
    },
    phoneInput: (page) => mihoyoLoginFrame(page).getByPlaceholder('手机号'),
    codeInput: (page) => mihoyoLoginFrame(page).getByPlaceholder('验证码'),
    sendButton: (page) => mihoyoLoginFrame(page).getByRole('button', {
        name: '获取验证码',
        exact: true,
    }),
    submitButton: (page) => mihoyoLoginFrame(page).getByRole('button', { name: '登录', exact: true }),
    async beforeSend(page) {
        const checkbox = mihoyoLoginFrame(page).locator('input[type=checkbox]').last();
        if ((await checkbox.count()) > 0 && !(await checkbox.isChecked().catch(() => false))) {
            await checkbox.evaluate((element) => {
                const input = element;
                if (!input.checked)
                    input.click();
            });
        }
    },
    async hasCaptcha(page) {
        const frame = mihoyoLoginFrame(page);
        return ((await frame
            .locator('.geetest_panel:visible, .yidun_panel:visible, [class*="slider"]:visible, canvas:visible')
            .count()) > 0 ||
            page.frames().some((candidate) => !candidate.url().includes('login-platform') &&
                /verifycenter|geetest|captcha/i.test(candidate.url())));
    },
    visibleError: (page) => bodyError(page, /请求异常|发送失败|操作频繁|验证码错误|验证码获取失败/),
});
//# sourceMappingURL=recruitment-sms-providers.js.map