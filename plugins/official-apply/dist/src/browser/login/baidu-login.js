import { redactLoginPageUrl, } from "./contracts.js";
const PROVIDER_ID = 'baidu.talent.sms';
const LOGGED_IN_PATHS = new Set([
    '/jobs/center',
    '/jobs/resume/create',
    '/jobs/resume/edit',
]);
function result(page, input) {
    return {
        providerId: PROVIDER_ID,
        pageUrlRedacted: redactLoginPageUrl(page.url()),
        ...input,
    };
}
async function isVisible(locator) {
    return (await locator.count()) > 0 && locator.isVisible().catch(() => false);
}
async function isLoggedIn(page) {
    let pathname = '';
    try {
        pathname = new URL(page.url()).pathname;
    }
    catch {
        return false;
    }
    if (!LOGGED_IN_PATHS.has(pathname)) {
        return false;
    }
    if (!(await isVisible(page.getByText(/你好[，,]/).first()))) {
        return false;
    }
    if (pathname === '/jobs/center') {
        return isVisible(page.getByText('我的简历', { exact: true }).first());
    }
    return isVisible(page.getByText('基础信息', { exact: true }).first());
}
async function visibleError(page) {
    const errors = page.locator('.pass-generalError:visible, .pass-item-error:visible, [class*="error"]:visible');
    const count = Math.min(await errors.count(), 12);
    for (let index = 0; index < count; index += 1) {
        const text = (await errors.nth(index).innerText().catch(() => '')).trim();
        if (text !== '') {
            return text.replace(/\b\d{6,}\b/g, '[数字]');
        }
    }
    return undefined;
}
async function hasCaptcha(page) {
    const captcha = page.locator([
        '.vcode-spin-wrapper:visible',
        '.passMod_dialog-wrapper:visible',
        '.passMod_verifyCode:visible',
        'iframe[src*="captcha"]:visible',
        'iframe[src*="verify"]:visible',
    ].join(', '));
    if ((await captcha.count()) > 0) {
        return true;
    }
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    return /拖动滑块|完成安全验证|请完成验证|图片验证码|图形验证码/.test(body);
}
function phoneInput(page) {
    return page.locator([
        'input.pass-text-input-smsPhone:visible',
        'input[placeholder*="手机号"]:visible',
        'input[placeholder*="手机号码"]:visible',
        'input[type="tel"]:visible',
    ].join(', ')).first();
}
function codeInput(page) {
    return page.locator([
        'input.pass-text-input-smsVerifyCode:visible',
        'input[placeholder*="验证码"]:visible',
        'input[name*="code"]:visible',
        'input[autocomplete="one-time-code"]:visible',
    ].join(', ')).first();
}
function sendButton(page) {
    return page.getByRole('button', {
        name: /获取验证码|发送验证码|获取短信验证码|重新发送/,
    }).first();
}
async function waitForSmsTab(page) {
    let smsTab = page.getByText('短信登录', { exact: true }).last();
    if (!(await isVisible(smsTab))) {
        const login = page.getByText('登录', { exact: true }).first();
        if (await isVisible(login)) {
            await login.click();
        }
        smsTab = page.getByText('短信登录', { exact: true }).last();
        await smsTab.waitFor({ state: 'visible', timeout: 10_000 });
    }
    return smsTab;
}
/**
 * 明确切到短信登录，再返回可见手机号框。
 *
 * 百度同时把账号登录和短信登录的 DOM 放在页面里。只按 placeholder 找，
 * 会抓到隐藏输入框并等到超时，所以这里每一步都检查可见状态。
 */
export async function prepareBaiduSmsLogin(page) {
    if (await isLoggedIn(page)) {
        return result(page, {
            stage: 'logged_in',
            nextAction: 'continue_application',
            evidence: ['网址是百度个人中心或简历编辑页', '页头显示当前账号问候语'],
        });
    }
    const smsTab = await waitForSmsTab(page);
    await smsTab.click();
    await phoneInput(page).waitFor({ state: 'visible', timeout: 10_000 });
    const className = (await smsTab.getAttribute('class')) ?? '';
    if (!className.includes('activ')) {
        return result(page, {
            stage: 'failed',
            nextAction: 'record_blocker',
            evidence: ['点击了“短信登录”，但标签没有变成选中状态'],
            errorCode: 'login_sms_tab_not_activated',
        });
    }
    return result(page, {
        stage: 'sms_ready',
        nextAction: 'begin_sms',
        evidence: ['“短信登录”标签已选中', '可见手机号输入框已出现'],
    });
}
async function inspectBaiduLogin(page) {
    await page
        .getByText(/你好[，,]/)
        .first()
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => undefined);
    if (await isLoggedIn(page)) {
        return result(page, {
            stage: 'logged_in',
            nextAction: 'continue_application',
            evidence: ['网址是百度个人中心或简历编辑页', '页头显示当前账号问候语'],
        });
    }
    if (await hasCaptcha(page)) {
        return result(page, {
            stage: 'captcha_required',
            nextAction: 'confirm_captcha',
            evidence: ['页面出现安全验证控件'],
        });
    }
    const phone = phoneInput(page);
    if (await isVisible(phone)) {
        const send = sendButton(page);
        const text = (await send.innerText().catch(() => '')).trim();
        const disabled = await send.isDisabled().catch(() => false);
        if (disabled || /重新发送|\d+\s*s|\d+\s*秒/.test(text)) {
            return result(page, {
                stage: 'code_sent',
                nextAction: 'read_sms',
                evidence: ['短信登录页已打开', '发送按钮进入倒计时或禁用状态'],
            });
        }
        return result(page, {
            stage: 'sms_ready',
            nextAction: 'begin_sms',
            evidence: ['短信登录页已打开', '可见手机号输入框已出现'],
        });
    }
    const smsTab = page.getByText('短信登录', { exact: true }).last();
    if (await isVisible(smsTab)) {
        return result(page, {
            stage: 'login_required',
            nextAction: 'begin_sms',
            evidence: ['百度登录弹窗已打开', '当前还没有切到短信登录'],
        });
    }
    const login = page.getByText('登录', { exact: true }).first();
    if (await isVisible(login)) {
        return result(page, {
            stage: 'login_required',
            nextAction: 'begin_sms',
            evidence: ['页面显示登录入口'],
        });
    }
    return result(page, {
        stage: 'failed',
        nextAction: 'record_blocker',
        evidence: ['没有识别到登录成功标志或百度登录控件'],
        errorCode: 'login_state_unrecognized',
    });
}
async function beginBaiduSms(page, input) {
    if (!/^1\d{10}$/.test(input.phone)) {
        return result(page, {
            stage: 'failed',
            nextAction: 'record_blocker',
            evidence: ['手机号格式不符合百度中国大陆手机号规则'],
            errorCode: 'login_phone_invalid',
        });
    }
    const current = await inspectBaiduLogin(page);
    if (current.stage === 'logged_in' ||
        current.stage === 'code_sent' ||
        current.stage === 'captcha_required') {
        return current;
    }
    const prepared = await prepareBaiduSmsLogin(page);
    if (prepared.stage === 'logged_in' || prepared.stage === 'failed') {
        return prepared;
    }
    await phoneInput(page).fill(input.phone);
    const send = sendButton(page);
    await send.waitFor({ state: 'visible', timeout: 10_000 });
    await send.click();
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
        if (await hasCaptcha(page)) {
            return result(page, {
                stage: 'captcha_required',
                nextAction: 'confirm_captcha',
                evidence: ['手机号已填写', '点击发送后出现安全验证'],
                requestedAt: input.now,
            });
        }
        const error = await visibleError(page);
        if (error !== undefined) {
            return result(page, {
                stage: 'failed',
                nextAction: 'retry_sms',
                evidence: ['短信发送后页面显示错误'],
                errorCode: 'login_sms_send_rejected',
                message: error,
            });
        }
        const text = (await send.innerText().catch(() => '')).trim();
        const disabled = await send.isDisabled().catch(() => false);
        if (disabled || /重新发送|\d+\s*s|\d+\s*秒/.test(text)) {
            return result(page, {
                stage: 'code_sent',
                nextAction: 'read_sms',
                evidence: ['短信登录页已打开', '手机号已填写', '发送按钮进入倒计时或禁用状态'],
                requestedAt: input.now,
            });
        }
        await page.waitForTimeout(250);
    }
    return result(page, {
        stage: 'failed',
        nextAction: 'retry_sms',
        evidence: ['点击了发送验证码，但没有倒计时、验证码挑战或明确错误'],
        errorCode: 'login_sms_send_unconfirmed',
    });
}
async function submitBaiduSmsCode(page, input) {
    if (!/^\d{4,8}$/.test(input.code)) {
        return result(page, {
            stage: 'code_rejected',
            nextAction: 'provide_sms_code',
            evidence: ['验证码格式不是 4 到 8 位数字'],
            errorCode: 'login_code_invalid',
        });
    }
    if (await hasCaptcha(page)) {
        return result(page, {
            stage: 'captcha_required',
            nextAction: 'confirm_captcha',
            evidence: ['提交短信验证码前仍有安全验证'],
        });
    }
    const code = codeInput(page);
    await code.waitFor({ state: 'visible', timeout: 10_000 });
    await code.fill(input.code);
    const submit = page.locator('input.pass-button-submit:visible').last();
    await submit.waitFor({ state: 'visible', timeout: 10_000 });
    await submit.click();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        if (await isLoggedIn(page)) {
            return result(page, {
                stage: 'logged_in',
                nextAction: 'continue_application',
                evidence: ['验证码已提交', '网址回到百度简历编辑页', '页面显示“基础信息”'],
            });
        }
        if (await hasCaptcha(page)) {
            return result(page, {
                stage: 'captcha_required',
                nextAction: 'confirm_captcha',
                evidence: ['提交短信验证码后出现安全验证'],
            });
        }
        const error = await visibleError(page);
        if (error !== undefined) {
            return result(page, {
                stage: 'code_rejected',
                nextAction: 'provide_sms_code',
                evidence: ['验证码已提交', '页面显示验证码错误'],
                errorCode: 'login_code_rejected',
                message: error,
            });
        }
        await page.waitForTimeout(250);
    }
    return result(page, {
        stage: 'failed',
        nextAction: 'record_blocker',
        evidence: ['验证码已提交，但没有登录成功标志或明确错误'],
        errorCode: 'login_submit_unconfirmed',
    });
}
export const baiduTalentLogin = {
    id: PROVIDER_ID,
    hosts: ['talent.baidu.com'],
    inspect: inspectBaiduLogin,
    beginSms: beginBaiduSms,
    submitSmsCode: submitBaiduSmsCode,
};
//# sourceMappingURL=baidu-login.js.map